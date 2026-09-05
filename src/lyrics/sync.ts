import type { LyricLine } from './lrc';
export function findActiveIndex(lines: LyricLine[], t: number): number { let lo=0,hi=lines.length-1,res=-1; while(lo<=hi){const mid=(lo+hi)>>1;if(lines[mid].startTime<=t){res=mid;lo=mid+1;}else hi=mid-1;} return res; }
export interface SyncSnapshot { active:number; prev:number; next:number; progress:number }
export function snapshot(lines: LyricLine[], t:number): SyncSnapshot { const active=findActiveIndex(lines,t); const cur=active>=0?lines[active]:null; let progress=0; if(cur){const end=cur.endTime!==null?cur.endTime:cur.startTime+4;const span=Math.max(.001,end-cur.startTime);progress=Math.max(0,Math.min(1,(t-cur.startTime)/span));} return {active,prev:active-1,next:active+1,progress}; }
