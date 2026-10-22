import i18n from '../i18n';
import { ApiError } from '@eventseva/app-shared';
import { errorText } from '../lib/errors';

test('a 24-hour OTP limit tells the user exactly when to try again', () => {
  const t = i18n.getFixedT('en');
  const e = new ApiError(429, 'OTP_LIMIT', 'Too many', { retryAfterSec: 79_000, retryAt: '2026-10-23T18:29:00Z' });
  expect(errorText(t, e)).toBe('Too many codes for this number. You can try again after 23 Oct, 11:59 pm.');
  expect(errorText(t, new ApiError(429, 'OTP_LIMIT', 'Too many'))).toBe('Too many codes requested. Please try again later.');
});
