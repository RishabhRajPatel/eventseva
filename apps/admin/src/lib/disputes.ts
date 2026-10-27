// Disputed rental / car charges and refund rows: labels and the decision form rules.
import { rupeesToPaise } from './money.ts';
import type { StatusLabel } from './labels.ts';

export interface DisputedCharge {
  id: string;
  bookingId: string;
  kind: string;
  description: string;
  amountPaise: number;
  customerNote: string | null;
  createdAt: string;
  businessName: string;
  bookingType: string;
}

export interface DisputedInspection {
  bookingId: string;
  phase: string;
  readings: Record<string, unknown> | null;
  notes: string | null;
  photoIds: string[];
  customerNote: string | null;
  disputedAt: string;
  businessName: string;
}

export interface Disputes {
  charges: DisputedCharge[];
  inspections: DisputedInspection[];
}

export const CHARGE_KIND: Record<string, string> = {
  damage: 'Damage',
  missing: 'Missing items',
  extra_km: 'Extra km',
  extra_hours: 'Extra hours',
  waiting: 'Waiting time',
  extension: 'Extension',
  guest_change: 'Guest count change',
  late_return: 'Late return',
  fuel: 'Fuel',
  toll: 'Toll',
  parking: 'Parking',
  cleaning: 'Cleaning',
  other: 'Other',
};

export const chargeKind = (kind: string): string => CHARGE_KIND[kind] ?? kind.replace(/_/g, ' ');

/** Same limits as ResolveChargeDto on the API. */
export const DECISION_NOTE = { min: 3, max: 300 } as const;

export interface DecisionForm {
  amount: string;
  note: string;
}

/** The decision can lower the charge (0 waives it) but never raise it. */
export function decisionErrors(f: DecisionForm, maxPaise: number): Partial<Record<keyof DecisionForm, string>> {
  const e: Partial<Record<keyof DecisionForm, string>> = {};
  const paise = rupeesToPaise(f.amount);
  if (paise === null) e.amount = 'Enter an amount in rupees, e.g. 500 or 0 to waive it.';
  else if (paise > maxPaise) e.amount = `A decision cannot raise the charge: at most ₹${maxPaise / 100}.`;
  const note = f.note.trim().length;
  if (note < DECISION_NOTE.min || note > DECISION_NOTE.max) e.note = `Reason must be ${DECISION_NOTE.min}–${DECISION_NOTE.max} characters.`;
  return e;
}

export type RefundStatus = 'pending' | 'sending' | 'sent' | 'processed' | 'failed';
export const REFUND_STATUSES: RefundStatus[] = ['pending', 'sending', 'sent', 'processed', 'failed'];
export const REFUND_STATUS: Record<RefundStatus, StatusLabel> = {
  pending: { label: 'Waiting', tone: 'warning' },
  sending: { label: 'Retrying', tone: 'warning' },
  sent: { label: 'Sent to Razorpay', tone: 'info' },
  processed: { label: 'Reached customer', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export interface AdminRefund {
  id: string;
  bookingId: string;
  amountPaise: number;
  reason: string;
  status: RefundStatus;
  attempts: number;
  lastError: string | null;
  razorpayRefundId: string | null;
  createdAt: string;
  sentAt: string | null;
  processedAt: string | null;
}

/** A failed refund can be sent again once: the API marks the old row ":retried" and adds a new one. */
export const canRetryRefund = (r: Pick<AdminRefund, 'status' | 'reason'>): boolean => r.status === 'failed' && !r.reason.endsWith(':retried');
