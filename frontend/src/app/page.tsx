"use client";

import { useState, useCallback } from "react";
import { Header } from "@/components/Header";
import { AddTrack } from "@/components/AddTrack";
import { TrackLibrary } from "@/components/TrackLibrary";
import { ClipEditor } from "@/components/ClipEditor";
import { PlaylistSidebar } from "@/components/PlaylistSidebar";
import { Player } from "@/components/Player";
import type { Track, Clip } from "@/types";

export default function HomePage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);

  const handleTrackResolved = useCallback((track: Track) => {
    setTracks((prev) => {
      const exists = prev.some((t) => t.trackId === track.trackId);
      if (exists) return prev;
      return [...prev, track];
    });
  }, []);

  const handleCreateClip = useCallback((track: Track) => {
    setEditingTrack(track);
  }, []);

  const handleClipCreated = useCallback((clip: Clip) => {
    setClips((prev) => [...prev, clip]);
    setEditingTrack(null);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditingTrack(null);
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Header />

      <div className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-6 pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          {/* Main content */}
          <main className="space-y-8 min-w-0">
            <AddTrack onTrackResolved={handleTrackResolved} />

            {editingTrack ? (
              <ClipEditor
                track={editingTrack}
                onClose={handleCloseEditor}
                onClipCreated={handleClipCreated}
              />
            ) : null}

            <TrackLibrary
              tracks={tracks}
              isLoading={false}
              onCreateClip={handleCreateClip}
            />
          </main>

          {/* Sidebar */}
          <div className="lg:border-l lg:border-zinc-800/60 lg:pl-8">
            <PlaylistSidebar tracks={tracks} clips={clips} />
          </div>
        </div>
      </div>

      <Player />
    </div>
  );
}
