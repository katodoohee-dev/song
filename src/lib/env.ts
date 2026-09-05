// Single source of truth for the auth/API base URL. Previously this was
// copy-pasted independently in auth.ts, songs.ts, and storage.ts — harmless
// today since they all read the same env var, but a classic source of drift
// if one copy is ever edited without the others.
export const AUTH_API_URL = (import.meta.env.VITE_AUTH_API_URL || '').replace(/\/$/, '');
