import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCode, couponBody, couponEditBody, couponEditErrors, couponFormErrors, couponSummary, EMPTY_COUPON, istDay, type CouponForm } from './coupons.ts';

const fmt = (p: number) => `₹${p / 100}`;

test('discount summary', () => {
  assert.equal(couponSummary({ discountType: 'percent', discountValue: 10, maxDiscountPaise: 50_000 }, fmt), '10% off, up to ₹500');
  assert.equal(couponSummary({ discountType: 'percent', discountValue: 15, maxDiscountPaise: null }, fmt), '15% off');
  assert.equal(couponSummary({ discountType: 'flat', discountValue: 30_000, maxDiscountPaise: null }, fmt), '₹300 off');
});

const good: CouponForm = { ...EMPTY_COUPON, code: 'SHAADI10', titleEn: 'Wedding offer', titleHi: 'शादी ऑफ़र', value: '10', maxDiscount: '500' };

test('coupon form validation', () => {
  assert.deepEqual(couponFormErrors(good), {});
  assert.equal(cleanCode('shaadi-10!'), 'SHAADI10');
  const bad = couponFormErrors({ ...good, code: 'AB', titleEn: 'x', value: '101', maxDiscount: '0', perCustomerLimit: '0', maxUses: '1.5' });
  assert.deepEqual(Object.keys(bad).sort(), ['code', 'maxDiscount', 'maxUses', 'perCustomerLimit', 'titleEn', 'value']);
  assert.ok(couponFormErrors({ ...good, value: '0' }).value);
  assert.ok(couponFormErrors({ ...good, value: '12.5' }).value, 'percent must be whole');
  assert.deepEqual(couponFormErrors({ ...good, discountType: 'flat', value: '299.50', maxDiscount: '' }), {});
  assert.ok(couponFormErrors({ ...good, discountType: 'flat', value: '0.5' }).value);
  assert.ok(couponFormErrors({ ...good, validFrom: '2026-11-10', validUntil: '2026-11-01' }).validUntil);
  assert.ok(couponFormErrors({ ...good, minAmount: 'lots' }).minAmount);
});

test('coupon body sends paise and India day bounds', () => {
  assert.deepEqual(couponBody({ ...good, code: 'shaadi10', minAmount: '2,000', categoryId: '3', maxUses: '100', validFrom: '2026-11-01', validUntil: '2026-11-30' }), {
    code: 'SHAADI10',
    titleEn: 'Wedding offer',
    titleHi: 'शादी ऑफ़र',
    discountType: 'percent',
    discountValue: 10,
    maxDiscountPaise: 50_000,
    minAmountPaise: 200_000,
    categoryId: 3,
    firstBookingOnly: false,
    isPublic: true,
    maxUses: 100,
    perCustomerLimit: 1,
    validFrom: '2026-10-31T18:30:00.000Z',
    validUntil: '2026-11-30T18:29:59.000Z',
  });
  const flat = couponBody({ ...good, discountType: 'flat', value: '300', maxDiscount: '999' });
  assert.equal(flat.discountValue, 30_000);
  assert.equal('maxDiscountPaise' in flat, false, 'a flat discount has no cap');
  assert.equal(istDay('2026-11-30T18:29:59.000Z'), '2026-11-30');
});

test('coupon edit', () => {
  const f = { titleEn: 'Offer', titleHi: 'ऑफ़र', isActive: false, isPublic: true, maxUses: '', validUntil: '' };
  assert.deepEqual(couponEditErrors(f), {});
  assert.deepEqual(couponEditBody(f), { titleEn: 'Offer', titleHi: 'ऑफ़र', isActive: false, isPublic: true });
  assert.ok(couponEditErrors({ ...f, maxUses: '0' }).maxUses);
});
