# CLAUDE.md — Roybal

## What Is This?

Roybal is a **universal music player with clip-aware playlists** — a personal tool built by Ian to solve two real problems:

1. **Platform fragmentation**: Music discovery happens across YouTube, TikTok, Spotify, SoundCloud, etc., but no single player unifies them. A remixed song found on TikTok might only exist on YouTube. Roybal lets you pull audio from any platform into one library.

2. **Granularity mismatch**: Platforms serve full tracks, but sometimes you only want a specific 20-second section of a song (the drop, the chorus, a vibe). Roybal lets you create "clips" — sub-segments of tracks — and add them to playlists alongside full tracks.

Think of it as a DJ crate where every "record" can be a full song or just the part you love, sourced from anywhere on the internet.

## System Design

Read `docs/system-design.md` for the full technical spec including:
- Architecture diagram
- Data models (SQLite)
- API routes (FastAPI)
- Caching strategy (hybrid lazy-download + LRU)
- Frontend component tree

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Backend**: FastAPI (Python) — yt-dlp is Python-native
- **Database**: SQLite (local, zero-config for MVP — migrate to Supabase later)
- **Audio extraction**: yt-dlp
- **Audio cache**: Local disk with LRU eviction

## Project Structure

```
roybal/
├── CLAUDE.md              ← you are here
├── docs/
│   └── system-design.md   ← full technical spec
├── frontend/              ← Next.js app
│   ├── src/
│   │   ├── app/           ← App Router pages
│   │   ├── components/    ← React components
│   │   ├── hooks/         ← custom hooks (usePlayer, useClipEditor, etc.)
│   │   ├── lib/           ← API client, Supabase client, utils
│   │   └── types/         ← TypeScript types
│   ├── package.json
│   └── tailwind.config.ts
├── backend/               ← FastAPI app
│   ├── app/
│   │   ├── main.py        ← FastAPI app entry
│   │   ├── routers/       ← route handlers (resolve, audio, clips, playlists)
│   │   ├── services/      ← business logic (yt-dlp wrapper, cache manager)
│   │   ├── models/        ← Pydantic schemas
│   │   └── db.py          ← SQLite client (aiosqlite)
│   ├── requirements.txt
│   └── .env.example
└── roybal.db              ← SQLite database (gitignored)
```

## Core Concepts

- **Track**: Resolved audio from any URL. A track is the full audio — whether that's a 4-minute YouTube video or a 20-second TikTok. The source URL is always stored as a "recipe" to re-fetch audio if the cache is evicted.
- **Clip**: A user-defined sub-segment of a track (`startMs`, `endMs`, `label`). Clips are optional — they only exist when the user wants a piece of a track.
- **Playlist Item**: Either a full track OR a clip. The `playlist_items` table always has a `track_id`; if `clip_id` is also set, the player uses the clip's boundaries.

## Coding Conventions

- **TypeScript** on the frontend, strict mode. No `any` types.
- **Python 3.11+** on the backend with type hints everywhere.
- **Async by default** — FastAPI routes should be async. Use `asyncio` for concurrent yt-dlp operations.
- **Error handling**: Never let yt-dlp errors crash the server. Wrap extraction in try/except and return meaningful error responses.
- **Environment variables**: Config (cache path, DB path) in `.env`. Never hardcode. Keep it minimal for MVP — SQLite needs no credentials.
- **API responses**: Use Pydantic models for request/response schemas. Be consistent with camelCase in JSON responses (frontend convention) even though Python uses snake_case internally.

## Key Technical Decisions

1. **SQLite for MVP**: Zero config, no credentials, instant setup. The schema matches the Supabase design doc exactly — when it's time to migrate, it's just swapping the DB client layer. Use `aiosqlite` for async access. Auto-create tables on app startup if they don't exist.
2. **Audio streaming**: The backend proxies audio to the frontend. The frontend never talks to YouTube/TikTok directly. This is intentional — it enables caching, format normalization, and keeps the frontend simple.
2. **Hybrid caching**: First play streams from source and caches to disk simultaneously. Subsequent plays serve from cache. LRU eviction when cache exceeds 2GB (configurable).
3. **Clip playback**: The frontend HTML5 `<audio>` element handles clip boundaries. On play, seek to `startMs`. Use a `timeupdate` listener to stop/advance at `endMs`. The backend serves full track audio — segment enforcement happens client-side.
4. **yt-dlp as a library**: Import `yt_dlp` directly in Python rather than shelling out. This gives better error handling and structured metadata.

## Development Workflow

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev  # runs on :3000, proxies /api to :8000
```

## What NOT To Do

- Don't add auth yet — this is a single-user personal tool for now.
- Don't over-engineer the UI — functional beats beautiful for the MVP. (But follow taste-skill principles when you do style things.)
- Don't normalize audio format yet — serve whatever yt-dlp gives us. Format normalization is a future optimization.
- Don't build search yet — MVP is URL paste only.

## Agent Orchestration Notes

This project has a clean frontend/backend split. If using parallel agents:
- **Agent 1 (Backend)**: FastAPI app, yt-dlp integration, caching, SQLite CRUD
- **Agent 2 (Frontend)**: Next.js app, player component, clip editor, playlist UI
- **Shared contract**: The API routes and Pydantic/TypeScript types are the interface. Define these first before splitting work.

## Development Cycle

When working on any feature or bug fix, follow this loop:

1. **Plan/brainstorm** — diagnose the issue or design the feature, discuss approach with Ian
2. **Implement** — make the changes
3. **Summarize** — explain what changed and why
4. **Test handoff** — give Ian specific tests to verify
5. **Iterate or commit** — if Ian reports issues, go back to step 1. If it works, commit and push to GitHub.

## Known Bugs & Patterns to Avoid

### ClipEditor must be a full-page view, NOT inline above the library
When "Create clip" is clicked, the ClipEditor must **replace** the entire main content area (the archive grid). Do NOT render it inline above the TrackLibrary — the user will see the song play but won't notice the editor, and the layout looks broken.

**Correct pattern** in `page.tsx`:
```tsx
{activeView.type === "archive" ? (
  editingTrack ? (
    <ClipEditor ... />   // full page — no library below
  ) : (
    <div>
      <AddTrack />
      <TrackLibrary />
    </div>
  )
) : null}
```
The library comes back when the editor is closed or a clip is saved.

---

## MVP Priority Order

1. Source resolver (POST /api/resolve) — get yt-dlp extracting audio
2. Audio streaming endpoint (GET /api/audio/{track_id}) — playable audio in browser
3. Basic player component — HTML5 audio with play/pause
4. SQLite tables + CRUD routes — tracks, clips, playlists, playlist_items (use aiosqlite, auto-create tables on startup)
5. Clip editor — timestamp inputs + tap-to-mark
6. Playlist UI — add tracks/clips, reorder, play through
7. Caching layer — lazy download + LRU eviction
8. (Future) Migrate SQLite → Supabase when ready for cloud/multi-device
