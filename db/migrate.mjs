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
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Song Note database schema is ready.');
} finally {
  await pool.end();
}
