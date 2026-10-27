// Vehicles, drivers and customers' driving licences waiting for EventSeva's check, and the reports page.
import { humanize } from './labels.ts';

export interface PendingResource {
  id: string;
  kind: 'vehicle' | 'driver';
  name: string;
  attributes: Record<string, unknown>;
  verification: string;
  createdAt: string;
  vendorId: string;
  businessName: string;
  documents: { id: string; docType: string; status: string; rejectReason: string | null }[];
}

export interface ResourceDocument {
  id: string;
  docType: string;
  status: string;
  viewUrl: string | null;
}

export interface PendingLicence {
  userId: string;
  name: string | null;
  /** Full number: verifiers only, never shown elsewhere. */
  number: string;
  dateOfBirth: string;
  expiresOn: string;
  createdAt: string;
}

export const RESOURCE_DOCS: Record<string, string> = {
  vehicle_rc: 'RC (registration)',
  vehicle_insurance: 'Insurance',
  vehicle_permit: 'Permit',
  vehicle_puc: 'PUC certificate',
  driver_licence: 'Driving licence',
  police_verification: 'Police verification',
};

/** Same as the API: approving needs these (verifyResource in catalog.service.ts). */
export const REQUIRED_DOCS: Record<PendingResource['kind'], string[]> = {
  vehicle: ['vehicle_rc', 'vehicle_insurance'],
  driver: ['driver_licence'],
};

export const docLabel = (type: string) => RESOURCE_DOCS[type] ?? humanize(type);

/** Required papers not uploaded (or rejected): approving is refused until they are there. */
export const missingRequired = (r: Pick<PendingResource, 'kind' | 'documents'>) =>
  (REQUIRED_DOCS[r.kind] ?? []).filter((d) => !r.documents.some((x) => x.docType === d && x.status !== 'rejected'));

/** Age in whole years on a day, from 'YYYY-MM-DD' dates. */
export function ageOn(dateOfBirth: string, day: string): number {
  const [y, m, d] = dateOfBirth.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = day.slice(0, 10).split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

export const RESOURCE_REJECT_PRESETS = ['RC or insurance photo is unclear', 'Registration does not match the RC', 'Insurance has expired', 'Licence has expired'];
export const LICENCE_REJECT_PRESETS = ['Number does not match the format on the licence', 'Licence has expired', 'Date of birth does not match'];

// ---------- reports ----------

export interface ReportSummary {
  from: string;
  to: string;
  money: Record<'bookedValuePaise' | 'commissionPaise' | 'advancesPaise' | 'balancesPaise' | 'depositsPaise' | 'refundsPaise' | 'payoutsPaise', string> & { failedRefunds: number };
  byStatus: { status: string; bookingType: string; bookings: number; amountPaise: string }[];
  byCategory: { slug: string; name: string; bookings: number; amountPaise: string }[];
}

/** Money comes as text (bigint); fine as numbers up to ₹90 lakh crore. */
export const paise = (text: string) => Number(text);

/** byStatus rows folded per status, all booking types together. */
export function statusTotals(rows: ReportSummary['byStatus']): { status: string; bookings: number; amountPaise: number }[] {
  const out = new Map<string, { status: string; bookings: number; amountPaise: number }>();
  for (const r of rows) {
    const cur = out.get(r.status) ?? { status: r.status, bookings: 0, amountPaise: 0 };
    cur.bookings += r.bookings;
    cur.amountPaise += paise(r.amountPaise);
    out.set(r.status, cur);
  }
  return [...out.values()].sort((a, b) => b.bookings - a.bookings);
}

/** "This month" by default; dates are inclusive, India time, 'YYYY-MM-DD'. */
export function validRange(from: string, to: string): string | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !day.test(from)) || (to && !day.test(to))) return 'Use dates like 2026-11-01.';
  if (from && to && from > to) return 'The start date is after the end date.';
  return null;
}
