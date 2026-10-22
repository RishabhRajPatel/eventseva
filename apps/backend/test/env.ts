// Shared by global-setup and every spec, so both talk to the same throwaway database.
export const ADMIN_DB_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
export const TEST_DB_NAME = 'eventseva_test';
export const TEST_DB_URL = ADMIN_DB_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);

export function useTestEnv() {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.OTP_PEPPER = 'test-otp-pepper';
  process.env.REVIEW_PHONE = '9000000001';
  process.env.REVIEW_OTP = '123456';
  process.env.RATE_LIMIT_PER_MIN = '10000';
  process.env.AUTH_RATE_LIMIT_PER_MIN = '10000';
  process.env.PAYMENT_PROVIDER = 'fake';
  process.env.BOOKING_SWEEP_SEC = '0';
  process.env.CLOUDINARY_URL = 'cloudinary://111222333:test-secret@testcloud';
}
