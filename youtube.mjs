const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const extractYouTubeVideoId = input => {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  let id = null;
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'www.youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || null;
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2] || null;

  return id && VIDEO_ID_RE.test(id) ? id : null;
};

export const getYouTubeMetadata = async input => {
  const videoId = extractYouTubeVideoId(input);
  if (!videoId) throw Object.assign(new Error('Please provide a valid YouTube URL.'), { status: 400 });

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error('YouTube video metadata could not be loaded.'), { status: 422 });
    const data = await response.json();
    const title = String(data.title || '').trim();
    if (!title) throw Object.assign(new Error('YouTube video has no usable title.'), { status: 422 });
    return {
      videoId,
      url: canonicalUrl,
      title,
      authorName: String(data.author_name || '').trim() || null,
      authorUrl: String(data.author_url || '').trim() || null,
      artworkUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      artworkFallbackUrl: String(data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
      source: 'youtube-oembed',
    };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('YouTube metadata request timed out.'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
