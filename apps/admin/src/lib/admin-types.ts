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
  openComplaints: number;
  pendingMedia: number;
  duePayouts: number;
  bookingsByStatus: Partial<Record<BookingStatus, number>>;
  last14Days: Array<{ day: string; bookings: number }>;
  topCategories: Array<{ slug: string; name: string; bookings: number }>;
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

export interface AdminBooking {
  id: string;
  status: BookingStatus;
  day: string;
  slot: Slot;
  quantity: number;
  note: string | null;
  amountPaise: number;
  advancePaise: number;
  commissionPaise: number;
  refundPaise: number;
  cancelReason: string | null;
  event: { id: string; title: string; eventType: EventType };
  vendor: { id: string; businessName: string; phone: string };
  customer: { id: string; name: string | null; phone: string };
  createdAt: string;
  payments: AdminPayment[];
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
  hasBankAccount: boolean;
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
