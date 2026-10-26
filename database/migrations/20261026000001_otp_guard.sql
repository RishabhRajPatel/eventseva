-- migrate:up
-- false for codes that were not texted (the Play Store reviewer's fixed code), so they do not count
-- against the daily SMS budget.
ALTER TABLE otp_requests ADD COLUMN sms_sent boolean NOT NULL DEFAULT true;
CREATE INDEX otp_requests_sms_sent_idx ON otp_requests (created_at) WHERE sms_sent;
COMMENT ON COLUMN otp_requests.sms_sent IS 'false when no SMS went out (Play Store reviewer number)';

CREATE TABLE system_alerts (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,                  -- sms_budget_warning, sms_budget_reached, sms_budget_hard_stop
  message      text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES admin_users(id)
);
CREATE INDEX system_alerts_open_idx ON system_alerts (created_at DESC) WHERE resolved_at IS NULL;
COMMENT ON TABLE system_alerts IS 'Problems the system raises for the team (e.g. the daily SMS budget running out), shown on the admin dashboard until someone marks them resolved.';

-- migrate:down
DROP TABLE system_alerts;
DROP INDEX otp_requests_sms_sent_idx;
ALTER TABLE otp_requests DROP COLUMN sms_sent;
