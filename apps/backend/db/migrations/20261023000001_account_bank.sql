-- migrate:up
-- Where a vendor's payouts go. The account number is encrypted (AES-256-GCM, key in BANK_DETAILS_KEY);
-- only the last 4 digits are readable in the database.
CREATE TABLE vendor_bank_accounts (
  vendor_id       uuid PRIMARY KEY REFERENCES vendors(id),
  holder_name     text NOT NULL,
  account_enc     text NOT NULL,
  account_last4   text NOT NULL CHECK (account_last4 ~ '^\d{4}$'),
  ifsc            text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id          text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reject_reason   text,
  verified_by     uuid REFERENCES admin_users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE vendor_bank_accounts;
