-- migrate:up
-- One-time recovery codes (keyed hashes) for an admin who lost their phone, and the short
-- "re-confirmed" window after entering a fresh 2FA code for a sensitive action.
ALTER TABLE admin_users
  ADD COLUMN recovery_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN step_up_until timestamptz,
  ADD COLUMN step_up_session bigint;
COMMENT ON COLUMN admin_users.recovery_codes IS 'HMAC hashes of unused one-time recovery codes; a used code is removed';
COMMENT ON COLUMN admin_users.step_up_until IS 'Money and personal-data actions need no new 2FA code until this time (5 minutes after one)';
COMMENT ON COLUMN admin_users.step_up_session IS 'The login (token issue time, ms) the window belongs to: another login never inherits it';
COMMENT ON COLUMN admin_users.totp_secret IS '2FA secret, encrypted with BANK_DETAILS_KEY (v1:…); old plain rows are encrypted at the next login';

-- migrate:down
ALTER TABLE admin_users DROP COLUMN IF EXISTS step_up_session, DROP COLUMN IF EXISTS step_up_until, DROP COLUMN IF EXISTS recovery_codes;
