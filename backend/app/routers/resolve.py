import logging
import uuid

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_db
from app.models.schemas import ResolveRequest, ResolveResponse
from app.services import ytdlp_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["resolve"])


@router.post("/resolve", response_model=ResolveResponse)
async def resolve_url(
    body: ResolveRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> ResolveResponse:
    """Resolve a URL to track metadata. Creates a track record if new."""

    # Check if track already exists for this URL
    cursor = await db.execute(
        "SELECT id, source_url, platform, title, artist, duration_ms, thumbnail_url "
        "FROM tracks WHERE source_url = ?",
        (body.url,),
    )
    row = await cursor.fetchone()

    if row is not None:
        return ResolveResponse(
            track_id=row["id"],
            title=row["title"],
            artist=row["artist"],
            duration_ms=row["duration_ms"],
            thumbnail_url=row["thumbnail_url"],
            platform=row["platform"],
        )

    # Extract info via yt-dlp
    try:
        info = await ytdlp_service.extract_info(body.url)
    except Exception as exc:
        logger.error("yt-dlp extraction failed for %s: %s", body.url, exc)
        raise HTTPException(status_code=422, detail=f"Could not resolve URL: {exc}")

    track_id = str(uuid.uuid4())

    await db.execute(
        "INSERT INTO tracks (id, source_url, platform, title, artist, duration_ms, thumbnail_url) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            track_id,
            body.url,
            info.platform,
            info.title,
            info.artist,
            info.duration_ms,
            info.thumbnail_url,
        ),
    )
    await db.commit()

    return ResolveResponse(
        track_id=track_id,
        title=info.title,
        artist=info.artist,
        duration_ms=info.duration_ms,
        thumbnail_url=info.thumbnail_url,
        platform=info.platform,
    )
