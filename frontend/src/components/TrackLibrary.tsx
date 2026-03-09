"use client";

import { MusicNotes } from "@phosphor-icons/react";
import { TrackCard, TrackCardSkeleton } from "@/components/TrackCard";
import type { Track } from "@/types";

interface TrackLibraryProps {
  tracks: Track[];
  isLoading: boolean;
  onCreateClip: (track: Track) => void;
  onDeleteTrack: (track: Track) => void;
}

export function TrackLibrary({
  tracks,
  isLoading,
  onCreateClip,
  onDeleteTrack,
}: TrackLibraryProps) {
  if (isLoading) {
    return (
      <section aria-label="Track library loading">
        <h2 className="text-lg font-semibold tracking-tighter text-zinc-100 mb-4">
          Library
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <TrackCardSkeleton />
          <TrackCardSkeleton />
          <TrackCardSkeleton />
        </div>
      </section>
    );
  }

  if (tracks.length === 0) {
    return (
      <section aria-label="Track library empty">
        <h2 className="text-lg font-semibold tracking-tighter text-zinc-100 mb-4">
          Library
        </h2>
        <div className="border border-dashed border-zinc-800 rounded-xl px-8 py-16 flex flex-col items-center gap-3">
          <MusicNotes size={40} className="text-zinc-700" />
          <p className="text-sm text-zinc-500 text-center max-w-[45ch]">
            Your library is empty. Paste a URL above to add your first track.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Track library">
      <h2 className="text-lg font-semibold tracking-tighter text-zinc-100 mb-4">
        Library
        <span className="ml-2 text-xs font-mono text-zinc-600 font-normal">
          {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
        </span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tracks.map((track) => (
          <TrackCard
            key={track.trackId}
            track={track}
            onCreateClip={onCreateClip}
            onDeleteTrack={onDeleteTrack}
          />
        ))}
      </div>
    </section>
  );
}
