"""Spotify Web API client using Client Credentials flow."""

import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
_SPOTIFY_API_BASE = "https://api.spotify.com/v1"

# Patterns for different Spotify URL types
_SPOTIFY_URL_RE = re.compile(r"https?://open\.spotify\.com/")
_SPOTIFY_TRACK_RE = re.compile(
    r"https?://open\.spotify\.com/(?:intl-\w+/)?track/([a-zA-Z0-9]+)"
)
_SPOTIFY_ALBUM_RE = re.compile(
    r"https?://open\.spotify\.com/(?:intl-\w+/)?album/([a-zA-Z0-9]+)"
)
_SPOTIFY_PLAYLIST_RE = re.compile(
    r"https?://open\.spotify\.com/(?:intl-\w+/)?playlist/([a-zA-Z0-9]+)"
)


def is_spotify_url(url: str) -> bool:
    """Returns True for ANY open.spotify.com URL."""
    return bool(_SPOTIFY_URL_RE.search(url))


def parse_spotify_url(url: str) -> tuple[str, Optional[str]]:
    """Parse a Spotify URL and return (type, id).

    Returns:
        ("track", "abc123") | ("album", "abc123") | ("playlist", "abc123") | ("unknown", None)
    """
    m = _SPOTIFY_TRACK_RE.search(url)
    if m:
        return "track", m.group(1)

    m = _SPOTIFY_ALBUM_RE.search(url)
    if m:
        return "album", m.group(1)

    m = _SPOTIFY_PLAYLIST_RE.search(url)
    if m:
        return "playlist", m.group(1)

    return "unknown", None


@dataclass
class SpotifyTrackInfo:
    title: str
    artist: str
    album: str
    duration_ms: int
    thumbnail_url: Optional[str]
    spotify_id: str
    spotify_track_url: str


def _parse_track_data(data: dict, album_images: Optional[list] = None) -> SpotifyTrackInfo:
    """Parse a Spotify API track object into SpotifyTrackInfo."""
    artists = data.get("artists", [])
    artist_name = ", ".join(a["name"] for a in artists) if artists else "Unknown"

    # Album art: use provided album images or get from track's album
    images = album_images or data.get("album", {}).get("images", [])
    thumbnail = images[0]["url"] if images else None

    track_id = data["id"]

    return SpotifyTrackInfo(
        title=data["name"],
        artist=artist_name,
        album=data.get("album", {}).get("name", ""),
        duration_ms=data.get("duration_ms", 0),
        thumbnail_url=thumbnail,
        spotify_id=track_id,
        spotify_track_url=f"https://open.spotify.com/track/{track_id}",
    )


class SpotifyClient:
    """Handles Spotify API auth and requests."""

    def __init__(self) -> None:
        self._client_id = os.getenv("SPOTIFY_CLIENT_ID", "")
        self._client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "")
        self._token: Optional[str] = None
        self._token_expires_at: float = 0

    def _has_credentials(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def _check_credentials(self) -> None:
        if not self._has_credentials():
            raise ValueError(
                "Spotify API credentials not configured. "
                "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env"
            )

    async def _ensure_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _SPOTIFY_TOKEN_URL,
                data={"grant_type": "client_credentials"},
                auth=(self._client_id, self._client_secret),
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data["access_token"]
        self._token_expires_at = time.time() + data.get("expires_in", 3600)
        logger.info("Spotify token refreshed, expires in %ds", data.get("expires_in", 3600))
        return self._token

    async def _api_get(self, path: str) -> dict:
        """Make an authenticated GET request to the Spotify API."""
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{_SPOTIFY_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_track(self, track_id: str) -> SpotifyTrackInfo:
        self._check_credentials()
        data = await self._api_get(f"/tracks/{track_id}")
        return _parse_track_data(data)

    async def get_album_tracks(self, album_id: str) -> list[SpotifyTrackInfo]:
        """Get all tracks from a Spotify album."""
        self._check_credentials()

        # First get album metadata (for album art)
        album_data = await self._api_get(f"/albums/{album_id}")
        album_images = album_data.get("images", [])

        # Album tracks endpoint returns simplified track objects
        # We need the full track objects for duration, so we get the album's tracks
        tracks_data = album_data.get("tracks", {}).get("items", [])

        results: list[SpotifyTrackInfo] = []
        for track in tracks_data:
            results.append(SpotifyTrackInfo(
                title=track["name"],
                artist=", ".join(a["name"] for a in track.get("artists", [])),
                album=album_data.get("name", ""),
                duration_ms=track.get("duration_ms", 0),
                thumbnail_url=album_images[0]["url"] if album_images else None,
                spotify_id=track["id"],
                spotify_track_url=f"https://open.spotify.com/track/{track['id']}",
            ))

        logger.info("Fetched %d tracks from Spotify album '%s'", len(results), album_data.get("name"))
        return results

    async def get_playlist_tracks(self, playlist_id: str) -> list[SpotifyTrackInfo]:
        """Get all tracks from a Spotify playlist."""
        self._check_credentials()

        data = await self._api_get(f"/playlists/{playlist_id}")
        playlist_name = data.get("name", "")

        items = data.get("tracks", {}).get("items", [])
        results: list[SpotifyTrackInfo] = []

        for item in items:
            track = item.get("track")
            if track is None or track.get("id") is None:
                continue  # Skip local files or unavailable tracks
            results.append(_parse_track_data(track))

        logger.info("Fetched %d tracks from Spotify playlist '%s'", len(results), playlist_name)
        return results


# Module-level singleton
spotify_client = SpotifyClient()
