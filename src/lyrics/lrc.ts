export interface LyricLine { index: number; text: string; startTime: number; endTime: number | null }
export interface LrcParseResult { lines: LyricLine[]; meta: Record<string, string>; warnings: string[] }
const TS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[(ti|ar|al|by|offset|length):(.*)\]$/i;
export function parseLrc(src: string): LrcParseResult {
  const meta: Record<string,string> = {}; const warnings:string[]=[]; const raw:Array<{t:number;text:string}>=[]; const rows=src.split(/\r?\n/);
  for(let n=0;n<rows.length;n++){const line=rows[n].trim();if(!line)continue;const m=META.exec(line);if(m){meta[m[1].toLowerCase()]=m[2].trim();continue;} TS.lastIndex=0;const stamps:number[]=[];let last=0;let mm:RegExpExecArray|null;while((mm=TS.exec(line))!==null){const min=Number(mm[1]),sec=Number(mm[2]),frac=mm[3]?Number('0.'+mm[3]):0;if(sec>=60){warnings.push('line '+(n+1)+': seconds '+sec+' >= 60');continue;}stamps.push(min*60+sec+frac);last=mm.index+mm[0].length;}if(!stamps.length){warnings.push('line '+(n+1)+': no timestamp');continue;}const text=line.slice(last).trim();for(const t of stamps)raw.push({t,text});}
  const offset=meta.offset?Number(meta.offset)/1000:0; raw.sort((a,b)=>a.t-b.t); const seen=new Set<number>(); const lines:LyricLine[]=[];
  for(const r of raw){const t=Math.max(0,Math.round((r.t+offset)*1000)/1000);if(seen.has(t)){warnings.push('duplicate timestamp '+t);continue;}seen.add(t);lines.push({index:lines.length,text:r.text,startTime:t,endTime:null});}
  for(let i=0;i<lines.length-1;i++)lines[i].endTime=lines[i+1].startTime; return {lines,meta,warnings};
}
export function toLrc(lines:LyricLine[],meta:Record<string,string>={}):string{const head=Object.keys(meta).map(k=>'['+k+':'+meta[k]+']').join('\n');const pad=(n:number)=>String(n).padStart(2,'0');const body=lines.slice().sort((a,b)=>a.startTime-b.startTime).map(l=>{const m=Math.floor(l.startTime/60),s=Math.floor(l.startTime%60),cs=Math.round((l.startTime%1)*100);return '['+pad(m)+':'+pad(s)+'.'+pad(cs)+']'+l.text;}).join('\n');return head?head+'\n'+body:body;}
