# Roybal — System Design Document

> A universal music player with clip-aware playlists.

---

## Problem Statement

Music discovery happens across platforms (YouTube, TikTok, Spotify, SoundCloud), but no single player unifies them. Additionally, users often want to replay specific **segments** of songs — not full tracks — but every platform forces you to listen to the entire thing.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Source** | A URL pointing to audio on any supported platform (YouTube, TikTok, SoundCloud, etc.) |
| **Track** | Resolved audio from a Source — includes metadata (title, artist, duration, thumbnail). A track is the full audio from a source, whether that's a 4-minute YouTube video or a 20-second TikTok. |
| **Clip** | A user-defined sub-segment of a Track: `{ trackId, startMs, endMs, label }`. Clips are optional — they only exist when you want a piece of a track, not the whole thing. |
| **Playlist** | An ordered collection of **playlist items**, where each item is either a full Track or a Clip. |

The key insight: **playlists hold both tracks and clips as first-class items.** You decide whether to add the full song or just the part you like. A TikTok import that's already 20 seconds long is just a short track — you'd only create a clip if you wanted an even smaller piece of it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND                        │
│              (Next.js / React)                   │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ URL Input│ │ Player   │ │ Clip Editor      │ │
│  │ + Search │ │ Controls │ │ (timestamps/tap) │ │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘ │
│       │             │               │            │
│  ┌────┴─────────────┴───────────────┴──────────┐ │
│  │           Playlist Manager                  │ │
│  └─────────────────┬───────────────────────────┘ │
└────────────────────┼─────────────────────────────┘
                     │ REST API
┌────────────────────┼─────────────────────────────┐
│                  BACKEND                         │
│              (FastAPI / Python)                   │
│                                                  │
│  ┌──────────────┐  ┌────────────┐  ┌───────────┐│
│  │ Source       │  │ Audio      │  │ Search    ││
│  │ Resolver     │  │ Cache      │  │ Proxy     ││
│  │ (yt-dlp)    │  │ (LRU disk) │  │ (yt-dlp)  ││
│  └──────┬───────┘  └──────┬─────┘  └───────────┘│
│         │                 │                      │
│         ▼                 ▼                      │
│  ┌──────────────────────────────────────────────┐│
│  │         Local File Cache (~/.roybal/)        ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
                     │
              ┌──────┴───────┐
              │    SQLite    │
              │  (roybal.db) │
              │  tracks      │
              │  clips       │
              │  playlists   │
              └──────────────┘
```

---

## Data Models (SQLite)

### `tracks`
```sql
CREATE TABLE IF NOT EXISTS tracks (
  id            TEXT PRIMARY KEY,            -- UUID generated in app code
  source_url    TEXT NOT NULL UNIQUE,        -- original URL (YouTube, TikTok, etc.)
  platform      TEXT NOT NULL,               -- 'youtube' | 'tiktok' | 'soundcloud' | etc.
  title         TEXT,
  artist        TEXT,
  thumbnail_url TEXT,
  duration_ms   INTEGER,
  audio_hash    TEXT,                        -- SHA256 of cached audio file (null if not cached)
  cached_at     TEXT,                        -- ISO 8601 timestamp
  last_played   TEXT,                        -- for LRU eviction
  created_at    TEXT DEFAULT (datetime('now'))
);
```

### `clips`
```sql
CREATE TABLE IF NOT EXISTS clips (
  id         TEXT PRIMARY KEY,
  track_id   TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,                 -- user-defined name, e.g. "drop at 1:32"
  start_ms   INTEGER NOT NULL DEFAULT 0,
  end_ms     INTEGER,                       -- null = play to end of track
  created_at TEXT DEFAULT (datetime('now'))
);
```

### `playlists`
```sql
CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

### `playlist_items` (junction table)
```sql
CREATE TABLE IF NOT EXISTS playlist_items (
  id          TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  clip_id     TEXT REFERENCES clips(id) ON DELETE SET NULL,  -- null = full track, set = play clip segment
  position    INTEGER NOT NULL,
  UNIQUE(playlist_id, position)
);
```

> **How it works:** Every playlist item points to a track. If `clip_id` is null, the player plays the full track. If `clip_id` is set, the player uses the clip's start/end boundaries. This keeps the model simple — the player just checks: "is there a clip? if yes, use its boundaries; if no, play start to finish."

---

## API Routes (FastAPI)

### Source Resolution
```
POST /api/resolve
Body: { "url": "https://youtube.com/watch?v=..." }
Returns: { trackId, title, artist, durationMs, thumbnailUrl, audioStreamUrl }
```
- Uses `yt-dlp` to extract metadata + audio stream URL
- Creates/updates `tracks` row in SQLite
- If audio is already cached, returns local cached URL instead

### Audio Streaming
```
GET /api/audio/{track_id}
Returns: Audio stream (with Range header support for seeking)
```
- If cached → serve from disk
- If not cached → fetch via yt-dlp, stream to client, simultaneously write to cache
- Update `last_played` timestamp

### Search
```
GET /api/search?q=lofi+hip+hop&platform=youtube
Returns: [{ url, title, artist, thumbnailUrl, durationMs }]
```
- Proxies search to yt-dlp's search functionality
- MVP: YouTube search only (yt-dlp supports `ytsearch:`)

### CRUD (Clips & Playlists)
```
POST   /api/clips              — create a clip
GET    /api/clips               — list all clips
PATCH  /api/clips/{id}          — update start/end/label
DELETE /api/clips/{id}          — delete a clip

POST   /api/playlists           — create playlist
GET    /api/playlists           — list playlists
GET    /api/playlists/{id}      — get playlist with items (tracks + clips)
POST   /api/playlists/{id}/items — add track or clip to playlist
PATCH  /api/playlists/{id}/items — reorder items
DELETE /api/playlists/{id}/items/{item_id} — remove item
```

---

## Caching Strategy

**Hybrid approach — "lazy download with LRU eviction"**

```
First Play:
  1. yt-dlp extracts fresh audio stream URL
  2. Backend streams audio to client
  3. Simultaneously writes audio to ~/.roybal/cache/{audio_hash}.webm
  4. Updates tracks.audio_hash and tracks.cached_at

Subsequent Plays:
  1. Check if cached file exists on disk
  2. If yes → serve directly (fast, no network)
  3. If no → re-resolve via yt-dlp (URL expired or cache evicted)

Eviction:
  - Configurable max cache size (default: 2GB)
  - LRU based on tracks.last_played
  - Background job checks cache size periodically
  - Evicts least-recently-played tracks until under limit
```

---

## Frontend Component Tree (React)

```
<App>
  ├── <Header />
  ├── <AddTrack />              — URL paste input + search bar
  ├── <TrackLibrary />          — grid/list of all resolved tracks
  │   └── <TrackCard />         — thumbnail, title, artist, "create clip" button
  ├── <ClipEditor />            — timestamp inputs, tap-to-mark, label
  │   ├── <ProgressBar />       — draggable playhead with start/end markers
  │   └── <TimestampInputs />   — manual ms input fields
  ├── <PlaylistSidebar />       — list of playlists
  │   └── <PlaylistView />      — ordered items (tracks + clips), drag to reorder
  └── <Player />                — persistent bottom bar
      ├── <NowPlaying />        — clip label, track info, thumbnail
      ├── <PlaybackControls />  — play/pause, prev/next clip, loop
      └── <ProgressBar />       — shows clip boundaries, seek within clip
```

---

## MVP Feature Scope

### In Scope (v0.1)
- [x] Paste a URL → resolve track metadata
- [x] Play full track audio via backend stream
- [x] Create clips with manual start/end timestamps
- [x] Tap-to-mark: play track, tap "start" and "stop" to set boundaries
- [x] Create playlists of tracks and/or clips
- [x] Player respects clip boundaries (seek to start, stop at end)
- [x] Loop current clip
- [x] Next/prev item in playlist
- [x] Hybrid caching (lazy download + LRU eviction)
- [x] YouTube support via yt-dlp

### Out of Scope (future)
- [ ] Waveform visualization
- [ ] In-app search (YouTube, SoundCloud, etc.)
- [ ] User auth (Supabase Auth)
- [ ] Mobile-optimized responsive design
- [ ] Crossfade between clips
- [ ] Keyboard shortcuts
- [ ] Import/export playlists
- [ ] Offline playback (service worker)
- [ ] Multi-user / sharing

---

## Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 14 (App Router) | You know it, fast iteration, SSR optional |
| Styling | Tailwind CSS | Rapid UI, consistent design tokens |
| Backend | FastAPI (Python) | yt-dlp is Python-native, async streaming support |
| Audio extraction | yt-dlp | Best-in-class, supports 1000+ sites |
| Database | SQLite (MVP) | Zero config, migrate to Supabase later |
| Audio cache | Local disk (LRU) | Simple, no cloud storage costs for MVP |
| Deployment (MVP) | Local dev (both services) | No infra cost, iterate fast |

---

## Open Questions / Risks

1. **Legal gray area**: yt-dlp audio extraction lives in a legal gray zone. For personal use this is generally fine, but worth noting if this ever becomes a product.
2. **yt-dlp reliability**: YouTube frequently changes their API. yt-dlp updates often, but there will be occasional breakage. Pin to a known-good version and update intentionally.
3. **Audio format consistency**: Different platforms serve different codecs (webm/opus, m4a/aac, mp3). The backend should normalize to a single format (suggestion: opus in webm container — small files, good quality).
4. **TikTok extraction**: TikTok is notoriously aggressive with anti-scraping. yt-dlp supports it but it breaks frequently. May need fallback strategies.

---

## Next Steps

1. **Scaffold the monorepo** — `/frontend` (Next.js) + `/backend` (FastAPI)
2. **Implement the Source Resolver** — POST /api/resolve with yt-dlp
3. **Build the Player component** — HTML5 Audio with clip boundary enforcement
4. **Wire up SQLite** — tracks, clips, playlists tables (aiosqlite, auto-create on startup)
5. **Build the Clip Editor** — timestamp inputs + tap-to-mark
6. **Add caching layer** — lazy download + LRU eviction
7. **Polish the playlist UX** — drag-to-reorder, loop modes
