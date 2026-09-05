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
const LOCAL_SONGS_KEY = 'song_note_youtube_songs_v1';

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || `Song request failed (${response.status})`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return payload as T;
}

function readLocalSongs(): Song[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_SONGS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSongs(songs: Song[]) {
  try {
    localStorage.setItem(LOCAL_SONGS_KEY, JSON.stringify(songs.slice(0, 200)));
  } catch {
    // Keep the live flow usable even when browser storage is unavailable.
  }
}

async function createLocalSong(url: string, note?: string): Promise<{ song: Song }> {
  const { metadata } = await youtubeApi.metadata(url);
  const songs = readLocalSongs();
  const duplicate = songs.find(song => song.youtubeVideoId === metadata.videoId);
  if (duplicate) return { song: { ...duplicate, duplicate: true } };

  const now = new Date().toISOString();
  const song: Song = {
    id: `local-${metadata.videoId}`,
    title: metadata.title,
    note: note || null,
    durationMs: null,
    status: 'ready',
    sourceType: 'youtube',
    sourceUrl: metadata.url,
    youtubeVideoId: metadata.videoId,
    artworkUrl: metadata.artworkUrl,
    artworkFallbackUrl: metadata.artworkFallbackUrl,
    createdAt: now,
    updatedAt: now,
    duplicate: false,
  };
  writeLocalSongs([song, ...songs]);
  return { song };
}

export const youtubeApi = {
  metadata: (url: string) => json<{ metadata: YouTubeMetadata }>('/api/youtube/metadata', { method: 'POST', body: JSON.stringify({ url }) }),
  createSong: async (url: string, note?: string) => {
    try {
      return await json<{ song: Song }>('/api/songs/from-youtube', { method: 'POST', body: JSON.stringify({ url, note }) });
    } catch (error) {
      if (error instanceof Error && (error as Error & { status?: number }).status === 503) return createLocalSong(url, note);
      throw error;
    }
  },
  list: async () => {
    try {
      return await json<{ songs: Song[] }>('/api/songs');
    } catch (error) {
      if (error instanceof Error && (error as Error & { status?: number }).status === 503) return { songs: readLocalSongs() };
      throw error;
    }
  },
};
