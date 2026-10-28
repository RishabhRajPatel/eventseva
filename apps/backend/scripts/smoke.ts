// Smoke test of a running API: a vendor signs up, the admin approves, a customer books, pays, extends and
// checks out a cart, every step over HTTP as the apps do it. It writes real rows, so run it only against a
// local or staging stack started with NODE_ENV=development, OTP_PROVIDER=console and PAYMENT_PROVIDER=fake
// (production refuses those, so this script cannot pass there). See docs/DEPLOY.md, "Smoke test".
//   SMOKE_API_URL         API to test (default http://localhost:3000)
//   SMOKE_LOGS            shell command that prints the API log, where console OTPs appear
//                         (default `docker compose logs api`)
//   SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD, SMOKE_ADMIN_TOTP_SECRET   an admin made with `pnpm create-admin`
//   SMOKE_CLOUDINARY_SECRET   the api_secret in the API's CLOUDINARY_URL, to sign a test upload
// Each run uses new phone numbers, so it can run again on the same database.
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { signParams } from '../src/media/cloudinary.service';
import { totpAt } from '../src/admin/totp';

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`set ${name}`);
  return v;
};
const API = (process.env.SMOKE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const LOGS = process.env.SMOKE_LOGS ?? 'docker compose logs api';
const SECRET = need('SMOKE_CLOUDINARY_SECRET');
const ADMIN_EMAIL = need('SMOKE_ADMIN_EMAIL');
const ADMIN_PASSWORD = need('SMOKE_ADMIN_PASSWORD');
const adminSecret = need('SMOKE_ADMIN_TOTP_SECRET');
/** A fresh 10-digit Indian mobile number. */
const mobile = () => `98${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
let passed = 0;
const step = (name: string) => console.log(`\n▶ ${name}`);
function check(cond: unknown, what: string, extra?: unknown) {
  if (!cond) {
    console.error(`✗ ${what}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${what}`);
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
const ok = async (method: string, path: string, opts: Parameters<typeof call>[2] = {}, want = [200, 201, 204]) => {
  const r = await call(method, path, opts);
  if (!want.includes(r.status)) {
    console.error(`✗ ${method} ${path} → ${r.status}`, JSON.stringify(r.body).slice(0, 600));
    process.exit(1);
  }
  return r.body;
};

function otpFromLog(phone: string): string {
  const masked = `${phone.slice(0, 5)}XXXXX${phone.slice(-2)}`;
  const log = execSync(LOGS, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const hits = [...log.matchAll(new RegExp(`OTP for ${masked.replace('+', '\\+')}: (\\d{4,8})`, 'g'))];
  if (!hits.length) throw new Error(`no OTP in log for ${masked}`);
  return hits[hits.length - 1][1];
}

async function login(mobile: string, app: 'customer' | 'partner') {
  const phone = `+91${mobile}`;
  await ok('POST', '/v1/auth/otp/send', { body: { phone } });
  await new Promise((r) => setTimeout(r, 300));
  const res = await ok('POST', '/v1/auth/otp/verify', { body: { phone, code: otpFromLog(phone), app } });
  return { token: res.accessToken as string, userId: res.user.id as string };
}

const day = (n: number) => {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (d: string, hhmm: string) => `${d}T${hhmm}:00+05:30`;
let lastTotp = '';
/** A 2FA code not used before (each code works once). */
async function freshTotp() {
  for (;;) {
    const code = totpAt(adminSecret);
    if (code !== lastTotp) {
      lastTotp = code;
      return code;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  step('Health and public catalogue');
  check((await ok('GET', '/health')).ok === true, 'API is healthy');
  const cats = (await ok('GET', '/v1/categories')).items as { id: number; slug: string }[];
  const dj = cats.find((c) => c.slug === 'dj')!;
  check(dj, 'DJ category is visible', cats.map((c) => c.slug));
  check(cats.some((c) => c.slug === 'car'), 'Cars & Travel category is visible');

  step('Vendor signs up in the Partner app');
  const vendor = await login(mobile(), 'partner');
  await ok('PATCH', '/v1/me', { token: vendor.token, body: { name: 'Raj Kumar' } });
  const v = await ok('POST', '/v1/partner/vendor', {
    token: vendor.token,
    body: { businessName: 'Raj DJ Sound', categoryId: dj.id, cityId: 1, area: 'Civil Lines', address: '12 MG Marg, Civil Lines', lat: 25.4484, lng: 81.8406, about: 'Wedding DJ with lights and sound for sangeet and baraat since 2012.' },
  });
  check(v.id, 'vendor profile created');
  const setup = await ok('GET', '/v1/partner/service-setup', { token: vendor.token });
  check(setup.bookingType === 'time_window', 'DJ is booked by time window', setup.bookingType);
  const photoId = `eventseva/vendors/${v.id}/media/stage1`;
  await ok('POST', '/v1/partner/media', {
    token: vendor.token,
    body: { publicId: photoId, version: 1, signature: signParams({ public_id: photoId, version: 1 }, SECRET), type: 'photo', width: 1200, height: 800, bytes: 200_000, etag: 'abcdef1234567890' },
  });
  const forged = await call('POST', '/v1/partner/media', {
    token: vendor.token,
    body: { publicId: `eventseva/vendors/${v.id}/media/x`, version: 1, signature: 'a'.repeat(40), type: 'photo', width: 10, height: 10, bytes: 10, etag: 'abcdef1234567891' },
  });
  check(forged.status >= 400, 'a forged upload signature is refused', forged);
  const svc = await ok('POST', '/v1/partner/engine-services', {
    token: vendor.token,
    body: { title: 'Wedding DJ night', pricing: { model: 'fixed', ratePaise: 1_500_000, includedHours: 4, overtimeHourPaise: 200_000 }, rules: { approval: 'vendor' }, attributes: { speakers_watt: 5000, lights_included: true } },
  });
  check(svc.id && svc.bookingType === 'time_window', 'engine service added');
  const gst = await call('POST', '/v1/partner/engine-services', { token: vendor.token, body: { title: 'With GST', pricing: { model: 'fixed', ratePaise: 100_000, taxPercent: 18 } } });
  check(gst.status === 400 && gst.body.error.code === 'GSTIN_REQUIRED', 'GST needs a GST number first', gst.body);
  await ok('POST', '/v1/partner/vendor/submit', { token: vendor.token });

  step('Admin approves (real create-admin login with 2FA)');
  // A 2FA code works once; if an earlier run just used this one, the next code is tried.
  const loginAdmin = async () => call('POST', '/v1/admin/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, totp: await freshTotp() } });
  let res = await loginAdmin();
  if (res.status === 401) res = await loginAdmin();
  check(res.status === 201 || res.status === 200, 'admin logs in with password and 2FA', res.body);
  const adm = res.body;
  const admin = adm.accessToken as string;
  const media = (await ok('GET', '/v1/admin/media?status=pending', { token: admin })).items as { id: string }[];
  for (const m of media) await ok('POST', `/v1/admin/media/${m.id}/approve`, { token: admin });
  await ok('POST', `/v1/admin/vendors/${v.id}/approve`, { token: admin, body: {} });
  const dash = await ok('GET', '/v1/admin/dashboard', { token: admin });
  check(dash.liveVendors >= 1 && typeof dash.pendingChecks === 'number' && typeof dash.openDisputes === 'number', 'dashboard counts include checks and disputes', dash);

  step('Customer finds the vendor and books');
  const cust = await login(mobile(), 'customer');
  await ok('PATCH', '/v1/me', { token: cust.token, body: { name: 'Rahul' } });
  const ev = await ok('POST', '/v1/events', { token: cust.token, body: { title: "Rahul's Wedding", eventType: 'wedding', eventDate: day(20), cityId: 1, venueAddress: 'Shubh Mangal Hall, Civil Lines', venueLat: 25.45, venueLng: 81.84, guestCount: 300 } });
  const list = await ok('GET', '/v1/vendors?category=dj&cityId=1');
  check(list.items.some((x: { id: string }) => x.id === v.id), 'vendor is listed for customers');
  const page = await ok('GET', `/v1/vendors/${v.id}`);
  check(page.engineServiceCount === 1 && page.category.bookingType === 'time_window', 'vendor page offers "Book"', { c: page.engineServiceCount, t: page.category });
  const pub = (await ok('GET', `/v1/vendors/${v.id}/engine-services`)).items;
  check(pub[0].questions.some((q: { key: string }) => q.key === 'occasion'), 'customer sees the vendor questions');
  const req = { eventId: ev.id, serviceId: svc.id, startsAt: at(day(20), '19:00'), endsAt: at(day(20), '23:59'), answers: { occasion: 'sangeet' } };
  const missing = await call('POST', '/v1/quotes', { token: cust.token, body: { ...req, answers: {} } });
  check(missing.status === 400 && missing.body.error.code === 'ANSWER_REQUIRED', 'a required question must be answered', missing.body);
  const quote = await ok('POST', '/v1/quotes', { token: cust.token, body: req });
  check(quote.totalPaise >= 1_500_000 && quote.lines.some((l: { code: string }) => l.code === 'overtime'), 'price has the base and overtime', quote.lines);
  const run = randomInt(0, 1e9).toString(36);
  const key = { 'idempotency-key': `smoke-book-${run}` };
  const b1 = await ok('POST', '/v1/engine-bookings', { token: cust.token, body: req, headers: key });
  const again = await ok('POST', '/v1/engine-bookings', { token: cust.token, body: req, headers: key });
  check(b1.id === again.id, 'a retried tap does not make a second booking');
  const rival = await login(mobile(), 'customer');
  const ev2 = await ok('POST', '/v1/events', { token: rival.token, body: { title: 'Other', eventType: 'party', eventDate: day(20), cityId: 1 } });
  const clash = await call('POST', '/v1/engine-bookings', { token: rival.token, body: { ...req, eventId: ev2.id } });
  check(clash.status === 409 && clash.body.error.code === 'NOT_AVAILABLE', 'the same evening cannot be double-booked', clash.body);

  step('Vendor accepts, customer pays, money and invoices');
  const seen = await ok('GET', `/v1/partner/bookings/${b1.id}`, { token: vendor.token });
  check(seen.questions.find((q: { key: string }) => q.key === 'occasion')?.label.hi === 'मौका', 'vendor sees the answer with its Hindi label');
  await ok('POST', `/v1/partner/bookings/${b1.id}/accept`, { token: vendor.token });
  const paid = await ok('POST', `/v1/bookings/${b1.id}/pay/dev`, { token: cust.token });
  check(paid.status === 'confirmed', 'advance paid, booking confirmed', paid.status);
  const inv = await ok('GET', `/v1/bookings/${b1.id}/invoice`, { token: cust.token });
  check(inv.title === 'Proforma invoice' && inv.number === 'PROFORMA' && inv.totalPaise === paid.amountPaise && inv.paidPaise === paid.advancePaise, 'proforma invoice in the vendor name while the booking can change', inv);
  const comm = await ok('GET', `/v1/partner/bookings/${b1.id}/commission-invoice`, { token: vendor.token });
  check(comm.seller.name !== v.businessName && comm.taxablePaise === seen.commissionPaise, 'commission invoice from EventSeva', comm);
  const stranger = await call('GET', `/v1/bookings/${b1.id}/invoice`, { token: rival.token });
  check(stranger.status === 404, 'another customer cannot read the invoice');

  step('Extension asked by the customer, approved by the vendor');
  const ch = await ok('POST', `/v1/bookings/${b1.id}/changes`, { token: cust.token, body: { kind: 'extension', endsAt: at(day(21), '01:59'), reason: 'Baraat late' } });
  check(ch.priceDiffPaise > 0, 'extension costs more', ch);
  const twice = await call('POST', `/v1/bookings/${b1.id}/changes`, { token: cust.token, body: { kind: 'extension', endsAt: at(day(21), '02:30') } });
  check(twice.status === 409 && twice.body.error.code === 'CHANGE_PENDING', 'one open change at a time', twice.body);
  await ok('POST', `/v1/partner/bookings/${b1.id}/changes/${ch.id}/approve`, { token: vendor.token });
  const after = await ok('GET', `/v1/bookings/${b1.id}`, { token: cust.token });
  check(after.amountPaise === paid.amountPaise + ch.priceDiffPaise && Date.parse(after.endsAt) === Date.parse(at(day(21), '01:59')), 'new end time and price on the booking', { a: after.amountPaise, e: after.endsAt });
  const inv2 = await ok('GET', `/v1/bookings/${b1.id}/invoice`, { token: cust.token });
  check(inv2.totalPaise === after.amountPaise, 'proforma follows the new price', { inv: inv2.totalPaise, booking: after.amountPaise });

  step('Cart: two evenings booked together, all or none');
  const day2 = day(25);
  const items = [
    { eventId: ev.id, serviceId: svc.id, startsAt: at(day2, '18:00'), endsAt: at(day2, '22:00'), answers: { occasion: 'reception' } },
    { eventId: ev.id, serviceId: svc.id, startsAt: at(day2, '19:00'), endsAt: at(day2, '23:00'), answers: { occasion: 'party' } },
  ];
  const bad = await call('POST', '/v1/checkouts', { token: cust.token, body: { items }, headers: { 'idempotency-key': `smoke-cart-${run}-1` } });
  check(bad.status === 409 && bad.body.error.itemIndex === 1, 'overlapping cart is refused, pointing at line 2', bad.body);
  const mine = (await ok('GET', '/v1/bookings', { token: cust.token })).items;
  check(mine.length === 1, 'nothing from the failed cart was kept', mine.length);
  const good = await ok('POST', '/v1/checkouts', { token: cust.token, body: { items: [items[0], { ...items[1], startsAt: at(day(26), '19:00'), endsAt: at(day(26), '23:00') }] }, headers: { 'idempotency-key': `smoke-cart-${run}-2` } });
  check(good.bookings.length === 2, 'cart made two bookings', good);

  step('Customer cancels one request; vendor declines the other');
  await ok('POST', `/v1/bookings/${good.bookings[0].id}/cancel`, { token: cust.token, body: { reason: 'Changed plans' } });
  await ok('POST', `/v1/partner/bookings/${good.bookings[1].id}/reject`, { token: vendor.token, body: { reason: 'Already booked elsewhere' } });
  const statuses = (await ok('GET', '/v1/bookings', { token: cust.token })).items.map((x: { status: string }) => x.status).sort();
  check(JSON.stringify(statuses) === JSON.stringify(['cancelled_by_customer', 'confirmed', 'rejected']), 'statuses are right', statuses);

  step('Admin: booking detail, invoices, reports, refunds');
  const det = await ok('GET', `/v1/admin/bookings/${b1.id}`, { token: admin });
  check(det.bookingType === 'time_window' && det.startsAt, 'admin booking page has engine fields');
  const both = await ok('GET', `/v1/admin/bookings/${b1.id}/invoices`, { token: admin });
  check(both.customer.title === 'Proforma invoice', 'admin sees the proforma too');
  const rep = await ok('GET', `/v1/admin/reports/summary?from=${day(0)}&to=${day(40)}`, { token: admin });
  check(Number(rep.money.bookedValuePaise) >= after.amountPaise, 'report counts the confirmed booking value', rep.money);
  await ok('GET', '/v1/admin/refunds', { token: admin });
  await ok('GET', '/v1/admin/disputes', { token: admin });
  const forbidden = await call('GET', '/v1/admin/refunds', { token: cust.token });
  check(forbidden.status === 401 || forbidden.status === 403, 'a customer token cannot open admin routes', forbidden.status);

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
