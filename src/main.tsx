import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, ArrowUpRight, Check, ChevronLeft, ChevronRight, Download, FileAudio, Headphones, Library, Link2, LoaderCircle, Mic2, Music2, Plus, Search, Sparkles, Upload, X } from 'lucide-react';
import { AuthPanel } from './auth-panel';
import { AUTH_API_URL } from './lib/env';
import { uploadFile } from './storage';
import { parseLrc, toLrc } from './lyrics/lrc';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './styles.css';

type Line = { start: number; end: number; text: string };
type Job = { id: string; title: string; status: 'queued'|'processing'|'completed'|'failed'; lines: Line[]; error?: string; createdAt: string };
const labels = { queued: 'รอคิว', processing: 'กำลังประมวลผล', completed: 'พร้อมใช้งาน', failed: 'ไม่สำเร็จ' };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AUTH_API_URL}/api/studio/${path}`, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  return data;
}
const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
function App() {
  const [view, setView] = useState('studio');
  const [mode, setMode] = useState('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File|null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [youtube, setYoutube] = useState(false);
  const [enabled, setEnabled] = useState<boolean|null>(null);
  const [query, setQuery] = useState('');
  const [stem, setStem] = useState('instrumental');
  const [audioUrl, setAudioUrl] = useState('');
  const [time, setTime] = useState(0);
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(true);
  const [custom, setCustom] = useState<Line[]|null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lines = custom ?? job?.lines ?? [];
  const perPage = 6;
  const pages = Math.max(1, Math.ceil(lines.length / perPage));
  const active = lines.findIndex(l => time >= l.start && time < l.end);
  useEffect(() => { api<{enabled:boolean;youtube:boolean}>('capabilities').then(v => { setEnabled(v.enabled); setYoutube(v.youtube); }).catch(() => setEnabled(false)); }, []);
  const refresh = () => api<{jobs:Job[]}>('jobs').then(v => setJobs(v.jobs)).catch(e => setError(e.message));
  useEffect(() => { if (view === 'library') void refresh(); }, [view]);
  useEffect(() => {
    if (!job || !['queued', 'processing'].includes(job.status)) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api<{job:Job}>(`jobs/${job.id}`).then(v => { if (!cancelled) setJob(v.job); }).catch(e => { if (!cancelled) setError(e.message); });
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [job?.id, job?.status]);
  useEffect(() => { setCustom(null); setPage(0); setTime(0); }, [job?.id]);
  useEffect(() => { if (auto && active >= 0) setPage(Math.floor(active / perPage)); }, [active, auto]);
  useEffect(() => {
    setAudioUrl('');
    if (job?.status !== 'completed') return;
    const controller = new AbortController(); let objectUrl = '';
    fetch(`${AUTH_API_URL}/api/studio/jobs/${job.id}/${stem}`, { credentials: 'include', signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('โหลดไฟล์เสียงไม่สำเร็จ');
      const blob = await r.blob();
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setAudioUrl(objectUrl); }
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [job?.id, job?.status, stem]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      let body: Record<string, string>;
      if (mode === 'file') {
        if (!file) throw new Error('เลือกไฟล์เสียงก่อนเริ่ม');
        const object = await uploadFile(file);
        body = { objectId: object.id, title: file.name.replace(/\.[^.]+$/, '') };
      } else {
        if (!url.trim()) throw new Error('วางลิงก์ไฟล์เสียงก่อนเริ่ม');
        body = { url: url.trim(), title: new URL(url.trim()).pathname.split('/').pop() || 'Linked track' };
      }
      const result = await api<{job:Job}>('jobs', { method: 'POST', body: JSON.stringify(body) });
      setJob(result.job); setView('studio');
    } catch (e) { setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  }
  function exportLyrics() {
    const content = toLrc(lines.map((l, index) => ({ index, text: l.text, startTime: l.start, endTime: l.end })), { ti: job?.title || 'Lyrics' });
    const href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = href; a.download = 'song-note.lrc'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function importLyrics(file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('ไฟล์เนื้อร้องต้องไม่เกิน 1 MB'); return; }
    const result = parseLrc(await file.text());
    if (!result.lines.length) { setError('ไม่พบเนื้อร้องพร้อมเวลาในไฟล์ LRC'); return; }
    setCustom(result.lines.map(l => ({ start: l.startTime, end: l.endTime ?? Number.MAX_SAFE_INTEGER, text: l.text })));
    setPage(0); setError('');
  }
  const lyricPanel = <section className="panel lyricsPanel">
    <div className="panelHeading"><div><span className="eyebrow">FOLLOW EVERY WORD</span><h2>เนื้อร้องของคุณ</h2></div><span className="tag">{lines.length} บรรทัด</span></div>
    <div className="lyricsToolbar"><label className="smallButton"><Upload size={14}/> นำเข้า LRC<input type="file" accept=".lrc,text/plain" hidden onChange={e => void importLyrics(e.target.files?.[0])}/></label><button className="smallButton" disabled={!lines.length} onClick={exportLyrics}><Download size={14}/> ส่งออก</button><label className="follow"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}/> ตามเพลง</label></div>
    {lines.length ? <div className="lyricLines">{lines.slice(page * perPage, (page + 1) * perPage).map((line, index) => <button key={`${page}-${index}`} className={`lyricLine ${active === page * perPage + index ? 'current' : ''}`} onClick={() => { setTime(line.start); if (audio.current) audio.current.currentTime = line.start; }}><time>{clock(line.start)}</time><span>{line.text}</span></button>)}</div> : <div className="emptyLyrics"><div className="emptyIcon"><Mic2 size={28}/></div><h3>ให้ทุกคำร้องมีพื้นที่ของตัวเอง</h3><p>เนื้อร้องพร้อมเวลาจะปรากฏเมื่อประมวลผลเสร็จ<br/>หรือนำเข้าไฟล์ LRC ที่คุณมีอยู่แล้ว</p><span className="miniWave">▂ ▅ ▃ ▇ ▅ ▂ ▄ ▆ ▃</span></div>}
    <div className="pagination"><span>หน้า {page + 1} / {pages}</span><div><button aria-label="หน้าก่อน" disabled={page === 0} onClick={() => { setAuto(false); setPage(p => p - 1); }}><ChevronLeft size={18}/></button><button aria-label="หน้าถัดไป" disabled={page + 1 >= pages} onClick={() => { setAuto(false); setPage(p => p + 1); }}><ChevronRight size={18}/></button></div></div>
  </section>;
  return <div className="app"><aside className="sidebar"><a className="brand" href="#" onClick={() => setView('studio')}><span className="brandMark"><AudioLines size={23}/></span>song<span className="brandLight">note</span><i/></a><div className="navCaption">YOUR CREATIVE SPACE</div><nav>{[['studio', 'สตูดิโอ', AudioLines], ['library', 'คลังเพลง', Library], ['lyrics', 'เนื้อร้อง', Mic2], ['guide', 'วิธีใช้งาน', Headphones]].map(([id, label, Icon]) => { const I = Icon as typeof AudioLines; return <button key={String(id)} className={`nav ${view === id ? 'active' : ''}`} onClick={() => { setView(String(id)); setError(''); }}><I size={19}/><span>{String(label)}</span>{view === id && <i/>}</button>; })}</nav><div className="sidebarNote"><Sparkles size={19}/><h3>Made for your next take.</h3><p>แยกเสียง ฝึกร้อง และค้นพบ<br/>รายละเอียดใหม่ในเพลงของคุณ</p></div><AuthPanel/></aside>
    <main className="main"><header className="topbar"><span>WORKSPACE <ChevronRight size={12}/> {view.toUpperCase()}</span><span className="service"><i className={enabled ? 'ready' : ''}/>{enabled === null ? 'กำลังเชื่อมต่อ' : enabled ? 'เปิดประมวลผลแล้ว' : 'ยังไม่เปิดประมวลผล'}</span></header>
    <div className="pageHeading"><div><p className="eyebrow">LESS NOISE. MORE YOU.</p><h1>{view === 'library' ? 'คลังเพลงของคุณ' : view === 'lyrics' ? 'ทุกคำร้อง ชัดเจน' : view === 'guide' ? 'เริ่มต้นเสียงใหม่' : <>ทุกเสียง มีความเป็นไปได้<span>.</span></>}</h1><p>แยกเสียงร้องและดนตรี พร้อมเนื้อร้องในพื้นที่สร้างสรรค์เดียวกัน</p></div><div className="studioBadge"><AudioLines/><span>SONG NOTE<br/><b>STUDIO / 01</b></span></div></div>
    {error && <div className="notice error" role="alert"><span>{error}</span><button aria-label="ปิดข้อความ" onClick={() => setError('')}><X size={17}/></button></div>}
    {view === 'studio' && <><div className="studioGrid"><div className="leftColumn"><section className="importPanel panel"><div className="panelHeading"><div><span className="eyebrow">01 / BRING YOUR SOUND</span><h2>เริ่มจากเพลงที่คุณรัก</h2></div><div className="roundIcon"><Plus size={20}/></div></div><div className="tabs" role="tablist"><button role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'selected' : ''} onClick={() => setMode('link')}><Link2 size={16}/> วางลิงก์เพลง</button><button role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'selected' : ''} onClick={() => setMode('file')}><Upload size={16}/> อัปโหลดไฟล์</button></div><form onSubmit={submit}>{mode === 'link' ? <div className="urlInput"><Link2 size={19}/><input aria-label="ลิงก์ไฟล์เสียง" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-domain.com/song.mp3" required/></div> : <button type="button" className="dropzone" onClick={() => input.current?.click()}><FileAudio size={28}/><b>{file?.name || 'เลือกไฟล์เพลงจากเครื่อง'}</b><span>MP3, WAV, M4A, FLAC · 50 MB · ประมวลผล 15 นาทีแรก</span><input ref={input} hidden type="file" accept="audio/*,.mp3,.wav,.m4a,.flac" onChange={e => setFile(e.target.files?.[0] || null)}/></button>}<p className="inputHint">{mode === 'link' ? (youtube ? 'รองรับ YouTube สาธารณะและลิงก์ไฟล์เสียงที่อนุญาต • สูงสุด 15 นาที' : 'รองรับลิงก์ไฟล์เสียงตรงจากโดเมนที่เปิดใช้งาน • YouTube ยังไม่เปิดใช้') : 'ใช้เพลงที่คุณเป็นเจ้าของหรือได้รับอนุญาตให้ประมวลผล'}</p><div className="outputPills"><span><Check size={13}/> เสียงร้อง</span><span><Check size={13}/> ดนตรี</span><span><Check size={13}/> เนื้อร้องตามเวลา</span></div><button className="primary" disabled={busy || !enabled || (job != null && ['queued', 'processing'].includes(job.status))}>{busy ? <LoaderCircle className="spin" size={18}/> : <Sparkles size={18}/>} {busy ? 'กำลังส่งเพลง…' : 'แยกเสียงและสร้างเนื้อร้อง'}<ArrowUpRight size={18}/></button></form><p className="finePrint">คุณภาพการแยกเสียงและถอดคำขึ้นอยู่กับต้นฉบับ อาจต้องแก้เนื้อร้องบางคำ</p></section>
    <section className="panel outputPanel"><div className="panelHeading"><div><span className="eyebrow">02 / MAKE IT YOURS</span><h2>{job?.title || 'ห้องมิกซ์เสียงของคุณ'}</h2></div>{job && <span className={`tag ${job.status}`}>{labels[job.status]}</span>}</div>{job?.error && <p role="alert" className="failure">{job.error}</p>}<div className="stemCards">{[['vocals', 'เสียงร้อง', Mic2, 'VOCALS'], ['instrumental', 'เสียงดนตรี', Music2, 'INSTRUMENTAL']].map(([id, title, Icon, sub]) => { const I = Icon as typeof Mic2; return <button key={String(id)} className={`stemCard ${stem === id ? 'selected' : ''}`} onClick={() => { setStem(String(id)); setTime(0); }}><I size={22}/><span><b>{String(title)}</b><small>{String(sub)}</small></span><i/></button>; })}</div>{audioUrl ? <><audio key={audioUrl} ref={audio} src={audioUrl} controls onTimeUpdate={e => setTime(e.currentTarget.currentTime)}/><a className="download" href={audioUrl} download={`${stem}.wav`}><Download size={15}/> ดาวน์โหลด {stem === 'vocals' ? 'เสียงร้อง' : 'เสียงดนตรี'} WAV</a></> : <div className="audioWaiting">{job && ['processing', 'queued'].includes(job.status) ? <><LoaderCircle size={18} className="spin"/> กำลังแยกเสียงและถอดเนื้อร้อง อาจใช้เวลาหลายนาที</> : job?.status === 'completed' ? 'กำลังโหลดเสียง…' : 'ไฟล์เสียงที่แยกแล้วจะปรากฏที่นี่'}</div>}</section></div>{lyricPanel}</div><div className="workflow"><span><b>01</b> นำเข้าเพลง</span><ChevronRight size={15}/><span><b>02</b> แยกเสียงด้วย AI</span><ChevronRight size={15}/><span><b>03</b> ฝึกร้องในแบบของคุณ</span><span className="workflowEnd">YOUR SOUND, REIMAGINED.</span></div></>}
    {view === 'lyrics' && lyricPanel}
    {view === 'library' && <section className="panel"><div className="panelHeading"><h2>โปรเจกต์ทั้งหมด</h2><button className="smallButton" onClick={() => void refresh()}>รีเฟรช</button></div><div className="urlInput"><Search size={18}/><input aria-label="ค้นหาเพลง" placeholder="ค้นหาเพลงของคุณ" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="jobList">{jobs.filter(j => j.title.toLowerCase().includes(query.toLowerCase())).map(j => <button key={j.id} onClick={() => { setJob(j); setView('studio'); }}><div className="roundIcon"><Music2 size={18}/></div><span><b>{j.title}</b><small>{new Date(j.createdAt).toLocaleString('th-TH')}</small></span><span className="tag">{labels[j.status]}</span><ChevronRight size={17}/></button>)}</div>{!jobs.length && <div className="emptyLyrics"><Library size={32}/><h3>พื้นที่สำหรับเพลงของคุณ</h3><p>เข้าสู่ระบบแล้วเริ่มประมวลผลเพลงแรก</p><button className="smallButton" onClick={() => setView('studio')}>สร้างโปรเจกต์ <Plus size={15}/></button></div>}</section>}
    {view === 'guide' && <section className="panel guide"><h2>จากเพลงต้นฉบับ สู่พื้นที่ฝึกร้อง</h2><ol><li><b>เข้าสู่ระบบ</b><p>ใช้บัญชี Song Note เพื่อเก็บและเข้าถึงงานของคุณ</p></li><li><b>วางลิงก์หรืออัปโหลด</b><p>ลิงก์ต้องเป็นไฟล์เสียงโดยตรงจากโดเมนที่ผู้ดูแลอนุญาต YouTube ใช้ได้เมื่อผู้ดูแลเปิดนำเข้า และวิดีโอต้องเข้าถึงแบบสาธารณะได้ ส่วน Spotify ให้ใช้ไฟล์ต้นฉบับแทน</p></li><li><b>รอผลแยกเสียง</b><p>ระบบใช้ Demucs แยกเสียงร้องและดนตรี จากนั้น Whisper ถอดคำร้อง งานอาจใช้เวลาหลายนาทีตามเครื่องและความยาวเพลง</p></li><li><b>เปิดเพลงและตามเนื้อร้อง</b><p>เลือกเสียงร้องหรือดนตรี คลิกบรรทัดเพื่อเลื่อนไปยังเวลาเพลง เนื้อร้องแบ่งหน้าละ 6 บรรทัดอัตโนมัติ ไม่จำกัดจำนวนหน้า</p></li><li><b>นำเข้าและส่งออก LRC</b><p>นำเข้าเนื้อร้องที่แก้ไขแล้วได้ และส่งออกไฟล์พร้อมเวลา การแก้ผ่าน LRC ในหน้านี้ใช้เฉพาะรอบการเปิดปัจจุบัน</p></li></ol></section>}
    <footer className="pageFooter"><span>songnote studio</span><span>A little space. An endless soundtrack.</span></footer></main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
