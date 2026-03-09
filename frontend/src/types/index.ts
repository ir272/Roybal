export interface Track {
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl: string;
  platform: string;
}

export interface Clip {
  id: string;
  trackId: string;
  label: string;
  startMs: number;
  endMs: number | null;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface PlaylistItem {
  id: string;
  playlistId: string;
  trackId: string;
  clipId: string | null;
  position: number;
  track: Track;
  clip: Clip | null;
}

export interface PlaylistWithItems extends Playlist {
  items: PlaylistItem[];
}

export interface ResolveResponse {
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl: string;
  platform: string;
}

export interface PlayerState {
  currentTrack: Track | null;
  currentClip: Clip | null;
  playlist: PlaylistItem[];
  currentIndex: number;
  isPlaying: boolean;
  currentTimeMs: number;
  loopMode: "none" | "track" | "playlist";
}
