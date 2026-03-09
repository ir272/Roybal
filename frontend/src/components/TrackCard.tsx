"use client";

import { Play, Scissors, Pause, Trash } from "@phosphor-icons/react";
import { usePlayerContext } from "@/lib/PlayerContext";
import type { Track } from "@/types";

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

interface TrackCardProps {
  track: Track;
  onCreateClip: (track: Track) => void;
  onDeleteTrack: (track: Track) => void;
}

export function TrackCard({ track, onCreateClip, onDeleteTrack }: TrackCardProps) {
  const { currentTrack, isPlaying, playTrack, togglePlay } =
    usePlayerContext();

  const isCurrentTrack = currentTrack?.trackId === track.trackId;
  const isCurrentlyPlaying = isCurrentTrack && isPlaying;

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlay();
    } else {
      playTrack(track);
    }
  };

  return (
    <article className="group relative bg-zinc-900/50 rounded-xl overflow-hidden border border-zinc-800/50 transition-all duration-200 ease-spring hover:border-zinc-700/60">
      <div className="relative aspect-video bg-zinc-900 overflow-hidden">
        {track.thumbnailUrl ? (
          <img
            src={track.thumbnailUrl}
            alt={`${track.title} thumbnail`}
            className="w-full h-full object-cover transition-transform duration-500 ease-spring group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
            <Play size={32} className="text-zinc-600" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent" />
        <button
          onClick={handlePlay}
          className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-emerald-600 text-zinc-100 flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-all duration-200 ease-spring
                     hover:bg-emerald-500 active:scale-[0.95]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:opacity-100"
          aria-label={isCurrentlyPlaying ? "Pause" : "Play"}
        >
          {isCurrentlyPlaying ? (
            <Pause size={18} weight="fill" />
          ) : (
            <Play size={18} weight="fill" className="ml-0.5" />
          )}
        </button>
        <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 bg-zinc-950/70 px-2 py-0.5 rounded">
          {platformLabel(track.platform)}
        </span>
      </div>
      <div className="p-3 space-y-1">
        <h3
          className="text-sm font-medium text-zinc-200 leading-snug line-clamp-2"
          title={track.title}
        >
          {track.title}
        </h3>
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500 truncate max-w-[70%]">
            {track.artist}
          </p>
          <span className="text-xs font-mono text-zinc-600">
            {formatDuration(track.durationMs)}
          </span>
        </div>
        <div className="pt-1 flex items-center justify-between">
          <button
            onClick={() => onCreateClip(track)}
            className="btn-ghost text-xs flex items-center gap-1.5 px-2 py-1"
            aria-label={`Create clip from ${track.title}`}
          >
            <Scissors size={14} />
            Create clip
          </button>
          <button
            onClick={() => onDeleteTrack(track)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 p-1.5"
            aria-label={`Remove ${track.title} from library`}
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function TrackCardSkeleton() {
  return (
    <div className="bg-zinc-900/50 rounded-xl overflow-hidden border border-zinc-800/50">
      <div className="aspect-video skeleton" />
      <div className="p-3 space-y-2">
        <div className="skeleton h-4 w-3/4 rounded" />
        <div className="flex items-center justify-between">
          <div className="skeleton h-3 w-1/2 rounded" />
          <div className="skeleton h-3 w-10 rounded" />
        </div>
        <div className="skeleton h-6 w-24 rounded mt-1" />
      </div>
    </div>
  );
}
