-- migrate:up
-- A handover or return the customer confirmed on the spot with their booking's handover code.
ALTER TABLE booking_inspections ADD COLUMN confirmed_by text CHECK (confirmed_by IN ('code'));
COMMENT ON COLUMN booking_inspections.confirmed_by IS 'code: the customer gave the vendor their handover code, so this record counts as agreed';

-- migrate:down
ALTER TABLE booking_inspections DROP COLUMN confirmed_by;
