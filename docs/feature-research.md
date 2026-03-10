# Roybal — Feature Research

> Researched 2026-03-09. Based on full codebase analysis of the current MVP.

---

## Table of Contents

1. [Audio & Playback](#audio--playback)
2. [Platform Support](#platform-support)
3. [Clip & Playlist Intelligence](#clip--playlist-intelligence)
4. [UI/UX Enhancements](#uiux-enhancements)
5. [Data & Discovery](#data--discovery)
6. [Technical Infrastructure](#technical-infrastructure)
7. [Unique / Creative Features](#unique--creative-features)
8. [Audio Format & Streaming Deep Dive](#audio-format--streaming-deep-dive)
9. [Priority Matrix](#priority-matrix)

---

## Audio & Playback

### Web Audio API Integration

**What:** Upgrade from plain HTML5 `<audio>` to a hybrid HTML5 Audio + Web Audio API pipeline using `MediaElementAudioSourceNode`. Keep the `<audio>` element for streaming/transport but route it through a Web Audio graph for analysis and effects.

**Why:** Unlocks visualization, crossfade, EQ, loudness normalization, and BPM detection — all impossible with raw HTML5 audio. This is the foundation for nearly every other audio feature.

**How:**
- In `PlayerContext.tsx`, create an `AudioContext` and connect the existing `audioRef` via `ctx.createMediaElementSource(audioRef.current)`
- Chain: `source → analyser → gainNode → ctx.destination`
- The `AnalyserNode` provides real-time frequency/waveform data
- The `GainNode` enables crossfade and volume control
- CORS is not an issue since audio is served from same-origin `/api/audio/`
- **Critical:** Once connected via `createMediaElementSource`, audio *only* outputs through the Web Audio graph — must connect to `ctx.destination`

**Complexity:** Medium (one-time refactor of PlayerContext)

**Dependencies:** None — Web Audio API is native, 92%+ browser support

**Risks:**
- `AudioContext` requires user gesture to start (call `ctx.resume()` on first play click)
- iOS Safari has quirks with AudioContext creation — test thoroughly
- The `<audio>` → `MediaElementSource` binding is permanent per element; can't disconnect

---

### Crossfade / DJ-Style Transitions

**What:** Smooth volume transitions between consecutive playlist items instead of abrupt stop/start.

**Why:** Eliminates jarring silence between clips. Essential for a "DJ crate" experience, especially when playing short clips back-to-back.

**How:**
- Requires Web Audio API integration (above)
- Use two `<audio>` elements (A and B) with separate `GainNode`s, both connected to destination
- When track A nears its end (or clip boundary), preload track B and start it
- Crossfade using `exponentialRampToValueAtTime`: ramp A's gain from 1→0.01 and B's from 0.01→1 over the fade duration
- Web Audio scheduling is sample-accurate (unlike `setTimeout`)
- Configurable fade duration: 0ms (gapless), 25ms (imperceptible gap fill), 500ms-3s (DJ-style)

**Libraries:**
- `@regosen/gapless-5` (~15 KB) — HTML5 Audio + WebAudio hybrid with crossfade support
- `Tone.js` — has `CrossFade` class, but heavyweight (~150 KB)
- Custom implementation recommended — it's 30 lines of Web Audio API code

**Complexity:** Medium

**Dependencies:** Web Audio API integration

**Risks:**
- Two audio elements = two concurrent network connections to backend
- Need to preload next track before current one ends — add a `preload()` method to PlayerContext
- Mobile browsers may restrict multiple simultaneous audio streams

---

### Gapless Playback

**What:** Zero-silence transitions between playlist items without crossfade overlap.

**Why:** Even without DJ-style fading, eliminating the ~50-200ms gap between tracks makes playlists feel professional.

**How:**
- Double-buffer approach: maintain two `<audio>` elements, preload next track while current plays
- When current track's `timeupdate` shows <2s remaining, start loading next track
- At end, instantly swap which element is "active"
- Alternative: use Web Audio API scheduling with `AudioBufferSourceNode.start(exactTime)` for sample-accurate transitions — but requires decoding full audio into memory

**Library:** `@regosen/gapless-5` handles this natively

**Complexity:** Medium

**Dependencies:** Web Audio API integration (for the best approach)

**Risks:**
- `AudioBufferSourceNode` approach loads full audio into RAM (~40 MB per 4-min track at 44.1kHz stereo) — not ideal for long tracks
- Double-buffer approach is more memory-efficient but timing is less precise

---

### Playback Speed Control

**What:** Variable playback speed from 0.5x to 2x with optional pitch preservation.

**Why:** Useful for learning music parts (slow down), previewing tracks quickly (speed up), or creative effects.

**How:**
- Basic: `audioRef.current.playbackRate = 1.5` — changes speed AND pitch
- Chrome does basic pitch correction automatically on `playbackRate`
- For proper pitch-preserving speed change: `SoundTouchJS` (npm: `soundtouchjs`) implements time-stretching in JavaScript
- UI: Add a speed selector to the Player component (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)
- Update `MediaSession.setPositionState()` with the current `playbackRate`

**Complexity:** Small (basic), Medium (pitch-preserved)

**Dependencies:** None for basic; `soundtouchjs` for pitch preservation

**Risks:** Pitch-preserved speed change adds CPU overhead and latency. Basic `playbackRate` sounds unnatural at extremes.

---

### Equalizer / Audio Effects

**What:** 3-band EQ (bass, mid, treble) and optional effects (compression, reverb).

**Why:** Different source platforms serve audio at different qualities and EQ profiles. A basic EQ lets the user compensate.

**How:**
- Chain three `BiquadFilterNode`s in the Web Audio graph:
  - Low shelf: `frequency=200Hz`, adjustable `gain` (-12 to +12 dB)
  - Peaking: `frequency=1000Hz`, adjustable `gain`
  - High shelf: `frequency=4000Hz`, adjustable `gain`
- Compression: `DynamicsCompressorNode` for real-time loudness leveling (threshold: -24 dB, ratio: 12, attack: 3ms, release: 250ms)
- Reverb: `ConvolverNode` loaded with impulse response audio file (~0.5s room reverb)
- UI: Three vertical sliders in a popover from the player bar
- EQ presets: "Flat", "Bass Boost", "Vocal", "Loudness" — just preset gain values

**Complexity:** Medium

**Dependencies:** Web Audio API integration

**Risks:**
- `BiquadFilterNode` parameters are well-behaved; no instability risks
- Reverb requires bundling an impulse response file (~50 KB)
- EQ settings should persist (store in `localStorage`)

---

### Audio Normalization (Loudness Leveling)

**What:** Consistent volume across tracks from different sources (YouTube vs SoundCloud vs TikTok).

**Why:** Without normalization, switching between tracks from different platforms causes jarring volume jumps.

**How (server-side, recommended):**
- During the caching step (after yt-dlp downloads audio), run `ffmpeg -af loudnorm` two-pass normalization to -14 LUFS (same target as Spotify/YouTube)
- Pass 1: `ffmpeg -i input -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -` → captures measured loudness
- Pass 2: Apply normalization with measured values
- Store measured LUFS in a new `loudness_lufs` column on the `tracks` table
- Python wrapper: `pyloudnorm` (`pip install pyloudnorm`) for analysis; shell out to `ffmpeg` for actual normalization

**How (client-side fallback):**
- `DynamicsCompressorNode` in the Web Audio graph acts as a real-time safety net
- Tames peaks without pre-processing — not as good as proper normalization but helps

**Complexity:** Medium

**Dependencies:** `ffmpeg` (already needed for yt-dlp), `pyloudnorm`

**Risks:**
- Two-pass normalization adds ~5s to the caching process per track
- Re-encoding audio may reduce quality slightly — use the same codec/bitrate as source
- Existing cached files won't be normalized until re-downloaded

---

## Platform Support

### Platform Reliability Tier List

| Tier | Platform | Rating | Auth Required | Notes |
|------|----------|--------|--------------|-------|
| 1 | YouTube | 5/5 | PO token recommended | Best supported; use `bgutil-ytdlp-pot-provider` plugin for bot detection bypass |
| 1 | Vimeo | 4/5 | No (unless password-protected) | Very reliable; `--video-password` for protected content |
| 1 | SoundCloud | 4/5 | OAuth token for Go+ | Free: 128kbps MP3; Go+: 256kbps AAC |
| 1 | Bandcamp | 4/5 | Cookies for purchased | Free streaming: 128kbps MP3; higher quality with cookies |
| 2 | Twitter/X | 3/5 | Cookies for private | Guest token works for public; audio extracted from video |
| 2 | Reddit | 3/5 | Cookies for NSFW | Requires ffmpeg for muxing separate audio/video streams |
| 2 | Twitch | 3/5 | Cookies for sub VODs | Clips well-supported; live is experimental |
| 3 | TikTok | 2/5 | Sometimes | Volatile — frequently breaks and gets fixed |
| 3 | Instagram | 1.5/5 | Always (cookies) | Actively hostile to scrapers; not recommended |
| — | Apple Music | 0/5 | N/A | FairPlay DRM, no yt-dlp support |
| — | Amazon Music | 0/5 | N/A | DRM, no yt-dlp support |
| — | Tidal | 0/5 | N/A | Widevine DRM, no yt-dlp support |
| — | Spotify | 0/5 | N/A | No audio extraction; use metadata→YouTube matching |

---

### SoundCloud & Bandcamp Support

**What:** Explicitly support and test SoundCloud and Bandcamp as first-class sources alongside YouTube.

**Why:** These are the two best music-focused platforms after YouTube — both are reliable, music-centric, and beloved by independent artists and DJs.

**How:**
- Already works via yt-dlp with no changes — your `/api/resolve` endpoint handles any yt-dlp-supported URL
- For SoundCloud Go+ tracks: add optional OAuth token config (extract from browser DevTools, pass via `--add-header`)
- For Bandcamp purchased content: add optional browser cookie support
- Consider showing platform-specific badges in the UI (already partially implemented via `platform` field)
- Add platform detection for better error messages ("SoundCloud Go+ tracks require authentication")

**Complexity:** Small (mostly UI/error handling improvements)

**Dependencies:** None

**Risks:** SoundCloud's OAuth tokens expire — user needs to re-extract periodically

---

### Spotify URL Support (via YouTube Matching)

**What:** Accept Spotify track/album/playlist URLs, extract metadata, find matching YouTube audio, and download that.

**Why:** Users often discover music on Spotify but want it in Roybal. Currently they'd have to manually search YouTube for the same track.

**How:**
- **Option A (lightweight):** Parse Spotify URL to extract track/artist info from the page's Open Graph metadata (no API key needed), then search YouTube via `ytsearch:{artist} - {title}`
- **Option B (robust):** Use `spotdl` (`pip install spotdl`) which does exactly this — Spotify metadata → YouTube Music matching → yt-dlp download. It compares title, artist, duration, album to find the best match (~95% accuracy for popular tracks)
- **Option C (API-based):** Register a Spotify API app, use the Web API to get full metadata + audio features (BPM, key, energy), then search YouTube
- New endpoint: `POST /api/resolve` already handles URL → track resolution. Add Spotify URL detection to route through the matching pipeline before calling yt-dlp
- The matched YouTube URL becomes the `source_url`; store the original Spotify URL as metadata

**Complexity:** Medium (Option A) to Large (Options B/C)

**Dependencies:** `spotdl` or Spotify API credentials

**Risks:**
- YouTube matching is imperfect — wrong version, live recording, or remix could match
- spotdl adds a significant dependency chain
- Spotify API requires OAuth app registration and has rate limits
- Some Spotify-exclusive tracks may not exist on YouTube

---

### Unsupported Platform Fallback

**What:** When a user pastes an Apple Music, Tidal, or Amazon Music URL, parse the track metadata from the URL/page and auto-search YouTube for a match.

**Why:** Graceful degradation is better than "unsupported URL" errors. Users share these links regularly.

**How:**
- Detect URL patterns for Apple Music (`music.apple.com`), Tidal (`tidal.com`), Amazon Music (`music.amazon.com`)
- Scrape the page's Open Graph `<meta>` tags for title/artist (most music platforms embed `og:title`, `og:description`)
- Construct a YouTube search query and present results to the user
- Let the user confirm the match before resolving
- New files: `backend/app/services/url_matcher.py` for platform-specific URL parsers

**Complexity:** Medium

**Dependencies:** `httpx` or `beautifulsoup4` for metadata scraping

**Risks:** Open Graph metadata may not always contain the artist name separately from the title

---

### YouTube PO Token Setup

**What:** Configure yt-dlp's `bgutil-ytdlp-pot-provider` plugin for reliable YouTube extraction.

**Why:** YouTube's "Sign in to confirm you're not a bot" errors are becoming more frequent. PO tokens solve this.

**How:**
- `pip install bgutil-ytdlp-pot-provider`
- The plugin automatically handles PO token generation
- Alternative: configure `--cookies-from-browser firefox` in yt-dlp options (add to `_BASE_OPTS` in `ytdlp_service.py`)
- Add a `/api/health/ytdlp` endpoint that tests YouTube extraction and reports if auth is needed

**Complexity:** Small

**Dependencies:** `bgutil-ytdlp-pot-provider`

**Risks:** PO token provider itself may break as YouTube evolves

---

### In-App Search

**What:** Search YouTube, SoundCloud, and YouTube Music directly from the app instead of pasting URLs.

**Why:** Reduces friction — users can discover and add tracks without leaving Roybal.

**How:**
- yt-dlp supports search extractors:
  - `ytsearch:query` — YouTube (use `ytsearchN:query` for N results)
  - `ytmusicsearch:query` — YouTube Music (better for music-specific results)
  - `scsearch:query` — SoundCloud
- New endpoint: `GET /api/search?q=lofi+hip+hop&platform=youtube&limit=10`
- Backend: Call `yt_dlp.extract_info(f"ytsearch10:{query}", download=False)` and return the list of entries
- Frontend: Add a search tab/mode to `AddTrack.tsx` with results displayed as `TrackCard`s. Click to resolve.
- Already spec'd in `system-design.md` but not implemented

**Complexity:** Medium

**Dependencies:** None (yt-dlp already supports this)

**Risks:**
- Search results are slower than direct URL resolution (~3-5s for YouTube search)
- `scsearch:` has had intermittent bugs (yt-dlp issue #14443)
- Rate limiting if searching frequently

---

## Clip & Playlist Intelligence

### Waveform Visualization

**What:** Display a visual waveform of the track's amplitude in the clip editor and player progress bar.

**Why:** The clip editor currently has a flat progress bar — users can't see where loud/quiet sections are, where beats hit, or where the "interesting parts" live. A waveform makes clip boundary selection vastly more intuitive.

**How (server-side peak generation):**
- Install `audiowaveform` CLI tool: `brew install audiowaveform`
- After yt-dlp downloads audio to cache, run: `audiowaveform -i track.mp3 -o peaks.json --pixels-per-second 10`
- This outputs ~2400 data points (min/max pairs) for a 4-minute track — perfect for rendering
- Store peaks JSON in SQLite (new `waveform_peaks` column on `tracks` table, or a separate file)
- New endpoint: `GET /api/tracks/{trackId}/waveform` returns the peaks JSON
- Run as a background task during caching (FastAPI `BackgroundTasks`)

**How (frontend rendering):**
- Option A: Use `wavesurfer.js` v7 (~15 KB) — full-featured waveform display with plugin ecosystem (Regions, Timeline, Minimap)
- Option B: Use BBC's `peaks.js` — designed for pre-computed waveform data, supports zoom and markers
- Option C: Custom Canvas rendering — draw vertical lines proportional to peak values. ~50 lines of code for a basic waveform.
- For the clip editor: overlay the clip region (green tint between start/end markers) on the waveform
- For the player progress bar: show a mini waveform behind the emerald progress fill

**Complexity:** Medium

**Dependencies:** `audiowaveform` (CLI), optionally `wavesurfer.js` or `peaks.js`

**Risks:**
- `audiowaveform` requires a system install (not a Python package)
- Waveform generation adds ~0.5s to the caching pipeline per track
- Large waveform JSON blobs in SQLite could grow the DB — consider storing as separate files

---

### BPM Detection

**What:** Automatically detect the tempo (BPM) of each track.

**Why:** Enables smart playlists, beat-matching between clips, and helps users find tracks at similar tempos for mixing.

**How (backend — recommended):**
- `pip install librosa`
- After caching audio: `tempo, beats = librosa.beat.beat_track(y=y, sr=sr)`
- `tempo` = estimated BPM (float), `beats` = array of beat frame indices
- Store `bpm` in a new column on `tracks` table
- Also store beat timestamps (convert frames to ms) for potential beat-grid UI
- Processing time: ~1.5s per track
- Run as background task alongside waveform generation

**How (browser — alternative):**
- `web-audio-beat-detector` (npm) — offline analysis of AudioBuffer
- `analyze(audioBuffer)` returns tempo
- Requires decoding full audio in browser — slower, uses more memory
- Better as a fallback if backend analysis isn't available

**Complexity:** Small (just BPM number), Medium (with beat grid)

**Dependencies:** `librosa` (pip)

**Risks:**
- librosa's beat tracker has a ~20-60ms late bias (documented in their GitHub issues) — fine for display, not for sample-accurate beat-matching
- Accuracy drops for complex time signatures, free-tempo music, or heavily syncopated rhythms
- For better accuracy: `beat_this` (PyTorch-based, from CPJKU) outperforms librosa but requires PyTorch

---

### Auto-Segment Detection (Drop, Chorus, Energy Peaks)

**What:** Automatically identify "interesting" segments of a track — the drop in EDM, the chorus in pop, energy peaks, section boundaries.

**Why:** The killer feature of Roybal is clips. Auto-detecting interesting segments means users can instantly create clips for the best parts without manually scrubbing through tracks.

**How:**
- **Energy-based segmentation** (easiest, most reliable):
  - Compute RMS energy envelope: `librosa.feature.rms(y=y)`
  - Find sections with above-average energy → these are likely choruses/drops
  - Find sudden energy spikes after quiet sections → these are drops
  - Present as "suggested clips" in the clip editor

- **Repetition-based chorus detection** (medium difficulty):
  - Extract chroma features: `librosa.feature.chroma_stft(y, sr)`
  - Build self-similarity matrix: `librosa.segment.recurrence_matrix(chroma)`
  - Sections that repeat most are likely choruses
  - Works well on pop/rock with clear structure

- **Drop detection in EDM** (medium difficulty):
  - Combine RMS energy + spectral flux (`librosa.onset.onset_strength`)
  - Pattern: sustained low energy + rising spectral flux (buildup) → sudden energy spike (drop)
  - Highly effective for electronic music

- **Simple silence/intro/outro detection**:
  - `pydub.silence.detect_nonsilent()` with a high threshold (-30 dBFS)
  - Finds where the "real content" starts and ends
  - Useful for trimming intros/outros automatically

**Data model:**
- New `track_segments` table or JSON blob on tracks: `[{startMs, endMs, type, confidence}]`
- Types: "energy_peak", "chorus", "drop", "intro", "outro"
- Present in clip editor as clickable markers on the waveform

**Complexity:** Medium (energy-based), Large (chorus detection)

**Dependencies:** `librosa` (pip), optionally `pydub` for silence detection

**Risks:**
- Section labeling ("this is the chorus") is research-grade and unreliable without ML
- Energy-based detection is reliable but doesn't understand musical structure
- Processing time: full analysis pipeline takes 5-8s per track

---

### Audio Fingerprinting & Duplicate Detection

**What:** Fingerprint each track and detect duplicates across sources (same song from YouTube and SoundCloud).

**Why:** Users may add the same song from different platforms without realizing it. Also enables metadata enrichment via MusicBrainz.

**How:**
- `pip install pyacoustid` + `brew install chromaprint`
- After caching: `duration, fingerprint = acoustid.fingerprint_file(path)`
- Compare against existing fingerprints: `acoustid.compare_fingerprints(fp1, fp2)` → similarity score 0.0-1.0 (>0.8 = likely same track)
- Store fingerprint in new `fingerprint` column on `tracks` table
- On resolve: check fingerprint against library, warn "This track may already be in your library as [title]"
- Optional: query AcoustID web service for MusicBrainz metadata enrichment (free API key, 3 req/s limit)

**Complexity:** Small

**Dependencies:** `pyacoustid`, `chromaprint` (system library)

**Risks:**
- Fingerprinting requires the full audio file (not streaming) — only works after caching
- chromaprint is a C library requiring system install
- AcoustID lookups require internet and a free API key

---

### Smart Playlists

**What:** Auto-generated playlists based on track attributes — BPM range, energy level, platform, tags, recently added.

**Why:** Once you have BPM, energy, and tags, you can auto-curate playlists like "High Energy (120-140 BPM)" or "New This Week."

**How:**
- Define smart playlist rules as JSON: `{ "rules": [{"field": "bpm", "op": "between", "value": [120, 140]}] }`
- New `smart_playlists` table with `rules` JSON column
- Backend evaluates rules against `tracks` + `track_analysis` tables
- Frontend: rule builder UI with dropdowns for field/operator/value
- Refresh on demand or on new track addition

**Complexity:** Medium

**Dependencies:** BPM detection, optionally tags and energy analysis

**Risks:** Only useful once you have enough analyzed tracks in the library

---

### Loop Builder / Mashup Mode

**What:** Layer multiple clips to play simultaneously, creating mashups or loop combinations.

**Why:** The next evolution of clip playback — instead of sequential clips, play them in parallel. Put a drum loop under a vocal clip, or layer two complementary clips.

**How:**
- Requires Web Audio API — each layer gets its own `<audio>` element → `MediaElementSource` → `GainNode` (individual volume) → destination
- UI: Timeline view with multiple horizontal tracks (like a simple DAW)
- Each lane holds a clip that loops independently
- Individual volume/mute per lane
- BPM sync: if both clips have detected BPM, adjust `playbackRate` to match tempos

**Complexity:** Large

**Dependencies:** Web Audio API integration, BPM detection (for tempo sync)

**Risks:**
- Multiple simultaneous audio streams strain mobile browsers
- Tempo-syncing requires reliable BPM detection
- This is essentially building a simple DAW — scope creep risk is high
- Start with 2-layer mode and expand if useful

---

## UI/UX Enhancements

### MediaSession API (Lock Screen / OS Controls)

**What:** Integrate with the browser's MediaSession API for lock screen controls, media key support, and browser media notifications.

**Why:** Highest-ROI UX enhancement on this list. Zero dependencies, works across all modern browsers and mobile. Users get play/pause/skip from their lock screen, keyboard media keys, Bluetooth headset buttons, and browser media notifications — all for free.

**How:**
- In `PlayerContext.tsx`, add a `useEffect` that fires when `currentTrack` changes:
  - Set `navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'Roybal', artwork: [{src: thumbnailUrl}] })`
  - Set action handlers: `navigator.mediaSession.setActionHandler('play', togglePlay)` etc.
  - Actions to handle: `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward`
  - Update `navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'`
  - Update position: `navigator.mediaSession.setPositionState({ duration: durationMs/1000, playbackRate: 1, position: currentTimeMs/1000 })`
- For clips: show clip label as the "track title" and full track title as "artist" in the notification

**Complexity:** Small

**Dependencies:** None (native API)

**Risks:**
- Must set metadata *after* audio starts playing (some browsers ignore pre-play metadata)
- iOS Safari support is more limited (no `seekto` action)
- Thumbnail URL must be accessible (your backend proxies thumbnails, so this works)

---

### Keyboard Shortcuts

**What:** Standard music player keyboard shortcuts: space=play/pause, arrows=seek, etc.

**Why:** Power users expect keyboard control. Especially important for the clip editor where you need quick tap-to-mark while your hands are on the keyboard.

**How:**
- Install `react-hotkeys-hook` (~3.5 KB gzipped)
- Add `useHotkeys` calls in `PlayerContext.tsx` or a new `KeyboardShortcuts` wrapper component
- Standard bindings:

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| ← / → | Seek ±5s |
| Shift+← / Shift+→ | Previous/Next track |
| ↑ / ↓ | Volume ±10% |
| M | Mute/Unmute |
| L | Cycle loop mode |
| ? | Show shortcut cheat sheet |

- `react-hotkeys-hook` has `enableOnFormTags: false` by default — shortcuts won't fire while user is typing in `<input>` fields (AddTrack URL input, clip label, etc.)
- Cheat sheet: modal triggered by `?` key, styled with `<kbd>` elements and backdrop blur

**Complexity:** Small

**Dependencies:** `react-hotkeys-hook` (npm)

**Risks:** Must call `e.preventDefault()` on Space (prevents page scroll) and arrow keys

---

### Queue System (Play Next / Add to Queue)

**What:** Ephemeral "up next" queue that's separate from playlists. "Play Next" inserts after the current track; "Add to Queue" appends to the end.

**Why:** Playlists are curated and persistent. A queue is spontaneous — "I want to hear this next, but I don't want to edit my playlist." Every music player has this.

**How:**
- Add to `PlayerContext.tsx`:
  - New state: `queue: PlaylistItem[]`
  - New methods: `playNext(track, clip?)`, `addToQueue(track, clip?)`, `removeFromQueue(index)`, `clearQueue()`
  - Modify `advanceToNext()`: if `queue.length > 0`, dequeue and play before advancing in the playlist
- Queue lives in React state only — ephemeral by design
- Optional: persist to `localStorage` for session recovery
- UI: Add a "Queue" panel/tab (slide-out or sidebar section) showing upcoming items
- Add "Play Next" and "Add to Queue" options to track cards and playlist items (right-click or overflow menu)

**Complexity:** Medium

**Dependencies:** None

**Risks:** Need to handle edge cases: what happens when you clear the queue while a queued item is playing? (Answer: keep playing it, just clear the rest)

---

### Drag-and-Drop URL

**What:** Drop a URL (dragged from browser address bar or a link on another page) anywhere on the Roybal page to resolve it.

**Why:** Faster than copy-paste. Users are already browsing YouTube/SoundCloud — dragging the URL directly into Roybal is natural.

**How:**
- Native HTML5 Drag and Drop API — no library needed
- Add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers to the root page component
- Extract URL: `e.dataTransfer.getData('text/uri-list')` (primary) or `e.dataTransfer.getData('text/plain')` (fallback)
- Validate with `new URL(text)` to ensure it's actually a URL
- Call `resolveTrack(url)` on drop — same as the AddTrack form
- Visual feedback: show a full-page overlay on `dragenter` with "Drop to add track" message
- Use a counter (increment on `dragenter`, decrement on `dragleave`) to prevent flickering from child elements

**Complexity:** Small

**Dependencies:** None

**Risks:** Detecting URL vs file drag: check `e.dataTransfer.types.includes('Files')` to distinguish

---

### Waveform Progress Bar

**What:** Replace the flat progress bar in the Player component with a mini waveform that fills with color as the track plays.

**Why:** Beautiful and informational — you can see the track's shape at a glance and know what's coming (quiet section, build-up, drop).

**How:**
- Requires waveform peaks data from the backend (see Waveform Visualization above)
- Render peaks as vertical bars in a Canvas element
- Use two colors: unfilled (zinc-700) and filled (emerald-500) split at the current playback position
- Click-to-seek on the waveform (same as current progress bar behavior)
- For clips: highlight the clip region with an emerald tint overlay

**Complexity:** Medium

**Dependencies:** Waveform peak generation (backend)

**Risks:** Canvas rendering on every `timeupdate` (~4 times/second) needs to be efficient. Use `requestAnimationFrame` and only redraw the changed portion.

---

### Audio Visualizer

**What:** Real-time audio-reactive visualization in the player.

**Why:** Fun. Makes Roybal feel alive. Especially cool when playing clips that are all about "the vibe."

**How (tiered approach):**

1. **CSS-only "now playing" bars** (easiest):
   - 3-5 `div` bars with varying `@keyframes` heights and delays
   - Not reactive to actual audio — purely decorative
   - Zero dependencies, zero performance cost
   - What Spotify uses in many contexts

2. **Canvas bar visualizer** (medium):
   - Uses `AnalyserNode.getByteFrequencyData()` from Web Audio API
   - Draw 32-64 frequency bars on a `<canvas>` element
   - `requestAnimationFrame` loop for smooth 60fps rendering
   - CPU cost is minimal if bar count is kept low

3. **Butterchurn Milkdrop** (full-screen wow factor):
   - `npm install butterchurn butterchurn-presets`
   - WebGL 2 implementation of classic Winamp Milkdrop visualizer
   - Hundreds of presets, visually spectacular
   - Heavy bundle — load on demand
   - Optional full-screen mode triggered by a button

**Complexity:** Small (CSS), Medium (Canvas), Large (Butterchurn)

**Dependencies:** Web Audio API integration (for reactive options)

**Risks:** `AnalyserNode` returns zeroed arrays if CORS headers are missing — not an issue for same-origin `/api/audio/`

---

### Mobile-Responsive Improvements

**What:** Bottom sheet "now playing" view, swipe gestures, touch-friendly controls, safe area handling.

**Why:** Roybal on mobile (via browser) should feel native-ish, not like a shrunken desktop app.

**How:**
- **Bottom sheet:** `npm install vaul` (~4 KB) — gesture-driven drawer component by Emil Kowalski. Three snap points: mini-player bar, half-expanded (controls + seek), full-expanded (artwork + clip editor + queue)
- **Swipe gestures:** `npm install react-swipeable` (~1.5 KB) — `useSwipeable()` hook for left=next, right=prev on the now-playing artwork
- **Touch-friendly seek bar:** Replace `<input type="range">` with a custom div-based slider or `@radix-ui/react-slider`. Larger touch target, thumb appears on touch.
- **iOS safe area:** Add `viewport-fit=cover` to `<meta name="viewport">`. Use `env(safe-area-inset-bottom)` for bottom player padding. The `tailwindcss-safe-area` plugin adds `pb-safe` utilities.
- **Responsive player:** On small screens, stack the player controls vertically. Hide artwork below 640px. Use larger touch targets (44x44px minimum per Apple's guidelines).

**Complexity:** Medium

**Dependencies:** `vaul`, `react-swipeable`, optionally `@radix-ui/react-slider`

**Risks:** Bottom sheet behavior can conflict with browser pull-to-refresh on Android. Vaul handles this with `preventScrollRestoration`.

---

## Data & Discovery

### Play History & Recently Played

**What:** Track every play event. Show "Recently Played" and "Most Played" views.

**Why:** "What was that track I was listening to yesterday?" Users often forget what they've played — history solves this.

**How:**
- New table:
```sql
CREATE TABLE play_history (
  id                   TEXT PRIMARY KEY,
  track_id             TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  clip_id              TEXT REFERENCES clips(id) ON DELETE SET NULL,
  played_at            TEXT DEFAULT (datetime('now')),
  duration_listened_ms INTEGER
);
CREATE INDEX idx_play_history_played_at ON play_history(played_at);
```
- New endpoints:
  - `POST /api/history` — record a play (call after 5s of playback to avoid accidental taps)
  - `GET /api/history?limit=50` — recent plays
  - `GET /api/history/stats` — most played tracks (COUNT + SUM of duration_listened_ms)
- Frontend: "History" tab in the sidebar, showing tracks with "played 3 hours ago" timestamps
- "Most Played" view: sorted by play count or total listen time

**Complexity:** Small

**Dependencies:** None

**Risks:** History table can grow large over time — add periodic cleanup (delete entries older than 90 days)

---

### Track Tags / Labels

**What:** User-defined tags for organizing tracks (e.g., "chill", "workout", "drops", "vocals").

**Why:** As the library grows, finding specific tracks gets harder. Tags provide flexible, user-defined organization without rigid folder structures.

**How:**
- New tables:
```sql
CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6B7280'
);

CREATE TABLE track_tags (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, tag_id)
);
```
- New endpoints:
  - `GET /api/tags` — list all tags
  - `POST /api/tags` — create tag with name + color
  - `PUT /api/tracks/{trackId}/tags` — set tags for a track
  - `GET /api/tracks?tags=id1,id2` — filter tracks by tags
- Auto-tagging: yt-dlp returns `genre` in metadata (when available) — auto-create tags from this
- Frontend: Tag pills on TrackCards, filter bar above TrackLibrary, tag selector in track detail view
- Color palette: 8-12 preset colors that look good on dark backgrounds

**Complexity:** Medium

**Dependencies:** None

**Risks:** Tag management UI needs to be lightweight — don't build a full tag taxonomy. Simple flat list with color dots.

---

### Import/Export Playlists

**What:** Export playlists as JSON (lossless, includes clip data) or M3U (compatible with other players). Import from JSON.

**Why:** Backup, sharing, migration between devices.

**How:**
- **JSON export:** Serialize `PlaylistWithItems` including all track source URLs and clip boundaries. Download as `.roybal.json` via `URL.createObjectURL(new Blob([json]))`
- **JSON import:** Upload `.roybal.json`, validate schema, resolve each `source_url` through `/api/resolve` (skip if already in library), create clips and playlist items
- **M3U export:** Generate M3U with `#EXTINF` lines and source URLs. Clips lose their boundary info (M3U has no concept of clips)
- New endpoints:
  - `GET /api/playlists/{id}/export?format=json` — returns downloadable JSON
  - `POST /api/playlists/import` — accepts JSON upload, returns new playlist

**Complexity:** Medium

**Dependencies:** None

**Risks:**
- Import can be slow if many tracks need to be re-resolved via yt-dlp
- Source URLs may have expired — need error handling for unresolvable tracks
- Duplicate detection: check `source_url` against existing library before creating new tracks

---

### "Continue Where You Left Off"

**What:** Remember the current player state (track, clip, position, queue, playlist) across page reloads.

**Why:** Closing the tab and reopening shouldn't lose your place. Basic UX expectation for any media player.

**How:**
- On every `timeupdate` (throttled to every 5 seconds), save to `localStorage`:
  - `currentTrack.trackId`
  - `currentClip.id` (if any)
  - `currentTimeMs`
  - `currentIndex` in playlist
  - `playlist` item IDs
  - `queue` item IDs
  - `loopMode`
- On app load: read from `localStorage`, fetch full track/playlist data from API, restore state
- Don't auto-play on restore — show a "Resume playback?" prompt or just set up the player silently

**Complexity:** Small

**Dependencies:** None

**Risks:** Stale state if tracks have been deleted. Validate track IDs against the API before restoring.

---

## Technical Infrastructure

### Background Audio Analysis Pipeline

**What:** Run audio analysis (waveform, BPM, fingerprint, segments) as background tasks after caching.

**Why:** Analysis shouldn't block the user from playing a track. Download + play immediately, analyze in the background, update the UI when analysis completes.

**How:**
- Use FastAPI's `BackgroundTasks` for fire-and-forget analysis
- After audio is cached in `audio.py`:
  1. Generate waveform peaks (`audiowaveform` CLI, ~0.5s)
  2. Compute fingerprint (`pyacoustid`, <0.1s)
  3. Extract BPM and beats (`librosa`, ~1.5s)
  4. Compute RMS energy envelope (`librosa`, <0.1s)
  5. Check for duplicates (compare fingerprint against library)
  6. Optionally: run segment detection (~5s)
- New table or columns to store results:
```sql
ALTER TABLE tracks ADD COLUMN bpm REAL;
ALTER TABLE tracks ADD COLUMN fingerprint TEXT;
ALTER TABLE tracks ADD COLUMN analysis_status TEXT DEFAULT 'pending';
-- Separate table for larger data:
CREATE TABLE track_analysis (
  track_id       TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  waveform_peaks TEXT,  -- JSON array
  beat_frames    TEXT,  -- JSON array of beat timestamps in ms
  rms_envelope   TEXT,  -- JSON array (~500 points)
  segments       TEXT,  -- JSON array of {startMs, endMs, type, confidence}
  analyzed_at    TEXT
);
```
- Frontend polls or uses SSE for "analysis complete" notification
- New endpoint: `GET /api/tracks/{trackId}/analysis` returns all analysis data

**Complexity:** Medium

**Dependencies:** `librosa`, `pyacoustid`, `chromaprint`, `audiowaveform`

**Risks:**
- Analysis can fail on corrupted or unusual audio — handle gracefully
- Multiple concurrent analyses could overload CPU — use a semaphore to limit concurrency
- `librosa.load()` at 22050 Hz mono keeps memory reasonable (~21 MB per 4-min track)

---

### Error Recovery (Re-resolve Expired URLs)

**What:** When a cached audio file is missing or corrupted, automatically re-resolve via yt-dlp and re-download.

**Why:** yt-dlp stream URLs expire after hours. If cache is evicted, the stored URL is stale. Currently this fails silently or returns an error.

**How:**
- In `audio.py`, when cache miss occurs:
  1. Current behavior: call `ytdlp_service.download_audio(track.source_url, ...)` — this already re-extracts
  2. Add retry logic: if download fails, wait 1s and retry once (transient network errors)
  3. If still fails, return a clear error to the frontend: `{ error: "source_unavailable", message: "Could not fetch audio. The source may have been removed." }`
- Frontend: show a retry button on the track card and player when playback fails
- Consider a periodic health check: `GET /api/health/cache` that validates cached files exist and are non-zero bytes

**Complexity:** Small

**Dependencies:** None

**Risks:** Retry loops could make things worse if the source is genuinely unavailable. Limit to 1 retry with exponential backoff.

---

### WebSocket / SSE for Real-Time Updates

**What:** Push notifications from backend to frontend for analysis completion, download progress, and error events.

**Why:** Currently the frontend has no way to know when background analysis finishes. Polling is wasteful. SSE (Server-Sent Events) is simpler than WebSocket for one-way server→client communication.

**How:**
- **SSE approach (recommended):** FastAPI supports SSE via `StreamingResponse` with `text/event-stream` content type
- New endpoint: `GET /api/events` — SSE stream
- Events: `analysis_complete`, `download_progress`, `cache_evicted`, `error`
- Frontend: `new EventSource('/api/events')` with event listeners
- Alternative: `WebSocket` via FastAPI's `WebSocket` endpoint — bidirectional, more complex, needed only if the client needs to send messages too

**Complexity:** Medium

**Dependencies:** None (FastAPI supports SSE natively)

**Risks:**
- SSE connections persist — need proper cleanup on client disconnect
- Multiple browser tabs = multiple SSE connections
- Keep event payload small (just IDs and status, not full data)

---

### Service Worker (App Shell Caching)

**What:** Cache the web app shell (HTML, CSS, JS, fonts) for instant loading and basic offline support.

**Why:** First load of a Next.js app can be slow. Service worker caching makes subsequent visits instant.

**How:**
- `npm install @serwist/next @serwist/precaching @serwist/strategies`
- Configure in `next.config.js` with precaching for static assets
- Use `CacheFirst` strategy for static assets, `NetworkFirst` for API calls
- **Do NOT cache audio in the service worker** — Safari has a 50 MB limit for SW cache, making it impractical for audio files
- Audio caching is better handled by the backend's existing disk cache

**Complexity:** Medium

**Dependencies:** `@serwist/next`

**Risks:**
- Service workers can serve stale JS if not configured for proper cache invalidation
- Development mode needs special handling (disable SW in dev)
- Safari iOS limits make audio caching via SW impractical

---

### Download Queue (Background Audio Downloads)

**What:** Queue multiple URLs for resolution and caching, processed sequentially in the background.

**Why:** Currently, each URL resolution blocks the UI until complete. A download queue lets users paste 10 URLs rapidly and let them resolve in the background.

**How:**
- New backend: `download_queue` module with `asyncio.Queue`
- `POST /api/resolve` returns immediately with a `task_id` and status `"queued"`
- Background worker pulls from the queue, resolves, downloads, analyzes
- `GET /api/tasks/{task_id}` returns current status (queued/processing/complete/failed)
- Frontend: show a download manager panel with progress indicators
- Rate limit: process 2-3 downloads concurrently (semaphore) to avoid overwhelming yt-dlp

**Complexity:** Medium

**Dependencies:** None

**Risks:**
- Queue state is lost on server restart — consider persisting to SQLite
- Need to handle cancellation (user removes item from queue)
- yt-dlp concurrent downloads may trigger rate limiting on YouTube

---

## Unique / Creative Features

> These are ideas that go beyond standard music player features and lean into what makes Roybal unique as a clip-based DJ crate tool.

### Vibe Match — Find Similar-Sounding Moments

**What:** Given a clip, find other moments across your entire library that sound similar — not by metadata, but by actual audio content.

**Why:** This is the feature no other music player has. Spotify's "similar songs" uses collaborative filtering. This uses *actual audio similarity*. "Find me other moments that sound like this 8-bar loop" is the dream workflow for sample-based music curation.

**How:**
- Backend: When a track is cached, extract audio features per 500ms window using `librosa`:
  - 13 MFCCs (timbral texture — what it "sounds like")
  - 12 chroma features (harmonic content — what notes are playing)
  - Spectral centroid + rolloff (brightness/energy)
  - Result: ~27-dimensional feature vector per segment
- Index vectors using Spotify's `annoy` library (approximate nearest neighbor search, O(log n) per query, memory-mapped index files)
- Store feature vectors in `track_features` table: `(track_id, offset_ms, feature_vector BLOB)`
- Query: average the feature vectors of a clip's segments → find K nearest neighbors in the index → return matching track+timestamp pairs
- New endpoint: `POST /api/clips/{clipId}/similar` returns `[{trackId, startMs, endMs, similarity}]`

**Complexity:** Large

**Dependencies:** `librosa`, `annoy` (pip), background analysis pipeline

**Risks:**
- Feature extraction adds 5-10s processing per track (must be async/background)
- MFCC similarity captures timbre well but may miss rhythmic or structural similarities
- Annoy index must be rebuilt when tracks are added (but <1s for a personal library of thousands)
- The quality of results depends heavily on feature selection — may need tuning

---

### Clip Chain — Intelligent Clip Sequencing

**What:** Auto-suggest the best ordering for a set of clips based on musical key compatibility, BPM proximity, and energy flow — like a DJ's harmonic mixing but for clip playlists.

**Why:** When you have 20 clips from different songs, putting them in a musically coherent order is hard. Clip Chain does what DJ software does for full tracks, but for clip-length fragments.

**How:**
- Per-clip analysis: detect musical key (Camelot wheel code), BPM, and mean energy
- Key detection: `essentia.KeyExtractor` (more accurate) or `librosa` chromagram → key estimation
- Camelot compatibility: simple lookup table — compatible transitions are same position, ±1 on the wheel, or major/minor switch (e.g., 8A→7A, 8A→9A, 8A→8B)
- Sequencing algorithm: weighted graph where edge weight = key_compatibility × bpm_proximity × energy_flow_score. Greedy nearest-neighbor heuristic works for typical playlist sizes (<50 clips)
- Energy flow modes: "build-up" (ascending energy), "cool-down" (descending), "peak-valley" (alternating), "smooth" (minimize energy jumps)
- Store analysis: `clip_analysis (clip_id, key TEXT, camelot_code TEXT, bpm REAL, energy REAL)`
- New endpoint: `POST /api/playlists/{id}/auto-sequence` reorders playlist items optimally

**Complexity:** Large

**Dependencies:** Key detection (essentia or librosa), BPM detection, energy analysis

**Risks:**
- Key detection on short clips (<10s) is unreliable — mitigate by inheriting key from parent track
- `essentia` installation is complex (C++ dependencies) — consider Docker or fall back to librosa
- The sequencing quality depends on analysis accuracy — garbage in, garbage out

---

### Clip Reactions / Timestamp Annotations

**What:** Private, timestamp-based notes on tracks — like SoundCloud's timed comments but for personal use.

**Why:** When scrubbing through a 10-minute mix looking for clip-worthy moments, you want to drop bookmarks with context: "come back to this," "compare with Track X at 2:30," "potential drop here." Annotations become seeds for clips.

**How:**
- New table:
```sql
CREATE TABLE annotations (
  id           TEXT PRIMARY KEY,
  track_id     TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  timestamp_ms INTEGER NOT NULL,
  note         TEXT,
  emoji        TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
```
- UI: markers on the progress bar at annotated timestamps. Hotkey (e.g., `N`) to add a note at current playback position. Floating bubbles or side panel list.
- Quick-create flow: press hotkey → annotation created at current time → type note inline → Enter to save
- Annotation types: free text, "potential clip" (auto-creates a clip ±5s around the timestamp), "key change," "beat drop"
- Export: `GET /api/tracks/{id}/annotations/export` → Markdown with timestamps

**Complexity:** Small

**Dependencies:** None

**Risks:** None meaningful — straightforward CRUD. UX design matters more than implementation.

---

### Mood Journey — Playlist Energy Curve

**What:** Visualize a playlist's energy flow as a curve chart — see where the energy peaks, dips, and transitions.

**Why:** Helps users identify "dead spots" in their clip playlists and build intentional energy arcs. A DJ's most important skill is energy management — this visualizes it.

**How:**
- Backend: for each track/clip, compute mean RMS energy (`librosa.feature.rms`) and spectral centroid (brightness)
- Downsample to 1 value per clip/track for the playlist view
- New endpoint: `GET /api/playlists/{id}/energy-curve` returns `[{position, trackId, energy, brightness}]`
- Frontend: area chart or line chart with `recharts` (~200KB) or custom Canvas
  - X-axis: playlist position
  - Y-axis: normalized energy (0-1)
  - Color gradient: cool→warm mapping energy levels
  - Interactive: hover for track info, click to jump, drag to reorder and see curve update

**Complexity:** Medium

**Dependencies:** `librosa` (backend), `recharts` or Canvas (frontend), energy analysis pipeline

**Risks:** `recharts` adds ~200KB to bundle — justified if the visualization is a core feature. Alternative: custom Canvas for lighter weight.

---

### A/B Compare — Side-by-Side Clip Comparison

**What:** Play two clips simultaneously with instant A/B switching to compare them. Toggle instantly between audio A and audio B.

**Why:** Core DJ workflow: "which version of this section sounds better?" "Is the YouTube or SoundCloud version higher quality?" No consumer music player has A/B comparison — only DAWs and DJ software.

**How:**
- Web Audio API: two audio sources sharing one destination, each with its own GainNode
- A/B toggle: `gainA.gain.value = 1, gainB.gain.value = 0` (or vice versa) — instant, within one audio frame (~0.02ms)
- Sync modes:
  - Time-aligned: both play from same relative position (for comparing versions of the same section)
  - Free-running: each from its own start (for comparing different sections)
  - Looping: both loop within their clip boundaries
- UI: two clip selectors + prominent A/B toggle button (keyboard shortcut: `Tab`)
- Both waveforms displayed stacked, active one highlighted

**Complexity:** Medium

**Dependencies:** Web Audio API integration

**Risks:** Both clips loaded as AudioBuffers in memory simultaneously — fine for short clips, potentially ~100MB each for full 10-minute tracks. Add a length limit or warn for long audio.

---

### Tempo Tap — Manual BPM Override

**What:** Tap a button to the beat → calculate BPM from tap intervals. Override auto-detected BPM when the algorithm gets it wrong.

**Why:** Auto BPM detection is notoriously bad for half-time (dubstep reads as 70 instead of 140), complex time signatures, and genres without clear beats. Every DJ tool has manual BPM tap — Roybal should too.

**How:**
- Pure frontend, zero dependencies
- Record timestamps of each tap → compute mean interval → `BPM = 60000 / mean_interval_ms`
- Moving window of last 8-12 taps for stability
- Discard outliers (>30% deviation from mean)
- Show live BPM as user taps, "Save" button after 4+ taps
- Display both auto-detected and tapped BPM; let user choose which is active
- Show N and 2N as options (handles half-time/double-time confusion)

**Complexity:** Small (2-hour implementation)

**Dependencies:** None

**Risks:** None. This is trivially implementable and universally useful.

---

### Stems Separation — Isolate Vocals, Drums, Bass, Other

**What:** Use Meta's Demucs model to separate a track into 4 stems: vocals, drums, bass, other. Create clips from individual stems.

**Why:** Stems + clips is genuinely novel. "Clip the drum break from Track A, clip the vocal from Track B, sequence them" — this is sample-based production workflow in a playlist player.

**How:**
- `pip install demucs` (pulls in PyTorch — ~700MB-2GB dependency)
- New endpoint: `POST /api/tracks/{trackId}/separate` → runs Demucs → saves 4 stems to `~/.roybal/stems/{trackId}/`
- Models: `htdemucs` (default, good quality) or `htdemucs_ft` (fine-tuned, better but 4x slower)
- Performance: ~10s GPU, ~5-7 min CPU per 4-minute track
- Stems become playable audio sources — clip editor can switch between full mix and individual stems
- Frontend: stem solo/mute toggles in clip editor

**Complexity:** Large

**Dependencies:** `demucs`, `torch`, `torchaudio` (massive dependency chain)

**Risks:**
- PyTorch triples the backend dependency footprint. Consider making it optional: `pip install roybal[stems]`
- CPU-only processing is painfully slow. Apple Silicon Macs can use MPS (Metal) for ~3x speedup
- Disk space: 4 stems ≈ 4× the original file size per track
- This is a v2 feature — don't prioritize over infrastructure

---

### URL Watch — Monitor Channels for New Uploads

**What:** Watch a YouTube channel or playlist for new uploads, auto-add them to a Roybal playlist.

**Why:** Turns Roybal from "pull" (paste URLs) to "push" (content comes to you). A DJ following a rare samples channel gets new uploads auto-added to their crate.

**How:**
- New tables:
```sql
CREATE TABLE watched_sources (
  id                   TEXT PRIMARY KEY,
  url                  TEXT NOT NULL,
  label                TEXT,
  last_checked         TEXT,
  target_playlist_id   TEXT REFERENCES playlists(id),
  check_interval_min   INTEGER DEFAULT 60,
  created_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE watched_source_items (
  id                TEXT PRIMARY KEY,
  watched_source_id TEXT NOT NULL REFERENCES watched_sources(id),
  video_id          TEXT NOT NULL,
  first_seen        TEXT DEFAULT (datetime('now')),
  resolved          BOOLEAN DEFAULT 0,
  UNIQUE(watched_source_id, video_id)
);
```
- Polling: `yt_dlp.extract_info(url, download=False)` with `extract_flat='in_playlist'` returns video IDs in seconds
- Compare against known IDs → new videos → auto-resolve → add to target playlist
- Scheduling: `apscheduler` (AsyncIOScheduler) for in-process periodic checks
- UI: "Watched Sources" panel — add channel/playlist URL, set target playlist, set check interval

**Complexity:** Medium

**Dependencies:** `apscheduler` (pip)

**Risks:**
- YouTube rate-limits aggressive polling — 60-minute intervals are safe, 5-minute intervals risk blocks
- First-run on a large channel fetches entire history — use `playlistend` limit
- Background scheduling adds complexity around error handling and server restarts

---

### Sample Hunter — Discover Sample Origins

**What:** Given a track, look up where its samples come from (via WhoSampled metadata) or identify unknown tracks (via audio fingerprinting).

**Why:** Knowing that the loop you clipped comes from a 1972 soul record adds a discovery dimension. You could clip the original source too.

**How:**
- **Metadata path (feasible):** Query WhoSampled API (available on RapidAPI) with track title/artist → get sample relationships. Display: "This track samples [Original] at [timestamp]"
- **Fingerprint path (adds identification):** Use `shazamio` (async Python Shazam wrapper) or `pyacoustid` to identify unknown tracks → then look up on WhoSampled
- New endpoint: `GET /api/tracks/{trackId}/samples` returns sample relationships

**Complexity:** Medium (metadata), Large (fingerprint-based)

**Dependencies:** WhoSampled API (third-party, availability uncertain), optionally `shazamio`

**Risks:**
- WhoSampled has no official public API — the RapidAPI listing is a third-party wrapper
- Audio fingerprinting identifies *whole tracks*, not samples within tracks
- True sample detection (matching audio fragments) is an unsolved problem at the consumer level
- **Verdict:** Metadata lookup is feasible and useful. Audio fragment matching is research-grade.

---

## Audio Format & Streaming Deep Dive

### Browser Audio Format Compatibility

| Format | Chrome | Firefox | Edge | Safari (macOS) | Safari (iOS) |
|--------|--------|---------|------|----------------|--------------|
| MP3 | Yes | Yes | Yes | Yes | Yes |
| M4A/AAC | Yes | Yes | Yes | Yes | Yes |
| WebM/Opus | Yes | Yes | Yes | 18.4+* | 18.4+* |
| Ogg/Vorbis | Yes | Yes | Yes | 18.4+ | 18.4+ |

\*Safari gained full Opus-in-WebM support in 18.4. Older versions have documented bugs (WebKit bug 238546).

**What yt-dlp downloads from YouTube:** With `"bestaudio/best"`, YouTube's format 251 (Opus/WebM ~160kbps VBR) typically wins over format 140 (AAC/M4A 128kbps) because yt-dlp's codec preference ranks Opus above AAC.

**Recommendation:** Don't transcode — lossy→lossy transcoding always degrades quality. Serve the native format. If Safari Opus bugs become an issue, change `_BASE_OPTS` in `ytdlp_service.py` to `"format": "bestaudio[ext=m4a]/bestaudio/best"` to prefer M4A/AAC.

### Seeking Requirements

- **WebM:** Needs Cues element (seek table) → YouTube-served WebM files have this. Your Range header support is sufficient.
- **M4A:** Needs moov atom at file start ("faststart") → YouTube and yt-dlp files have this. If you ever transcode with ffmpeg, add `-movflags +faststart`.
- **MP3:** Seeking works with Range headers natively.

Your current `audio.py` Range header implementation is correct for all formats. No changes needed.

### Quality Tiers by Source

| Source | Format | Bitrate | Quality |
|--------|--------|---------|---------|
| YouTube (251) | Opus/WebM | ~160kbps VBR | Good |
| YouTube (140) | AAC/M4A | 128kbps CBR | Good |
| SoundCloud (free) | MP3 | 128kbps | Acceptable |
| Bandcamp (free) | MP3 | 128kbps | Acceptable |
| YouTube Music Premium | Opus/AAC | 256kbps | Great |

All tiers are transparent or near-transparent for casual listening. 128kbps in any modern codec is fine for a personal music player.

### Why NOT to Stream While Downloading

Current behavior (download fully → serve from cache) is correct for Roybal because:
1. Streaming breaks seeking (no `Content-Length`, no Range requests)
2. Clip playback depends on seeking to `startMs` — this fails on partial downloads
3. yt-dlp downloads are fast (few seconds for a typical track)
4. The architecture stays simple

### Gapless Playback & Format Gaps

- MP3 has inherent encoder delay (~13-26ms of silence at start/end) that HTML5 `<audio>` doesn't trim
- Opus is truly gapless (pre-skip header handles it)
- For Roybal, this doesn't matter: your `timeupdate` clip boundary detection already has ~250ms imprecision, dwarfing any codec-level gap
- Cross-track gaps in playlists are caused by loading a new audio source (~100-500ms), not by codecs

### MIME Type Improvement

Your `_EXT_TO_MIME` mapping in `audio.py` is reliable. One suggestion: change the fallback on line 38 from `"audio/webm"` to `"application/octet-stream"` — if an unknown extension appears, letting the browser content-sniff is safer than claiming WebM when it might be M4A.

---

## Priority Matrix

### Tier 1: High Impact, Low-Medium Effort (Do First)

| Feature | Impact | Effort | Why |
|---------|--------|--------|-----|
| MediaSession API | Very High | Small | OS controls, lock screen, media keys — instant UX win |
| Keyboard shortcuts | High | Small | Power user essential, ~1 hour with react-hotkeys-hook |
| Playback speed control | High | Small | One line: `audio.playbackRate = x` |
| Tempo Tap | Medium | Small | 2-hour implementation, universally useful BPM override |
| Clip Reactions / Annotations | High | Small | Straightforward CRUD, high curation value |
| Drag-and-drop URL | Medium | Small | Native API, 30 min implementation |
| Play history | Medium | Small | One table, two endpoints, useful data |
| "Continue where you left off" | Medium | Small | localStorage, 30 min |
| In-app search | High | Medium | yt-dlp already supports it, just needs a UI |

### Tier 2: High Impact, Medium Effort (Do Next)

| Feature | Impact | Effort | Why |
|---------|--------|--------|-----|
| Web Audio API integration | Very High | Medium | Foundation for crossfade, EQ, visualization, A/B compare |
| Waveform visualization | High | Medium | Makes clip editor 10x more usable |
| Queue system | High | Medium | Expected feature, extends PlayerContext |
| BPM detection | Medium | Medium | Enables smart features, cool data to display |
| Audio fingerprinting | Medium | Small | Duplicate detection + metadata enrichment |
| Audio normalization | High | Medium | Fixes the #1 annoyance: volume jumps between sources |
| Track tags | Medium | Medium | Organization for growing libraries |
| A/B Compare | High | Medium | Core DJ workflow, needs Web Audio API |
| Mood Journey (energy curve) | Medium | Medium | Unique playlist visualization, needs librosa |

### Tier 3: Medium Impact, Medium-Large Effort (When Ready)

| Feature | Impact | Effort | Why |
|---------|--------|--------|-----|
| Crossfade / gapless playback | High | Medium | DJ-crate experience upgrade |
| Auto-segment detection | High | Large | Killer feature but complex |
| URL Watch (channel monitoring) | Medium | Medium | Turns pull→push, great for crate-diggers |
| Spotify URL support | Medium | Medium | Convenient but workaround exists (search YouTube) |
| Import/export playlists | Medium | Medium | Backup/sharing |
| Background analysis pipeline | Medium | Medium | Enables waveform, BPM, fingerprint |
| Mobile responsive | Medium | Medium | Important if using on phone |
| Smart playlists | Medium | Medium | Cool but needs BPM/tags first |
| Clip Chain (auto-sequencing) | High | Large | Needs key detection + BPM + energy analysis first |

### Tier 4: Fun / Future / Experimental

| Feature | Impact | Effort | Why |
|---------|--------|--------|-----|
| Vibe Match (audio similarity) | Very High | Large | Flagship unique feature, needs analysis infrastructure |
| EQ / audio effects | Low | Medium | Nice-to-have, not critical |
| Audio visualizer (canvas) | Low | Medium | Fun, not functional |
| Butterchurn Milkdrop | Low | Large | Nostalgia factor, heavy bundle |
| Loop builder / mashup mode | Medium | Large | Essentially a mini-DAW |
| Stems separation (Demucs) | High | Very Large | Novel but massive PyTorch dependency |
| Sample Hunter | Medium | Medium | WhoSampled API availability uncertain |
| Time Warp (pitch shift) | Medium | Medium | Needs Web Audio refactor + key detection |
| Service worker (app shell) | Low | Medium | Performance optimization |
| Unsupported platform fallback | Low | Medium | Edge case |
| SSE for real-time updates | Low | Medium | Only needed with background analysis |
| Download queue | Low | Medium | Only needed for bulk imports |

---

## Recommended Implementation Order

**Phase 1 — Quick Wins (1-2 days)**
1. MediaSession API (lock screen, media keys, browser notification)
2. Keyboard shortcuts (react-hotkeys-hook)
3. Playback speed control (one-line `playbackRate`)
4. Drag-and-drop URL (native HTML5 API)
5. "Continue where you left off" (localStorage)
6. Tempo Tap (manual BPM override)

**Phase 2 — Audio Foundation (3-5 days)**
7. Web Audio API integration (MediaElementSource → AnalyserNode → GainNode → destination)
8. Audio normalization (ffmpeg loudnorm in cache step)
9. BPM detection (librosa in background task)
10. Audio fingerprinting + duplicate detection (pyacoustid)
11. Clip Reactions / Annotations (timestamp notes)

**Phase 3 — Visual & Discovery (3-5 days)**
12. Waveform peak generation (audiowaveform CLI)
13. Waveform visualization in clip editor
14. Waveform progress bar in player
15. In-app search (YouTube, SoundCloud, YouTube Music)
16. Play history + most played

**Phase 4 — Playlist Intelligence (3-5 days)**
17. Queue system (play next / add to queue)
18. Track tags (with auto-tagging from yt-dlp metadata)
19. Auto-segment detection (energy-based, then repetition-based)
20. Crossfade / gapless playback
21. Mood Journey energy curve visualization

**Phase 5 — DJ Features (3-5 days)**
22. A/B Compare (side-by-side clip comparison)
23. Smart playlists (rule-based auto-generation)
24. Clip Chain (harmonic sequencing)
25. URL Watch (channel monitoring)

**Phase 6 — Polish & Expansion (ongoing)**
26. Spotify URL support (metadata → YouTube matching)
27. Mobile responsive improvements (vaul bottom sheet, swipe gestures)
28. Import/export playlists (JSON + M3U)
29. Audio visualizer (canvas, then optionally Butterchurn)
30. EQ / effects panel

**Phase 7 — Ambitious / v2 (when everything else is solid)**
31. Vibe Match (cross-library audio similarity search)
32. Stems separation (Demucs)
33. Time Warp (pitch-shifting for key matching)
34. Sample Hunter (WhoSampled integration)
35. Loop builder / mashup mode

---

## Implementation Blueprints (Top Priority Features)

Detailed file-level blueprints for the Phase 1 features, grounded in the actual codebase.

### Blueprint: MediaSession API

**Files to modify:** `frontend/src/lib/PlayerContext.tsx`

Add a `useEffect` after line 191 (after the timeupdate/ended listeners):

```typescript
useEffect(() => {
  if (!('mediaSession' in navigator)) return;
  if (!currentTrack) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: currentClip ? currentClip.label : currentTrack.title || 'Unknown',
    artist: currentClip ? currentTrack.title || '' : currentTrack.artist || '',
    album: 'Roybal',
    artwork: currentTrack.thumbnailUrl
      ? [{ src: currentTrack.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });

  navigator.mediaSession.setActionHandler('play', () => togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) seek(details.seekTime * 1000);
  });
}, [currentTrack, currentClip, togglePlay, pause, prev, next, seek]);

useEffect(() => {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}, [isPlaying]);

useEffect(() => {
  if (!('mediaSession' in navigator) || !currentTrack) return;
  navigator.mediaSession.setPositionState({
    duration: durationMs / 1000,
    playbackRate: 1,
    position: currentTimeMs / 1000,
  });
}, [currentTimeMs, durationMs, currentTrack]);
```

No new files, no dependencies, ~30 lines of code.

---

### Blueprint: Keyboard Shortcuts

**Install:** `npm install react-hotkeys-hook`

**Files to modify:** `frontend/src/lib/PlayerContext.tsx` (add hooks inside `PlayerProvider`)

Add after the MediaSession effects:

```typescript
import { useHotkeys } from 'react-hotkeys-hook';

// Inside PlayerProvider:
useHotkeys('space', (e) => { e.preventDefault(); togglePlay(); }, [togglePlay]);
useHotkeys('left', () => seek(Math.max(0, currentTimeMs - 5000)), [currentTimeMs, seek]);
useHotkeys('right', () => seek(currentTimeMs + 5000), [currentTimeMs, seek]);
useHotkeys('shift+left', () => prev(), [prev]);
useHotkeys('shift+right', () => next(), [next]);
useHotkeys('m', () => { if (audioRef.current) audioRef.current.muted = !audioRef.current.muted; });
useHotkeys('l', () => {
  const modes: LoopMode[] = ['none', 'track', 'playlist'];
  const idx = modes.indexOf(loopMode);
  setLoopMode(modes[(idx + 1) % modes.length]);
}, [loopMode]);
```

Optionally add a `KeyboardShortcutsModal` component triggered by `useHotkeys('shift+/', ...)`.

---

### Blueprint: Playback Speed Control

**Files to modify:**
- `frontend/src/lib/PlayerContext.tsx` — add `playbackRate` state and setter to context
- `frontend/src/components/Player.tsx` — add speed selector button

In PlayerContext, add:
```typescript
const [playbackRate, setPlaybackRate] = useState(1);

useEffect(() => {
  if (audioRef.current) audioRef.current.playbackRate = playbackRate;
}, [playbackRate]);
```

Expose `playbackRate` and `setPlaybackRate` in the context value.

In Player.tsx, add a clickable button that cycles through `[0.5, 0.75, 1, 1.25, 1.5, 2]` and displays the current speed (e.g., "1x", "1.5x").

---

### Blueprint: Web Audio API Integration

**Files to modify:** `frontend/src/lib/PlayerContext.tsx`

This is the most impactful infrastructure change. Add to `PlayerProvider`:

```typescript
const audioCtxRef = useRef<AudioContext | null>(null);
const analyserRef = useRef<AnalyserNode | null>(null);
const gainRef = useRef<GainNode | null>(null);
const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

// Initialize on first play (requires user gesture):
const ensureAudioContext = useCallback(() => {
  if (audioCtxRef.current) return;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const gain = ctx.createGain();

  const source = ctx.createMediaElementSource(audioRef.current!);
  source.connect(analyser);
  analyser.connect(gain);
  gain.connect(ctx.destination);

  audioCtxRef.current = ctx;
  analyserRef.current = analyser;
  gainRef.current = gain;
  sourceRef.current = source;
}, []);
```

Call `ensureAudioContext()` at the start of `loadAndPlay` and `togglePlay`. Expose `analyserRef` in the context for visualization components to consume.

**Critical note:** The `MediaElementSource` binding is permanent — once connected, you cannot disconnect it. The `AudioContext` should be created once and reused for the lifetime of the page.

---

### Blueprint: Background Analysis Pipeline (Backend)

**New files:**
- `backend/app/services/analysis.py` — librosa-based audio analysis
- `backend/app/routers/analysis.py` — new API endpoints

**Files to modify:**
- `backend/app/db.py` — add `track_analysis` table to schema
- `backend/app/routers/audio.py` — trigger background analysis after caching
- `backend/requirements.txt` — add `librosa`, `pyacoustid`

**System installs needed:** `brew install chromaprint audiowaveform`

New table in `db.py`:
```sql
CREATE TABLE IF NOT EXISTS track_analysis (
  track_id       TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  bpm            REAL,
  fingerprint    TEXT,
  waveform_peaks TEXT,
  rms_envelope   TEXT,
  beat_frames    TEXT,
  segments       TEXT,
  status         TEXT DEFAULT 'pending',
  analyzed_at    TEXT
);
```

`analysis.py` service:
```python
async def analyze_track(track_id: str, audio_path: str, db_path: str):
    """Run in background after caching. Updates track_analysis table."""
    # 1. Waveform peaks (audiowaveform CLI, ~0.5s)
    # 2. Fingerprint (acoustid.fingerprint_file, <0.1s)
    # 3. Load audio (librosa.load at 22050 Hz mono, ~0.5s)
    # 4. BPM + beats (librosa.beat.beat_track, ~1.5s)
    # 5. RMS envelope (librosa.feature.rms, <0.1s)
    # 6. Duplicate check (compare fingerprint, <0.1s)
    # Total: ~3-4 seconds per track
```

Trigger from `audio.py` after `cache_manager.register()`:
```python
from fastapi import BackgroundTasks
background_tasks.add_task(analyze_track, track_id, str(actual_path), DB_PATH)
```

New endpoints:
- `GET /api/tracks/{trackId}/analysis` — returns analysis results (or status: "pending")
- `GET /api/tracks/{trackId}/waveform` — returns just the waveform peaks JSON

---

### Blueprint: Waveform in Clip Editor

**Files to modify:** `frontend/src/components/ClipEditor.tsx`

Replace the flat progress bar (currently a simple div with click-to-seek) with a Canvas-based waveform renderer:

1. Fetch waveform data: `GET /api/tracks/{trackId}/waveform` → array of peak values
2. Draw on a `<canvas>` element sized to the editor width
3. For each data point, draw a vertical line proportional to the peak value
4. Two-tone rendering: played portion in emerald-500, unplayed in zinc-700
5. Overlay clip region with emerald-500/10 tint between start/end markers
6. Clip boundary markers (green IN, red OUT) drawn on top of the waveform
7. Click-to-seek: translate click X position to time position

The `ClipEditor.tsx` already has a progress bar with markers at lines ~115-185. Replace that section with a Canvas component that renders peaks data.

---

### New Dependencies Summary

**Backend (pip):**
| Package | Purpose | Size |
|---------|---------|------|
| `librosa` | BPM, beats, RMS, segments | ~30 MB (+ numpy, scipy) |
| `pyacoustid` | Audio fingerprinting | ~50 KB (+ chromaprint system lib) |
| `pyloudnorm` | Loudness measurement | ~100 KB |
| `apscheduler` | URL Watch scheduling | ~200 KB |

**System (brew):**
| Package | Purpose |
|---------|---------|
| `chromaprint` | Audio fingerprinting C library |
| `audiowaveform` | Waveform peak generation |

**Frontend (npm):**
| Package | Purpose | Bundle Size |
|---------|---------|-------------|
| `react-hotkeys-hook` | Keyboard shortcuts | ~3.5 KB gzipped |
| `recharts` | Energy curve charts | ~200 KB (optional) |
| `vaul` | Mobile bottom sheet | ~4 KB |
| `react-swipeable` | Mobile swipe gestures | ~1.5 KB |
| `wavesurfer.js` | Waveform display (optional) | ~15 KB |

Total frontend bundle increase for Phase 1-3: ~5 KB (just react-hotkeys-hook and maybe vaul). The heavier libraries (recharts, wavesurfer) are optional and can be loaded on demand.
