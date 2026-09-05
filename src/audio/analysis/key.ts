import { fft, hann } from './fft';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyResult { key: string; mode: 'major' | 'minor'; confidence: number }

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function analyzeKey(pcm: Float32Array, sr: number): KeyResult | null {
  const win = 4096, hop = 2048;
  const frames = Math.floor((pcm.length - win) / hop);
  if (frames < 8) return null;
  const chroma = new Float64Array(12);
  const w = hann(win);

  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(win);
    const im = new Float32Array(win);
    for (let i = 0; i < win; i++) re[i] = pcm[f * hop + i] * w[i];
    fft(re, im);
    for (let k = 1; k < win / 2; k++) {
      const freq = k * sr / win;
      if (freq < 65 || freq > 2100) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.hypot(re[k], im[k]);
    }
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum <= 0) return null;
  for (let i = 0; i < 12; i++) chroma[i] /= sum;

  const results: Array<{ key: string; mode: 'major' | 'minor'; r: number }> = [];
  for (let rot = 0; rot < 12; rot++) {
    const rotated: number[] = [];
    for (let i = 0; i < 12; i++) rotated.push(chroma[(i + rot) % 12]);
    results.push({ key: NOTES[rot], mode: 'major', r: pearson(rotated, MAJOR) });
    results.push({ key: NOTES[rot], mode: 'minor', r: pearson(rotated, MINOR) });
  }
  results.sort((a, b) => b.r - a.r);
  const b1 = results[0], b2 = results[1];
  const confidence = Math.max(0, Math.min(1, b1.r * (1 + (b1.r - b2.r) * 3)));
  return { key: b1.key, mode: b1.mode, confidence: Math.round(confidence * 1000) / 1000 };
}
