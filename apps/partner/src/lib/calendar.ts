import type { CalendarEntry, Slot } from '@eventseva/app-shared';

export type SlotState = { status: 'free' } | { status: 'booked'; bookingId: string | null } | { status: 'blocked' };
export type DaySlots = Record<Slot, SlotState>;
export type DaySummary = 'free' | 'partial' | 'booked' | 'blocked' | 'past';

const FREE: SlotState = { status: 'free' };

/** 'YYYY-MM' of a 'YYYY-MM-DD' day. */
export const monthOf = (day: string) => day.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Weeks of a month, Monday first; null pads the first and last week. */
export function monthGrid(month: string): Array<Array<string | null>> {
  const [y, m] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon = 0
  const cells: Array<string | null> = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth(month); d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The state of each slot of every listed day; days not in the map are fully free. */
export function slotsByDay(entries: CalendarEntry[]): Map<string, DaySlots> {
  const map = new Map<string, DaySlots>();
  for (const e of entries) {
    const slots = map.get(e.day) ?? { full: FREE, day: FREE, night: FREE };
    slots[e.slot] = e.status === 'booked' ? { status: 'booked', bookingId: e.bookingId } : { status: 'blocked' };
    map.set(e.day, slots);
  }
  return map;
}

export const freeDay = (): DaySlots => ({ full: FREE, day: FREE, night: FREE });

export const isPastDay = (day: string, today: string) => day < today;

export function summarizeDay(slots: DaySlots | undefined, day: string, today: string): DaySummary {
  if (isPastDay(day, today)) return 'past';
  if (!slots) return 'free';
  const states = [slots.full, slots.day, slots.night].map((s) => s.status);
  const booked = states.includes('booked');
  const blocked = states.includes('blocked');
  if (!booked && !blocked) return 'free';
  // Whole day taken (full slot, or both halves).
  const wholeTaken = slots.full.status !== 'free' || (slots.day.status !== 'free' && slots.night.status !== 'free');
  if (!wholeTaken) return 'partial';
  return booked ? 'booked' : 'blocked';
}

/**
 * Whether a free slot can be blocked: the full day overlaps both halves, so the server
 * refuses "full" when day or night is taken, and day/night when the full day is taken.
 */
export function canBlock(slots: DaySlots, slot: Slot, day: string, today: string): boolean {
  if (isPastDay(day, today) || slots[slot].status !== 'free') return false;
  if (slot === 'full') return slots.day.status === 'free' && slots.night.status === 'free';
  return slots.full.status === 'free';
}

/** What tapping a slot row does. */
export type SlotAction = 'block' | 'unblock' | 'open' | 'none';

export function slotAction(slots: DaySlots, slot: Slot, day: string, today: string): SlotAction {
  const s = slots[slot];
  if (s.status === 'booked') return s.bookingId ? 'open' : 'none';
  if (isPastDay(day, today)) return 'none';
  if (s.status === 'blocked') return 'unblock';
  return canBlock(slots, slot, day, today) ? 'block' : 'none';
}
