import { randomUUID } from 'node:crypto';
const WORKER_ID = process.pid + '-' + randomUUID().slice(0, 8);

export async function enqueue(pool, opts) {
  const r = await pool.query(
    'INSERT INTO processing_jobs(user_id, song_id, job_type, payload) VALUES ($1,$2,$3,$4) ' +
    'ON CONFLICT DO NOTHING RETURNING id',
    [opts.userId, opts.songId, opts.jobType, opts.payload || {}]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

export async function claimNext(pool) {
  const r = await pool.query(
    'UPDATE processing_jobs SET status=$2::job_status, attempts=attempts+1, locked_at=now(), locked_by=$1 ' +
    'WHERE id = (SELECT id FROM processing_jobs WHERE status=$3::job_status AND run_after <= now() ' +
    'ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *'.replace('RETURNING *','RETURNING *'),
    [WORKER_ID, 'processing', 'queued']
  );
  return r.rows[0] || null;
}

export async function setProgress(pool, id, progress) {
  await pool.query('UPDATE processing_jobs SET progress=$2 WHERE id=$1', [id, progress]);
}

export async function completeJob(pool, id) {
  await pool.query(
    "UPDATE processing_jobs SET status='completed', progress=100, locked_at=NULL WHERE id=$1",
    [id]
  );
}

export async function failJob(pool, job, err) {
  const retry = job.attempts < job.max_attempts;
  const backoff = retry ? Math.min(300, Math.pow(2, job.attempts) * 5) : 0;
  await pool.query(
    'UPDATE processing_jobs SET status=$2::job_status, error_code=$3, error_message=$4, ' +
    "locked_at=NULL, run_after = now() + ($5 || ' seconds')::interval WHERE id=$1",
    [job.id, retry ? 'queued' : 'failed', (err && err.code) || 'INTERNAL_ERROR',
     String((err && err.message) || err).slice(0, 500), String(backoff)]
  );
}

export async function reclaimStale(pool, staleMinutes) {
  await pool.query(
    "UPDATE processing_jobs SET status='queued', locked_at=NULL, locked_by=NULL " +
    "WHERE status='processing' AND locked_at < now() - ($1 || ' minutes')::interval",
    [String(staleMinutes || 10)]
  );
}
