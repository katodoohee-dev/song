import { useEffect, useRef, useState } from 'react';
import { snapshot } from './sync';
import type { LyricLine } from './lrc';
export function useLyricSync(audio: HTMLAudioElement | null, lines: LyricLine[]) {
  const [active, setActive] = useState(-1); const progressRef = useRef(0); const rafRef = useRef(0);
  useEffect(() => { if (!audio || lines.length === 0) return; let lastActive = -1; const tick=()=>{const s=snapshot(lines,audio.currentTime);progressRef.current=s.progress;if(s.active!==lastActive){lastActive=s.active;setActive(s.active);}rafRef.current=requestAnimationFrame(tick);}; rafRef.current=requestAnimationFrame(tick); return ()=>cancelAnimationFrame(rafRef.current); }, [audio,lines]);
  return {active,progressRef};
}
