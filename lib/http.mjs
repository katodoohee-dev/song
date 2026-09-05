export const ErrorCode = {
  UNAUTHENTICATED: ['UNAUTHENTICATED', 401],
  FORBIDDEN: ['FORBIDDEN', 403],
  NOT_FOUND: ['NOT_FOUND', 404],
  VALIDATION: ['VALIDATION_ERROR', 422],
  CONFLICT: ['CONFLICT', 409],
  RATE_LIMITED: ['RATE_LIMITED', 429],
  PAYLOAD_TOO_LARGE: ['PAYLOAD_TOO_LARGE', 413],
  UNSUPPORTED_MEDIA: ['UNSUPPORTED_MEDIA_TYPE', 415],
  RANGE_NOT_SATISFIABLE: ['RANGE_NOT_SATISFIABLE', 416],
  STORAGE_UNAVAILABLE: ['STORAGE_UNAVAILABLE', 503],
  INTERNAL: ['INTERNAL_ERROR', 500]
};

export class AppError extends Error {
  constructor(codeKey, message, details) {
    const pair = ErrorCode[codeKey] || ErrorCode.INTERNAL;
    super(message || pair[0]);
    this.code = pair[0];
    this.status = pair[1];
    this.details = details;
  }
}

export function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'x-content-type-options': 'nosniff'
  });
  res.end(buf);
}

export function sendError(res, err, requestId) {
  const e = err instanceof AppError ? err : new AppError('INTERNAL');
  if (!(err instanceof AppError)) {
    log('error', { requestId, msg: err && err.message, stack: err && err.stack });
  }
  const body = { error: { code: e.code, message: e.message, requestId } };
  if (e.details) body.error.details = e.details;
  sendJson(res, e.status, body);
}

const REDACT = new Set(['password', 'cookie', 'token', 'secret', 'authorization', 'passwordHash']);
export function log(level, fields) {
  const safe = {};
  for (const k of Object.keys(fields || {})) {
    safe[k] = REDACT.has(k.toLowerCase()) ? '[redacted]' : fields[k];
  }
  process.stdout.write(JSON.stringify({ lvl: level, ts: new Date().toISOString(), ...safe }) + '\n');
}
