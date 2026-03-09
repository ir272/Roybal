import logging
import os
from datetime import datetime, timezone
from typing import Optional

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.db import get_db
from app.services import ytdlp_service
from app.services.cache_manager import cache_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["audio"])

# Shared httpx client for streaming audio from upstream
_http_client: Optional[httpx.AsyncClient] = None


async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30.0, read=120.0))
    return _http_client


@router.get("/audio/{track_id}")
async def stream_audio(
    track_id: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
) -> Response:
    """Stream audio for a track. Serves from cache if available, otherwise fetches via yt-dlp."""

    # Look up track
    cursor = await db.execute(
        "SELECT id, source_url FROM tracks WHERE id = ?",
        (track_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Track not found")

    source_url: str = row["source_url"]

    # Update last_played
    now = datetime.now(timezone.utc).isoformat()
    await db.execute("UPDATE tracks SET last_played = ? WHERE id = ?", (now, track_id))
    await db.commit()

    # Check cache
    cached_path = cache_manager.get(track_id)
    if cached_path is not None:
        return _serve_from_cache(cached_path, request)

    # Not cached — stream from source and cache simultaneously
    return await _stream_and_cache(track_id, source_url, request, db)


def _serve_from_cache(cached_path, request: Request) -> Response:
    """Serve a cached audio file with Range header support."""
    file_size = cached_path.stat().st_size
    content_type = "audio/mpeg"

    range_header = request.headers.get("range")

    if range_header:
        # Parse Range: bytes=start-end
        range_spec = range_header.replace("bytes=", "")
        parts = range_spec.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_range():
            with open(cached_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk_size = min(64 * 1024, remaining)
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )

    # No range — serve full file
    def iter_full():
        with open(cached_path, "rb") as f:
            while True:
                chunk = f.read(64 * 1024)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        iter_full(),
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )


async def _stream_and_cache(
    track_id: str,
    source_url: str,
    request: Request,
    db: aiosqlite.Connection,
) -> StreamingResponse:
    """Fetch audio from upstream, stream to client, and write to cache simultaneously."""

    # Get a fresh audio URL via yt-dlp
    try:
        audio_url = await ytdlp_service.get_audio_url(source_url)
    except Exception as exc:
        logger.error("Failed to get audio URL for track %s: %s", track_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not fetch audio: {exc}")

    cache_path = cache_manager.open_write(track_id)
    client = await _get_http_client()

    async def stream_generator():
        cache_file = None
        try:
            cache_file = open(cache_path, "wb")
            async with client.stream("GET", audio_url) as resp:
                if resp.status_code >= 400:
                    raise HTTPException(status_code=502, detail="Upstream audio fetch failed")
                async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                    cache_file.write(chunk)
                    yield chunk
            cache_file.close()
            cache_file = None

            # Mark cache complete and update DB
            cache_manager.mark_complete(track_id)
            now = datetime.now(timezone.utc).isoformat()
            await db.execute(
                "UPDATE tracks SET cached_at = ? WHERE id = ?",
                (now, track_id),
            )
            await db.commit()
        except Exception:
            # Clean up partial cache file on error
            if cache_file is not None:
                cache_file.close()
            cache_manager.remove(track_id)
            raise

    return StreamingResponse(
        stream_generator(),
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "bytes"},
    )
