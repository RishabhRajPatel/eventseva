import type { CuratedPackage } from '@eventseva/app-shared';
import { packageFromPaise } from '../app/packages';

const pkg = (prices: number[], discountPercent: number): CuratedPackage => ({
  id: 'p1',
  name: 'Full wedding',
  description: null,
  eventType: 'wedding',
  discountPercent,
  available: true,
  services: prices.map((pricePaise, i) => ({
    serviceId: `s${i}`,
    title: `Service ${i}`,
    vendorId: `v${i}`,
    vendorName: `Vendor ${i}`,
    pricePaise,
    unit: 'per_event',
    mandatory: true,
  })),
});

describe('package price', () => {
  it('adds the services up and takes the discount off', () => {
    expect(packageFromPaise(pkg([2_000_000, 3_000_000], 10))).toBe(4_500_000);
    expect(packageFromPaise(pkg([2_500_000, 2_500_000], 0))).toBe(5_000_000);
  });

  it('is always whole paise, even when the discount does not divide evenly', () => {
    // 1001 × 88 / 100 = 880.88 — a fraction of a paisa would print as ₹8.8088.
    for (const [prices, percent] of [
      [[1001], 12],
      [[333_333], 7],
      [[2_500_001], 15],
      [[7, 11, 13], 33],
    ] as [number[], number][]) {
      const total = packageFromPaise(pkg(prices, percent));
      expect(Number.isInteger(total)).toBe(true);
    }
  });

  it('never costs more than the services on their own', () => {
    const prices = [1_234_567, 89_101];
    const listed = prices.reduce((a, b) => a + b, 0);
    for (const percent of [0, 1, 7, 12, 50]) {
      expect(packageFromPaise(pkg(prices, percent))).toBeLessThanOrEqual(listed);
    }
  });

  it('is zero for an empty package rather than NaN', () => {
    expect(packageFromPaise(pkg([], 10))).toBe(0);
  });
});
