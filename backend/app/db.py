import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import aiosqlite
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "..", "roybal.db"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id            TEXT PRIMARY KEY,
  source_url    TEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL,
  title         TEXT,
  artist        TEXT,
  thumbnail_url TEXT,
  duration_ms   INTEGER,
  audio_hash    TEXT,
  cached_at     TEXT,
  last_played   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clips (
  id         TEXT PRIMARY KEY,
  track_id   TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  start_ms   INTEGER NOT NULL DEFAULT 0,
  end_ms     INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  clip_id     TEXT REFERENCES clips(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL,
  UNIQUE(playlist_id, position)
);

-- Add source_credit column if it doesn't exist (for TikTok "via @user" attribution)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we handle this in init_db()

CREATE TABLE IF NOT EXISTS spotify_youtube_map (
  spotify_url TEXT PRIMARY KEY,
  youtube_url TEXT NOT NULL
);
"""


async def init_db() -> None:
    """Create all tables if they don't exist."""
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.executescript(_SCHEMA)

        # Migration: add source_credit column if missing
        cursor = await db.execute("PRAGMA table_info(tracks)")
        columns = {row[1] for row in await cursor.fetchall()}
        if "source_credit" not in columns:
            await db.execute("ALTER TABLE tracks ADD COLUMN source_credit TEXT")

        await db.commit()


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency that yields an async SQLite connection."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
    finally:
        await db.close()
