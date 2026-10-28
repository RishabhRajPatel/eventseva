import type { Package, Service, Slot, VendorDetail } from '@eventseva/app-shared';

/** A bookable thing on a vendor page: a service (priced per unit) or a fixed package. */
export type Item = { type: 'service'; id: string; title: string; pricePaise: number; unit: Service['unit']; detail: string | null; cashAllowed?: boolean } | {
  type: 'package';
  id: string;
  title: string;
  pricePaise: number;
  unit: 'package';
  detail: string | null;
  cashAllowed?: boolean;
};

export function vendorItems(v: Pick<VendorDetail, 'services' | 'packages'>): Item[] {
  const packages: Item[] = v.packages
    .filter((p: Package) => p.isActive)
    .map((p) => ({ type: 'package', id: p.id, title: p.title, pricePaise: p.pricePaise, unit: 'package', detail: p.items.join(' · ') || null, cashAllowed: p.cashAllowed ?? false }));
  const services: Item[] = v.services
    .filter((s: Service) => s.isActive)
    .map((s) => ({ type: 'service', id: s.id, title: s.title, pricePaise: s.pricePaise, unit: s.unit, detail: s.description, cashAllowed: s.cashAllowed ?? false }));
  return [...packages, ...services];
}

export const itemKey = (i: Pick<Item, 'type' | 'id'>) => `${i.type}:${i.id}`;

/** Per day: 'full' when no slot is left, 'partial' when one of day/night is taken. */
export function busyByDay(busy: { day: string; slot: Slot }[]): Record<string, 'full' | 'partial'> {
  const slots: Record<string, Set<Slot>> = {};
  for (const b of busy) (slots[b.day] ??= new Set()).add(b.slot);
  const out: Record<string, 'full' | 'partial'> = {};
  for (const [day, s] of Object.entries(slots)) out[day] = s.has('full') || (s.has('day') && s.has('night')) ? 'full' : 'partial';
  return out;
}

/** Slots that can still be requested on a day: a whole-day booking blocks everything, and the reverse. */
export function freeSlots(taken: Slot[]): Record<Slot, boolean> {
  const has = (s: Slot) => taken.includes(s);
  return {
    full: taken.length === 0,
    day: !has('full') && !has('day'),
    night: !has('full') && !has('night'),
  };
}
