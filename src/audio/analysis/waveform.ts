export interface WaveformResult { peaks: number[]; rms: number; peakDbfs: number }

export function computeWaveform(pcm: Float32Array, buckets = 1000): WaveformResult {
  const step = Math.max(1, Math.floor(pcm.length / buckets));
  const peaks: number[] = [];
  let sumSq = 0, gPeak = 0;
  for (let b = 0; b < buckets; b++) {
    const start = b * step;
    const end = Math.min(pcm.length, start + step);
    let mx = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(pcm[i]);
      if (v > mx) mx = v;
      sumSq += pcm[i] * pcm[i];
    }
    peaks.push(Math.round(mx * 10000) / 10000);
    if (mx > gPeak) gPeak = mx;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, pcm.length));
  return { peaks, rms: Math.round(rms * 100000) / 100000, peakDbfs: gPeak > 0 ? Math.round(20 * Math.log10(gPeak) * 100) / 100 : -120 };
}

export function downsample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return pcm;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio), e = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = s; j < e; j++) sum += pcm[j];
    out[i] = sum / Math.max(1, e - s);
  }
  return out;
}
