"use client";

import { useState, useCallback, type FormEvent } from "react";
import { Link as LinkIcon, CircleNotch, Warning } from "@phosphor-icons/react";
import { resolveTrack } from "@/lib/api";
import type { Track } from "@/types";

interface AddTrackProps {
  onTrackResolved: (track: Track) => void;
}

export function AddTrack({ onTrackResolved }: AddTrackProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;

      setIsLoading(true);
      setError(null);

      try {
        const track = await resolveTrack(trimmed);
        onTrackResolved({
          trackId: track.trackId,
          title: track.title,
          artist: track.artist,
          durationMs: track.durationMs,
          thumbnailUrl: track.thumbnailUrl,
          platform: track.platform,
        });
        setUrl("");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to resolve URL";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [url, onTrackResolved]
  );

  return (
    <section aria-label="Add a track">
      <form onSubmit={handleSubmit} className="flex gap-3 items-start">
        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600">
            <LinkIcon size={18} />
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste a YouTube, TikTok, SoundCloud, or Spotify URL"
            className="input-field w-full pl-10 pr-4"
            disabled={isLoading}
            aria-label="Track URL"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {isLoading ? (
            <CircleNotch size={18} className="animate-spin" />
          ) : null}
          {isLoading ? "Resolving" : "Add track"}
        </button>
      </form>
      {error ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-400">
          <Warning size={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  );
}
