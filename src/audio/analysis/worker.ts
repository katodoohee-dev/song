import { analyzeBpm } from './bpm';
import { analyzeKey } from './key';
import { computeWaveform, downsample } from './waveform';

export interface AnalysisPayload {
  peaks: number[];
  bpm: number | null;
  bpmConfidence: number;
  key: string | null;
  keyMode: string | null;
  keyConfidence: number;
  beats: number[];
  loudnessRms: number;
  peakDbfs: number;
  sampleRate: number;
  channels: number;
  duration: number;
}

interface InMsg { pcm: Float32Array; sr: number; channels: number; buckets: number }

self.onmessage = (e: MessageEvent<InMsg>) => {
  const { pcm, sr, channels, buckets } = e.data;
  try {
    (self as unknown as Worker).postMessage({ type: 'progress', value: 10 });
    const wf = computeWaveform(pcm, buckets || 1000);
    (self as unknown as Worker).postMessage({ type: 'progress', value: 35 });
    const ds = downsample(pcm, sr, 11025);
    const bpmRes = analyzeBpm(ds, 11025);
    (self as unknown as Worker).postMessage({ type: 'progress', value: 75 });
    const keyRes = analyzeKey(ds, 11025);
    const payload: AnalysisPayload = {
      peaks: wf.peaks, bpm: bpmRes.bpm || null, bpmConfidence: bpmRes.confidence,
      key: keyRes ? keyRes.key : null, keyMode: keyRes ? keyRes.mode : null,
      keyConfidence: keyRes ? keyRes.confidence : 0, beats: bpmRes.beats,
      loudnessRms: wf.rms, peakDbfs: wf.peakDbfs, sampleRate: sr,
      channels, duration: pcm.length / sr
    };
    (self as unknown as Worker).postMessage({ type: 'done', payload });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String((err as Error)?.message || err) });
  }
};
