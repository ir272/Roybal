"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Play,
  Pause,
  Trash,
  DotsSixVertical,
  Plus,
  MusicNotes,
  Warning,
} from "@phosphor-icons/react";
import {
  getPlaylist,
  addPlaylistItem,
  removePlaylistItem,
  reorderPlaylistItems,
} from "@/lib/api";
import { usePlayerContext } from "@/lib/PlayerContext";
import type { PlaylistWithItems, Track, Clip } from "@/types";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    youtube: "YouTube",
    tiktok: "TikTok",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
  };
  return labels[platform.toLowerCase()] ?? platform;
}

interface PlaylistDetailViewProps {
  playlistId: string;
  playlistName: string;
  tracks: Track[];
  clips: Clip[];
}

export function PlaylistDetailView({
  playlistId,
  playlistName,
  tracks,
  clips,
}: PlaylistDetailViewProps) {
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
      const item = playlist.items[index];
      const isCurrentItem =
        currentTrack?.trackId === item?.track.trackId &&
        currentClip?.id === (item?.clip?.id ?? null);

      if (isCurrentItem) {
        togglePlay();
      } else {
        playPlaylist(playlist.items, index);
      }
    },
    [playlist, currentTrack, currentClip, togglePlay, playPlaylist]
  );

  const handlePlayAll = useCallback(() => {
    if (!playlist || playlist.items.length === 0) return;
    playPlaylist(playlist.items, 0);
  }, [playlist, playPlaylist]);

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
    } catch {
      fetchPlaylist();
    }
  }, [playlist, playlistId, fetchPlaylist]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <Warning size={16} />
        <span>{error}</span>
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className="space-y-6">
      {/* Playlist header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tighter text-zinc-100">
            {playlistName}
          </h2>
          <p className="text-xs text-zinc-500 font-mono mt-1">
            {playlist.items.length}{" "}
            {playlist.items.length === 1 ? "track" : "tracks"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {playlist.items.length > 0 ? (
            <button
              onClick={handlePlayAll}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Play size={16} weight="fill" />
              Play all
            </button>
          ) : null}
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      </div>

      {/* Add menu dropdown */}
      {showAddMenu ? (
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-3 space-y-1 max-h-64 overflow-y-auto">
          {tracks.length === 0 ? (
            <p className="text-xs text-zinc-500 px-2 py-2">
              No tracks in your archive yet. Add some first.
            </p>
          ) : null}
          {tracks.map((track) => (
            <div key={track.trackId} className="space-y-0.5">
              <button
                onClick={() => handleAddTrack(track.trackId)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors flex items-center gap-3"
              >
                {track.thumbnailUrl ? (
                  <img
                    src={track.thumbnailUrl}
                    alt=""
                    className="w-8 h-8 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-zinc-800 shrink-0" />
                )}
                <span className="truncate flex-1">{track.title}</span>
                <span className="text-xs text-zinc-600 font-mono shrink-0">
                  {platformLabel(track.platform)}
                </span>
              </button>
              {clips
                .filter((c) => c.trackId === track.trackId)
                .map((clip) => (
                  <button
                    key={clip.id}
                    onClick={() => handleAddTrack(track.trackId, clip.id)}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/60 transition-colors truncate ml-11"
                  >
                    {clip.label}
                    <span className="text-zinc-600 ml-1.5">(clip)</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* Track list */}
      {playlist.items.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-xl px-8 py-16 flex flex-col items-center gap-3">
          <MusicNotes size={40} className="text-zinc-700" />
          <p className="text-sm text-zinc-500 text-center max-w-[45ch]">
            This playlist is empty. Click "Add" to include tracks or clips from
            your archive.
          </p>
        </div>
      ) : (
        <div className="space-y-px" role="list" aria-label="Playlist tracks">
          {/* Column headers */}
          <div className="grid grid-cols-[32px_40px_1fr_100px_80px_32px] gap-3 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-600 border-b border-zinc-800/60">
            <span />
            <span>#</span>
            <span>Title</span>
            <span>Platform</span>
            <span className="text-right">Duration</span>
            <span />
          </div>

          {playlist.items.map((item, index) => {
            const isCurrentItem =
              currentTrack?.trackId === item.track.trackId &&
              currentClip?.id === (item.clip?.id ?? null);
            const isItemPlaying = isCurrentItem && isPlaying;

            return (
              <div
                key={item.id}
                role="listitem"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`grid grid-cols-[32px_40px_1fr_100px_80px_32px] gap-3 items-center px-3 py-2.5 rounded-lg transition-all duration-150 ease-spring group
                  ${
                    dragIndex === index
                      ? "opacity-50 bg-zinc-800"
                      : "hover:bg-zinc-800/40"
                  }
                  ${isCurrentItem ? "bg-zinc-800/30" : ""}`}
              >
                {/* Drag handle */}
                <button
                  className="cursor-grab active:cursor-grabbing text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Drag to reorder"
                >
                  <DotsSixVertical size={16} />
                </button>

                {/* Index / Play button */}
                <button
                  onClick={() => handlePlayItem(index)}
                  className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                  aria-label={isItemPlaying ? "Pause" : "Play"}
                >
                  {isItemPlaying ? (
                    <Pause
                      size={14}
                      weight="fill"
                      className="text-emerald-400"
                    />
                  ) : (
                    <>
                      <span className="text-sm font-mono text-zinc-600 group-hover:hidden">
                        {index + 1}
                      </span>
                      <Play
                        size={14}
                        weight="fill"
                        className="text-zinc-400 hidden group-hover:block"
                      />
                    </>
                  )}
                </button>

                {/* Title + thumbnail + clip label */}
                <div className="flex items-center gap-3 min-w-0">
                  {item.track.thumbnailUrl ? (
                    <img
                      src={item.track.thumbnailUrl}
                      alt=""
                      className="w-10 h-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-zinc-800 shrink-0 flex items-center justify-center">
                      <MusicNotes size={16} className="text-zinc-600" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p
                      className={`text-sm truncate leading-tight ${
                        isCurrentItem
                          ? "text-emerald-400"
                          : "text-zinc-200"
                      }`}
                    >
                      {item.track.title}
                    </p>
                    {item.clip ? (
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {item.clip.label}
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {item.track.artist}
                      </p>
                    )}
                  </div>
                </div>

                {/* Platform */}
                <span className="text-xs font-mono text-zinc-600">
                  {platformLabel(item.track.platform)}
                </span>

                {/* Duration */}
                <span className="text-xs font-mono text-zinc-600 text-right">
                  {item.clip && item.clip.endMs
                    ? formatDuration(item.clip.endMs - item.clip.startMs)
                    : formatDuration(item.track.durationMs)}
                </span>

                {/* Remove button */}
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 p-1"
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
