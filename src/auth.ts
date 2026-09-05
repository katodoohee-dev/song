export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
};

const AUTH_API_URL = (import.meta.env.VITE_AUTH_API_URL || '').replace(/\/$/, '');

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${AUTH_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {}),
    },
  });

  let payload: any = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload as T;
}

export const authApi = {
  me: () => request<{ user: AuthUser | null }>('/api/auth/me'),
  register: (email: string, password: string, displayName: string) => request<{ user: AuthUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) }),
  login: (email: string, password: string) => request<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (displayName: string) => request<{ user: AuthUser }>('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ displayName }) }),
};

export { AUTH_API_URL };