-- migrate:up
-- A photo of the customer's driving licence (private Cloudinary file), so the verifier can compare
-- it with the number and dates typed in. storage_key already holds the public id; this is its format.
ALTER TABLE customer_licences ADD COLUMN storage_format text CHECK (storage_format IN ('jpg', 'jpeg', 'png', 'pdf'));
COMMENT ON COLUMN customer_licences.storage_format IS 'File type of the private licence photo in storage_key (for the expiring view link)';

-- migrate:down
ALTER TABLE customer_licences DROP COLUMN storage_format;
