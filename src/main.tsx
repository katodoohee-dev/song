import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Home, Search, Library, Mic2, Play, Pause, Heart, ChevronRight, Sparkles, MoreHorizontal, X, Plus, Volume2, Shuffle, SkipBack, SkipForward, Repeat2, Upload, Link2, Music2, CheckCircle2 } from "lucide-react";
import { AuthPanel } from "./auth-panel";
import { uploadFile, type StorageObject } from "./storage";
import { youtubeApi, songsApi, type Song as ApiSong, type YouTubeMetadata } from "./songs";
import { AUTH_API_URL } from "./lib/env";
import "./styles.css";

// `sourceType`/`sourceUrl` are present only for songs that came from the
// real backend (YouTube import or an uploaded file). The five bundled demo
// songs below are visual placeholders with no audio behind them, so they
// intentionally have neither field — see useAudioEngine, which treats their
// absence as "nothing to play" rather than pretending to play silence.
type Song = { id?: string; youtubeVideoId?: string | null; sourceType?: string; sourceUrl?: string; title: string; artist: string; note: string; image: string };
const songs: Song[] = [
 {title:"Moonlit Echoes",artist:"Luna Vale",note:"Aurora Sessions",image:"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1200&q=85"},
 {title:"Velvet Hours",artist:"Mira Sol",note:"Midnight Bloom",image:"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=85"},
 {title:"Northern Lines",artist:"Aster",note:"Quiet Horizons",image:"https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=85"},
 {title:"After the Rain",artist:"Noon & Night",note:"City Weather",image:"https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=85"},
 {title:"Slow Bloom",artist:"Nara",note:"New this week",image:"https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1200&q=85"}
];
const nav=[['home','Home',Home],['search','Search',Search],['library','Library',Library],['karaoke','Karaoke',Mic2]] as const;

const fromApiSong=(item:ApiSong):Song=>({
 id:item.id,
 youtubeVideoId:item.youtubeVideoId,
 sourceType:item.sourceType,
 // Upload sources come back as a relative API path (/api/storage/object/:id);
 // YouTube sources are already an absolute watch URL. Normalize both into
 // something useAudioEngine can act on directly.
 sourceUrl:item.sourceType==='upload' && item.sourceUrl ? `${AUTH_API_URL}${item.sourceUrl}` : item.sourceUrl,
 title:item.title,
 artist:item.sourceType==='upload'?'You':'YouTube',
 note:item.note||(item.sourceType==='upload'?'Uploaded track':'YouTube'),
 image:item.artworkUrl||item.artworkFallbackUrl||'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1200&q=85'
});

// ---------------------------------------------------------------------------
// Real audio playback.
//
// Two real sources exist in this app:
//  - Uploaded files: playable directly through an <audio> element pointed at
//    /api/storage/object/:id (the browser sends the session cookie for this
//    cross-site request because the auth API sets SameSite=None; Secure).
//  - YouTube imports: YouTube does not provide a raw audio stream URL (and
//    scraping one would violate YouTube's Terms of Service), so playback
//    goes through YouTube's own IFrame Player API, which is the supported,
//    ToS-compliant way to play a YouTube video's audio/video from a webpage.
// Demo/placeholder songs (no sourceType) have no real audio anywhere, so
// this hook simply does nothing for them instead of faking playback.
// ---------------------------------------------------------------------------
function loadYouTubeIframeApi(): Promise<any> {
  return new Promise(resolve => {
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(w.YT); return; }
    if (!document.getElementById('youtube-iframe-api')) {
      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(script);
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { previous?.(); resolve(w.YT); };
  });
}

function useAudioEngine(song: Song, playing: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const containerId = useRef(`yt-player-${Math.random().toString(36).slice(2)}`);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ''; };
  }, []);

  // Swap sources whenever the selected song changes.
  useEffect(() => {
    setUnavailable(false);
    if (song.sourceType === 'youtube' && song.youtubeVideoId) {
      audioRef.current?.pause();
      const videoId = song.youtubeVideoId;
      loadYouTubeIframeApi().then(YT => {
        if (!ytPlayerRef.current) {
          const el = document.createElement('div');
          el.id = containerId.current;
          el.style.position = 'fixed';
          el.style.bottom = '0';
          el.style.right = '0';
          el.style.width = '1px';
          el.style.height = '1px';
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          document.body.appendChild(el);
          ytPlayerRef.current = new YT.Player(containerId.current, {
            videoId,
            playerVars: { playsinline: 1 },
            events: {
              onReady: () => { ytReadyRef.current = true; if (playing) ytPlayerRef.current.playVideo(); },
              onError: () => setUnavailable(true),
            },
          });
        } else {
          ytReadyRef.current = false;
          ytPlayerRef.current.loadVideoById(videoId);
          ytReadyRef.current = true;
          if (!playing) ytPlayerRef.current.pauseVideo();
        }
      });
    } else if (song.sourceType === 'upload' && song.sourceUrl) {
      ytPlayerRef.current?.pauseVideo?.();
      if (audioRef.current) {
        audioRef.current.src = song.sourceUrl;
        audioRef.current.onerror = () => setUnavailable(true);
        if (playing) audioRef.current.play().catch(() => setUnavailable(true));
      }
    } else {
      // Demo/placeholder song — nothing real to play.
      ytPlayerRef.current?.pauseVideo?.();
      audioRef.current?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.sourceType, song.sourceUrl, song.youtubeVideoId]);

  // React to play/pause toggles without reloading the source.
  useEffect(() => {
    if (song.sourceType === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
      playing ? ytPlayerRef.current.playVideo() : ytPlayerRef.current.pauseVideo();
    } else if (song.sourceType === 'upload' && audioRef.current) {
      if (playing) audioRef.current.play().catch(() => setUnavailable(true));
      else audioRef.current.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const hasRealAudio = Boolean((song.sourceType === 'youtube' && song.youtubeVideoId) || (song.sourceType === 'upload' && song.sourceUrl));

  const [progress, setProgress] = useState({ currentTime: 0, duration: 0 });
  useEffect(() => {
    if (!hasRealAudio) { setProgress({ currentTime: 0, duration: 0 }); return; }
    if (song.sourceType === 'upload') {
      const audio = audioRef.current;
      if (!audio) return;
      const update = () => setProgress({ currentTime: audio.currentTime || 0, duration: audio.duration || 0 });
      audio.addEventListener('timeupdate', update);
      audio.addEventListener('loadedmetadata', update);
      return () => { audio.removeEventListener('timeupdate', update); audio.removeEventListener('loadedmetadata', update); };
    }
    if (song.sourceType === 'youtube') {
      // The YouTube IFrame API has no timeupdate event, so poll it.
      const interval = setInterval(() => {
        const player = ytPlayerRef.current;
        if (player && ytReadyRef.current && typeof player.getCurrentTime === 'function') {
          setProgress({ currentTime: player.getCurrentTime() || 0, duration: player.getDuration() || 0 });
        }
      }, 500);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealAudio, song.sourceType, song.id]);

  return { hasRealAudio, unavailable, progress };
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

function App(){
 const [view,setView]=useState<'home'|'search'|'library'|'karaoke'>('home');
 const [librarySongs,setLibrarySongs]=useState<Song[]>(songs);
 const [song,setSong]=useState(songs[0]); const [playing,setPlaying]=useState(false); const [lyrics,setLyrics]=useState(false); const [query,setQuery]=useState(''); const [add,setAdd]=useState(false);
 const { hasRealAudio, unavailable, progress } = useAudioEngine(song, playing);
 useEffect(()=>{
  let active=true;
  youtubeApi.list().then(({songs:remote})=>{
   if(!active)return;
   const mapped=remote.map(fromApiSong);
   setLibrarySongs([...mapped,...songs.filter(local=>!mapped.some(item=>item.youtubeVideoId&&item.youtubeVideoId===local.youtubeVideoId))]);
  }).catch(()=>undefined);
  return()=>{active=false};
 },[]);
 const filtered=useMemo(()=>librarySongs.filter(s=>(s.title+' '+s.artist+' '+s.note).toLowerCase().includes(query.trim().toLowerCase())),[librarySongs,query]);
 const addSongToLibrary=(item:ApiSong)=>{
  const mapped=fromApiSong(item);
  setLibrarySongs(current=>[mapped,...current.filter(existing=>existing.youtubeVideoId!==mapped.youtubeVideoId && existing.id!==mapped.id)]);
  setSong(mapped);
 };
 const play=(s:Song)=>{setSong(s);setPlaying(true)};
 return <div className="app">
  {view!=='karaoke'&&<aside className="sidebar"><div className="brand"><span className="brandMark"><Music2 size={17}/></span><b>Song Note</b></div><nav>{nav.map(([id,label,Icon])=><button key={id} className={view===id?'nav active':'nav'} onClick={()=>setView(id)}><Icon size={18}/>{label}</button>)}</nav><AuthPanel/></aside>}
  {view!=='karaoke'&&<header className="mobileHeader"><div className="brand"><span className="brandMark"><Music2 size={17}/></span><b>Song Note</b></div><AuthPanel/></header>}
  <main className={view==='karaoke'?'main karaoke':'main'}>
   {view==='home'&&<HomeView onPlay={play}/>} 
   {view==='search'&&<SearchView query={query} setQuery={setQuery} songs={filtered} onPlay={play}/>} 
   {view==='library'&&<LibraryView songs={librarySongs} onPlay={play} onAdd={()=>setAdd(true)}/>} 
   {view==='karaoke'&&<Karaoke song={song} onEnd={()=>setView('home')}/>} 
  </main>
  {view!=='karaoke'&&<Player song={song} playing={playing} onToggle={()=>setPlaying(v=>!v)} onLyrics={()=>setLyrics(true)} onKaraoke={()=>setView('karaoke')} hasRealAudio={hasRealAudio} unavailable={unavailable} progress={progress}/>} 
  {view!=='karaoke'&&<nav className="mobileNav">{nav.map(([id,label,Icon])=><button key={id} className={view===id?'mobileNavItem active':'mobileNavItem'} onClick={()=>setView(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>}
  {lyrics&&<div className="overlay"><div className="overlayTop"><button className="iconBtn" onClick={()=>setLyrics(false)}><X/></button><div><b>{song.title}</b><span>{song.artist}</span></div><MoreHorizontal/></div><div className="lyrics"><p className="faint">I still remember the night we met</p><h2><span>ฉัน ยัง รอ </span><em>เธอ</em><span> อยู่ ตรง นี้</span></h2><p className="en">I’m still waiting right here</p><p className="faint">แม้เวลาจะผ่านไปนานเท่าไร</p></div><button className="primary" onClick={()=>{setLyrics(false);setView('karaoke')}}><Mic2 size={17}/> Karaoke</button></div>}
  {add&&<AddMusicModal onClose={()=>setAdd(false)} onAdded={addSongToLibrary}/>} 
 </div>
}

function AddMusicModal({onClose,onAdded}:{onClose:()=>void;onAdded:(song:ApiSong)=>void}){
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [uploaded,setUploaded]=useState<StorageObject|null>(null);
 const [link,setLink]=useState(''); const [metadata,setMetadata]=useState<YouTubeMetadata|null>(null); const [saving,setSaving]=useState(false);
 const handleFile=async(e:React.ChangeEvent<HTMLInputElement>)=>{
  const file=e.target.files?.[0]; if(!file)return; setBusy(true); setMessage(''); setUploaded(null);
  try {
   const object=await uploadFile(file);
   setUploaded(object);
   // Uploading only stores the raw bytes. Turn it into an actual library
   // entry (songs + tracks + audio_files rows) so it shows up in Library.
   try {
    const title=file.name.replace(/\.[a-z0-9]+$/i,'')||object.filename;
    const result=await songsApi.createFromUpload(object.id, title);
    onAdded(result.song);
    setMessage('Upload complete — added to your library.');
   } catch(linkError){
    const status=linkError instanceof Error?(linkError as Error & {status?:number}).status:undefined;
    setMessage(status===503
     ?'File uploaded, but your library needs the database connection to save it as a song. Ask an admin to check the database configuration.'
     :linkError instanceof Error?linkError.message:'Upload succeeded, but could not add it to your library.');
   }
  }
  catch(error){ setMessage(error instanceof Error?error.message:'Upload failed.'); }
  finally { setBusy(false); e.target.value=''; }
 };
 const loadLink=async()=>{
  const value=link.trim(); if(!value){setMessage('Paste a YouTube link first.');return;}
  setSaving(true); setMessage(''); setMetadata(null);
  try { const result=await youtubeApi.metadata(value); setMetadata(result.metadata); }
  catch(error){
   const status=error instanceof Error ? (error as Error & {status?:number}).status : undefined;
   setMessage(status===401?'Sign in before adding a song to your library.':error instanceof Error?error.message:'Could not read YouTube metadata.');
  }
  finally { setSaving(false); }
 };
 const saveLink=async()=>{
  if(!metadata){await loadLink();return;}
  setSaving(true); setMessage('');
  try { const result=await youtubeApi.createSong(metadata.url); onAdded(result.song); setMessage(result.song.duplicate?'Song already exists in your library.':'Song added to your library.'); }
  catch(error){
   const status=error instanceof Error ? (error as Error & {status?:number}).status : undefined;
   setMessage(status===401?'Sign in before saving songs to your library.':error instanceof Error?error.message:'Could not save song.');
  }
  finally { setSaving(false); }
 };
 return <div className="modalShade" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="record"><Music2 size={34}/><span>SONG NOTE</span></div><div className="modalBody"><h2>Add Music</h2><p>Bring a song into your library.</p><label className="primary wide" style={{cursor:busy?'wait':'pointer',opacity:busy?.6:1}}><Upload size={17}/>{busy?'Uploading…':'Upload music'}<input type="file" accept="audio/*" hidden disabled={busy} onChange={handleFile}/></label>{uploaded&&<div style={{display:'flex',alignItems:'center',gap:8,margin:'10px 0',color:'#d8ff66',fontSize:13}}><CheckCircle2 size={17}/><span>{uploaded.filename}</span></div>}<div style={{display:'grid',gap:8,marginTop:10}}><input value={link} onChange={e=>{setLink(e.target.value);setMetadata(null)}} placeholder="Paste YouTube link" style={{width:'100%',padding:'12px 14px',borderRadius:10,border:'1px solid rgba(255,255,255,.14)',background:'rgba(255,255,255,.05)',color:'inherit'}}/><button className="secondary wide" onClick={saveLink} disabled={saving}>{saving?(metadata?'Adding…':'Reading YouTube…'):<><Link2 size={17}/>{metadata?'Add YouTube song':'Get song info'}</>}</button></div>{metadata&&<div style={{display:'flex',gap:10,alignItems:'center',margin:'12px 0'}}><img src={metadata.artworkUrl} onError={e=>{e.currentTarget.src=metadata.artworkFallbackUrl}} style={{width:64,height:64,objectFit:'cover',borderRadius:8}}/><div style={{minWidth:0}}><b style={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{metadata.title}</b><span style={{fontSize:12,opacity:.7}}>{metadata.authorName||'YouTube'}</span></div></div>}{message&&<div style={{margin:'10px 0',fontSize:13,color:/complete|added|exists/i.test(message)?'#d8ff66':'#ff8e8e'}}>{message}</div>}<button className="ghost wide" onClick={onClose}>Close</button></div></div></div>
}
function HomeView({onPlay}:{onPlay:(s:Song)=>void}){return <section><p className="eyebrow">Good evening</p><h1>What do you want to hear?</h1><div className="hero"><img src={songs[0].image}/><div className="shade"/><div className="heroText"><p className="eyebrow"><Sparkles size={13}/> Continue listening</p><h2>Moonlit Echoes</h2><p>Luna Vale · Aurora Sessions</p><div><button className="primary" onClick={()=>onPlay(songs[0])}><Play size={16} fill="currentColor"/> Play</button><button className="secondary circle"><Heart size={17}/></button></div></div></div><Section title="Recently played"><div className="grid">{songs.slice(0,4).map(s=><Card key={s.title} song={s} onPlay={onPlay}/>)}</div></Section><Section title="Trending now"><div className="rows">{songs.slice(0,4).map((s,i)=><Row key={s.title} song={s} n={i+1} onPlay={onPlay}/>)}</div></Section></section>}
function SearchView({query,setQuery,songs,onPlay}:{query:string;setQuery:(v:string)=>void;songs:Song[];onPlay:(s:Song)=>void}){return <section><h1>Search</h1><div className="search"><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Songs, artists, albums, playlists"/>{query&&<button onClick={()=>setQuery('')}><X size={17}/></button>}</div>{!query?<><Section title="Explore by mood"><div className="moods"><div>Calm</div><div>After dark</div><div>Sing along</div></div></Section></>:<div className="rows top">{songs.length?songs.map((s,i)=><Row key={s.id||s.youtubeVideoId||s.title} song={s} n={i+1} onPlay={onPlay}/>):<div style={{padding:'24px 0',opacity:.65}}>No songs found.</div>}</div>}</section>}
function LibraryView({songs,onPlay,onAdd}:{songs:Song[];onPlay:(s:Song)=>void;onAdd:()=>void}){return <section><div className="sectionHead"><div><p className="eyebrow">Your collection</p><h1>Library</h1></div><button className="primary" onClick={onAdd}><Plus size={17}/> Add Music</button></div><Section title="All songs"><div className="grid">{songs.map(s=><Card key={s.id||s.youtubeVideoId||s.title} song={s} onPlay={onPlay}/>)}</div></Section></section>}
function Karaoke({song,onEnd}:{song:Song;onEnd:()=>void}){return <div className="kStage"><div className="aurora"/><header><button className="iconBtn" onClick={onEnd}>‹</button><div><b>Karaoke</b><span>{song.title} · {song.artist}</span></div><button className="iconBtn"><MoreHorizontal/></button></header><div className="kLyric"><p>แม้เวลาจะผ่านไปนานเท่าไร</p><h2><span>ฉันยัง</span> <em>รอเธอ</em> <span>อยู่ตรงนี้</span></h2><p>I’m still waiting right here</p></div><div className="wave">{Array.from({length:38}).map((_,i)=><i key={i} style={{height:(14+((i*29)%42))+'px'}}/>)}</div><footer><button className="secondary circle"><Shuffle/></button><button className="primary circle big" onClick={onEnd}><Pause fill="currentColor"/></button><button className="secondary circle"><Repeat2/></button></footer></div>}
function Card({song,onPlay}:{song:Song;onPlay:(s:Song)=>void}){return <article className="card" onClick={()=>onPlay(song)}><div className="cover"><div className="vinyl"/><img src={song.image}/><button className="play"><Play size={16} fill="currentColor"/></button></div><b>{song.title}</b><span>{song.artist}</span></article>}
function Row({song,n,onPlay}:{song:Song;n:number;onPlay:(s:Song)=>void}){return <div className="row" onClick={()=>onPlay(song)}><small>{String(n).padStart(2,'0')}</small><img src={song.image}/><div><b>{song.title}</b><span>{song.artist}</span></div><span className="note">{song.note}</span><small>3:{12+n}</small><MoreHorizontal size={17}/></div>}
function Section({title,children}:{title:string;children:React.ReactNode}){return <section className="sub"><div className="sectionTitle"><h2>{title}</h2><button className="ghost">See all <ChevronRight size={16}/></button></div>{children}</section>}
function Player({song,playing,onToggle,onLyrics,onKaraoke,hasRealAudio,unavailable,progress}:{song:Song;playing:boolean;onToggle:()=>void;onLyrics:()=>void;onKaraoke:()=>void;hasRealAudio:boolean;unavailable:boolean;progress:{currentTime:number;duration:number}}){
 const pct = hasRealAudio && progress.duration > 0 ? Math.min(100, (progress.currentTime / progress.duration) * 100) : 0;
 return <div className="player"><div className="now"><img src={song.image}/><div><b>{song.title}</b><span>{unavailable?'Playback unavailable':!hasRealAudio?'Preview not available':song.artist}</span></div><Heart size={17}/></div><div className="controls"><div><button><SkipBack/></button><button className="primary circle" onClick={onToggle} disabled={!hasRealAudio} style={{opacity:hasRealAudio?1:.5,cursor:hasRealAudio?'pointer':'not-allowed'}} title={hasRealAudio?undefined:'This track has no playable audio source'}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button><SkipForward/></button></div><div className="progress"><span>{hasRealAudio?formatTime(progress.currentTime):'0:00'}</span><div><i style={{width:`${pct}%`}}/></div><span>{hasRealAudio?formatTime(progress.duration):'--:--'}</span></div></div><div className="right"><button className="ghost" onClick={onLyrics}><Sparkles/> Lyrics</button><button className="ghost" onClick={onKaraoke}><Mic2/></button><Volume2 size={16}/></div></div>
}

createRoot(document.getElementById('root')!).render(<App/>);
