-- migrate:up
-- GST invoices (customer invoice in the vendor's name, commission invoice from EventSeva) and refund
-- results from Razorpay webhooks.

ALTER TYPE refund_status ADD VALUE IF NOT EXISTS 'processed';
ALTER TABLE refunds ADD COLUMN processed_at timestamptz;
COMMENT ON COLUMN refunds.processed_at IS 'When Razorpay said the money reached the customer (refund.processed webhook)';

ALTER TABLE vendors ADD COLUMN gstin text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
COMMENT ON COLUMN vendors.gstin IS 'The vendor''s GST number, if registered; customer invoices are tax invoices only with it';

CREATE TABLE invoice_counters (
  series text PRIMARY KEY,
  last   integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE invoice_counters IS 'Next invoice number per series (a vendor or EventSeva, per financial year); numbers never repeat or skip';

CREATE TABLE invoices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  kind       text NOT NULL CHECK (kind IN ('customer', 'commission')),
  number     text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  -- Seller, buyer, lines and totals as issued; never recalculated.
  data       jsonb NOT NULL,
  UNIQUE (booking_id, kind)
);
COMMENT ON TABLE invoices IS 'Invoices as issued: to the customer in the vendor''s name, and EventSeva''s commission invoice to the vendor';

-- migrate:down
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS invoice_counters;
ALTER TABLE vendors DROP COLUMN IF EXISTS gstin;
ALTER TABLE refunds DROP COLUMN IF EXISTS processed_at;
-- (refund_status 'processed' cannot be removed from the enum; it is harmless when unused.)
