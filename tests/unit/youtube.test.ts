import { describe, it, expect } from 'vitest';
import { extractYouTubeVideoId } from '../../youtube.mjs';

describe('extractYouTubeVideoId', () => {
  it('extracts id from a standard watch URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts id from youtu.be short URL', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts id from /shorts/ URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('extracts id from /embed/ URL', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('rejects a non-YouTube host even if it has a v= param', () => {
    expect(extractYouTubeVideoId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
  it('rejects a malformed URL string', () => {
    expect(extractYouTubeVideoId('not a url at all')).toBeNull();
  });
  it('rejects a watch URL with an id of the wrong length', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
  });
  it('rejects a non-http(s) protocol', () => {
    expect(extractYouTubeVideoId('javascript:alert(1)//dQw4w9WgXcQ')).toBeNull();
  });
  it('accepts youtube-nocookie.com embed host', () => {
    expect(extractYouTubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
});