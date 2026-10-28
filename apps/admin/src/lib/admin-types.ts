// Response shapes of the /v1/admin routes (apps/backend/src/admin/*.controller.ts). Shared app
// types (VendorDetail, Review …) come from @eventseva/app-shared.
import type { BookingStatus, EventType, Slot, VendorDetail, VendorDocument, VendorStatus } from '@eventseva/app-shared';
import type { ComplaintStatus, MediaStatus, PayoutStatus } from './labels';

export interface Dashboard {
  month: string;
  pendingVendors: number;
  liveVendors: number;
  users: number;
  newUsersToday: number;
  bookingsToday: number;
  monthConfirmed: number;
  monthGmvPaise: number;
  monthCommissionPaise: number;
  /** Coupon discounts EventSeva paid on bookings this month. */
  monthDiscountPaise: number;
  /** Featured listings sold this month. */
  monthFeaturedPaise: number;
  /** Commission − discounts + featured sales. */
  monthNetRevenuePaise: number;
  /** Vendors featured right now. */
  featuredVendors: number;
  openComplaints: number;
  pendingMedia: number;
  duePayouts: number;
  /** Cars, drivers and customers' licences waiting for a check. */
  pendingChecks: number;
  /** Disputed charges and inspection records. */
  openDisputes: number;
  bookingsByStatus: Partial<Record<BookingStatus, number>>;
  last14Days: Array<{ day: string; bookings: number }>;
  topCategories: Array<{ slug: string; name: string; bookings: number }>;
  /** OTP SMS sent in the last 24 hours (whole app). */
  smsLast24h: number;
  /** OTP_DAILY_SMS_BUDGET on the server. */
  smsBudgetPerDay: number;
  /** System alerts not resolved yet (GET /v1/admin/alerts). */
  openAlerts: number;
}

export interface AdminVendorRow {
  id: string;
  businessName: string;
  status: VendorStatus;
  area: string | null;
  createdAt: string;
  phone: string;
  category: string;
  city: string;
  serviceCount: number;
  packageCount: number;
}

export interface VendorHistoryEntry {
  action: string;
  reason: string | null;
  adminEmail: string;
  createdAt: string;
}

export interface AdminVendor extends VendorDetail {
  status: VendorStatus;
  owner: { id: string; phone: string; name: string | null } | null;
  history: VendorHistoryEntry[];
  /** Latest document of each type. viewUrl: 10-minute link, verifier/super only. */
  documents: VendorDocument[];
}

export interface AdminBookingRow {
  id: string;
  status: BookingStatus;
  day: string;
  slot: Slot;
  amountPaise: number;
  advancePaise: number;
  commissionPaise: number;
  refundPaise: number;
  createdAt: string;
  eventTitle: string;
  vendorId: string;
  vendorName: string;
  customerPhone: string;
  customerName: string | null;
}

export interface AdminPayment {
  id: string;
  type: string;
  amountPaise: number;
  status: string;
  orderId: string | null;
  paymentId: string | null;
  refundId: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminRefund {
  id: string;
  amountPaise: number;
  reason: 'cancellation' | 'late_payment' | 'replaced_order' | 'admin' | string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  refundId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface BookingStateMove {
  from: string | null;
  to: string;
  actorKind: 'customer' | 'vendor' | 'admin' | 'system' | 'gateway';
  actorId: string | null;
  reason: string | null;
  at: string;
}

export interface AdminBooking {
  id: string;
  status: BookingStatus;
  day: string;
  slot: Slot;
  quantity: number;
  note: string | null;
  bookingType: string;
  startsAt: string | null;
  endsAt: string | null;
  fulfilment: string | null;
  taxPaise: number;
  depositPaise: number;
  depositSettledAt: string | null;
  amountPaise: number;
  advancePaise: number;
  commissionPaise: number;
  refundPaise: number;
  /** Coupon discount paid by EventSeva. */
  discountPaise: number;
  /** Already taken off the vendor's payout by earlier refunds. */
  payoutDeductionPaise: number;
  cancelReason: string | null;
  event: { id: string; title: string; eventType: EventType };
  vendor: { id: string; businessName: string; phone: string };
  customer: { id: string; name: string | null; phone: string };
  createdAt: string;
  payments: AdminPayment[];
  /** The refund queue: pending / sending ones are still on their way to Razorpay. */
  refunds: AdminRefund[];
  /** Lifecycle state from the database state machine, and every move with who made it. */
  state?: string;
  history?: BookingStateMove[];
  payout: { id: string; amountPaise: number; status: PayoutStatus; releaseAfter: string; reference: string | null } | null;
}

export interface AdminPayout {
  id: string;
  amountPaise: number;
  status: PayoutStatus;
  releaseAfter: string;
  reference: string | null;
  bookingId: string;
  day: string;
  vendorId: string;
  vendorName: string;
  /** null = the vendor has not added a bank account. */
  bankStatus: 'pending' | 'verified' | 'rejected' | null;
}

export interface AdminComplaint {
  id: string;
  subject: string;
  details: string;
  status: ComplaintStatus;
  resolution: string | null;
  bookingId: string | null;
  createdAt: string;
  raisedByPhone: string;
  raisedByName: string | null;
  raisedByVendor: boolean;
}

export interface AdminUser {
  id: string;
  phone: string;
  name: string | null;
  language: string;
  isBlocked: boolean;
  createdAt: string;
  vendorId: string | null;
  vendorName: string | null;
  vendorStatus: VendorStatus | null;
  bookingCount: number;
}

export interface AdminMedia {
  id: string;
  type: 'photo' | 'video';
  publicId: string;
  width: number;
  height: number;
  durationSec: number | null;
  status: MediaStatus;
  rejectReason: string | null;
  createdAt: string;
  vendorId: string;
  vendorName: string;
}

export interface AdminCategory {
  id: number;
  slug: string;
  nameEn: string;
  nameHi: string;
  icon: string;
  defaultUnit: string;
  sortOrder: number;
  isActive: boolean;
  liveVendors: number;
  allVendors: number;
}

export interface AdminCategoryList {
  items: AdminCategory[];
  icons: string[];
  units: string[];
}

export interface AdminCoupon {
  id: number;
  code: string;
  titleEn: string;
  titleHi: string;
  discountType: 'percent' | 'flat';
  /** Percent, or paise for flat. */
  discountValue: number;
  maxDiscountPaise: number | null;
  minAmountPaise: number;
  categoryId: number | null;
  categoryName: string | null;
  firstBookingOnly: boolean;
  isPublic: boolean;
  maxUses: number | null;
  perCustomerLimit: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
  usedCount: number;
  /** Applied to unpaid bookings, not used yet. */
  heldCount: number;
  discountGivenPaise: number;
}

export interface FeaturedPlan {
  id: number;
  nameEn: string;
  nameHi: string;
  days: number;
  pricePaise: number;
  isActive: boolean;
  sortOrder: number;
}

export interface FeaturedPurchase {
  id: string;
  days: number;
  amountPaise: number;
  /** 'paid' (bought by the vendor) or 'granted' (free days from an admin). */
  status: string;
  reason: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  paidAt: string | null;
  paymentId: string | null;
  vendorId: string;
  vendorName: string;
  planName: string | null;
  grantedBy: string | null;
}

export interface AdminCity {
  id: number;
  name: string;
  nameHi: string;
  state: string;
  isActive: boolean;
  liveVendors: number;
}

export interface AuditEntry {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  adminRole: string;
}

export interface AuditPage {
  items: AuditEntry[];
  page: number;
  hasMore: boolean;
  admins: Array<{ id: string; email: string; role: string }>;
}

/** GET /v1/categories (public, active only). */
export interface PublicCategory {
  id: number;
  slug: string;
  name: string;
}
