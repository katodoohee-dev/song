BEGIN;

CREATE TABLE IF NOT EXISTS audio_analysis (
  id UUID PRIMARY KEY,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  audio_file_id UUID REFERENCES audio_files(id) ON DELETE CASCADE,
  bpm REAL,
  bpm_confidence REAL CHECK (bpm_confidence BETWEEN 0 AND 1),
  music_key TEXT,
  key_mode TEXT CHECK (key_mode IN ('major','minor')),
  key_confidence REAL CHECK (key_confidence BETWEEN 0 AND 1),
  beats JSONB NOT NULL DEFAULT '[]'::jsonb,
  peaks JSONB NOT NULL DEFAULT '[]'::jsonb,
  loudness_rms REAL,
  peak_dbfs REAL,
  sample_rate INT,
  channels SMALLINT,
  codec TEXT,
  bitrate INT,
  analyzer_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audio_analysis_unique UNIQUE (song_id, analyzer_version)
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id UUID REFERENCES songs(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempts SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_jobs_active
  ON processing_jobs(song_id, job_type)
  WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_processing_jobs_claim
  ON processing_jobs(status, run_after)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_audio_analysis_song ON audio_analysis(song_id);

ALTER TABLE songs ADD COLUMN IF NOT EXISTS album_artist TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION songs_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title,'')),'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.note,'')),'D');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_songs_tsv ON songs;
CREATE TRIGGER trg_songs_tsv BEFORE INSERT OR UPDATE OF title,note ON songs
  FOR EACH ROW EXECUTE FUNCTION songs_tsv_update();
UPDATE songs SET title = title WHERE search_tsv IS NULL;
CREATE INDEX IF NOT EXISTS idx_songs_tsv ON songs USING GIN(search_tsv);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_audio_analysis ON audio_analysis;
CREATE TRIGGER trg_touch_audio_analysis BEFORE UPDATE ON audio_analysis
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_processing_jobs ON processing_jobs;
CREATE TRIGGER trg_touch_processing_jobs BEFORE UPDATE ON processing_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;