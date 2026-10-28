-- migrate:up
-- Every payment-provider webhook, kept once per provider event id: a repeated delivery is answered
-- without running again, a failed one is retried by the provider and its error kept for support.
CREATE TABLE webhook_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL DEFAULT 'razorpay',
  event_id text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  result text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);
COMMENT ON TABLE webhook_events IS 'Payment webhooks by provider event id: duplicates are answered without running twice; failures keep their error and are retried by the provider';
COMMENT ON COLUMN webhook_events.result IS 'What the event did, e.g. confirmed, refunded, already_done, amount_mismatch';
CREATE INDEX webhook_events_open_idx ON webhook_events (received_at) WHERE status IN ('received', 'failed');

-- Payments still "created" are checked with the provider by the reconciliation job.
ALTER TABLE payments ADD COLUMN checked_at timestamptz;
COMMENT ON COLUMN payments.checked_at IS 'Last time the reconciliation job asked the provider about this unpaid order';
CREATE INDEX payments_open_idx ON payments (created_at) WHERE status = 'created';
ALTER TABLE featured_purchases ADD COLUMN checked_at timestamptz;
COMMENT ON COLUMN featured_purchases.checked_at IS 'Last time the reconciliation job asked the provider about this unpaid order';

-- migrate:down
ALTER TABLE featured_purchases DROP COLUMN checked_at;
DROP INDEX payments_open_idx;
ALTER TABLE payments DROP COLUMN checked_at;
DROP TABLE webhook_events;
