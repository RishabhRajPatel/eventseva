import { cashKinds } from '../lib/cash';

const money = { amountPaise: 1_500_000, depositPaise: 0, depositHeldPaise: 0, receivedPaise: 0 };

describe('cash entries the vendor can record', () => {
  it('advance first, then payment; deposit only while confirmed; give-backs only of what was taken', () => {
    expect(cashKinds({ status: 'confirmed' }, money)).toEqual(['advance']);
    expect(cashKinds({ status: 'confirmed' }, { ...money, receivedPaise: 500_000 })).toEqual(['balance', 'refund']);
    expect(cashKinds({ status: 'confirmed' }, { ...money, depositPaise: 500_000 })).toEqual(['advance', 'deposit']);
    expect(cashKinds({ status: 'completed' }, { ...money, receivedPaise: 1_500_000, depositPaise: 500_000, depositHeldPaise: 500_000 })).toEqual(['deposit_return', 'refund']);
    expect(cashKinds({ status: 'cancelled_by_customer' }, { ...money, receivedPaise: 400_000 })).toEqual(['refund']);
  });
});
