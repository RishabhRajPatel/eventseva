-- migrate:up
-- Vendor-configurable services (docs/BOOKING_ENGINE.md, "What a vendor configures"): the vendor's own
-- questions, the event types served, several rate plans, and a history of every change to the price,
-- rules or questions. Only additions: existing services keep working with the defaults.
ALTER TABLE services
  ADD COLUMN questions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(questions) = 'array'),
  ADD COLUMN event_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN plans jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(plans) = 'array'),
  ADD COLUMN config_version integer NOT NULL DEFAULT 1 CHECK (config_version >= 1);
COMMENT ON COLUMN services.questions IS 'The vendor''s own questions for the customer, asked after the category''s (same field format)';
COMMENT ON COLUMN services.event_types IS 'Event types the service is offered for; empty means every event';
COMMENT ON COLUMN services.plans IS 'Rate plans: ways to book the service, each with its own pricing (and rule overrides); empty means the service pricing';
COMMENT ON COLUMN services.config_version IS 'Goes up by one with every change to pricing, rules, questions, plans or event types';
CREATE INDEX services_event_types_idx ON services USING gin (event_types) WHERE is_active;

CREATE TABLE service_config_history (
  id bigserial PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id),
  version integer NOT NULL,
  changed_by uuid REFERENCES users(id),
  -- Only the settings that changed: {"pricing": {"before": …, "after": …}, …}
  changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, version)
);
COMMENT ON TABLE service_config_history IS 'Every change a vendor made to a service''s price, rules, questions, plans or event types (bookings keep their own snapshot)';

-- migrate:down
DROP TABLE service_config_history;
DROP INDEX services_event_types_idx;
ALTER TABLE services DROP COLUMN config_version, DROP COLUMN plans, DROP COLUMN event_types, DROP COLUMN questions;
