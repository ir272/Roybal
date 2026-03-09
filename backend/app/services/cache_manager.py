import hashlib
import logging
import os
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

CACHE_DIR = os.getenv("CACHE_DIR", os.path.expanduser("~/.roybal/cache"))
MAX_CACHE_SIZE_GB = float(os.getenv("MAX_CACHE_SIZE_GB", "2"))
MAX_CACHE_SIZE_BYTES = int(MAX_CACHE_SIZE_GB * 1024 * 1024 * 1024)


class CacheManager:
    """Manages on-disk audio cache with LRU eviction."""

    def __init__(
        self,
        cache_dir: str = CACHE_DIR,
        max_size_bytes: int = MAX_CACHE_SIZE_BYTES,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.max_size_bytes = max_size_bytes
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _path_for(self, track_id: str) -> Path:
        """Return the cache file path for a given track ID."""
        return self.cache_dir / track_id

    def get(self, track_id: str) -> Optional[Path]:
        """Return the cached file path if it exists, else None. Updates atime for LRU."""
        path = self._path_for(track_id)
        if path.exists() and path.stat().st_size > 0:
            # Touch access time for LRU tracking
            path.touch()
            return path
        return None

    def open_write(self, track_id: str) -> Path:
        """Return the path to write cached audio into. Caller is responsible for writing."""
        path = self._path_for(track_id)
        return path

    def mark_complete(self, track_id: str) -> None:
        """Mark a cache write as complete and run eviction if needed."""
        self._evict_if_needed()

    def remove(self, track_id: str) -> None:
        """Remove a cached file."""
        path = self._path_for(track_id)
        if path.exists():
            path.unlink()

    def total_size(self) -> int:
        """Return total size of all cached files in bytes."""
        total = 0
        for f in self.cache_dir.iterdir():
            if f.is_file():
                total += f.stat().st_size
        return total

    def _evict_if_needed(self) -> None:
        """Evict least-recently-used files until cache is under the size limit."""
        current_size = self.total_size()
        if current_size <= self.max_size_bytes:
            return

        # Collect files sorted by access time (oldest first)
        files: list[tuple[float, Path, int]] = []
        for f in self.cache_dir.iterdir():
            if f.is_file():
                stat = f.stat()
                files.append((stat.st_atime, f, stat.st_size))

        files.sort(key=lambda x: x[0])

        for atime, path, size in files:
            if current_size <= self.max_size_bytes:
                break
            logger.info("Evicting cached file: %s (size=%d, atime=%s)", path.name, size, atime)
            path.unlink()
            current_size -= size


# Module-level singleton
cache_manager = CacheManager()
