# Song Note Studio

Thai-first responsive workspace for real vocal/instrumental separation and timed lyrics. The studio replaces the previous demo-song homepage and hard-coded karaoke lyrics. Existing authentication, storage and song APIs remain available; previous song records are not deleted. The new project list shows processing jobs, not the old song catalog.

## Run locally

```sh
npm ci
# Terminal 1: API (configuration variables must be exported in your shell)
FRONTEND_ORIGIN=http://localhost:5173 npm run auth:start
# Terminal 2: frontend with /api proxy
npm run dev
```

Vite proxies `/api` to port 10000. For separate deployed frontend/API hosts, set `VITE_AUTH_API_URL` at frontend build time and `FRONTEND_ORIGIN` on the API. Existing Render deployment configuration keeps processing disabled until a suitably provisioned API is deployed. `npm start` serves the frontend; the studio endpoints live in `auth-server.mjs`, not the frontend server.

## Real processing setup

Requires Python 3.10+, FFmpeg, and adequate RAM/disk for Demucs and Whisper. CPU processing can take many minutes; GPU acceleration can improve throughput. Models download on first use, requiring outbound access. These model downloads and actual ML quality were not verified in the development environment.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r processor/requirements.txt
PROCESSING_ENABLED=true PYTHON_BIN=.venv/bin/python npm run auth:start
```

Alternatively build the API image with `docker build -f processor/Dockerfile -t song-note-api .`. Supply your database and frontend origin environment variables, mount persistent storage at `/data`, and cache models persistently if needed. The Docker image was authored but has not been built in this environment. Do not enable processing on the existing free Node service without installing Python/FFmpeg and checking memory capacity.

- Uploaded audio: maximum 50 MB; the first 15 minutes are processed.
- Direct links: HTTPS only, exact public host allowlist via `AUDIO_SOURCE_HOSTS=media.example.com,cdn.example.com`; redirects rejected. Configure only trusted public hosts, never local/private endpoints or user-controlled DNS.
- YouTube: opt in with `YOUTUBE_IMPORT_ENABLED=true`. Uses yt-dlp for public videos up to 15 minutes; use only material you are permitted to process. Private, login-required, DRM-protected, blocked or unavailable videos are not bypassed. YouTube may reject requests from hosting providers; upload the original file if import fails. Spotify URLs are not audio imports.
- Demucs `htdemucs` separates vocals and instrumental; faster-whisper transcribes the vocals with language detection. Lyrics are machine-generated and may need correction, particularly singing, backing vocals and Thai segmentation.
- One active job per account; ten outstanding jobs across the instance; one processor at a time with a 30-minute timeout. This is a **single-instance** worker. Do not scale replicas against one job directory.
- Jobs and WAVs persist in `PROCESSING_DIR`. A persistent disk is required in production. Interrupted jobs become failed after restart and can be resubmitted. Retention/automatic deletion is not implemented; monitor disk usage and remove old job directories only when workers are stopped.

## Lyrics and playback

Real output playback with native audio controls, seeking, volume and WAV download. Lyrics use six flowing rows per page, automatically follow playback, and support manual navigation and LRC import/export. Sixty lines produce ten pages; longer songs get more pages rather than hiding lyrics. Imported LRC edits are session-local: export before switching projects or reloading. Output audio is fetched with account credentials before playback/download, supporting cross-origin API deployments.

## Validation

```sh
npm run typecheck
npm run build
npm test
```

Tests cover input URL restrictions, authentication, disabled-processing behavior and unavailable output access. These do not establish audio quality or production readiness. Before launch, process an authorized full song on the target host, check both stems and Thai transcription, verify disk persistence across restart, and test browser sign-in with the actual frontend/API domains.

### Browser regression checks

Fonts are bundled with the frontend, including Thai glyphs; Google Fonts is no longer required.

```sh
npx playwright install chromium
npm run build
npm run test:ui
```

For an existing Chromium binary, set `CHROMIUM_EXECUTABLE=/path/to/chromium`. Optional `UI_SCREENSHOTS=/tmp/song-ui` saves desktop and mobile screenshots. The UI test uses mocked API responses and checks 320/390/768/1440-pixel layouts, local Thai font loading, 60 lyric lines across ten pages, row overlap, navigation and browser errors. It does not verify the audio models.

Verified on 2026-10-15: browser checks passed with Chromium 153, as did typecheck, production build and five API unit tests. Real model execution and deployment still require the selected hosting workspace and configured processing machine.
