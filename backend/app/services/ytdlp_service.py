import asyncio
import logging
import math
from dataclasses import dataclass
from difflib import SequenceMatcher
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
    source_credit: Optional[str] = None  # e.g. "via @username" for TikTok


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

    # Platform: use the extractor key
    platform = (info.get("extractor_key") or info.get("extractor") or "unknown").lower()

    # Smart title/artist extraction — especially for TikTok
    title = info.get("title")
    artist = (
        info.get("artist")
        or info.get("uploader")
        or info.get("channel")
    )

    # TikTok: prefer the "track" field (actual song name) over the video caption
    source_credit: Optional[str] = None
    if "tiktok" in platform:
        track_name = info.get("track") or ""
        track_artist = info.get("artist") or ""
        uploader = info.get("uploader") or ""
        # Filter out generic "original sound" variants
        generic_sounds = {
            "original sound", "originalton", "son original", "suono originale",
            "sonido original", "origineel geluid", "som original", "orijinal ses",
            "suara asli", "оригинальный звук", "原创音乐", "オリジナルサウンド",
        }
        if track_name.lower().strip() not in generic_sounds and track_name.strip():
            title = track_name
            if track_artist:
                artist = track_artist
            # Store attribution to the TikTok source
            if uploader:
                source_credit = f"via @{uploader}"
            logger.info("TikTok: using track name '%s' by '%s' (%s)", title, artist, source_credit or "no credit")

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
        title=title,
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


# ---------------------------------------------------------------------------
# YouTube search + smart matching for Spotify → YouTube resolution
# ---------------------------------------------------------------------------

_PENALTY_KEYWORDS = {
    "remix", "live", "cover", "slowed", "sped up", "reverb",
    "8d audio", "bass boosted", "nightcore", "acoustic", "karaoke",
    "instrumental", "concert", "performance",
}


@dataclass
class YouTubeSearchResult:
    """A single YouTube search result with metadata for scoring."""
    url: str
    title: str
    duration_ms: Optional[int]
    view_count: Optional[int]
    channel: Optional[str]
    channel_is_verified: bool
    is_topic_channel: bool


def _search_youtube_sync(query: str, num_results: int = 5) -> list[YouTubeSearchResult]:
    """Search YouTube via yt-dlp and return results with metadata."""
    opts = {
        **_BASE_OPTS,
        "extract_flat": False,
        "default_search": "ytsearch",
    }

    search_url = f"ytsearch{num_results}:{query}"

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(search_url, download=False)

    if info is None:
        return []

    entries = info.get("entries") or []
    results: list[YouTubeSearchResult] = []

    for entry in entries:
        if entry is None:
            continue

        duration_s = entry.get("duration")
        duration_ms = int(duration_s * 1000) if duration_s else None

        channel = entry.get("channel") or entry.get("uploader") or ""
        is_topic = channel.endswith(" - Topic")
        is_verified = bool(entry.get("channel_is_verified"))

        results.append(YouTubeSearchResult(
            url=entry.get("webpage_url") or entry.get("url", ""),
            title=entry.get("title", ""),
            duration_ms=duration_ms,
            view_count=entry.get("view_count"),
            channel=channel,
            channel_is_verified=is_verified or is_topic,
            is_topic_channel=is_topic,
        ))

    return results


def _score_result(
    result: YouTubeSearchResult,
    target_title: str,
    target_artist: str,
    target_duration_ms: int,
) -> float:
    """Score a YouTube result against Spotify metadata. Higher = better match."""

    # --- Duration score (weight: 0.45) ---
    if result.duration_ms and target_duration_ms:
        diff_ms = abs(result.duration_ms - target_duration_ms)
        if diff_ms <= 5000:
            duration_score = 1.0
        elif diff_ms <= 15000:
            duration_score = 0.7
        elif diff_ms <= 30000:
            duration_score = 0.3
        else:
            duration_score = 0.0
    else:
        duration_score = 0.3  # Unknown duration, neutral

    # --- Channel score (weight: 0.30) ---
    if result.is_topic_channel:
        channel_score = 1.0  # Auto-generated album audio — best source
    elif result.channel_is_verified:
        channel_score = 0.75  # Official artist channel
    else:
        channel_score = 0.3  # Random uploader

    # --- View count score (weight: 0.15) ---
    if result.view_count and result.view_count > 0:
        # Log scale: 1k=3, 10k=4, 100k=5, 1M=6, 10M=7, 100M=8, 1B=9
        log_views = math.log10(max(result.view_count, 1))
        view_score = min(log_views / 9.0, 1.0)
    else:
        view_score = 0.2  # Unknown views, slight penalty

    # --- Title score (weight: 0.10) ---
    yt_title_lower = result.title.lower()
    target_combined = f"{target_artist} - {target_title}".lower()

    # Fuzzy text similarity
    title_similarity = SequenceMatcher(None, target_combined, yt_title_lower).ratio()

    # Penalty: if YouTube title contains "remix"/"live"/etc. but Spotify title doesn't
    target_lower = target_title.lower()
    penalty = 0.0
    for keyword in _PENALTY_KEYWORDS:
        if keyword in yt_title_lower and keyword not in target_lower:
            penalty = 0.5
            break

    title_score = max(title_similarity - penalty, 0.0)

    # --- Weighted total ---
    total = (
        duration_score * 0.45
        + channel_score * 0.30
        + view_score * 0.15
        + title_score * 0.10
    )

    logger.info(
        "Score %.3f for '%s' (dur=%.2f chan=%.2f views=%.2f title=%.2f) %s",
        total, result.title[:60], duration_score, channel_score,
        view_score, title_score, result.url,
    )

    return total


def _find_best_match_sync(
    title: str,
    artist: str,
    duration_ms: int,
) -> Optional[YouTubeSearchResult]:
    """Search YouTube with two queries and return the best-scoring result."""

    query1 = f"{artist} - {title}"
    query2 = f"{artist} {title} official audio"

    logger.info("YouTube search queries: [%s] and [%s]", query1, query2)

    # Run both searches
    results1 = _search_youtube_sync(query1, num_results=5)
    results2 = _search_youtube_sync(query2, num_results=3)

    # Merge and deduplicate by URL
    seen_urls: set[str] = set()
    all_results: list[YouTubeSearchResult] = []
    for r in results1 + results2:
        if r.url not in seen_urls:
            seen_urls.add(r.url)
            all_results.append(r)

    if not all_results:
        return None

    # Score all results
    scored = [
        (r, _score_result(r, title, artist, duration_ms))
        for r in all_results
    ]

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    best_result, best_score = scored[0]

    # Minimum confidence threshold
    if best_score < 0.35:
        logger.warning(
            "Best match score %.3f is below threshold for '%s - %s'",
            best_score, artist, title,
        )
        return None

    logger.info(
        "Best match: '%s' (score=%.3f, url=%s)",
        best_result.title, best_score, best_result.url,
    )
    return best_result


async def find_best_youtube_match(
    title: str,
    artist: str,
    duration_ms: int,
) -> Optional[YouTubeSearchResult]:
    """Find the best YouTube match for a Spotify track (async wrapper)."""
    return await asyncio.to_thread(_find_best_match_sync, title, artist, duration_ms)
