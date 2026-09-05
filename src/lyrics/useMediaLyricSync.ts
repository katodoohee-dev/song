import { useEffect, useRef, useState } from 'react';
import { snapshot } from './sync';
import type { LyricLine } from './lrc';
export function useMediaLyricSync(currentTime:number,lines:LyricLine[]){const [active,setActive]=useState(-1);const progressRef=useRef(0);useEffect(()=>{const state=snapshot(lines,currentTime);setActive(state.active);progressRef.current=state.progress;},[currentTime,lines]);return {active,progressRef};}
