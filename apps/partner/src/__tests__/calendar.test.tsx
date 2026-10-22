import { fireEvent, render, screen } from '@testing-library/react-native';
import '../i18n';
import type { CalendarEntry } from '@eventseva/app-shared';
import { canBlock, freeDay, monthGrid, shiftMonth, slotAction, slotsByDay, summarizeDay } from '../lib/calendar';
import { CalendarGrid } from '../components/CalendarGrid';

const TODAY = '2026-11-10';

const entries: CalendarEntry[] = [
  { day: '2026-11-12', slot: 'night', status: 'booked', bookingId: 'b1' },
  { day: '2026-11-14', slot: 'full', status: 'blocked', bookingId: null },
  { day: '2026-11-15', slot: 'day', status: 'blocked', bookingId: null },
  { day: '2026-11-15', slot: 'night', status: 'booked', bookingId: 'b2' },
];
const slots = slotsByDay(entries);

describe('month grid', () => {
  it('starts on Monday and pads the first week', () => {
    // 1 Nov 2026 is a Sunday.
    const weeks = monthGrid('2026-11');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('moves between months and years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('slot states', () => {
  it('days not listed are free; listed slots are booked or blocked', () => {
    expect(slots.get('2026-11-11')).toBeUndefined();
    expect(slots.get('2026-11-12')!.night).toEqual({ status: 'booked', bookingId: 'b1' });
    expect(slots.get('2026-11-12')!.day).toEqual({ status: 'free' });
    expect(slots.get('2026-11-14')!.full).toEqual({ status: 'blocked' });
  });

  it('summarizes a day for the grid colour', () => {
    expect(summarizeDay(undefined, '2026-11-11', TODAY)).toBe('free');
    expect(summarizeDay(slots.get('2026-11-12'), '2026-11-12', TODAY)).toBe('partial');
    expect(summarizeDay(slots.get('2026-11-14'), '2026-11-14', TODAY)).toBe('blocked');
    expect(summarizeDay(slots.get('2026-11-15'), '2026-11-15', TODAY)).toBe('booked');
    expect(summarizeDay(undefined, '2026-11-09', TODAY)).toBe('past');
  });

  it('follows the server overlap rule: full day clashes with day and night', () => {
    const halfBooked = slots.get('2026-11-12')!;
    expect(canBlock(halfBooked, 'day', '2026-11-12', TODAY)).toBe(true);
    expect(canBlock(halfBooked, 'full', '2026-11-12', TODAY)).toBe(false);
    const fullBlocked = slots.get('2026-11-14')!;
    expect(canBlock(fullBlocked, 'day', '2026-11-14', TODAY)).toBe(false);
  });

  it('decides what tapping a slot does', () => {
    expect(slotAction(freeDay(), 'full', '2026-11-20', TODAY)).toBe('block');
    expect(slotAction(slots.get('2026-11-14')!, 'full', '2026-11-14', TODAY)).toBe('unblock');
    expect(slotAction(slots.get('2026-11-12')!, 'night', '2026-11-12', TODAY)).toBe('open');
    expect(slotAction(slots.get('2026-11-12')!, 'full', '2026-11-12', TODAY)).toBe('none');
  });

  it('never blocks or unblocks a past day, but a past booking can still be opened', () => {
    expect(slotAction(freeDay(), 'day', '2026-11-09', TODAY)).toBe('none');
    const past = slotsByDay([
      { day: '2026-11-01', slot: 'day', status: 'blocked', bookingId: null },
      { day: '2026-11-01', slot: 'night', status: 'booked', bookingId: 'b9' },
    ]).get('2026-11-01')!;
    expect(slotAction(past, 'day', '2026-11-01', TODAY)).toBe('none');
    expect(slotAction(past, 'night', '2026-11-01', TODAY)).toBe('open');
  });
});

describe('<CalendarGrid>', () => {
  it('disables past days and selects future ones', async () => {
    const onSelect = jest.fn();
    await render(<CalendarGrid month="2026-11" slots={slots} today={TODAY} selected={null} onSelect={onSelect} />);
    const past = screen.getByTestId('day-2026-11-05');
    expect(past.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(past);
    expect(onSelect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('day-2026-11-14'));
    expect(onSelect).toHaveBeenCalledWith('2026-11-14');
    expect(screen.getByLabelText('14 · Blocked')).toBeTruthy();
    expect(screen.getByLabelText('15 · Booked')).toBeTruthy();
  });
});
