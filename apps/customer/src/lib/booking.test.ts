import { ADVANCE_PERCENT, canCancel, daysBetween, estimate, needsQuantity, parseQuantity, refundPercent, refundPreview } from './booking';

describe('booking form estimate', () => {
  test('counted units need a quantity; fixed prices do not', () => {
    expect(needsQuantity('per_plate')).toBe(true);
    expect(needsQuantity('per_hour')).toBe(true);
    expect(needsQuantity('per_room_night')).toBe(true);
    expect(needsQuantity('per_event')).toBe(false);
    expect(needsQuantity('per_shift')).toBe(false);
    expect(needsQuantity('package')).toBe(false);
  });

  test('quantity must be a whole number from 1 to 1,00,000', () => {
    expect(parseQuantity('300')).toBe(300);
    expect(parseQuantity(' 12 ')).toBe(12);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('2.5')).toBeNull();
    expect(parseQuantity('-3')).toBeNull();
    expect(parseQuantity('100001')).toBeNull();
    expect(parseQuantity('100000')).toBe(100_000);
  });

  test('unit price × quantity, split 25% advance and the rest after the event', () => {
    expect(ADVANCE_PERCENT).toBe(25);
    // ₹450 a plate × 300 plates = ₹1,35,000
    expect(estimate(45_000, 'per_plate', 300)).toEqual({ amountPaise: 13_500_000, advancePaise: 3_375_000, balancePaise: 10_125_000 });
  });

  test('a counted unit has no estimate until a quantity is entered', () => {
    expect(estimate(45_000, 'per_plate', null)).toBeNull();
    expect(estimate(45_000, 'per_plate', 0)).toBeNull();
  });

  test('fixed-price items ignore the quantity', () => {
    expect(estimate(2_500_000, 'per_event', null)).toEqual({ amountPaise: 2_500_000, advancePaise: 625_000, balancePaise: 1_875_000 });
    expect(estimate(2_500_000, 'per_event', 7)?.amountPaise).toBe(2_500_000);
  });

  test('the advance is rounded to whole paise and advance + balance = total', () => {
    const e = estimate(333, 'per_hour', 1)!;
    expect(e.advancePaise).toBe(83);
    expect(e.advancePaise + e.balancePaise).toBe(e.amountPaise);
  });
});

describe('cancel refund preview', () => {
  const today = '2026-11-01';
  const confirmed = { status: 'confirmed' as const, payNowPaise: 1_000_000 };

  test('days between two India dates', () => {
    expect(daysBetween(today, '2026-11-01')).toBe(0);
    expect(daysBetween(today, '2026-11-16')).toBe(15);
    expect(daysBetween(today, '2026-10-31')).toBe(-1);
  });

  test('policy: 15+ days 90%, 7–14 days 50%, under 7 days 0%', () => {
    expect(refundPercent(30)).toBe(90);
    expect(refundPercent(15)).toBe(90);
    expect(refundPercent(14)).toBe(50);
    expect(refundPercent(7)).toBe(50);
    expect(refundPercent(6)).toBe(0);
    expect(refundPercent(0)).toBe(0);
  });

  test('paid booking 20 days away gets 90% of the advance', () => {
    expect(refundPreview({ ...confirmed, day: '2026-11-21' }, today)).toEqual({ paid: true, percent: 90, refundPaise: 900_000, daysBefore: 20 });
  });

  test('paid booking 10 days away gets 50%', () => {
    expect(refundPreview({ ...confirmed, day: '2026-11-11' }, today)).toMatchObject({ percent: 50, refundPaise: 500_000 });
  });

  test('paid booking 3 days away gets nothing', () => {
    expect(refundPreview({ ...confirmed, day: '2026-11-04' }, today)).toMatchObject({ paid: true, percent: 0, refundPaise: 0 });
  });

  test('with a coupon, the refund is a share of what was paid, not of the advance', () => {
    // Advance ₹3,750, coupon −₹500: ₹3,250 was paid; 20 days away gives 90% of that.
    const paid = { status: 'confirmed' as const, day: '2026-11-21', advancePaise: 375_000, discountPaise: 50_000, payNowPaise: 325_000 };
    expect(refundPreview(paid, today)).toEqual({ paid: true, percent: 90, refundPaise: 292_500, daysBefore: 20 });
  });

  test('nothing to refund before payment', () => {
    expect(refundPreview({ status: 'requested', payNowPaise: 1_000_000, day: '2026-12-01' }, today)).toMatchObject({ paid: false, refundPaise: 0 });
    expect(refundPreview({ status: 'accepted', payNowPaise: 1_000_000, day: '2026-12-01' }, today)).toMatchObject({ paid: false, refundPaise: 0 });
  });

  test('finished, cancelled or past bookings cannot be cancelled', () => {
    expect(refundPreview({ status: 'completed', payNowPaise: 1, day: '2026-12-01' }, today)).toBeNull();
    expect(refundPreview({ status: 'cancelled_by_vendor', payNowPaise: 1, day: '2026-12-01' }, today)).toBeNull();
    expect(refundPreview({ ...confirmed, day: '2026-10-30' }, today)).toBeNull();
    expect(canCancel({ status: 'confirmed', day: today }, today)).toBe(true);
  });
});
