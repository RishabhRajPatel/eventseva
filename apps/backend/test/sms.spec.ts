// The SMS adapter: what MSG91 is actually sent, and what happens when it will not take the message.
// No app or database here — this is the one piece that talks to the outside world, so it is tested
// against a stubbed fetch rather than a real account.
import { Msg91OtpSender, parseMsg91, type Msg91Config } from '../src/auth/msg91-sender';
import { loadConfig } from '../src/config';

const CONFIG: Msg91Config = { authKey: 'key-123', templateId: 'tpl-en', templateIdHi: 'tpl-hi', timeoutMs: 8000 };

describe('MSG91 OTP sender', () => {
  const realFetch = global.fetch;
  let calls: { url: string; init: RequestInit }[];

  const stub = (reply: { status?: number; body: unknown }) => {
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: (reply.status ?? 200) < 400,
        status: reply.status ?? 200,
        text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
      };
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    calls = [];
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const sent = () => JSON.parse(calls[0].init.body as string);

  it('sends the code against the DLT template, with the country code and no plus', async () => {
    stub({ body: { type: 'success', message: 'abc' } });
    await new Msg91OtpSender(CONFIG).send('+919822222222', '123456', 'en');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://control.msg91.com/api/v5/flow');
    expect((calls[0].init.headers as Record<string, string>).authkey).toBe('key-123');
    expect(sent()).toEqual({ template_id: 'tpl-en', short_url: '0', recipients: [{ mobiles: '919822222222', OTP: '123456' }] });
  });

  it('uses the Hindi template for Hindi, and falls back to English when there is no Hindi one', async () => {
    stub({ body: { type: 'success' } });
    await new Msg91OtpSender(CONFIG).send('+919822222222', '111111', 'hi');
    expect(sent().template_id).toBe('tpl-hi');

    calls = [];
    await new Msg91OtpSender({ ...CONFIG, templateIdHi: undefined }).send('+919822222222', '111111', 'hi');
    expect(sent().template_id).toBe('tpl-en');
  });

  it('throws when MSG91 refuses, so the user is never told a code is coming when it is not', async () => {
    // MSG91 answers 200 with type "error" for a rejected template or a bad number.
    stub({ body: { type: 'error', message: 'Template id is invalid' } });
    await expect(new Msg91OtpSender(CONFIG).send('+919822222222', '123456', 'en')).rejects.toThrow(/Template id is invalid/);

    stub({ status: 401, body: { message: 'authkey is invalid' } });
    await expect(new Msg91OtpSender(CONFIG).send('+919822222222', '123456', 'en')).rejects.toThrow(/401/);

    // A body that is not JSON at all (a gateway error page) still fails cleanly.
    stub({ status: 502, body: '<html>Bad gateway</html>' });
    await expect(new Msg91OtpSender(CONFIG).send('+919822222222', '123456', 'en')).rejects.toThrow(/502/);
  });

  it('reports a network failure as unreachable rather than hanging', async () => {
    global.fetch = (async () => {
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as typeof fetch;
    await expect(new Msg91OtpSender(CONFIG).send('+919822222222', '123456', 'en')).rejects.toThrow(/MSG91 unreachable.*timeout/);
  });

  it('never writes the code to the log', async () => {
    const logged: string[] = [];
    const spy = jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    stub({ body: { type: 'success' } });
    await new Msg91OtpSender(CONFIG).send('+919822222222', '654321', 'en');
    spy.mockRestore();

    expect(logged.join(' ')).not.toContain('654321');
    expect(logged.join(' ')).toContain('9198XXXXX22');
  });
});

describe('OTP provider configuration', () => {
  const base = { DATABASE_URL: 'postgres://x/y', JWT_SECRET: 'a'.repeat(40), OTP_PEPPER: 'b'.repeat(40) };

  it('msg91 needs its credentials at boot, not at the first login', () => {
    expect(() => parseMsg91({ OTP_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY and MSG91_TEMPLATE_ID/);
    expect(() => loadConfig({ ...base, OTP_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
    expect(loadConfig({ ...base, OTP_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' }).msg91)
      .toMatchObject({ authKey: 'k', templateId: 't', timeoutMs: 8000 });
  });

  it('an unknown provider is refused rather than silently printing codes to the log', () => {
    expect(() => loadConfig({ ...base, OTP_PROVIDER: 'twilio' })).toThrow(/must be console or msg91/);
  });

  it('console is still refused in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', OTP_PROVIDER: 'console' })).toThrow(/development only/);
  });

  it('development keeps the console sender, with no credentials needed', () => {
    expect(loadConfig(base).msg91).toBeUndefined();
    expect(loadConfig(base).otpProvider).toBe('console');
  });
});
