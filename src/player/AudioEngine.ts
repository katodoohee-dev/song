export type AudioEngineState = 'idle'|'loading'|'playing'|'paused'|'ended'|'error';
export interface AudioEngineSnapshot { state:AudioEngineState; currentTime:number; duration:number; buffered:number; error:string|null; }

type Listener=(s:AudioEngineSnapshot)=>void;

export class AudioEngine {
  private static instance:AudioEngine|null=null; static getInstance(){return this.instance??=new AudioEngine();}
  readonly audio:HTMLAudioElement; private listeners=new Set<Listener>(); private objectUrl:string|null=null; private ctx:AudioContext|null=null; private source:MediaElementAudioSourceNode|null=null; private analyser:AnalyserNode|null=null;
  private snapshot:AudioEngineSnapshot={state:'idle',currentTime:0,duration:0,buffered:0,error:null};
  private constructor(){this.audio=new Audio();this.audio.preload='metadata';this.audio.crossOrigin='use-credentials';this.audio.addEventListener('loadstart',()=>this.update({state:'loading',error:null}));this.audio.addEventListener('loadedmetadata',()=>this.publish());this.audio.addEventListener('timeupdate',()=>this.publish());this.audio.addEventListener('progress',()=>this.publish());this.audio.addEventListener('play',()=>this.update({state:'playing'}));this.audio.addEventListener('pause',()=>this.audio.ended?undefined:this.update({state:'paused'}));this.audio.addEventListener('ended',()=>this.update({state:'ended'}));this.audio.addEventListener('error',()=>this.update({state:'error',error:this.audio.error?.message||'Audio playback failed.'}));}
  subscribe(fn:Listener){this.listeners.add(fn);fn(this.snapshot);return()=>this.listeners.delete(fn)}
  private update(p:Partial<AudioEngineSnapshot>){this.snapshot={...this.snapshot,...p};this.publish()}
  private publish(){let buffered=0;try{const r=this.audio.buffered;if(r.length)buffered=r.end(r.length-1);}catch{}this.snapshot={...this.snapshot,currentTime:Number.isFinite(this.audio.currentTime)?this.audio.currentTime:0,duration:Number.isFinite(this.audio.duration)?this.audio.duration:0,buffered};for(const l of this.listeners)l(this.snapshot);}
  async load(url:string){this.revoke();this.audio.src=url;this.audio.load();await new Promise<void>((resolve,reject)=>{const ok=()=>{cleanup();resolve();};const bad=()=>{cleanup();reject(new Error(this.snapshot.error||'Audio load failed.'));};const cleanup=()=>{this.audio.removeEventListener('loadedmetadata',ok);this.audio.removeEventListener('error',bad);};this.audio.addEventListener('loadedmetadata',ok,{once:true});this.audio.addEventListener('error',bad,{once:true});});}
  async play(){await this.audio.play();}
  pause(){this.audio.pause()}
  async stop(){this.audio.pause();this.audio.currentTime=0;this.update({state:'idle'});}
  seek(seconds:number){if(Number.isFinite(seconds))this.audio.currentTime=Math.max(0,Math.min(seconds,this.audio.duration||seconds));}
  setVolume(v:number){this.audio.volume=Math.max(0,Math.min(1,v))}
  setMuted(m:boolean){this.audio.muted=m}
  getAnalyser(){if(this.analyser)return this.analyser;const C=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!C)return null;this.ctx??=new C();this.source??=this.ctx.createMediaElementSource(this.audio);this.analyser=this.ctx.createAnalyser();this.source.connect(this.analyser);this.analyser.connect(this.ctx.destination);return this.analyser;}
  private revoke(){if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null}}
  dispose(){this.pause();this.revoke();this.audio.removeAttribute('src');this.audio.load();this.source?.disconnect();this.analyser?.disconnect();void this.ctx?.close();this.listeners.clear();AudioEngine.instance=null;}
}
