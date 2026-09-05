export type YouTubeMetadata = {
  videoId: string;
  url: string;
  title: string;
  authorName: string | null;
  authorUrl: string | null;
  artworkUrl: string;
  artworkFallbackUrl: string;
  source: string;
};

export type Song = {
  id: string;
  title: string;
  note?: string | null;
  durationMs?: number | null;
  status: string;
  sourceType: string;
  sourceUrl: string;
  youtubeVideoId?: string | null;
  artworkUrl?: string | null;
  artworkFallbackUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  duplicate?: boolean;
};

const API_URL = (import.meta.env.VITE_AUTH_API_URL || '').replace(/\/$/, '');

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Song request failed (${response.status})`);
  return payload as T;
}

export const youtubeApi = {
  metadata: (url: string) => json<{ metadata: YouTubeMetadata }>('/api/youtube/metadata', { method: 'POST', body: JSON.stringify({ url }) }),
  createSong: (url: string, note?: string) => json<{ song: Song }>('/api/songs/from-youtube', { method: 'POST', body: JSON.stringify({ url, note }) }),
  list: () => json<{ songs: Song[] }>('/api/songs'),
};
