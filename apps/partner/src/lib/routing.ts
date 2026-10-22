import type { LoginResult, VendorStatus } from '@eventseva/app-shared';

export type AppRoute = '/name' | '/onboarding' | '/onboarding/submit' | '/pending' | '/home';

/**
 * Where a logged-in vendor belongs. Used right after login (with `vendor` from the login
 * result) and whenever GET /v1/partner/vendor says the status changed.
 */
export function routeFor(input: { name: string | null; vendorStatus: VendorStatus | null }): AppRoute {
  if (!input.name?.trim()) return '/name';
  switch (input.vendorStatus) {
    case null:
      return '/onboarding';
    case 'draft':
    case 'rejected':
      // The checklist screen: shows what is missing (and the reject reason) and has Submit.
      return '/onboarding/submit';
    case 'pending':
      return '/pending';
    case 'approved':
    case 'on_hold':
      return '/home';
  }
}

/** Profile changes are refused while the team reviews the profile. */
export const canEdit = (status: VendorStatus | undefined) => status !== 'pending';

/** The service type decides which customers see the vendor, so it is fixed after approval. */
export const isCategoryLocked = (status: VendorStatus | undefined) => status === 'approved' || status === 'on_hold';

/** Right after OTP verify, before the full vendor profile is loaded. */
export const routeAfterLogin = (result: Pick<LoginResult, 'user' | 'vendor'>): AppRoute =>
  routeFor({ name: result.user.name, vendorStatus: result.vendor?.status ?? null });
