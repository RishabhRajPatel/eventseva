// Display text and colour tone for every status the API returns, plus small display helpers.
import type { BookingStatus, VendorStatus } from '@eventseva/core';

/** Matches a .tone-* class in globals.css (colours from the design boards). */
export type Tone = 'info' | 'warning' | 'success' | 'successSoft' | 'dark' | 'outline' | 'neutral';

export interface StatusLabel {
  label: string;
  tone: Tone;
}

export const BOOKING_STATUS: Record<BookingStatus, StatusLabel> = {
  requested: { label: 'Requested', tone: 'info' },
  accepted: { label: 'Payment pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  completed: { label: 'Completed', tone: 'successSoft' },
  rejected: { label: 'Rejected by vendor', tone: 'dark' },
  expired: { label: 'Expired', tone: 'outline' },
  cancelled_by_customer: { label: 'Cancelled · customer', tone: 'dark' },
  cancelled_by_vendor: { label: 'Cancelled · vendor', tone: 'dark' },
};

export const VENDOR_STATUS: Record<VendorStatus, StatusLabel> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'dark' },
  on_hold: { label: 'On hold', tone: 'outline' },
  draft: { label: 'Draft', tone: 'info' },
};

export type PayoutStatus = 'scheduled' | 'processing' | 'paid' | 'failed' | 'held';
export const PAYOUT_STATUSES: PayoutStatus[] = ['scheduled', 'processing', 'paid', 'failed', 'held'];
export const PAYOUT_STATUS: Record<PayoutStatus, StatusLabel> = {
  scheduled: { label: 'Scheduled', tone: 'warning' },
  processing: { label: 'Processing', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'outline' },
  held: { label: 'On hold', tone: 'dark' },
};

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved';
export const COMPLAINT_STATUSES: ComplaintStatus[] = ['open', 'in_progress', 'resolved'];
export const COMPLAINT_STATUS: Record<ComplaintStatus, StatusLabel> = {
  open: { label: 'Open', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export type MediaStatus = 'pending' | 'approved' | 'rejected';
export const MEDIA_STATUSES: MediaStatus[] = ['pending', 'approved', 'rejected'];
export const MEDIA_STATUS: Record<MediaStatus, StatusLabel> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'dark' },
};

export const BANK_STATUS: Record<'pending' | 'verified' | 'rejected', StatusLabel> = {
  pending: { label: 'To verify', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Sent back', tone: 'dark' },
};

/** Falls back to the raw value, so a status added on the backend still shows. */
export function statusLabel<S extends string>(map: Record<S, StatusLabel>, status: string): StatusLabel {
  return (map as Record<string, StatusLabel>)[status] ?? { label: humanize(status), tone: 'neutral' };
}

/** 'cancelled_by_vendor' → 'Cancelled by vendor' */
export function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export const SLOT_LABELS: Record<string, string> = { full: 'Full day', day: 'Day (10–4)', night: 'Night (6–11)' };

export const UNIT_LABELS: Record<string, string> = {
  per_event: 'per event',
  per_day: 'per day',
  per_shift: 'per shift',
  per_plate: 'per plate',
  per_hour: 'per hour',
  per_km: 'per km',
  per_room_night: 'per room night',
  per_person: 'per person',
  package: 'package',
};

/** Which vendor decisions the API accepts from each status (ALLOWED_FROM in admin.controller.ts). */
export type VendorDecision = 'approve' | 'reject' | 'hold';
export function vendorDecisions(status: string): VendorDecision[] {
  const all: Record<VendorDecision, string[]> = {
    approve: ['pending', 'on_hold'],
    reject: ['pending'],
    hold: ['pending', 'approved'],
  };
  return (Object.keys(all) as VendorDecision[]).filter((d) => all[d].includes(status));
}

/** Payout actions the API accepts from each status (admin-ops.controller.ts). */
export const canMarkPaid = (status: string) => ['scheduled', 'processing', 'held', 'failed'].includes(status);
export const canHoldPayout = (status: string) => ['scheduled', 'processing'].includes(status);

/** First block of a UUID, in capitals: enough to read out on a call ("EV-1A2B3C4D"). */
export const shortId = (id: string): string => id.slice(0, 8).toUpperCase();

/** "3 days" / "5 hours" / "just now" since an ISO time. */
export function waitingFor(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** A query string from filters, dropping empty values and page 1: '?status=paid&page=2'. */
export function toQueryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (key === 'page' && Number(value) <= 1) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** A positive page number from the URL; anything else is page 1. */
export function pageFrom(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Bars for the 14-day chart: height fractions against a rounded-up maximum. */
export function chartScale(values: number[]): { max: number; ticks: number[] } {
  const peak = Math.max(0, ...values);
  if (peak === 0) return { max: 4, ticks: [0, 2, 4] };
  const step = niceStep(peak / 4);
  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { max, ticks };
}

function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

// ---- vendor ID documents ----

export const DOC_LABELS: Record<string, string> = {
  aadhaar: 'Aadhaar',
  pan: 'PAN card',
  gst: 'GST certificate',
  shop_photo: 'Shop photo',
};

/** The number as admins may see it: Aadhaar only ever as "XXXX XXXX 1234". */
export function docNumber(docType: string, last4: string | null): string | null {
  if (!last4) return null;
  return docType === 'aadhaar' ? `XXXX XXXX ${last4}` : `ending ${last4}`;
}

/** Document view links last 10 minutes; refetch after 9 so the link still works when opened. */
export const DOC_LINK_MAX_AGE_MS = 9 * 60_000;
export const isLinkStale = (fetchedAt: number, now: number = Date.now()) => now - fetchedAt > DOC_LINK_MAX_AGE_MS;

const HISTORY_ACTIONS: Record<string, string> = {
  'vendor.approve': 'Approved',
  'vendor.reject': 'Rejected',
  'vendor.hold': 'Put on hold',
  'document.approve': 'Document approved',
  'document.reject': 'Document rejected',
};

/** Audit log action for the vendor history list, e.g. 'vendor.hold' → 'Put on hold'. */
export const historyLabel = (action: string) => HISTORY_ACTIONS[action] ?? humanize(action.replace(/\./g, ' '));

/** What each category icon looks like, for the picker (the apps draw them). */
export const CATEGORY_ICON_LABELS: Record<string, string> = {
  dj: 'Music note (DJ)',
  decor: 'Star (decoration)',
  catering: 'Covered dish (catering)',
  bartan: 'Cooking pot (bartan)',
  tent: 'Tent',
  planner: 'Clipboard (planner)',
  camera: 'Camera',
  hall: 'Building (hall)',
  halwai: 'Bowl (cook)',
  band: 'Drum (band)',
  car: 'Car',
  hotel: 'Bed (hotel)',
  bartender: 'Glass (bartender)',
  makeup: 'Lipstick (makeup)',
  other: 'Lamp (other)',
};

export const PRICING_UNIT_LABELS: Record<string, string> = {
  per_event: 'Per event',
  per_day: 'Per day',
  per_shift: 'Per shift',
  per_plate: 'Per plate',
  per_hour: 'Per hour',
  per_km: 'Per km',
  per_room_night: 'Per room per night',
  per_person: 'Per person',
  package: 'Package price',
};
