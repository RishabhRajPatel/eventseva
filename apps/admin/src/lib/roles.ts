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

export type Section =
  | 'dashboard'
  | 'vendors'
  | 'photos'
  | 'bookings'
  | 'payouts'
  | 'disputes'
  | 'refunds'
  | 'checks'
  | 'reports'
  | 'complaints'
  | 'users'
  | 'coupons'
  | 'featured'
  | 'categories'
  | 'cities'
  | 'audit'
  | 'security';

export interface NavItem {
  section: Section;
  href: `/${string}`;
  label: string;
  /** Dashboard count shown as a badge next to the link. */
  badge?: 'pendingVendors' | 'pendingMedia' | 'openComplaints' | 'duePayouts' | 'openAlerts' | 'pendingChecks' | 'openDisputes';
}

export const NAV_ITEMS: readonly NavItem[] = [
  // Open system alerts (SMS budget) are shown on the dashboard, for every role.
  { section: 'dashboard', href: '/dashboard', label: 'Dashboard', badge: 'openAlerts' },
  { section: 'vendors', href: '/vendors', label: 'Vendors', badge: 'pendingVendors' },
  { section: 'photos', href: '/photos', label: 'Photos', badge: 'pendingMedia' },
  // Vehicles, drivers and customers' driving licences waiting for a check.
  { section: 'checks', href: '/checks', label: 'Car checks', badge: 'pendingChecks' },
  { section: 'bookings', href: '/bookings', label: 'Bookings' },
  { section: 'payouts', href: '/payouts', label: 'Payouts', badge: 'duePayouts' },
  // Rental / car charges the customer disputes, and refunds with their Razorpay result.
  { section: 'disputes', href: '/disputes', label: 'Disputes', badge: 'openDisputes' },
  { section: 'refunds', href: '/refunds', label: 'Refunds' },
  { section: 'reports', href: '/reports', label: 'Reports' },
  { section: 'complaints', href: '/complaints', label: 'Complaints', badge: 'openComplaints' },
  { section: 'users', href: '/users', label: 'Users' },
  { section: 'coupons', href: '/coupons', label: 'Coupons' },
  { section: 'featured', href: '/featured', label: 'Featured' },
  // Super admins only: categories and cities change both apps at once.
  { section: 'categories', href: '/categories', label: 'Categories' },
  { section: 'cities', href: '/cities', label: 'Cities' },
  { section: 'audit', href: '/audit', label: 'Audit log' },
  // Every admin: their own 2FA recovery codes.
  { section: 'security', href: '/security', label: 'My security' },
];

const SECTIONS: Record<Exclude<AdminRole, 'super'>, readonly Section[]> = {
  verifier: ['dashboard', 'vendors', 'photos', 'checks', 'security'],
  support: ['dashboard', 'vendors', 'bookings', 'disputes', 'reports', 'complaints', 'users', 'security'],
  finance: ['dashboard', 'bookings', 'payouts', 'disputes', 'refunds', 'reports', 'coupons', 'featured', 'security'],
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
  | 'user.block'
  | 'coupon.manage'
  | 'featured.plans'
  | 'featured.grant'
  | 'booking.refund'
  | 'charge.resolve'
  | 'resource.verify'
  | 'alert.resolve';

const ACTIONS: Record<Exclude<AdminRole, 'super'>, readonly AdminAction[]> = {
  verifier: ['vendor.decide', 'media.moderate', 'resource.verify'],
  support: ['review.hide', 'complaint.manage', 'user.block', 'charge.resolve', 'alert.resolve'],
  finance: ['payout.manage', 'coupon.manage', 'booking.refund', 'charge.resolve'],
};

export function can(role: AdminRole, action: AdminAction): boolean {
  return role === 'super' || ACTIONS[role].includes(action);
}

/** CSV downloads (GET /v1/admin/export/:kind); EXPORT_ROLES in admin-extras.controller.ts. */
export const EXPORT_KINDS = ['bookings', 'payouts', 'users', 'vendors', 'coupons', 'featured'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const EXPORTS: Record<ExportKind, readonly Exclude<AdminRole, 'super'>[]> = {
  bookings: ['support', 'finance'],
  payouts: ['finance'],
  users: ['support'],
  vendors: ['verifier', 'support'],
  coupons: ['finance'],
  featured: ['finance'],
};

export function canExport(role: AdminRole, kind: ExportKind): boolean {
  return role === 'super' || EXPORTS[kind].includes(role);
}
