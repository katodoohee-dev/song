export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return { invalid: true };
  const a = m[1], b = m[2];
  if (a === '' && b === '') return { invalid: true };
  let start, end;
  if (a === '') {
    const n = Number(b);
    if (!n) return { invalid: true };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

export async function readRange(pool, key, ownerUserId, start, length) {
  const q = await pool.query(
    'SELECT substring(data from $3 for $4) AS chunk, octet_length(data) AS total, mime_type ' +
    'FROM storage_objects WHERE object_key = $1 AND user_id = $2',
    [key, ownerUserId, start + 1, length]
  );
  return q.rows[0] || null;
}

export async function statObject(pool, key, ownerUserId) {
  const q = await pool.query(
    'SELECT octet_length(data) AS total, mime_type FROM storage_objects WHERE object_key=$1 AND user_id=$2',
    [key, ownerUserId]
  );
  return q.rows[0] || null;
}
