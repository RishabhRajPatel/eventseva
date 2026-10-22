import type { PricingUnit } from '@eventseva/app-shared';

/** Units a vendor can price a service in ('package' is only for packages). */
export const SERVICE_UNITS: PricingUnit[] = ['per_event', 'per_day', 'per_shift', 'per_plate', 'per_hour', 'per_km', 'per_room_night', 'per_person'];

/** A category's default unit, if a service can use it. */
export const defaultServiceUnit = (unit: PricingUnit | undefined): PricingUnit => (unit && SERVICE_UNITS.includes(unit) ? unit : 'per_event');

export const MAX_PACKAGE_ITEMS = 20;
