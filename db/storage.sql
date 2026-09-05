BEGIN;

CREATE TABLE IF NOT EXISTS storage_objects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  storage_driver TEXT NOT NULL DEFAULT 'postgres' CHECK (storage_driver IN ('local','s3','postgres')),
  data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE storage_objects ADD COLUMN IF NOT EXISTS data BYTEA;
ALTER TABLE storage_objects DROP CONSTRAINT IF EXISTS storage_objects_storage_driver_check;
ALTER TABLE storage_objects ADD CONSTRAINT storage_objects_storage_driver_check
  CHECK (storage_driver IN ('local','s3','postgres'));

CREATE INDEX IF NOT EXISTS storage_objects_user_created_idx
  ON storage_objects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS storage_objects_user_key_idx
  ON storage_objects(user_id, object_key);

COMMIT;
