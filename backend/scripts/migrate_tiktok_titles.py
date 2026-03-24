"""One-shot migration: re-extract TikTok track metadata to get real song titles and source_credit."""

import asyncio
import os
import sys

# Add parent dir so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import aiosqlite
from app.db import DB_PATH
from app.services.ytdlp_service import extract_info


async def migrate():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, source_url, title, artist FROM tracks WHERE platform LIKE '%tiktok%'"
        )
        rows = await cursor.fetchall()

        if not rows:
            print("No TikTok tracks found.")
            return

        print(f"Found {len(rows)} TikTok track(s). Re-extracting metadata...\n")

        for row in rows:
            track_id = row["id"]
            source_url = row["source_url"]
            old_title = row["title"]
            old_artist = row["artist"]

            try:
                info = await extract_info(source_url)
            except Exception as exc:
                print(f"  SKIP {track_id}: extraction failed — {exc}")
                continue

            changed = []
            if info.title and info.title != old_title:
                changed.append(f"title: '{old_title}' -> '{info.title}'")
            if info.artist and info.artist != old_artist:
                changed.append(f"artist: '{old_artist}' -> '{info.artist}'")
            if info.source_credit:
                changed.append(f"source_credit: '{info.source_credit}'")

            if not changed:
                print(f"  OK   {track_id}: no changes needed ('{old_title}')")
                continue

            await db.execute(
                "UPDATE tracks SET title = ?, artist = ?, source_credit = ? WHERE id = ?",
                (info.title or old_title, info.artist or old_artist, info.source_credit, track_id),
            )
            print(f"  UPD  {track_id}: {', '.join(changed)}")

        await db.commit()
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(migrate())
