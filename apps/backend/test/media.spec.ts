import { parseCloudinaryUrl } from '../src/config';
import { signParams } from '../src/media/cloudinary.service';
import { createTestApp, TestApp } from './helpers';

const SECRET = 'test-secret'; // from CLOUDINARY_URL in test/env.ts

describe('Cloudinary signing', () => {
  it("matches the example in Cloudinary's documentation", () => {
    const params = { eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 };
    expect(signParams(params, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('reads CLOUDINARY_URL from the dashboard format', () => {
    expect(parseCloudinaryUrl('cloudinary://123:abc-DEF@my-cloud')).toEqual({ apiKey: '123', apiSecret: 'abc-DEF', cloudName: 'my-cloud' });
    expect(parseCloudinaryUrl(undefined)).toBeUndefined();
    expect(() => parseCloudinaryUrl('https://example.com')).toThrow(/CLOUDINARY_URL/);
  });
});

describe('vendor photos, videos and documents', () => {
  let t: TestApp;
  let partner: string;
  let vendorId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => t.http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  /** What Cloudinary sends back after an upload, signed with the account secret. */
  const uploaded = (folder: string, name: string, version = 1700000000) => {
    const publicId = `${folder}/${name}`;
    return { publicId, version, signature: signParams({ public_id: publicId, version }, SECRET) };
  };

  const photo = (name: string, extra: object = {}) => ({
    ...uploaded(`eventseva/vendors/${vendorId}/media`, name),
    type: 'photo',
    width: 1600,
    height: 1200,
    bytes: 400_000,
    etag: `etag-${name}-00000000`,
    ...extra,
  });

  beforeEach(async () => {
    await t.reset();
    t.cloudinary.destroyed.length = 0;
    partner = (await t.login('9811111111', 'partner')).body.accessToken;
    const cityId = (await t.db.one(t.db, `SELECT id FROM cities LIMIT 1`)).id;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(partner).post('/v1/partner/vendor', { businessName: 'Raj DJ Sound', categoryId: dj, cityId }).expect(201)).body.id;
  });

  it('signs an upload into the vendor\'s own folder, without exposing the secret', async () => {
    const res = (await as(partner).post('/v1/partner/uploads/sign', { kind: 'photo' }).expect(200)).body;
    expect(res).toMatchObject({
      uploadUrl: 'https://api.cloudinary.com/v1_1/testcloud/image/upload',
      cloudName: 'testcloud',
      apiKey: '111222333',
      params: { folder: `eventseva/vendors/${vendorId}/media`, allowed_formats: 'jpg,jpeg,png,webp,heic' },
    });
    expect(res.signature).toBe(signParams(res.params, SECRET));
    expect(JSON.stringify(res)).not.toContain(SECRET);

    const video = (await as(partner).post('/v1/partner/uploads/sign', { kind: 'video' }).expect(200)).body;
    expect(video.uploadUrl).toMatch(/\/video\/upload$/);
    const doc = (await as(partner).post('/v1/partner/uploads/sign', { kind: 'document' }).expect(200)).body;
    expect(doc.params).toMatchObject({ type: 'private', folder: `eventseva/vendors/${vendorId}/docs` });

    const customer = (await t.login('9822222222')).body.accessToken;
    await as(customer).post('/v1/partner/uploads/sign', { kind: 'photo' }).expect(403);
  });

  it('registers a verified upload as pending; first photo becomes the cover; checklist updates', async () => {
    expect((await as(partner).get('/v1/partner/vendor')).body.missingForReview).toContain('photos');
    const m = (await as(partner).post('/v1/partner/media', photo('a')).expect(201)).body;
    expect(m).toMatchObject({ type: 'photo', status: 'pending', isCover: true, sortOrder: 0 });
    const m2 = (await as(partner).post('/v1/partner/media', photo('b')).expect(201)).body;
    expect(m2).toMatchObject({ isCover: false, sortOrder: 1 });
    expect((await as(partner).get('/v1/partner/vendor')).body.missingForReview).not.toContain('photos');
    expect((await as(partner).get('/v1/partner/media').expect(200)).body.items).toHaveLength(2);
  });

  it('refuses forged, foreign, duplicate, too big and too long uploads', async () => {
    const forged = { ...photo('a'), signature: 'a'.repeat(40) };
    expect((await as(partner).post('/v1/partner/media', forged).expect(400)).body.error.code).toBe('UPLOAD_INVALID');

    const foreign = { ...photo('a'), ...uploaded('eventseva/vendors/someone-else/media', 'a') };
    expect((await as(partner).post('/v1/partner/media', foreign).expect(403)).body.error.code).toBe('UPLOAD_INVALID');

    await as(partner).post('/v1/partner/media', photo('a')).expect(201);
    const dup = await as(partner).post('/v1/partner/media', photo('a2', { etag: 'etag-a-00000000' })).expect(409);
    expect(dup.body.error.code).toBe('MEDIA_DUPLICATE');

    expect((await as(partner).post('/v1/partner/media', photo('big', { bytes: 50 * 1024 * 1024 })).expect(400)).body.error.code).toBe('FILE_TOO_BIG');
    const longVideo = { ...photo('v', { type: 'video', durationSec: 600 }), ...uploaded(`eventseva/vendors/${vendorId}/media`, 'v') };
    expect((await as(partner).post('/v1/partner/media', longVideo).expect(400)).body.error.code).toBe('VIDEO_TOO_LONG');
  });

  it('cover, order and delete (the cover passes to the next photo; the file is removed from Cloudinary)', async () => {
    const a = (await as(partner).post('/v1/partner/media', photo('a')).expect(201)).body;
    const b = (await as(partner).post('/v1/partner/media', photo('b')).expect(201)).body;
    const c = (await as(partner).post('/v1/partner/media', photo('c')).expect(201)).body;

    await as(partner).post(`/v1/partner/media/${c.id}/cover`).expect(200);
    await as(partner).put('/v1/partner/media/order', { ids: [b.id, a.id, c.id] }).expect(204);
    let items = (await as(partner).get('/v1/partner/media')).body.items;
    expect(items.map((m: { id: string }) => m.id)).toEqual([c.id, b.id, a.id]); // cover first, then by order

    await as(partner).delete(`/v1/partner/media/${c.id}`).expect(204);
    expect(t.cloudinary.destroyed).toEqual([c.publicId]);
    items = (await as(partner).get('/v1/partner/media')).body.items;
    expect(items[0]).toMatchObject({ id: b.id, isCover: true });

    const other = (await t.login('9833333333', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const cityId = (await t.db.one(t.db, `SELECT id FROM cities LIMIT 1`)).id;
    await as(other).post('/v1/partner/vendor', { businessName: 'Other DJ', categoryId: dj, cityId }).expect(201);
    await as(other).delete(`/v1/partner/media/${a.id}`).expect(404);
  });

  it('customers see a photo only after admin approval', async () => {
    const m = (await as(partner).post('/v1/partner/media', photo('a')).expect(201)).body;
    await t.db.query(`UPDATE vendors SET status = 'approved'`);
    expect((await t.http().get(`/v1/vendors/${vendorId}`)).body.media).toEqual([]);
    const verifier = await t.adminLogin('verifier');
    await as(verifier).post(`/v1/admin/media/${m.id}/approve`).expect(200);
    expect((await t.http().get(`/v1/vendors/${vendorId}`)).body.media).toEqual([expect.objectContaining({ publicId: m.publicId })]);
  });

  it('documents: private upload, Aadhaar keeps only last 4, replacing removes the old file, verifier gets an expiring link', async () => {
    const docFolder = `eventseva/vendors/${vendorId}/docs`;
    const aadhaar = (name: string, last4?: string) => ({ ...uploaded(docFolder, name), docType: 'aadhaar', format: 'jpg', last4 });

    expect((await as(partner).post('/v1/partner/documents', aadhaar('a1')).expect(400)).body.error.code).toBe('VALIDATION');
    await as(partner).post('/v1/partner/documents', aadhaar('a1', '1234 5678 9012')).expect(400);
    await as(partner).post('/v1/partner/documents', aadhaar('a1', '9012')).expect(201);
    await as(partner).post('/v1/partner/documents', aadhaar('a2', '9012')).expect(201);
    expect(t.cloudinary.destroyed).toEqual([`${docFolder}/a1`]);
    await as(partner).post('/v1/partner/documents', { ...uploaded(docFolder, 'p1'), docType: 'pan', format: 'pdf' }).expect(201);

    const docs = (await as(partner).get('/v1/partner/documents').expect(200)).body.items;
    expect(docs).toEqual([
      expect.objectContaining({ docType: 'aadhaar', last4: '9012', status: 'pending' }),
      expect.objectContaining({ docType: 'pan', last4: null }),
    ]);

    // Media folder files cannot be registered as documents.
    await as(partner).post('/v1/partner/documents', { ...uploaded(`eventseva/vendors/${vendorId}/media`, 'x'), docType: 'pan', format: 'jpg' }).expect(403);

    const verifier = await t.adminLogin('verifier');
    const detail = (await as(verifier).get(`/v1/admin/vendors/${vendorId}`).expect(200)).body;
    const link = new URL(detail.documents[0].viewUrl);
    expect(link.origin + link.pathname).toBe('https://api.cloudinary.com/v1_1/testcloud/image/download');
    expect(link.searchParams.get('type')).toBe('private');
    expect(Number(link.searchParams.get('expires_at')) - Date.now() / 1000).toBeLessThanOrEqual(600);
    const signed = Object.fromEntries(['public_id', 'format', 'type', 'timestamp', 'expires_at'].map((k) => [k, link.searchParams.get(k)!]));
    expect(link.searchParams.get('signature')).toBe(signParams(signed, SECRET));

    const support = await t.adminLogin('support');
    expect((await as(support).get(`/v1/admin/vendors/${vendorId}`)).body.documents[0].viewUrl).toBeNull();

    await as(verifier).post(`/v1/admin/documents/${detail.documents[0].id}/reject`, { reason: 'Photo is blurry' }).expect(200);
    expect((await as(partner).get('/v1/partner/documents')).body.items[0]).toMatchObject({ status: 'rejected', rejectReason: 'Photo is blurry' });
  });
});
