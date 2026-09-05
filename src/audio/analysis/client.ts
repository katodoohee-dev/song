import { AUTH_API_URL } from '../../lib/env';

export type AnalysisPayload = {
  peaks: number[]; bpm: number | null; bpmConfidence: number; key: string | null; keyMode: string | null; keyConfidence: number; beats: number[]; loudnessRms: number; peakDbfs: number; sampleRate: number; channels: number; duration: number;
};

function makeWorker(): Worker { return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); }

async function decodeAudio(buffer: ArrayBuffer): Promise<AudioBuffer> {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio API is not supported in this browser.');
  const ctx = new AudioContextCtor();
  try { return await ctx.decodeAudioData(buffer.slice(0)); } finally { void ctx.close(); }
}

export async function analyzeAudioUrl(url: string, onProgress?: (value: number) => void): Promise<AnalysisPayload> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not read audio (${response.status}).`);
  const buffer = await response.arrayBuffer(); onProgress?.(5);
  const decoded = await decodeAudio(buffer); onProgress?.(20);
  const worker = makeWorker();
  return await new Promise<AnalysisPayload>((resolve, reject) => {
    const channel = decoded.getChannelData(0); const pcm = new Float32Array(channel);
    worker.onmessage = event => {
      if (event.data?.type === 'progress') onProgress?.(20 + Math.round(event.data.value * 0.8));
      else if (event.data?.type === 'done') { worker.terminate(); resolve(event.data.payload as AnalysisPayload); }
      else if (event.data?.type === 'error') { worker.terminate(); reject(new Error(event.data.message || 'Audio analysis failed.')); }
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Audio analysis worker failed.')); };
    worker.postMessage({ pcm, sr: decoded.sampleRate, channels: decoded.numberOfChannels, buckets: 1200 }, [pcm.buffer]);
  });
}

export async function persistAnalysis(songId: string, analysis: AnalysisPayload): Promise<void> {
  const response = await fetch(`${AUTH_API_URL}/api/songs/${songId}/analysis`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analysis) });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message || body?.error || `Analysis save failed (${response.status}).`); }
}

export async function analyzeAndPersist(songId: string, url: string, onProgress?: (value: number) => void): Promise<AnalysisPayload> {
  const analysis = await analyzeAudioUrl(url, onProgress); await persistAnalysis(songId, analysis); return analysis;
}
