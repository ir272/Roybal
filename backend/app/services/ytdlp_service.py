import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

import yt_dlp

logger = logging.getLogger(__name__)


@dataclass
class TrackInfo:
    """Extracted metadata from a URL via yt-dlp."""
    title: Optional[str]
    artist: Optional[str]
    duration_ms: Optional[int]
    thumbnail_url: Optional[str]
    platform: str
    audio_url: str
    source_url: str
    audio_ext: str = "webm"


_BASE_OPTS: dict = {
    "format": "bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "extract_flat": False,
    "nocheckcertificate": True,
}


def _extract_sync(url: str) -> TrackInfo:
    """Run yt-dlp extract_info synchronously (call from asyncio.to_thread)."""
    opts = {**_BASE_OPTS}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info is None:
        raise ValueError(f"yt-dlp returned no info for URL: {url}")

    # Duration: yt-dlp returns seconds (float or int), convert to ms
    duration_s = info.get("duration")
    duration_ms = int(duration_s * 1000) if duration_s is not None else None

    # Artist: yt-dlp uses various fields depending on platform
    artist = (
        info.get("artist")
        or info.get("uploader")
        or info.get("channel")
    )

    # Platform: use the extractor key
    platform = (info.get("extractor_key") or info.get("extractor") or "unknown").lower()

    # Thumbnail
    thumbnail_url = info.get("thumbnail")

    # Audio URL: prefer the direct URL from the selected format
    audio_url = info.get("url")
    if not audio_url:
        # Fall back to first audio-only format
        formats = info.get("formats") or []
        for fmt in reversed(formats):
            if fmt.get("acodec") and fmt["acodec"] != "none":
                audio_url = fmt.get("url")
                if audio_url:
                    break

    if not audio_url:
        raise ValueError("Could not extract audio URL from source")

    # Get audio extension from the selected format
    audio_ext = info.get("ext") or info.get("audio_ext") or "webm"

    return TrackInfo(
        title=info.get("title"),
        artist=artist,
        duration_ms=duration_ms,
        thumbnail_url=thumbnail_url,
        platform=platform,
        audio_url=audio_url,
        source_url=url,
        audio_ext=audio_ext,
    )


async def extract_info(url: str) -> TrackInfo:
    """Extract metadata and audio URL from a source URL (async wrapper)."""
    return await asyncio.to_thread(_extract_sync, url)


def _get_audio_url_sync(url: str) -> str:
    """Re-extract just the audio stream URL (for cache misses on replay)."""
    opts = {**_BASE_OPTS}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info is None:
        raise ValueError(f"yt-dlp returned no info for URL: {url}")

    audio_url = info.get("url")
    if not audio_url:
        formats = info.get("formats") or []
        for fmt in reversed(formats):
            if fmt.get("acodec") and fmt["acodec"] != "none":
                audio_url = fmt.get("url")
                if audio_url:
                    break

    if not audio_url:
        raise ValueError("Could not extract audio URL from source")

    return audio_url


async def get_audio_url(source_url: str) -> str:
    """Get a fresh audio stream URL for a given source URL (async wrapper)."""
    return await asyncio.to_thread(_get_audio_url_sync, source_url)


def _download_audio_sync(source_url: str, output_path: str) -> str:
    """Download audio to a specific path using yt-dlp's built-in downloader.

    Returns the actual output file path (yt-dlp may change the extension).
    """
    opts = {
        **_BASE_OPTS,
        "outtmpl": output_path,
        "overwrites": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(source_url, download=True)

    if info is None:
        raise ValueError(f"yt-dlp returned no info for URL: {source_url}")

    # yt-dlp may have written the file with the correct extension appended
    # Check what file was actually created
    requested_downloads = info.get("requested_downloads") or []
    if requested_downloads:
        return requested_downloads[0].get("filepath", output_path)

    return output_path


async def download_audio(source_url: str, output_path: str) -> str:
    """Download audio to cache path using yt-dlp (async wrapper).

    Returns actual file path written.
    """
    return await asyncio.to_thread(_download_audio_sync, source_url, output_path)
