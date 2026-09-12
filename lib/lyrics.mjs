// Best-effort lyrics lookup against lrclib.net — a free, open database of
// crowd-sourced lyric timing data (not a licensed lyrics distributor). We
// only use its /api/search endpoint, which is meant for exactly this kind
// of "find timing data for a track I already have" lookup.
//
// This is intentionally conservative:
//  - It's best-effort. A miss (no match, network error, timeout) never
//    blocks or fails song creation — the song is saved either way.
//  - We only take a result if the title match is a reasonably close,
//    case-insensitive match, to avoid attaching the wrong song's lyrics.
//  - We do not scrape or otherwise pull lyrics from sites that prohibit it
//    (Genius, AZLyrics, etc.) — that's out of scope, see prior conversation.

const SEARCH_ENDPOINT = 'https://lrclib.net/api/search';
const USER_AGENT = 'song-note/1.0 (+https://github.com/katodoohee-dev/song)';

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ') // drop "(Official Video)", "[Lyrics]", etc.
  .replace(/[^a-z0-9\u0E00-\u0E7F\s]/g, ' ') // keep Thai + latin + digits
  .replace(/\s+/g, ' ')
  .trim();

const isCloseMatch = (queryTitle, candidateTitle) => {
  const a = normalize(queryTitle);
  const b = normalize(candidateTitle);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

// title: the song's display title (required).
// artistHint: optional — a YouTube channel/author name, which is often but
// not always the real recording artist, so we use it to narrow the search
// rather than as a hard filter.
export async function fetchLyrics(title, artistHint) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const params = new URLSearchParams({ track_name: cleanTitle });
    if (artistHint) params.set('artist_name', String(artistHint).trim());
    const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    // Prefer a close title match; fall back to the top result if artistHint
    // was supplied (search already ranked by relevance to it).
    const match = results.find(r => isCloseMatch(cleanTitle, r.trackName)) || (artistHint ? results[0] : null);
    if (!match) return null;

    return {
      syncedLyrics: match.syncedLyrics || null,
      plainLyrics: match.plainLyrics || null,
      instrumental: Boolean(match.instrumental),
      source: 'lrclib.net',
    };
  } catch {
    // Network error, timeout, or bad JSON — treat exactly like "no match".
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
