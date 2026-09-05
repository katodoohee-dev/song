const at = (b, off, s) => {
  for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
  return true;
};

const SIGS = [
  { ext: 'mp3', mime: 'audio/mpeg', test: b => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) },
  { ext: 'wav', mime: 'audio/wav', test: b => at(b, 0, 'RIFF') && at(b, 8, 'WAVE') },
  { ext: 'flac', mime: 'audio/flac', test: b => at(b, 0, 'fLaC') },
  { ext: 'ogg', mime: 'audio/ogg', test: b => at(b, 0, 'OggS') },
  { ext: 'm4a', mime: 'audio/mp4', test: b => at(b, 4, 'ftyp') },
  { ext: 'aac', mime: 'audio/aac', test: b => b[0] === 0xFF && (b[1] & 0xF6) === 0xF0 }
];

export function sniffAudio(head) {
  for (const s of SIGS) {
    try { if (s.test(head)) return { ext: s.ext, mime: s.mime }; } catch (e) { void e; }
  }
  return null;
}

export function safeFilename(name) {
  const cleaned = String(name)
    .normalize('NFKC')
    .split('/').join('_')
    .split('\\').join('_')
    .split('..').join('_')
    .replace(/[\x00-\x1f<>:"|?]/g, '')
    .slice(0, 180);
  return cleaned || 'audio';
}

export function isAllowedExt(ext, allowList) {
  return allowList.split(',').map(s => s.trim().toLowerCase()).includes(String(ext).toLowerCase());
}

export function extractYouTubeId(input) {
  const s = String(input || '').trim();
  const direct = /^[A-Za-z0-9_-]{11}$/;
  if (direct.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1);
      return direct.test(id) ? id : null;
    }
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && direct.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && direct.test(last)) return last;
    }
  } catch (e) { void e; }
  return null;
}
