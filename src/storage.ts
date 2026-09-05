export type StorageObject = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  driver?: string;
  createdAt?: string;
  url: string;
};

const API_URL = (import.meta.env.VITE_AUTH_API_URL || '').replace(/\/$/, '');

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.body instanceof FormData ? (init.headers || {}) : { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let payload: any = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error || `Storage request failed (${response.status})`);
  return payload as T;
}

export async function uploadFile(file: File, kind = file.type.startsWith('audio/') ? 'original' : 'artwork') {
  if (file.size > 50 * 1024 * 1024) throw new Error('File is too large. Maximum size is 50 MB.');
  const response = await fetch(`${API_URL}/api/storage/upload?filename=${encodeURIComponent(file.name)}&kind=${encodeURIComponent(kind)}`, {
    method: 'POST',
    body: file,
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  const payload: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Upload failed (${response.status})`);
  return payload.object as StorageObject;
}

export const storageApi = {
  list: () => json<{ objects: StorageObject[] }>('/api/storage'),
  remove: (id: string) => json<{ ok: true }>(`/api/storage/object/${id}`, { method: 'DELETE' }),
};
