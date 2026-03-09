import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.db import get_db
from app.services import ytdlp_service
from app.services.cache_manager import cache_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["audio"])

# Map common audio extensions to MIME types
_EXT_TO_MIME: dict[str, str] = {
    ".webm": "audio/webm",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
}


def _detect_mime(path: Path) -> str:
    """Detect MIME type from file extension, falling back to audio/webm."""
    ext = path.suffix.lower()
    if ext in _EXT_TO_MIME:
        return _EXT_TO_MIME[ext]
    guessed = mimetypes.guess_type(str(path))[0]
    return guessed or "audio/webm"


@router.get("/audio/{track_id}")
async def stream_audio(
    track_id: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Stream audio for a track. Serves from cache if available, otherwise downloads via yt-dlp first."""

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

    # Not cached — download via yt-dlp (uses its own throttle-resistant downloader)
    return await _download_and_serve(track_id, source_url, request, db)


def _serve_from_cache(cached_path: Path, request: Request):
    """Serve a cached audio file with Range header support."""
    file_size = cached_path.stat().st_size
    content_type = _detect_mime(cached_path)

    range_header = request.headers.get("range")

    if range_header:
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


async def _download_and_serve(
    track_id: str,
    source_url: str,
    request: Request,
    db: aiosqlite.Connection,
):
    """Download audio via yt-dlp to cache, then serve from cache."""

    # yt-dlp will choose the correct extension based on the format
    output_template = str(cache_manager.cache_dir / f"{track_id}.%(ext)s")

    try:
        actual_path = await ytdlp_service.download_audio(source_url, output_template)
    except Exception as exc:
        logger.error("Failed to download audio for track %s: %s", track_id, exc)
        cache_manager.remove(track_id)
        raise HTTPException(status_code=502, detail=f"Could not fetch audio: {exc}")

    actual_path = Path(actual_path)

    # Register the downloaded file in the cache manager
    cache_manager.register(track_id, actual_path)

    # Update DB
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE tracks SET cached_at = ? WHERE id = ?",
        (now, track_id),
    )
    await db.commit()

    logger.info("Cached audio for track %s at %s (%s bytes)", track_id, actual_path, actual_path.stat().st_size)

    return _serve_from_cache(actual_path, request)
