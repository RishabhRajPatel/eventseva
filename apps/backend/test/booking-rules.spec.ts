import { daysUntil, needsQuantity, priceBooking, refundPaise, refundPercent, slotsClash, todayIst } from '../src/bookings/booking.rules';

describe('booking rules', () => {
  it('prices from the unit price, never from the app', () => {
    expect(priceBooking(45_000, 300, 25, 10)).toEqual({ amountPaise: 13_500_000, advancePaise: 3_375_000, commissionPaise: 1_350_000 });
    expect(priceBooking(1_499_99, 1, 25, 10)).toEqual({ amountPaise: 149_999, advancePaise: 37_500, commissionPaise: 15_000 });
  });

  it('only counted units ask for a quantity', () => {
    expect(needsQuantity('per_plate')).toBe(true);
    expect(needsQuantity('per_hour')).toBe(true);
    expect(needsQuantity('per_event')).toBe(false);
    expect(needsQuantity('package')).toBe(false);
  });

  it('full day clashes with everything; day and night do not clash', () => {
    expect(slotsClash('day', 'night')).toBe(false);
    expect(slotsClash('day', 'day')).toBe(true);
    expect(slotsClash('full', 'night')).toBe(true);
    expect(slotsClash('day', 'full')).toBe(true);
  });

  it('cancellation refund policy', () => {
    expect(refundPercent('customer', 30)).toBe(90);
    expect(refundPercent('customer', 15)).toBe(90);
    expect(refundPercent('customer', 14)).toBe(50);
    expect(refundPercent('customer', 7)).toBe(50);
    expect(refundPercent('customer', 6)).toBe(0);
    expect(refundPercent('customer', 0)).toBe(0);
    expect(refundPercent('vendor', 0)).toBe(100);
    expect(refundPaise(3_375_000, 90)).toBe(3_037_500);
  });

  it('dates follow India time', () => {
    // 20:00 UTC on 21 Oct is already 22 Oct in India.
    const now = new Date('2026-10-21T20:00:00Z');
    expect(todayIst(now)).toBe('2026-10-22');
    expect(daysUntil('2026-10-22', now)).toBe(0);
    expect(daysUntil('2026-11-06', now)).toBe(15);
    expect(daysUntil('2026-10-21', now)).toBe(-1);
  });
});
