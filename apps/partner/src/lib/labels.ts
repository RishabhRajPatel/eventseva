// Turning API values into words in the current language.
import type { TFunction } from 'i18next';
import type { BookingStatus, EventType, PricingUnit, Slot, VendorStatus } from '@eventseva/app-shared';
import type { Tone } from '../components/Chip';
import type { Remaining } from './bookings';

export const slotLabel = (t: TFunction, slot: Slot) => t(`slot.${slot}`);
export const slotHours = (t: TFunction, slot: Slot) => t(`slotHours.${slot}`);
export const eventTypeLabel = (t: TFunction, type: EventType) => t(`eventType.${type}`);
export const unitLabel = (t: TFunction, unit: PricingUnit) => t(`unit.${unit}`);

export function bookingStatus(t: TFunction, status: BookingStatus): { label: string; tone: Tone } {
  const tone: Record<BookingStatus, Tone> = {
    requested: 'warning',
    accepted: 'info',
    confirmed: 'success',
    completed: 'success',
    rejected: 'neutral',
    expired: 'neutral',
    cancelled_by_customer: 'danger',
    cancelled_by_vendor: 'danger',
  };
  return { label: t(`bookingStatus.${status}`), tone: tone[status] };
}

export function vendorStatus(t: TFunction, status: VendorStatus): { label: string; tone: Tone } {
  const tone: Record<VendorStatus, Tone> = { draft: 'neutral', pending: 'warning', approved: 'success', rejected: 'danger', on_hold: 'warning' };
  return { label: t(`vendorStatus.${status}`), tone: tone[status] };
}

/** "18h 20m left" / "40m left". */
export function timeLeftLabel(t: TFunction, r: Remaining): string {
  return r.hours ? t('time.hoursLeft', { h: r.hours, m: r.minutes }) : t('time.minutesLeft', { m: r.minutes });
}
