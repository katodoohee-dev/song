import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is required for database migration.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

try {
  const schemaSql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schemaSql);
  // storage.sql (storage_objects table) was previously not applied by this
  // script — auth-server.mjs runs both on boot, but a manual
  // `npm run db:migrate` silently skipped storage_objects until now.
  const storageSql = await readFile(new URL('./storage.sql', import.meta.url), 'utf8');
  await pool.query(storageSql);
  console.log('Song Note database schema is ready.');
} finally {
  await pool.end();
}
