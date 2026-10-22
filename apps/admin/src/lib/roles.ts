// Who can see and do what in the admin panel. Mirrors the @AdminRoles guards in
// apps/backend/src/admin; the API still enforces them (403 FORBIDDEN), this only hides UI.

export const ADMIN_ROLES = ['super', 'verifier', 'support', 'finance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const isAdminRole = (value: unknown): value is AdminRole =>
  typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);

export const ROLE_LABELS: Record<AdminRole, string> = {
  super: 'Super admin',
  verifier: 'Verifier',
  support: 'Support',
  finance: 'Finance',
};

export type Section = 'dashboard' | 'vendors' | 'photos' | 'bookings' | 'payouts' | 'complaints' | 'users';

export interface NavItem {
  section: Section;
  href: `/${string}`;
  label: string;
  /** Dashboard count shown as a badge next to the link. */
  badge?: 'pendingVendors' | 'pendingMedia' | 'openComplaints' | 'duePayouts';
}

export const NAV_ITEMS: readonly NavItem[] = [
  { section: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { section: 'vendors', href: '/vendors', label: 'Vendors', badge: 'pendingVendors' },
  { section: 'photos', href: '/photos', label: 'Photos', badge: 'pendingMedia' },
  { section: 'bookings', href: '/bookings', label: 'Bookings' },
  { section: 'payouts', href: '/payouts', label: 'Payouts', badge: 'duePayouts' },
  { section: 'complaints', href: '/complaints', label: 'Complaints', badge: 'openComplaints' },
  { section: 'users', href: '/users', label: 'Users' },
];

const SECTIONS: Record<Exclude<AdminRole, 'super'>, readonly Section[]> = {
  verifier: ['dashboard', 'vendors', 'photos'],
  support: ['dashboard', 'vendors', 'bookings', 'complaints', 'users'],
  finance: ['dashboard', 'bookings', 'payouts'],
};

export function canView(role: AdminRole, section: Section): boolean {
  return role === 'super' || SECTIONS[role].includes(section);
}

export function navFor(role: AdminRole): NavItem[] {
  return NAV_ITEMS.filter((item) => canView(role, item.section));
}

/** The section a pathname belongs to, e.g. '/vendors/abc' → 'vendors'; null for unknown paths. */
export function sectionOf(pathname: string): Section | null {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return NAV_ITEMS.find((item) => item.href === `/${first}`)?.section ?? null;
}

export function canVisit(role: AdminRole, pathname: string): boolean {
  const section = sectionOf(pathname);
  return section === null || canView(role, section);
}

export type AdminAction =
  | 'vendor.decide'
  | 'media.moderate'
  | 'review.hide'
  | 'payout.manage'
  | 'complaint.manage'
  | 'user.block';

const ACTIONS: Record<Exclude<AdminRole, 'super'>, readonly AdminAction[]> = {
  verifier: ['vendor.decide', 'media.moderate'],
  support: ['review.hide', 'complaint.manage', 'user.block'],
  finance: ['payout.manage'],
};

export function can(role: AdminRole, action: AdminAction): boolean {
  return role === 'super' || ACTIONS[role].includes(action);
}
