import type { Booking } from '@eventseva/app-shared';
import { showsHandoverCode } from '../components/HandoverCodeCard';

const booking = (b: Partial<Booking>) => ({ status: 'confirmed', bookingType: 'transport', stage: 'confirmed', ...b }) as Booking;

describe('handover code card', () => {
  it('shows for confirmed cars and rentals until the return is counted', () => {
    expect(showsHandoverCode(booking({}))).toBe(true);
    expect(showsHandoverCode(booking({ bookingType: 'rental', stage: 'delivered' }))).toBe(true);
    expect(showsHandoverCode(booking({ stage: 'return_pending' }))).toBe(false);
    expect(showsHandoverCode(booking({ status: 'accepted', stage: 'awaiting_payment' }))).toBe(false);
    expect(showsHandoverCode(booking({ bookingType: 'slot' }))).toBe(false);
  });
});
