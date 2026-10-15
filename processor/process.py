"""Separate real stems with Demucs, then transcribe vocals with Whisper."""
import json
import os
import pathlib
import subprocess
import sys
from faster_whisper import WhisperModel

source, destination = map(pathlib.Path, sys.argv[1:3])
video_id = sys.argv[3] if len(sys.argv) > 3 else ''
if video_id:
    import re
    from yt_dlp import YoutubeDL
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise ValueError('Invalid video ID')
    with YoutubeDL({'format': 'bestaudio/best', 'noplaylist': True,
                    'outtmpl': str(destination / 'download.%(ext)s'),
                    'max_filesize': 50 * 1024 * 1024, 'socket_timeout': 30,
                    'match_filter': lambda info, **kwargs: 'Track exceeds 15 minutes' if (info.get('duration') or 0) > 900 else None}) as downloader:
        info = downloader.extract_info('https://www.youtube.com/watch?v=' + video_id, download=True)
        if not info:
            raise ValueError('Video unavailable')
        source = pathlib.Path(downloader.prepare_filename(info))
# Decode into a bounded, predictable WAV before invoking ML models.
decoded = destination / 'input.wav'
subprocess.run(['ffmpeg', '-nostdin', '-y', '-i', str(source), '-t', '900', '-vn', '-ar', '44100', '-ac', '2', str(decoded)], check=True, timeout=120)
source = decoded
subprocess.run([sys.executable, '-m', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', str(destination), str(source)], check=True)
stems = destination / 'htdemucs' / source.stem
for name, target in [('vocals.wav', 'vocals.wav'), ('no_vocals.wav', 'instrumental.wav')]:
    (stems / name).replace(destination / target)
model = WhisperModel(os.getenv('WHISPER_MODEL', 'small'), device=os.getenv('WHISPER_DEVICE', 'cpu'), compute_type=os.getenv('WHISPER_COMPUTE_TYPE', 'int8'))
segments, info = model.transcribe(str(destination / 'vocals.wav'), beam_size=5, vad_filter=True)
lines = [{'start': s.start, 'end': s.end, 'text': s.text.strip()} for s in segments if s.text.strip()]
(destination / 'lyrics.json').write_text(json.dumps({'language': info.language, 'lines': lines}, ensure_ascii=False), encoding='utf-8')
