import { useCallback, useEffect, useRef, useState } from 'react';

export interface MicFrame { note: string | null; frequency: number | null; confidence: number; rms: number; peak: number; voiced: boolean }

export function useMicrophone(onFrame?: (frame: MicFrame) => void) {
  const [status,setStatus]=useState<'idle'|'active'|'error'>('idle'); const worker=useRef<AudioWorkletNode|null>(null); const ctx=useRef<AudioContext|null>(null); const stream=useRef<MediaStream|null>(null);
  const stop=useCallback(()=>{worker.current?.disconnect();worker.current=null;ctx.current?.close().catch(()=>undefined);ctx.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setStatus('idle');},[]);
  const start=useCallback(async()=>{stop();try{const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});stream.current=s;const C=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!C)throw new Error('Web Audio API is not supported.');const c=new C();ctx.current=c;await c.audioWorklet.addModule('/worklets/pitch-processor.js');const src=c.createMediaStreamSource(s);const node=new AudioWorkletNode(c,'pitch-processor');node.port.onmessage=e=>onFrame?.(e.data as MicFrame);src.connect(node);const mute=c.createGain();mute.gain.value=0;node.connect(mute).connect(c.destination);worker.current=node;setStatus('active');}catch(e){stop();setStatus('error');throw e;}},[onFrame,stop]);
  useEffect(()=>stop, [stop]); return {status,start,stop};
}
