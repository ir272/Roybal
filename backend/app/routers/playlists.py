import uuid
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException

from app.db import get_db
from app.models.schemas import (
    AddPlaylistItemRequest,
    ClipResponse,
    CreatePlaylistRequest,
    PlaylistDetailResponse,
    PlaylistItemResponse,
    PlaylistResponse,
    ReorderItemsRequest,
    TrackResponse,
)

router = APIRouter(prefix="/api", tags=["playlists"])


# ── Playlist CRUD ────────────────────────────────────────────────────────────


@router.post("/playlists", response_model=PlaylistResponse, status_code=201)
async def create_playlist(
    body: CreatePlaylistRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> PlaylistResponse:
    """Create a new playlist."""
    playlist_id = str(uuid.uuid4())

    await db.execute(
        "INSERT INTO playlists (id, name, description) VALUES (?, ?, ?)",
        (playlist_id, body.name, body.description),
    )
    await db.commit()

    cursor = await db.execute(
        "SELECT id, name, description, created_at, updated_at FROM playlists WHERE id = ?",
        (playlist_id,),
    )
    row = await cursor.fetchone()

    return PlaylistResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/playlists", response_model=list[PlaylistResponse])
async def list_playlists(
    db: aiosqlite.Connection = Depends(get_db),
) -> list[PlaylistResponse]:
    """List all playlists."""
    cursor = await db.execute(
        "SELECT id, name, description, created_at, updated_at "
        "FROM playlists ORDER BY updated_at DESC",
    )
    rows = await cursor.fetchall()

    return [
        PlaylistResponse(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


@router.get("/playlists/{playlist_id}", response_model=PlaylistDetailResponse)
async def get_playlist(
    playlist_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> PlaylistDetailResponse:
    """Get a playlist with all its items, joined with track and clip data."""

    cursor = await db.execute(
        "SELECT id, name, description, created_at, updated_at FROM playlists WHERE id = ?",
        (playlist_id,),
    )
    playlist_row = await cursor.fetchone()
    if playlist_row is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    # Fetch items joined with tracks and clips
    cursor = await db.execute(
        """
        SELECT
            pi.id AS item_id,
            pi.playlist_id,
            pi.track_id,
            pi.clip_id,
            pi.position,
            t.id AS t_id,
            t.source_url AS t_source_url,
            t.platform AS t_platform,
            t.title AS t_title,
            t.artist AS t_artist,
            t.thumbnail_url AS t_thumbnail_url,
            t.duration_ms AS t_duration_ms,
            t.created_at AS t_created_at,
            c.id AS c_id,
            c.track_id AS c_track_id,
            c.label AS c_label,
            c.start_ms AS c_start_ms,
            c.end_ms AS c_end_ms,
            c.created_at AS c_created_at
        FROM playlist_items pi
        JOIN tracks t ON t.id = pi.track_id
        LEFT JOIN clips c ON c.id = pi.clip_id
        WHERE pi.playlist_id = ?
        ORDER BY pi.position
        """,
        (playlist_id,),
    )
    item_rows = await cursor.fetchall()

    items: list[PlaylistItemResponse] = []
    for row in item_rows:
        track = TrackResponse(
            id=row["t_id"],
            source_url=row["t_source_url"],
            platform=row["t_platform"],
            title=row["t_title"],
            artist=row["t_artist"],
            thumbnail_url=row["t_thumbnail_url"],
            duration_ms=row["t_duration_ms"],
            created_at=row["t_created_at"],
        )

        clip = None
        if row["c_id"] is not None:
            clip = ClipResponse(
                id=row["c_id"],
                track_id=row["c_track_id"],
                label=row["c_label"],
                start_ms=row["c_start_ms"],
                end_ms=row["c_end_ms"],
                created_at=row["c_created_at"],
            )

        items.append(
            PlaylistItemResponse(
                id=row["item_id"],
                playlist_id=row["playlist_id"],
                track_id=row["track_id"],
                clip_id=row["clip_id"],
                position=row["position"],
                track=track,
                clip=clip,
            )
        )

    return PlaylistDetailResponse(
        id=playlist_row["id"],
        name=playlist_row["name"],
        description=playlist_row["description"],
        created_at=playlist_row["created_at"],
        updated_at=playlist_row["updated_at"],
        items=items,
    )


@router.delete("/playlists/{playlist_id}", status_code=204)
async def delete_playlist(
    playlist_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Delete a playlist and all its items."""
    cursor = await db.execute("SELECT id FROM playlists WHERE id = ?", (playlist_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    await db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    await db.commit()


# ── Playlist Items ───────────────────────────────────────────────────────────


@router.post(
    "/playlists/{playlist_id}/items",
    response_model=PlaylistItemResponse,
    status_code=201,
)
async def add_playlist_item(
    playlist_id: str,
    body: AddPlaylistItemRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> PlaylistItemResponse:
    """Add a track (or clip) to the end of a playlist."""

    # Verify playlist exists
    cursor = await db.execute("SELECT id FROM playlists WHERE id = ?", (playlist_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    # Verify track exists
    cursor = await db.execute("SELECT id FROM tracks WHERE id = ?", (body.track_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Track not found")

    # Verify clip exists if provided
    if body.clip_id is not None:
        cursor = await db.execute("SELECT id FROM clips WHERE id = ?", (body.clip_id,))
        if await cursor.fetchone() is None:
            raise HTTPException(status_code=404, detail="Clip not found")

    # Determine next position
    cursor = await db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos "
        "FROM playlist_items WHERE playlist_id = ?",
        (playlist_id,),
    )
    row = await cursor.fetchone()
    next_position: int = row["next_pos"]

    item_id = str(uuid.uuid4())

    await db.execute(
        "INSERT INTO playlist_items (id, playlist_id, track_id, clip_id, position) "
        "VALUES (?, ?, ?, ?, ?)",
        (item_id, playlist_id, body.track_id, body.clip_id, next_position),
    )

    # Touch playlist updated_at
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE playlists SET updated_at = ? WHERE id = ?",
        (now, playlist_id),
    )
    await db.commit()

    return PlaylistItemResponse(
        id=item_id,
        playlist_id=playlist_id,
        track_id=body.track_id,
        clip_id=body.clip_id,
        position=next_position,
    )


@router.patch("/playlists/{playlist_id}/items")
async def reorder_playlist_items(
    playlist_id: str,
    body: ReorderItemsRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> list[PlaylistItemResponse]:
    """Reorder items in a playlist."""

    # Verify playlist exists
    cursor = await db.execute("SELECT id FROM playlists WHERE id = ?", (playlist_id,))
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    # Temporarily remove unique constraint conflicts by using negative positions
    for idx, item in enumerate(body.items):
        await db.execute(
            "UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?",
            (-(idx + 1), item.id, playlist_id),
        )

    # Now set the real positions
    for item in body.items:
        await db.execute(
            "UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?",
            (item.position, item.id, playlist_id),
        )

    # Touch playlist updated_at
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE playlists SET updated_at = ? WHERE id = ?",
        (now, playlist_id),
    )
    await db.commit()

    # Return updated items
    cursor = await db.execute(
        "SELECT id, playlist_id, track_id, clip_id, position "
        "FROM playlist_items WHERE playlist_id = ? ORDER BY position",
        (playlist_id,),
    )
    rows = await cursor.fetchall()

    return [
        PlaylistItemResponse(
            id=row["id"],
            playlist_id=row["playlist_id"],
            track_id=row["track_id"],
            clip_id=row["clip_id"],
            position=row["position"],
        )
        for row in rows
    ]


@router.delete("/playlists/{playlist_id}/items/{item_id}", status_code=204)
async def delete_playlist_item(
    playlist_id: str,
    item_id: str,
    db: aiosqlite.Connection = Depends(get_db),
) -> None:
    """Remove an item from a playlist."""

    cursor = await db.execute(
        "SELECT id, position FROM playlist_items WHERE id = ? AND playlist_id = ?",
        (item_id, playlist_id),
    )
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Playlist item not found")

    deleted_position: int = row["position"]

    await db.execute(
        "DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?",
        (item_id, playlist_id),
    )

    # Shift subsequent items down to fill the gap
    await db.execute(
        "UPDATE playlist_items SET position = position - 1 "
        "WHERE playlist_id = ? AND position > ?",
        (playlist_id, deleted_position),
    )

    # Touch playlist updated_at
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE playlists SET updated_at = ? WHERE id = ?",
        (now, playlist_id),
    )
    await db.commit()
