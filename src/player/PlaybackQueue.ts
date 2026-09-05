export interface QueueItem { songId: string | number; title: string; artist: string | null; sourceType: 'upload' | 'youtube'; }
export type RepeatMode = 'off' | 'one' | 'all';
export class PlaybackQueue {
  private items: QueueItem[]=[]; private order:number[]=[]; private pos=-1; shuffle=false; repeat:RepeatMode='off';
  set(items:QueueItem[],startIndex=0){this.items=items.slice();this.rebuild();this.pos=this.order.indexOf(startIndex);if(this.pos<0)this.pos=0;}
  private rebuild(){this.order=this.items.map((_,i)=>i);if(this.shuffle){for(let i=this.order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=this.order[i];this.order[i]=this.order[j];this.order[j]=t;}}}
  setShuffle(on:boolean){const cur=this.current();this.shuffle=on;this.rebuild();if(cur)this.pos=Math.max(0,this.order.indexOf(this.items.indexOf(cur)));}
  current():QueueItem|null{if(this.pos<0||this.pos>=this.order.length)return null;return this.items[this.order[this.pos]]||null;}
  hasNext(){return this.repeat!=='off'||this.pos<this.order.length-1;}
  next():QueueItem|null{if(!this.items.length)return null;if(this.repeat==='one')return this.current();if(this.pos>=this.order.length-1){if(this.repeat!=='all')return null;this.pos=0;}else this.pos++;return this.current();}
  prev():QueueItem|null{if(!this.items.length)return null;if(this.pos<=0){if(this.repeat!=='all')return this.current();this.pos=this.order.length-1;}else this.pos--;return this.current();}
  add(i:QueueItem){this.items.push(i);this.rebuild();}
  playNext(i:QueueItem){const at=this.pos>=0?this.order[this.pos]+1:0;this.items.splice(at,0,i);this.rebuild();}
  remove(idx:number){this.items.splice(idx,1);this.rebuild();if(this.pos>=this.order.length)this.pos=this.order.length-1;}
  clear(){this.items=[];this.order=[];this.pos=-1;} list(){return this.items.slice();}
}
