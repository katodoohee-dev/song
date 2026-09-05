BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','CREATOR','MODERATOR','ADMIN','SUPER_ADMIN')),
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  locale TEXT NOT NULL DEFAULT 'th-TH',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artists (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS albums (
  id UUID PRIMARY KEY,
  artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  artwork_url TEXT,
  release_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS songs (
  id UUID PRIMARY KEY,
  artist_id UUID REFERENCES artists(id) ON DELETE SET NULL,
  album_id UUID REFERENCES albums(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  note TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','ready','failed','hidden')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS artwork_url TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_metadata JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS songs_created_by_youtube_video_idx
  ON songs(created_by, youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tracks (
  id UUID PRIMARY KEY,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  track_number INTEGER NOT NULL DEFAULT 1 CHECK (track_number > 0),
  title TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  source_url TEXT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(song_id, track_number)
);

CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  artwork_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, song_id),
  UNIQUE (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS lyrics (
  id UUID PRIMARY KEY,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL DEFAULT 'und',
  source TEXT NOT NULL DEFAULT 'manual',
  plain_text TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lyric_lines (
  id UUID PRIMARY KEY,
  lyrics_id UUID NOT NULL REFERENCES lyrics(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  text TEXT NOT NULL,
  start_ms INTEGER CHECK (start_ms IS NULL OR start_ms >= 0),
  end_ms INTEGER CHECK (end_ms IS NULL OR end_ms >= 0),
  UNIQUE(lyrics_id, line_index)
);

CREATE TABLE IF NOT EXISTS audio_files (
  id UUID PRIMARY KEY,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('original','instrumental','vocal','drums','bass','piano','guitar','other','recording')),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','ready','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waveforms (
  id UUID PRIMARY KEY,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  audio_file_id UUID REFERENCES audio_files(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  sample_rate INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, song_id)
);

CREATE TABLE IF NOT EXISTS history (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  position_ms INTEGER NOT NULL DEFAULT 0 CHECK (position_ms >= 0)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, artist_id)
);

CREATE TABLE IF NOT EXISTS karaoke_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  score NUMERIC(6,2) CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

CREATE TABLE IF NOT EXISTS karaoke_scores (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES karaoke_sessions(id) ON DELETE CASCADE,
  pitch_score NUMERIC(6,2),
  timing_score NUMERIC(6,2),
  lyric_score NUMERIC(6,2),
  total_score NUMERIC(6,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS singing_results (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES karaoke_sessions(id) ON DELETE CASCADE,
  recording_file_id UUID REFERENCES audio_files(id) ON DELETE SET NULL,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS songs_artist_id_idx ON songs(artist_id);
CREATE INDEX IF NOT EXISTS songs_album_id_idx ON songs(album_id);
CREATE INDEX IF NOT EXISTS songs_status_idx ON songs(status);
CREATE INDEX IF NOT EXISTS playlists_user_id_idx ON playlists(user_id);
CREATE INDEX IF NOT EXISTS history_user_played_at_idx ON history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS likes_song_id_idx ON likes(song_id);
CREATE INDEX IF NOT EXISTS lyrics_song_current_idx ON lyrics(song_id, is_current);
CREATE INDEX IF NOT EXISTS audio_files_song_kind_idx ON audio_files(song_id, kind);

INSERT INTO profiles(user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
