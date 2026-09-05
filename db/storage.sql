BEGIN;

CREATE TABLE IF NOT EXISTS storage_objects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  storage_driver TEXT NOT NULL CHECK (storage_driver IN ('local','s3')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS storage_objects_user_created_idx
  ON storage_objects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS storage_objects_user_key_idx
  ON storage_objects(user_id, object_key);

COMMIT;
