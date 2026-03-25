from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that converts snake_case fields to camelCase in JSON output."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    def model_dump(self, *, by_alias: bool = True, **kwargs: Any) -> dict[str, Any]:
        """Default to by_alias=True so FastAPI returns camelCase JSON."""
        return super().model_dump(by_alias=by_alias, **kwargs)

    def model_dump_json(self, *, by_alias: bool = True, **kwargs: Any) -> str:
        """Default to by_alias=True for JSON serialization."""
        return super().model_dump_json(by_alias=by_alias, **kwargs)


# ── Resolve ──────────────────────────────────────────────────────────────────

class ResolveRequest(CamelModel):
    url: str


class ResolveResponse(CamelModel):
    track_id: str
    title: Optional[str] = None
    artist: Optional[str] = None
    duration_ms: Optional[int] = None
    thumbnail_url: Optional[str] = None
    platform: str
    already_exists: bool = False


class BatchResolveResponse(CamelModel):
    tracks: list[ResolveResponse]
    failed: list[str] = Field(default_factory=list)  # track titles that failed to match


# ── Tracks ───────────────────────────────────────────────────────────────────

class TrackResponse(CamelModel):
    track_id: str
    source_url: str
    platform: str
    title: Optional[str] = None
    artist: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_ms: Optional[int] = None
    source_credit: Optional[str] = None
    created_at: Optional[str] = None


# ── Clips ────────────────────────────────────────────────────────────────────

class CreateClipRequest(CamelModel):
    track_id: str
    label: str
    start_ms: int = 0
    end_ms: Optional[int] = None


class UpdateClipRequest(CamelModel):
    label: Optional[str] = None
    start_ms: Optional[int] = None
    end_ms: Optional[int] = None


class ClipResponse(CamelModel):
    id: str
    track_id: str
    label: str
    start_ms: int
    end_ms: Optional[int] = None
    created_at: Optional[str] = None


# ── Playlists ────────────────────────────────────────────────────────────────

class CreatePlaylistRequest(CamelModel):
    name: str
    description: Optional[str] = None


class PlaylistResponse(CamelModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AddPlaylistItemRequest(CamelModel):
    track_id: str
    clip_id: Optional[str] = None


class PlaylistItemResponse(CamelModel):
    id: str
    playlist_id: str
    track_id: str
    clip_id: Optional[str] = None
    position: int
    track: Optional[TrackResponse] = None
    clip: Optional[ClipResponse] = None


class ReorderItem(CamelModel):
    id: str
    position: int


class ReorderItemsRequest(CamelModel):
    items: list[ReorderItem]


class PlaylistDetailResponse(CamelModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    items: list[PlaylistItemResponse] = Field(default_factory=list)
