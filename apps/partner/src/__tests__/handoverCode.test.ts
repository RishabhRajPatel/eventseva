import { customerCode } from '../lib/handoverCode';

describe('customer handover code', () => {
  it('is sent only when all 6 digits are typed', () => {
    expect(customerCode('482913')).toEqual({ customerCode: '482913' });
    expect(customerCode('')).toEqual({});
    expect(customerCode('48291')).toEqual({});
  });
});
