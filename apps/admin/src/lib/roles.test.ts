import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_ROLES, can, canVisit, isAdminRole, navFor, sectionOf, type AdminAction } from './roles.ts';

const labels = (role: (typeof ADMIN_ROLES)[number]) => navFor(role).map((item) => item.label);

test('nav is filtered by role', () => {
  assert.deepEqual(labels('super'), ['Dashboard', 'Vendors', 'Photos', 'Bookings', 'Payouts', 'Complaints', 'Users', 'Categories']);
  assert.deepEqual(labels('verifier'), ['Dashboard', 'Vendors', 'Photos']);
  assert.deepEqual(labels('support'), ['Dashboard', 'Vendors', 'Bookings', 'Complaints', 'Users']);
  assert.deepEqual(labels('finance'), ['Dashboard', 'Bookings', 'Payouts']);
});

test('page access follows the nav, including detail pages', () => {
  assert.equal(sectionOf('/vendors/0b6c7a52-1111-4a4a-8888-123456789abc'), 'vendors');
  assert.equal(sectionOf('/'), null);
  assert.equal(canVisit('finance', '/bookings/abc'), true);
  assert.equal(canVisit('finance', '/vendors/abc'), false);
  assert.equal(canVisit('verifier', '/payouts'), false);
  assert.equal(canVisit('support', '/users'), true);
  assert.equal(canVisit('support', '/photos'), false);
  // Unknown paths are left to the 404 page.
  assert.equal(canVisit('finance', '/nope'), true);
});

test('actions per role', () => {
  const actions: AdminAction[] = ['vendor.decide', 'media.moderate', 'review.hide', 'payout.manage', 'complaint.manage', 'user.block'];
  const allowed = (role: (typeof ADMIN_ROLES)[number]) => actions.filter((a) => can(role, a));
  assert.deepEqual(allowed('super'), actions);
  assert.deepEqual(allowed('verifier'), ['vendor.decide', 'media.moderate']);
  // Support can view vendors but never approve, reject or hold them.
  assert.deepEqual(allowed('support'), ['review.hide', 'complaint.manage', 'user.block']);
  assert.deepEqual(allowed('finance'), ['payout.manage']);
});

test('role guard', () => {
  assert.equal(isAdminRole('finance'), true);
  assert.equal(isAdminRole('owner'), false);
  assert.equal(isAdminRole(undefined), false);
});
