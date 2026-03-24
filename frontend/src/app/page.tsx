"use client";

import { useState, useCallback, useEffect } from "react";
import { Header } from "@/components/Header";
import type { ActiveView } from "@/components/Header";
import { AddTrack } from "@/components/AddTrack";
import { TrackLibrary } from "@/components/TrackLibrary";
import { ClipEditor } from "@/components/ClipEditor";
import { PlaylistSidebar } from "@/components/PlaylistSidebar";
import { PlaylistDetailView } from "@/components/PlaylistDetailView";
import { Player } from "@/components/Player";
import { getTracks, getAllClips, deleteTrack } from "@/lib/api";
import type { Track, Clip, Playlist } from "@/types";

export default function HomePage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>({ type: "archive" });

  useEffect(() => {
    async function loadLibrary() {
      try {
        const [loadedTracks, loadedClips] = await Promise.all([
          getTracks(),
          getAllClips(),
        ]);
        setTracks(loadedTracks);
        setClips(loadedClips);
      } catch (err) {
        console.error("Failed to load library:", err);
      } finally {
        setIsLoadingLibrary(false);
      }
    }
    loadLibrary();
  }, []);

  const handleTrackResolved = useCallback((track: Track) => {
    setTracks((prev) => {
      const exists = prev.some((t) => t.trackId === track.trackId);
      if (exists) return prev;
      return [...prev, track];
    });
  }, []);

  const handleDeleteTrack = useCallback(async (track: Track) => {
    try {
      await deleteTrack(track.trackId);
      setTracks((prev) => prev.filter((t) => t.trackId !== track.trackId));
      setClips((prev) => prev.filter((c) => c.trackId !== track.trackId));
      if (editingTrack?.trackId === track.trackId) {
        setEditingTrack(null);
      }
    } catch (err) {
      console.error("Failed to delete track:", err);
    }
  }, [editingTrack]);

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

  const handleSelectPlaylist = useCallback((playlist: Playlist) => {
    setActiveView({
      type: "playlist",
      playlistId: playlist.id,
      playlistName: playlist.name,
    });
  }, []);

  const handleDeselectPlaylist = useCallback(() => {
    setActiveView({ type: "archive" });
  }, []);

  const handleNavigate = useCallback((view: ActiveView) => {
    setActiveView(view);
    if (view.type === "archive") {
      setEditingTrack(null);
    }
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Header activeView={activeView} onNavigate={handleNavigate} />

      <div className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-6 pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
          {/* Main content */}
          <main className="min-w-0">
            {activeView.type === "archive" ? (
              <div className="space-y-8">
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
                  isLoading={isLoadingLibrary}
                  onCreateClip={handleCreateClip}
                  onDeleteTrack={handleDeleteTrack}
                />
              </div>
            ) : (
              <PlaylistDetailView
                playlistId={activeView.playlistId}
                playlistName={activeView.playlistName}
                tracks={tracks}
                clips={clips}
              />
            )}
          </main>

          {/* Sidebar */}
          <div className="lg:border-l lg:border-zinc-800/60 lg:pl-6">
            <PlaylistSidebar
              selectedPlaylistId={
                activeView.type === "playlist" ? activeView.playlistId : null
              }
              onSelectPlaylist={handleSelectPlaylist}
              onDeselectPlaylist={handleDeselectPlaylist}
            />
          </div>
        </div>
      </div>

      <Player />
    </div>
  );
}
