import { slugify } from '../src/admin/categories.controller';
import { createTestApp, restoreLiveCategories, TestApp } from './helpers';

describe('categories managed by admins', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  /** Puts the category list back as the migration left it, so other test files see the real set. */
  async function restoreCategories() {
    await t.db.query(`DELETE FROM categories WHERE slug IN ('mehendi-artist')`);
    await restoreLiveCategories(t.db);
    await t.db.query(`UPDATE categories SET sort_order = CASE slug WHEN 'dj' THEN 1 WHEN 'decor' THEN 2 WHEN 'catering' THEN 3
      WHEN 'bartan' THEN 4 WHEN 'tent' THEN 5 WHEN 'planner' THEN 6 WHEN 'camera' THEN 7 WHEN 'car' THEN 8 ELSE sort_order END`);
  }
  afterAll(async () => {
    await t.reset();
    await restoreCategories();
    await t.app.close();
  });
  beforeEach(async () => {
    await t.reset();
    await restoreCategories();
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const appCategories = async (lang = 'en') =>
    (await t.http().get('/v1/categories').set('Accept-Language', lang).expect(200)).body.items as { id: number; slug: string; name: string; icon: string }[];

  it('makes readable slugs', () => {
    expect(slugify('Bartan & Kitchen Equipment')).toBe('bartan-kitchen-equipment');
    expect(slugify('  Mehendi Artist!! ')).toBe('mehendi-artist');
  });

  it('the owner\'s seven categories and wedding cars, in order, with Hindi names and icons; old ones hidden but kept', async () => {
    const hi = await appCategories('hi');
    expect(hi.map((c) => c.slug)).toEqual(['dj', 'decor', 'catering', 'bartan', 'tent', 'planner', 'camera', 'car']);
    expect(hi.map((c) => c.name)).toEqual([
      'डीजे और साउंड', 'लाइटिंग और सजावट', 'हलवाई और कैटरिंग', 'बर्तन और किचन का सामान', 'टेंट और फ़र्नीचर', 'वेडिंग और इवेंट प्लानर', 'फ़ोटोग्राफ़ी और मनोरंजन', 'कार और ट्रैवल',
    ]);
    expect(hi.find((c) => c.slug === 'car')!.icon).toBe('car');
    expect(hi.find((c) => c.slug === 'tent')!.icon).toBe('tent');
    expect((await t.db.query(`SELECT slug FROM categories WHERE NOT is_active ORDER BY slug`)).rows.map((r) => r.slug)).toEqual([
      'band', 'bartender', 'generator', 'guest-transport', 'halwai', 'hotel', 'hall', 'makeup', 'other',
    ].sort());
  });

  it('only super admins manage categories', async () => {
    const verifier = await t.adminLogin('verifier');
    await as(verifier).get('/v1/admin/categories').expect(403);
    const support = await t.adminLogin('support');
    await as(support).post('/v1/admin/categories', { nameEn: 'X Y', nameHi: 'X Y', icon: 'other', defaultUnit: 'per_event' }).expect(403);
  });

  it('add → appears in both apps at the end; edit; hide; show; reorder; all audited', async () => {
    const admin = await t.adminLogin('super');
    const list = (await as(admin).get('/v1/admin/categories').expect(200)).body;
    expect(list.icons).toContain('planner');
    expect(list.items).toHaveLength(17);

    const bad = await as(admin).post('/v1/admin/categories', { nameEn: 'Mehendi Artist', nameHi: 'मेहंदी आर्टिस्ट', icon: 'rocket', defaultUnit: 'per_event' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    const created = (await as(admin)
      .post('/v1/admin/categories', { nameEn: 'Mehendi Artist', nameHi: 'मेहंदी आर्टिस्ट', icon: 'makeup', defaultUnit: 'per_person' })
      .expect(201)).body;
    expect(created).toMatchObject({ slug: 'mehendi-artist', isActive: true, sortOrder: 9, liveVendors: 0 });
    const dup = await as(admin).post('/v1/admin/categories', { nameEn: 'mehendi artist', nameHi: 'मेहंदी', icon: 'makeup', defaultUnit: 'per_person' }).expect(409);
    expect(dup.body.error.code).toBe('CATEGORY_EXISTS');
    expect((await appCategories('hi')).at(-1)).toMatchObject({ slug: 'mehendi-artist', name: 'मेहंदी आर्टिस्ट', icon: 'makeup' });

    // A vendor can now register under it.
    const partner = (await t.login('9811111111', 'partner')).body.accessToken;
    const cityId = (await t.db.one(t.db, 'SELECT id FROM cities LIMIT 1')).id;
    await as(partner).post('/v1/partner/vendor', { businessName: 'Heena Arts', categoryId: created.id, cityId }).expect(201);

    await as(admin).patch(`/v1/admin/categories/${created.id}`, { nameEn: 'Mehendi Artists' }).expect(200);
    await as(admin).patch(`/v1/admin/categories/${created.id}`, { isActive: false }).expect(200);
    expect((await appCategories()).map((c) => c.slug)).not.toContain('mehendi-artist');
    // Hidden categories cannot take new vendors; switching back on works.
    const other = (await t.login('9822222222', 'partner')).body.accessToken;
    expect((await as(other).post('/v1/partner/vendor', { businessName: 'Rang', categoryId: created.id, cityId }).expect(400)).body.error.code).toBe('CATEGORY_NOT_FOUND');
    const hall = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'hall'`)).id;
    await as(admin).patch(`/v1/admin/categories/${hall}`, { isActive: true }).expect(200);
    expect((await appCategories()).map((c) => c.slug)).toContain('hall');

    const ids = (await appCategories()).map((c) => c.id);
    const reordered = [ids.at(-1)!, ...ids.slice(0, -1)];
    await as(admin).put('/v1/admin/categories/order', { ids: reordered }).expect(200);
    expect((await appCategories()).map((c) => c.id)).toEqual(reordered);

    const actions = (await t.db.query(`SELECT action FROM admin_audit_log WHERE target_type = 'category' ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toEqual(['category.create', 'category.update', 'category.hide', 'category.show', 'category.order']);
  });
});
