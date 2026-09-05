import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(JSON.stringify({ ok: false, error: 'DATABASE_URL is not configured' }));
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 1,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

const requiredTables = [
  'users', 'profiles', 'sessions', 'artists', 'albums', 'songs', 'tracks',
  'playlists', 'playlist_tracks', 'lyrics', 'lyric_lines', 'audio_files',
  'waveforms', 'likes', 'history', 'follows', 'karaoke_sessions',
  'karaoke_scores', 'singing_results', 'storage_objects',
];

try {
  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [requiredTables]);

  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !present.has(name));

  if (missing.length) {
    console.error(JSON.stringify({ ok: false, missingTables: missing }));
    process.exitCode = 1;
  } else {
    await pool.query('SELECT 1');
    console.log(JSON.stringify({ ok: true, tables: requiredTables.length }));
  }
} finally {
  await pool.end();
}
