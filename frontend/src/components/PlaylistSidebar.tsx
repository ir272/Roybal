"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Plus,
  Playlist as PlaylistIcon,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { getPlaylists, createPlaylist, deletePlaylist } from "@/lib/api";
import type { Playlist } from "@/types";

interface PlaylistSidebarProps {
  selectedPlaylistId: string | null;
  onSelectPlaylist: (playlist: Playlist) => void;
  onDeselectPlaylist: () => void;
}

export function PlaylistSidebar({
  selectedPlaylistId,
  onSelectPlaylist,
  onDeselectPlaylist,
}: PlaylistSidebarProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getPlaylists();
      setPlaylists(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load playlists"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  const handleDelete = useCallback(
    async (playlistId: string) => {
      try {
        await deletePlaylist(playlistId);
        setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
        if (selectedPlaylistId === playlistId) {
          onDeselectPlaylist();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete playlist"
        );
      }
    },
    [selectedPlaylistId, onDeselectPlaylist]
  );

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    try {
      const playlist = await createPlaylist({ name: trimmed });
      setPlaylists((prev) => [...prev, playlist]);
      setNewName("");
      setIsCreating(false);
      onSelectPlaylist(playlist);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create playlist"
      );
    }
  }, [newName, onSelectPlaylist]);

  return (
    <aside aria-label="Playlists" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tighter text-zinc-100">
          Playlists
        </h2>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="btn-ghost p-1.5"
          aria-label="Create new playlist"
        >
          <Plus size={18} />
        </button>
      </div>

      {isCreating ? (
        <div className="space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setIsCreating(false);
                setNewName("");
              }
            }}
            placeholder="Playlist name"
            className="input-field w-full text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="btn-primary text-xs py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewName("");
              }}
              className="btn-ghost text-xs py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <Warning size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-xl px-4 py-8 flex flex-col items-center gap-2">
          <PlaylistIcon size={28} className="text-zinc-700" />
          <p className="text-xs text-zinc-500 text-center max-w-[30ch]">
            No playlists yet. Create one to start organizing tracks and clips.
          </p>
        </div>
      ) : (
        <nav aria-label="Playlist list" className="space-y-1">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className={`flex items-center gap-1 rounded-lg transition-all duration-200 ease-spring group
                ${
                  selectedPlaylistId === pl.id
                    ? "bg-zinc-800"
                    : "hover:bg-zinc-900"
                }`}
            >
              <button
                onClick={() => {
                  if (selectedPlaylistId === pl.id) {
                    onDeselectPlaylist();
                  } else {
                    onSelectPlaylist(pl);
                  }
                }}
                className={`flex-1 text-left px-3 py-2.5 text-sm active:scale-[0.98] transition-colors
                  ${
                    selectedPlaylistId === pl.id
                      ? "text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-300"
                  }`}
              >
                <span className="truncate block">{pl.name}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(pl.id);
                }}
                className="shrink-0 p-1.5 mr-1 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400"
                aria-label={`Delete playlist ${pl.name}`}
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </nav>
      )}
    </aside>
  );
}
