import i18n from '../i18n';
import { ApiError } from '@eventseva/app-shared';
import { errorText } from '../lib/errors';

test('a 24-hour OTP limit tells the vendor exactly when to try again', () => {
  const t = i18n.getFixedT('en');
  const e = new ApiError(429, 'OTP_LIMIT', 'Too many', { retryAfterSec: 79_000, retryAt: '2026-10-23T18:29:00Z' });
  expect(errorText(t, e)).toBe('Too many OTP requests for this number. You can try again after 23 Oct, 11:59 pm.');
});
