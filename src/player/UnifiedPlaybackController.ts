import { AudioEngine, type AudioEngineSnapshot } from './AudioEngine';
export type Source = { type:'upload';url:string } | { type:'youtube';videoId:string };
export interface UnifiedPlaybackEvent extends AudioEngineSnapshot { sourceType:'upload'|'youtube'|null; ended:boolean; }

type Listener=(e:UnifiedPlaybackEvent)=>void;
let ytPromise:Promise<any>|null=null;
function loadYouTube(){if((window as any).YT?.Player)return Promise.resolve((window as any).YT);if(ytPromise)return ytPromise;ytPromise=new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';window.onYouTubeIframeAPIReady=()=>resolve((window as any).YT);tag.onerror=()=>reject(new Error('YouTube API failed to load.'));document.head.appendChild(tag);});return ytPromise;}

export class UnifiedPlaybackController{
 private audio=AudioEngine.getInstance(); private listeners=new Set<Listener>(); private event:UnifiedPlaybackEvent={state:'idle',currentTime:0,duration:0,buffered:0,error:null,sourceType:null,ended:false}; private youtube:any=null; private youtubeTimer:number|null=null;
 constructor(){this.audio.subscribe(s=>{if(this.event.sourceType==='upload'){this.event={...s,sourceType:'upload',ended:s.state==='ended'};this.publish();}})}
 subscribe(fn:Listener){this.listeners.add(fn);fn(this.event);return()=>this.listeners.delete(fn)}
 private publish(){for(const l of this.listeners)l(this.event)}
 async load(source:Source){this.stopYouTubePoll();this.event={...this.event,state:'loading',currentTime:0,duration:0,buffered:0,error:null,sourceType:source.type,ended:false};this.publish();if(source.type==='upload'){if(this.youtube){try{this.youtube.stopVideo();}catch{} }await this.audio.load(source.url);this.event={...this.event,...this.snapshotFromAudio(),sourceType:'upload'};this.publish();return;}await this.loadYT(source.videoId)}
 private snapshotFromAudio(){const a=this.audio.audio;return {state:a.paused?'paused':'playing',currentTime:a.currentTime,duration:Number.isFinite(a.duration)?a.duration:0,buffered:a.buffered.length?a.buffered.end(a.buffered.length-1):0,error:null,ended:a.ended};}
 private async loadYT(id:string){const YT=await loadYouTube();let host=document.getElementById('song-note-youtube-player');if(!host){host=document.createElement('div');host.id='song-note-youtube-player';host.style.cssText='position:fixed;width:1px;height:1px;left:-100px;top:-100px;opacity:0;pointer-events:none';document.body.appendChild(host);}if(this.youtube){try{this.youtube.destroy();}catch{}this.youtube=null;}await new Promise<void>(resolve=>{this.youtube=new YT.Player(host!,{width:'1',height:'1',videoId:id,playerVars:{playsinline:1,controls:0},events:{onReady:()=>{resolve();this.startYouTubePoll();},onStateChange:(e:any)=>{if(e.data===0){this.event={...this.event,state:'ended',ended:true};this.publish();}else if(e.data===1){this.event={...this.event,state:'playing',ended:false};this.publish();}else if(e.data===2){this.event={...this.event,state:'paused'};this.publish();}},onError:(e:any)=>{this.event={...this.event,state:'error',error:'YouTube playback error: '+e.data};this.publish();}}});});}
 private startYouTubePoll(){this.stopYouTubePoll();const tick=()=>{if(!this.youtube)return;let t=0,d=0;try{t=this.youtube.getCurrentTime()||0;d=this.youtube.getDuration()||0;}catch{}this.event={...this.event,currentTime:t,duration:d,sourceType:'youtube',ended:false};this.publish();this.youtubeTimer=window.setTimeout(tick,200);};tick();}
 private stopYouTubePoll(){if(this.youtubeTimer!==null){window.clearTimeout(this.youtubeTimer);this.youtubeTimer=null;}}
 async play(){if(this.event.sourceType==='youtube'){this.youtube?.playVideo();return;}await this.audio.play();}
 pause(){if(this.event.sourceType==='youtube')this.youtube?.pauseVideo();else this.audio.pause()}
 async toggle(){if(this.event.state==='playing')this.pause();else await this.play()}
 async stop(){this.stopYouTubePoll();if(this.event.sourceType==='youtube')this.youtube?.stopVideo();else await this.audio.stop();this.event={...this.event,state:'idle',currentTime:0,ended:false};this.publish();}
 seek(t:number){if(this.event.sourceType==='youtube')this.youtube?.seekTo(t,true);else this.audio.seek(t)}
 setVolume(v:number){this.audio.setVolume(v);if(this.youtube)this.youtube.setVolume(Math.round(v*100))}
 setMuted(m:boolean){this.audio.setMuted(m);if(this.youtube){if(m)this.youtube.mute();else this.youtube.unMute()}}
 get sourceType(){return this.event.sourceType}
}
export const playbackController=new UnifiedPlaybackController();
