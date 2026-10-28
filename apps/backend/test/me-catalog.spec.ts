import { createTestApp, TestApp } from './helpers';

describe('profile and catalog', () => {
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await t.reset();
    token = (await t.login('9876543210')).body.accessToken;
  });

  const patch = (body: object) => t.http().patch('/v1/me').set('Authorization', `Bearer ${token}`).send(body);

  it('GET /v1/me returns the profile', async () => {
    const res = await t.http().get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toMatchObject({ phone: '+919876543210', name: null, language: 'en', cityId: null });
  });

  it('language can be switched to Hindi from Profile → Language and back', async () => {
    expect((await patch({ language: 'hi' }).expect(200)).body.language).toBe('hi');
    expect((await patch({ name: 'Ravi' }).expect(200)).body).toMatchObject({ name: 'Ravi', language: 'hi' });
    expect((await patch({ language: 'en' }).expect(200)).body.language).toBe('en');
    expect((await patch({ language: 'fr' }).expect(400)).body.error.code).toBe('VALIDATION');
  });

  it('city must exist', async () => {
    const { items } = (await t.http().get('/v1/cities').expect(200)).body;
    expect(items.map((c: { name: string }) => c.name)).toContain('Prayagraj');
    expect((await patch({ cityId: items[0].id }).expect(200)).body.cityId).toBe(items[0].id);
    expect((await patch({ cityId: 99999 }).expect(400)).body.error.code).toBe('CITY_NOT_FOUND');
  });

  it('categories come back in the requested language', async () => {
    const en = (await t.http().get('/v1/categories').expect(200)).body;
    expect(en.language).toBe('en');
    expect(en.items.map((c: { name: string }) => c.name)).toEqual([
      'DJ & Sound',
      'Lighting & Decoration',
      'Cook & Catering',
      'Bartan & Kitchen Equipment',
      'Tent & Furniture',
      'Wedding & Event Planners',
      'Photography & Entertainment',
      'Cars & Travel',
    ]);
    const hi = (await t.http().get('/v1/categories').set('Accept-Language', 'hi-IN,hi;q=0.9').expect(200)).body;
    expect(hi.language).toBe('hi');
    expect(hi.items[0].slug).toBe(en.items[0].slug);
    expect(hi.items[0].name).not.toBe(en.items[0].name);
    expect(hi.items[0].name).toMatch(/[ऀ-ॿ]/);
  });

  it('health check', async () => {
    await t.http().get('/health').expect(200, { ok: true });
  });
});
