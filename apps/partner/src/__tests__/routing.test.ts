import { canEdit, isCategoryLocked, routeAfterLogin, routeFor } from '../lib/routing';

describe('where a vendor goes after login', () => {
  const user = { id: 'u1', phone: '+919876543210', name: 'Ramesh', language: 'en' as const };

  it.each([
    [null, '/onboarding'],
    ['draft', '/onboarding/submit'],
    ['rejected', '/onboarding/submit'],
    ['pending', '/pending'],
    ['approved', '/home'],
    ['on_hold', '/home'],
  ] as const)('vendor %s → %s', (status, route) => {
    expect(routeFor({ name: 'Ramesh', vendorStatus: status })).toBe(route);
    expect(routeAfterLogin({ user, vendor: status ? { id: 'v1', status } : null })).toBe(route);
  });

  it('asks for the name first when there is none', () => {
    expect(routeAfterLogin({ user: { ...user, name: null }, vendor: { id: 'v1', status: 'approved' } })).toBe('/name');
    expect(routeFor({ name: '   ', vendorStatus: null })).toBe('/name');
  });

  it('locks editing while pending and the category once approved', () => {
    expect(canEdit('pending')).toBe(false);
    expect(canEdit('rejected')).toBe(true);
    expect(isCategoryLocked('approved')).toBe(true);
    expect(isCategoryLocked('on_hold')).toBe(true);
    expect(isCategoryLocked('draft')).toBe(false);
    expect(isCategoryLocked('rejected')).toBe(false);
  });
});
