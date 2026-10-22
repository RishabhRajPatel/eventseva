import { booking } from './fixtures';
import { groupBookings, isCancellable, remaining, segmentOf, vendorPayout } from '../lib/bookings';

const NOW = new Date('2026-11-10T06:00:00Z').getTime();
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe('segments', () => {
  it('maps every status to one of the four lists', () => {
    expect(segmentOf('requested')).toBe('new');
    expect(segmentOf('accepted')).toBe('awaitingPayment');
    expect(segmentOf('confirmed')).toBe('upcoming');
    for (const s of ['completed', 'rejected', 'expired', 'cancelled_by_customer', 'cancelled_by_vendor'] as const) expect(segmentOf(s)).toBe('past');
  });

  it('groups and orders bookings; a request past its deadline moves to Past', () => {
    const g = groupBookings(
      [
        booking('late', 'requested', { respondBy: hours(20) }),
        booking('soon', 'requested', { respondBy: hours(2) }),
        booking('gone', 'requested', { respondBy: hours(-1) }),
        booking('pay', 'accepted', { payBy: hours(10) }),
        booking('dec', 'confirmed', { day: '2026-12-20' }),
        booking('nov', 'confirmed', { day: '2026-11-20' }),
        booking('old', 'completed', { day: '2026-10-01' }),
      ],
      NOW,
    );
    expect(g.new.map((b) => b.id)).toEqual(['soon', 'late']);
    expect(g.awaitingPayment.map((b) => b.id)).toEqual(['pay']);
    expect(g.upcoming.map((b) => b.id)).toEqual(['nov', 'dec']);
    expect(g.past.map((b) => b.id)).toEqual(['gone', 'old']);
  });
});

describe('countdown', () => {
  it('counts hours and minutes to respondBy', () => {
    expect(remaining(hours(18.5), NOW)).toEqual({ hours: 18, minutes: 30, urgent: false });
    expect(remaining(hours(0.75), NOW)).toEqual({ hours: 0, minutes: 45, urgent: true });
  });

  it('is null once the deadline passes or when there is none', () => {
    expect(remaining(hours(-0.01), NOW)).toBeNull();
    expect(remaining(hours(0), NOW)).toBeNull();
    expect(remaining(null, NOW)).toBeNull();
  });
});

describe('money and actions', () => {
  it('payout is advance minus the EventSeva fee', () => {
    expect(vendorPayout(booking('a', 'requested'))).toBe(150_000);
    expect(vendorPayout(booking('a', 'requested', { payoutPaise: undefined }))).toBe(150_000);
  });

  it('only accepted/confirmed future bookings can be cancelled', () => {
    expect(isCancellable(booking('a', 'confirmed'), '2026-11-10')).toBe(true);
    expect(isCancellable(booking('a', 'accepted'), '2026-11-10')).toBe(true);
    expect(isCancellable(booking('a', 'requested'), '2026-11-10')).toBe(false);
    expect(isCancellable(booking('a', 'confirmed', { day: '2026-11-01' }), '2026-11-10')).toBe(false);
  });
});
