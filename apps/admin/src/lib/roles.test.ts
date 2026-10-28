import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_ROLES, can, canExport, canView, canVisit, EXPORT_KINDS, isAdminRole, navFor, sectionOf, type AdminAction } from './roles.ts';

const labels = (role: (typeof ADMIN_ROLES)[number]) => navFor(role).map((item) => item.label);

test('nav is filtered by role', () => {
  assert.deepEqual(labels('super'), [
    'Dashboard', 'Vendors', 'Photos', 'Car checks', 'Bookings', 'Payouts', 'Disputes', 'Refunds', 'Payment events', 'Reports', 'Complaints', 'Users', 'Coupons', 'Featured', 'Categories', 'Cities', 'Audit log', 'My security',
  ]);
  // Every admin manages their own 2FA recovery codes.
  assert.deepEqual(labels('verifier'), ['Dashboard', 'Vendors', 'Photos', 'Car checks', 'My security']);
  assert.deepEqual(labels('support'), ['Dashboard', 'Vendors', 'Bookings', 'Disputes', 'Reports', 'Complaints', 'Users', 'My security']);
  assert.deepEqual(labels('finance'), ['Dashboard', 'Bookings', 'Payouts', 'Disputes', 'Refunds', 'Payment events', 'Reports', 'Coupons', 'Featured', 'My security']);
});

test('page access follows the nav, including detail pages', () => {
  assert.equal(sectionOf('/vendors/0b6c7a52-1111-4a4a-8888-123456789abc'), 'vendors');
  assert.equal(sectionOf('/'), null);
  assert.equal(canVisit('finance', '/bookings/abc'), true);
  assert.equal(canVisit('finance', '/vendors/abc'), false);
  assert.equal(canVisit('finance', '/payment-events'), true);
  assert.equal(canVisit('support', '/payment-events'), false);
  assert.equal(canVisit('verifier', '/payouts'), false);
  assert.equal(canVisit('support', '/users'), true);
  assert.equal(canVisit('support', '/photos'), false);
  // Unknown paths are left to the 404 page.
  assert.equal(canVisit('finance', '/nope'), true);
});

test('actions per role', () => {
  const actions: AdminAction[] = [
    'vendor.decide', 'media.moderate', 'review.hide', 'payout.manage', 'complaint.manage', 'user.block',
    'coupon.manage', 'featured.plans', 'featured.grant', 'booking.refund', 'charge.resolve', 'resource.verify',
  ];
  const allowed = (role: (typeof ADMIN_ROLES)[number]) => actions.filter((a) => can(role, a));
  assert.deepEqual(allowed('super'), actions);
  assert.deepEqual(allowed('verifier'), ['vendor.decide', 'media.moderate', 'resource.verify']);
  // Support can view vendors but never approve, reject or hold them.
  assert.deepEqual(allowed('support'), ['review.hide', 'complaint.manage', 'user.block', 'charge.resolve']);
  // Finance runs coupons and refunds, but plans and free featured days are super only.
  assert.deepEqual(allowed('finance'), ['payout.manage', 'coupon.manage', 'booking.refund', 'charge.resolve']);
});

test('role guard', () => {
  assert.equal(isAdminRole('finance'), true);
  assert.equal(isAdminRole('owner'), false);
  assert.equal(isAdminRole(undefined), false);
});

test('new sections: coupons and featured for finance, cities and audit for super only', () => {
  assert.equal(canVisit('finance', '/coupons'), true);
  assert.equal(canVisit('finance', '/featured'), true);
  assert.equal(canVisit('finance', '/cities'), false);
  assert.equal(canVisit('finance', '/audit'), false);
  for (const role of ['verifier', 'support'] as const) {
    for (const section of ['coupons', 'featured', 'cities', 'audit'] as const) assert.equal(canView(role, section), false);
  }
  for (const section of ['coupons', 'featured', 'cities', 'audit'] as const) assert.equal(canView('super', section), true);
  assert.equal(sectionOf('/audit'), 'audit');
});

test('CSV downloads follow EXPORT_ROLES on the API', () => {
  const kinds = (role: (typeof ADMIN_ROLES)[number]) => EXPORT_KINDS.filter((k) => canExport(role, k));
  assert.deepEqual(kinds('super'), [...EXPORT_KINDS]);
  assert.deepEqual(kinds('finance'), ['bookings', 'payouts', 'coupons', 'featured']);
  assert.deepEqual(kinds('support'), ['bookings', 'users', 'vendors']);
  assert.deepEqual(kinds('verifier'), ['vendors']);
});

test('disputes for support and finance, refunds for finance only', () => {
  assert.equal(canVisit('support', '/disputes'), true);
  assert.equal(canVisit('finance', '/disputes'), true);
  assert.equal(canVisit('verifier', '/disputes'), false);
  assert.equal(canVisit('finance', '/refunds'), true);
  assert.equal(canVisit('support', '/refunds'), false);
});

test('car checks for verifiers, reports for support and finance', () => {
  assert.equal(canVisit('verifier', '/checks'), true);
  assert.equal(canVisit('finance', '/checks'), false);
  assert.equal(canVisit('support', '/reports'), true);
  assert.equal(canVisit('verifier', '/reports'), false);
});
