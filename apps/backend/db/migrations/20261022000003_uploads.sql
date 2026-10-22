-- migrate:up
-- Documents are private Cloudinary files; the format is needed to build a signed download link.
ALTER TABLE vendor_documents
  ADD COLUMN format text NOT NULL DEFAULT 'jpg',
  ADD COLUMN reject_reason text,
  ADD CHECK (doc_type IN ('aadhaar', 'pan', 'gst', 'shop_photo')),
  ADD CHECK (last4 IS NULL OR last4 ~ '^\d{4}$');
CREATE INDEX ON vendor_documents (vendor_id, created_at DESC);

-- migrate:down
DROP INDEX IF EXISTS vendor_documents_vendor_id_created_at_idx;
ALTER TABLE vendor_documents DROP COLUMN format, DROP COLUMN reject_reason;
