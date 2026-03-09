"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Play,
  Pause,
  Trash,
  DotsSixVertical,
  Plus,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";
import {
  getPlaylist,
  addPlaylistItem,
  removePlaylistItem,
  reorderPlaylistItems,
} from "@/lib/api";
import { usePlayerContext } from "@/lib/PlayerContext";
import type { PlaylistWithItems, PlaylistItem, Track, Clip } from "@/types";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

interface PlaylistViewProps {
  playlistId: string;
  tracks: Track[];
  clips: Clip[];
}

export function PlaylistView({
  playlistId,
  tracks,
  clips,
}: PlaylistViewProps) {
  const { currentTrack, currentClip, isPlaying, playPlaylist, togglePlay } =
    usePlayerContext();

  const [playlist, setPlaylist] = useState<PlaylistWithItems | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fetchPlaylist = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getPlaylist(playlistId);
      setPlaylist(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load playlist"
      );
    } finally {
      setIsLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    fetchPlaylist();
  }, [fetchPlaylist]);

  const handleAddTrack = useCallback(
    async (trackId: string, clipId?: string) => {
      try {
        await addPlaylistItem(playlistId, { trackId, clipId });
        setShowAddMenu(false);
        fetchPlaylist();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to add item"
        );
      }
    },
    [playlistId, fetchPlaylist]
  );

  const handleRemoveItem = useCallback(
    async (itemId: string) => {
      try {
        await removePlaylistItem(playlistId, itemId);
        fetchPlaylist();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to remove item"
        );
      }
    },
    [playlistId, fetchPlaylist]
  );

  const handlePlayItem = useCallback(
    (index: number) => {
      if (!playlist) return;
      const isCurrentItem =
        currentTrack?.trackId === playlist.items[index]?.track.trackId &&
        currentClip?.id === playlist.items[index]?.clip?.id;

      if (isCurrentItem) {
        togglePlay();
      } else {
        playPlaylist(playlist.items, index);
      }
    },
    [playlist, currentTrack, currentClip, togglePlay, playPlaylist]
  );

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === targetIndex || !playlist) return;

      const items = [...playlist.items];
      const [movedItem] = items.splice(dragIndex, 1);
      items.splice(targetIndex, 0, movedItem);

      setPlaylist({ ...playlist, items });
      setDragIndex(targetIndex);
    },
    [dragIndex, playlist]
  );

  const handleDragEnd = useCallback(async () => {
    setDragIndex(null);
    if (!playlist) return;

    const reorderData = playlist.items.map((item, i) => ({
      id: item.id,
      position: i,
    }));

    try {
      await reorderPlaylistItems(playlistId, reorderData);
    } catch (err) {
      fetchPlaylist();
    }
  }, [playlist, playlistId, fetchPlaylist]);

  if (isLoading) {
    return (
      <div className="space-y-2 mt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-400 mt-2">
        <Warning size={14} />
        <span>{error}</span>
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">{playlist.name}</h3>
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="btn-ghost p-1"
          aria-label="Add track to playlist"
        >
          <Plus size={16} />
        </button>
      </div>

      {showAddMenu ? (
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-2 space-y-1 max-h-48 overflow-y-auto">
          {tracks.length === 0 ? (
            <p className="text-xs text-zinc-500 px-2 py-1">
              No tracks in library yet
            </p>
          ) : null}
          {tracks.map((track) => (
            <div key={track.trackId} className="space-y-0.5">
              <button
                onClick={() => handleAddTrack(track.trackId)}
                className="w-full text-left px-2 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors truncate"
              >
                {track.title}
                <span className="text-zinc-600 ml-1">
                  (full track)
                </span>
              </button>
              {clips
                .filter((c) => c.trackId === track.trackId)
                .map((clip) => (
                  <button
                    key={clip.id}
                    onClick={() => handleAddTrack(track.trackId, clip.id)}
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-zinc-400 hover:bg-zinc-700/50 transition-colors truncate pl-5"
                  >
                    {clip.label}
                    <span className="text-zinc-600 ml-1">
                      (clip)
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : null}

      {playlist.items.length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-4">
          No items yet. Add tracks or clips above.
        </p>
      ) : (
        <div className="space-y-1" role="list" aria-label="Playlist items">
          {playlist.items.map((item, index) => {
            const isCurrentItem =
              currentTrack?.trackId === item.track.trackId &&
              currentClip?.id === (item.clip?.id ?? null) &&
              isPlaying;

            return (
              <div
                key={item.id}
                role="listitem"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs transition-all duration-150 ease-spring group
                  ${
                    dragIndex === index
                      ? "opacity-50 bg-zinc-800"
                      : "hover:bg-zinc-800/40"
                  }`}
              >
                <button
                  className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 shrink-0"
                  aria-label="Drag to reorder"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <DotsSixVertical size={14} />
                </button>

                <button
                  onClick={() => handlePlayItem(index)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-all hover:bg-zinc-700/50"
                  aria-label={isCurrentItem ? "Pause" : "Play"}
                >
                  {isCurrentItem ? (
                    <Pause
                      size={12}
                      weight="fill"
                      className="text-emerald-400"
                    />
                  ) : (
                    <Play
                      size={12}
                      weight="fill"
                      className="text-zinc-400 group-hover:text-zinc-200"
                    />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <p
                    className={`truncate leading-tight ${
                      isCurrentItem
                        ? "text-emerald-400"
                        : "text-zinc-300"
                    }`}
                  >
                    {item.track.title}
                  </p>
                  {item.clip ? (
                    <p className="text-[10px] text-zinc-500 truncate">
                      {item.clip.label}
                    </p>
                  ) : null}
                </div>

                <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                  {item.clip && item.clip.endMs
                    ? formatDuration(item.clip.endMs - item.clip.startMs)
                    : formatDuration(item.track.durationMs)}
                </span>

                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 p-0.5"
                  aria-label={`Remove ${item.track.title} from playlist`}
                >
                  <Trash size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
