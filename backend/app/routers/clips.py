import uuid
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_db
from app.models.schemas import ClipResponse, CreateClipRequest, UpdateClipRequest

router = APIRouter(prefix="/api", tags=["clips"])


@router.post("/clips", response_model=ClipResponse, status_code=201)
async def create_clip(
    body: CreateClipRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> ClipResponse:
    """Create a new clip for a track."""

    # Verify track exists
    cursor = await db.execute("SELECT id FROM tracks WHERE id = ?", (body.track_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Track not found")

    clip_id = str(uuid.uuid4())

    await db.execute(
        "INSERT INTO clips (id, track_id, label, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)",
        (clip_id, body.track_id, body.label, body.start_ms, body.end_ms),
    )
    await db.commit()

    cursor = await db.execute(
        "SELECT id, track_id, label, start_ms, end_ms, created_at FROM clips WHERE id = ?",
        (clip_id,),
    )
    row = await cursor.fetchone()

    return ClipResponse(
        id=row["id"],
        track_id=row["track_id"],
        label=row["label"],
        start_ms=row["start_ms"],
        end_ms=row["end_ms"],
        created_at=row["created_at"],
    )


@router.get("/clips", response_model=list[ClipResponse])
async def list_clips(
    track_id: Optional[str] = Query(default=None, alias="trackId"),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[ClipResponse]:
    """List clips, optionally filtered by track ID."""
    if track_id:
        cursor = await db.execute(
            "SELECT id, track_id, label, start_ms, end_ms, created_at "
            "FROM clips WHERE track_id = ? ORDER BY start_ms",
            (track_id,),
        )
    else:
        cursor = await db.execute(
            "SELECT id, track_id, label, start_ms, end_ms, created_at "
            "FROM clips ORDER BY created_at DESC",
        )

    rows = await cursor.fetchall()
    return [
        ClipResponse(
            id=row["id"],
            track_id=row["track_id"],
            label=row["label"],
            start_ms=row["start_ms"],
            end_ms=row["end_ms"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.patch("/clips/{clip_id}", response_model=ClipResponse)
async def update_clip(
    clip_id: str,
    body: UpdateClipRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> ClipResponse:
    """Update a clip's label, start_ms, or end_ms."""

    # Check clip exists
    cursor = await db.execute("SELECT id FROM clips WHERE id = ?", (clip_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Clip not found")

    updates: list[str] = []
    params: list = []

    if body.label is not None:
        updates.append("label = ?")
        params.append(body.label)
    if body.start_ms is not None:
        updates.append("start_ms = ?")
        params.append(body.start_ms)
    if body.end_ms is not None:
        updates.append("end_ms = ?")
        params.append(body.end_ms)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(clip_id)
    await db.execute(
        f"UPDATE clips SET {', '.join(updates)} WHERE id = ?",
        params,
    )
    await db.commit()

    cursor = await db.execute(
        "SELECT id, track_id, label, start_ms, end_ms, created_at FROM clips WHERE id = ?",
        (clip_id,),
    )
    row = await cursor.fetchone()

    return ClipResponse(
        id=row["id"],
        track_id=row["track_id"],
        label=row["label"],
        start_ms=row["start_ms"],
        end_ms=row["end_ms"],
        created_at=row["created_at"],
    )


@router.delete("/clips/{clip_id}", status_code=204)
async def delete_clip(
    clip_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete a clip."""
    cursor = await db.execute("SELECT id FROM clips WHERE id = ?", (clip_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Clip not found")

    await db.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
    await db.commit()
