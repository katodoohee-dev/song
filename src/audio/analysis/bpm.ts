import { fft, hann } from './fft';

export interface BpmResult { bpm: number; confidence: number; beats: number[] }

function onsetEnvelope(pcm: Float32Array, sr: number, hop = 512, win = 1024) {
  const frames = Math.floor((pcm.length - win) / hop);
  if (frames <= 0) return { env: new Float32Array(0), fps: sr / hop };
  const env = new Float32Array(frames);
  const w = hann(win);
  let prev = new Float32Array(win / 2);
  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(win);
    const im = new Float32Array(win);
    for (let i = 0; i < win; i++) re[i] = pcm[f * hop + i] * w[i];
    fft(re, im);
    const mag = new Float32Array(win / 2);
    let flux = 0;
    for (let k = 0; k < win / 2; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      const d = mag[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = mag;
  }
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length || 1;
  for (let i = 0; i < env.length; i++) env[i] = Math.max(0, env[i] - mean);
  return { env, fps: sr / hop };
}

export function analyzeBpm(pcm: Float32Array, sr: number): BpmResult {
  const { env, fps } = onsetEnvelope(pcm, sr);
  if (env.length < fps * 4) return { bpm: 0, confidence: 0, beats: [] };

  const minLag = Math.floor(fps * 60 / 200);
  const maxLag = Math.ceil(fps * 60 / 60);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, n = 0;
    for (let i = 0; i + lag < env.length; i++) { s += env[i] * env[i + lag]; n++; }
    scores.push(n ? s / n : 0);
  }
  for (let i = 0; i < scores.length; i++) {
    const lag = i + minLag;
    const h = lag * 2 - minLag;
    if (h >= 0 && h < scores.length) scores[i] += 0.5 * scores[h];
  }

  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

  const sorted = scores.slice().sort((a, b) => b - a);
  const peak = sorted[0];
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  const confidence = Math.max(0, Math.min(1, (peak / median - 1) / 4));

  const y0 = best > 0 ? scores[best - 1] : scores[best];
  const y1 = scores[best];
  const y2 = best + 1 < scores.length ? scores[best + 1] : scores[best];
  const denom = y0 - 2 * y1 + y2;
  const delta = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
  const lagF = best + minLag + delta;
  const bpm = Math.round((60 * fps / lagF) * 10) / 10;

  let bestPhase = 0, bestScore = -1;
  for (let p = 0; p < Math.ceil(lagF); p++) {
    let s = 0;
    for (let t = p; t < env.length; t += lagF) s += env[Math.round(t)] || 0;
    if (s > bestScore) { bestScore = s; bestPhase = p; }
  }
  const beats: number[] = [];
  for (let t = bestPhase; t < env.length; t += lagF) {
    beats.push(Math.round((t / fps) * 1000) / 1000);
  }
  return { bpm, confidence: Math.round(confidence * 1000) / 1000, beats };
}
