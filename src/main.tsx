import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Home, Search, Library, Mic2, Play, Pause, Heart, ChevronRight, Sparkles, MoreHorizontal, X, Plus, Volume2, Shuffle, SkipBack, SkipForward, Repeat2, Upload, Link2, Music2, CheckCircle2 } from "lucide-react";
import { AuthPanel } from "./auth-panel";
import { uploadFile, type StorageObject } from "./storage";
import "./styles.css";

type Song={title:string;artist:string;note:string;image:string};
const songs:Song[]=[
 {title:"Moonlit Echoes",artist:"Luna Vale",note:"Aurora Sessions",image:"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1200&q=85"},
 {title:"Velvet Hours",artist:"Mira Sol",note:"Midnight Bloom",image:"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=85"},
 {title:"Northern Lines",artist:"Aster",note:"Quiet Horizons",image:"https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=85"},
 {title:"After the Rain",artist:"Noon & Night",note:"City Weather",image:"https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=85"},
 {title:"Slow Bloom",artist:"Nara",note:"New this week",image:"https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1200&q=85"}
];
const nav=[['home','Home',Home],['search','Search',Search],['library','Library',Library],['karaoke','Karaoke',Mic2]] as const;

function App(){
 const [view,setView]=useState<'home'|'search'|'library'|'karaoke'>('home');
 const [song,setSong]=useState(songs[0]); const [playing,setPlaying]=useState(false); const [lyrics,setLyrics]=useState(false); const [query,setQuery]=useState(''); const [add,setAdd]=useState(false);
 const filtered=useMemo(()=>songs.filter(s=>(s.title+' '+s.artist).toLowerCase().includes(query.toLowerCase())),[query]);
 const play=(s:Song)=>{setSong(s);setPlaying(true)};
 return <div className="app">
  {view!=='karaoke'&&<aside className="sidebar"><div className="brand"><span className="brandMark"><Music2 size={17}/></span><b>Song Note</b></div><nav>{nav.map(([id,label,Icon])=><button key={id} className={view===id?'nav active':'nav'} onClick={()=>setView(id)}><Icon size={18}/>{label}</button>)}</nav><AuthPanel/></aside>}
  {view!=='karaoke'&&<header className="mobileHeader"><div className="brand"><span className="brandMark"><Music2 size={17}/></span><b>Song Note</b></div><AuthPanel/></header>}
  <main className={view==='karaoke'?'main karaoke':'main'}>
   {view==='home'&&<HomeView onPlay={play}/>} 
   {view==='search'&&<SearchView query={query} setQuery={setQuery} songs={filtered} onPlay={play}/>} 
   {view==='library'&&<LibraryView songs={songs} onPlay={play} onAdd={()=>setAdd(true)}/>} 
   {view==='karaoke'&&<Karaoke song={song} onEnd={()=>setView('home')}/>} 
  </main>
  {view!=='karaoke'&&<Player song={song} playing={playing} onToggle={()=>setPlaying(v=>!v)} onLyrics={()=>setLyrics(true)} onKaraoke={()=>setView('karaoke')}/>} 
  {view!=='karaoke'&&<nav className="mobileNav">{nav.map(([id,label,Icon])=><button key={id} className={view===id?'mobileNavItem active':'mobileNavItem'} onClick={()=>setView(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>}
  {lyrics&&<div className="overlay"><div className="overlayTop"><button className="iconBtn" onClick={()=>setLyrics(false)}><X/></button><div><b>{song.title}</b><span>{song.artist}</span></div><MoreHorizontal/></div><div className="lyrics"><p className="faint">I still remember the night we met</p><h2><span>ฉัน ยัง รอ </span><em>เธอ</em><span> อยู่ ตรง นี้</span></h2><p className="en">I’m still waiting right here</p><p className="faint">แม้เวลาจะผ่านไปนานเท่าไร</p></div><button className="primary" onClick={()=>{setLyrics(false);setView('karaoke')}}><Mic2 size={17}/> Karaoke</button></div>}
  {add&&<AddMusicModal onClose={()=>setAdd(false)}/>} 
 </div>
}

function AddMusicModal({onClose}:{onClose:()=>void}){
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [uploaded,setUploaded]=useState<StorageObject|null>(null);
 const handleFile=async(e:React.ChangeEvent<HTMLInputElement>)=>{
  const file=e.target.files?.[0]; if(!file)return; setBusy(true); setMessage(''); setUploaded(null);
  try { setUploaded(await uploadFile(file)); setMessage('Upload complete.'); }
  catch(error){ setMessage(error instanceof Error?error.message:'Upload failed.'); }
  finally { setBusy(false); e.target.value=''; }
 };
 return <div className="modalShade" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="record"><Music2 size={34}/><span>SONG NOTE</span></div><div className="modalBody"><h2>Add Music</h2><p>Bring a song into your library.</p><label className="primary wide" style={{cursor:busy?'wait':'pointer',opacity:busy?.6:1}}><Upload size={17}/>{busy?'Uploading…':'Upload music'}<input type="file" accept="audio/*" hidden disabled={busy} onChange={handleFile}/></label>{uploaded&&<div style={{display:'flex',alignItems:'center',gap:8,margin:'10px 0',color:'#d8ff66',fontSize:13}}><CheckCircle2 size={17}/><span>{uploaded.filename}</span></div>}{message&&<div style={{margin:'10px 0',fontSize:13,color:message==='Upload complete.'?'#d8ff66':'#ff8e8e'}}>{message}</div>}<button className="secondary wide"><Link2 size={17}/> Paste a link</button><button className="ghost wide" onClick={onClose}>Close</button></div></div></div>
}
function HomeView({onPlay}:{onPlay:(s:Song)=>void}){return <section><p className="eyebrow">Good evening</p><h1>What do you want to hear?</h1><div className="hero"><img src={songs[0].image}/><div className="shade"/><div className="heroText"><p className="eyebrow"><Sparkles size={13}/> Continue listening</p><h2>Moonlit Echoes</h2><p>Luna Vale · Aurora Sessions</p><div><button className="primary" onClick={()=>onPlay(songs[0])}><Play size={16} fill="currentColor"/> Play</button><button className="secondary circle"><Heart size={17}/></button></div></div></div><Section title="Recently played"><div className="grid">{songs.slice(0,4).map(s=><Card key={s.title} song={s} onPlay={onPlay}/>)}</div></Section><Section title="Trending now"><div className="rows">{songs.slice(0,4).map((s,i)=><Row key={s.title} song={s} n={i+1} onPlay={onPlay}/>)}</div></Section></section>}
function SearchView({query,setQuery,songs,onPlay}:{query:string;setQuery:(v:string)=>void;songs:Song[];onPlay:(s:Song)=>void}){return <section><h1>Search</h1><div className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Songs, artists, albums, playlists"/>{query&&<button onClick={()=>setQuery('')}><X size={17}/></button>}</div>{!query?<><Section title="Explore by mood"><div className="moods"><div>Calm</div><div>After dark</div><div>Sing along</div></div></Section></>:<div className="rows top">{songs.map((s,i)=><Row key={s.title} song={s} n={i+1} onPlay={onPlay}/>)}</div>}</section>}
function LibraryView({songs,onPlay,onAdd}:{songs:Song[];onPlay:(s:Song)=>void;onAdd:()=>void}){return <section><div className="sectionHead"><div><p className="eyebrow">Your collection</p><h1>Library</h1></div><button className="primary" onClick={onAdd}><Plus size={17}/> Add Music</button></div><Section title="All songs"><div className="grid">{songs.map(s=><Card key={s.title} song={s} onPlay={onPlay}/>)}</div></Section></section>}
function Karaoke({song,onEnd}:{song:Song;onEnd:()=>void}){return <div className="kStage"><div className="aurora"/><header><button className="iconBtn" onClick={onEnd}>‹</button><div><b>Karaoke</b><span>{song.title} · {song.artist}</span></div><button className="iconBtn"><MoreHorizontal/></button></header><div className="kLyric"><p>แม้เวลาจะผ่านไปนานเท่าไร</p><h2><span>ฉันยัง</span> <em>รอเธอ</em> <span>อยู่ตรงนี้</span></h2><p>I’m still waiting right here</p></div><div className="wave">{Array.from({length:38}).map((_,i)=><i key={i} style={{height:(14+((i*29)%42))+'px'}}/>)}</div><footer><button className="secondary circle"><Shuffle/></button><button className="primary circle big" onClick={onEnd}><Pause fill="currentColor"/></button><button className="secondary circle"><Repeat2/></button></footer></div>}
function Card({song,onPlay}:{song:Song;onPlay:(s:Song)=>void}){return <article className="card" onClick={()=>onPlay(song)}><div className="cover"><div className="vinyl"/><img src={song.image}/><button className="play"><Play size={16} fill="currentColor"/></button></div><b>{song.title}</b><span>{song.artist}</span></article>}
function Row({song,n,onPlay}:{song:Song;n:number;onPlay:(s:Song)=>void}){return <div className="row" onClick={()=>onPlay(song)}><small>{String(n).padStart(2,'0')}</small><img src={song.image}/><div><b>{song.title}</b><span>{song.artist}</span></div><span className="note">{song.note}</span><small>3:{12+n}</small><MoreHorizontal size={17}/></div>}
function Section({title,children}:{title:string;children:React.ReactNode}){return <section className="sub"><div className="sectionTitle"><h2>{title}</h2><button className="ghost">See all <ChevronRight size={16}/></button></div>{children}</section>}
function Player({song,playing,onToggle,onLyrics,onKaraoke}:{song:Song;playing:boolean;onToggle:()=>void;onLyrics:()=>void;onKaraoke:()=>void}){return <div className="player"><div className="now"><img src={song.image}/><div><b>{song.title}</b><span>{song.artist}</span></div><Heart size={17}/></div><div className="controls"><div><button><SkipBack/></button><button className="primary circle" onClick={onToggle}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button><SkipForward/></button></div><div className="progress"><span>1:42</span><div><i/></div><span>3:48</span></div></div><div className="right"><button className="ghost" onClick={onLyrics}><Sparkles/> Lyrics</button><button className="ghost" onClick={onKaraoke}><Mic2/></button><Volume2 size={16}/></div></div>}

createRoot(document.getElementById('root')!).render(<App/>);
