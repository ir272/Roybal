"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type { Track, Clip, PlaylistItem } from "@/types";
import { getAudioUrl } from "@/lib/api";

type LoopMode = "none" | "track" | "playlist";

interface PlayerContextValue {
  currentTrack: Track | null;
  currentClip: Clip | null;
  playlist: PlaylistItem[];
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTimeMs: number;
  durationMs: number;
  loopMode: LoopMode;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playTrack: (track: Track, clip?: Clip | null) => void;
  playPlaylist: (items: PlaylistItem[], startIndex?: number) => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (timeMs: number) => void;
  next: () => void;
  prev: () => void;
  setLoopMode: (mode: LoopMode) => void;
  setCurrentTimeMs: (ms: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayerContext(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayerContext must be used within PlayerProvider");
  }
  return ctx;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [currentClip, setCurrentClip] = useState<Clip | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [loopMode, setLoopMode] = useState<LoopMode>("none");

  const clipRef = useRef<Clip | null>(null);
  const loopModeRef = useRef<LoopMode>("none");
  const playlistRef = useRef<PlaylistItem[]>([]);
  const currentIndexRef = useRef<number>(-1);

  useEffect(() => {
    clipRef.current = currentClip;
  }, [currentClip]);

  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Keep a ref to any pending canplay handler so we can clean it up
  const pendingCanPlayRef = useRef<(() => void) | null>(null);

  const loadAndPlay = useCallback(
    (track: Track, clip: Clip | null) => {
      const audio = audioRef.current;
      if (!audio) return;

      // Clean up any previous pending canplay listener
      if (pendingCanPlayRef.current) {
        audio.removeEventListener("canplay", pendingCanPlayRef.current);
        pendingCanPlayRef.current = null;
      }

      setCurrentTrack(track);
      setCurrentClip(clip);
      setDurationMs(track.durationMs);
      setIsBuffering(true);

      const url = getAudioUrl(track.trackId);
      const fullUrl = window.location.origin + url;

      // Always set the src for a new track
      if (audio.src !== fullUrl) {
        audio.src = url;
      }

      const startSec = clip ? clip.startMs / 1000 : 0;

      const startPlayback = () => {
        setIsBuffering(false);
        audio.currentTime = startSec;
        audio.play().then(() => {
          setIsPlaying(true);
        }).catch((err) => {
          console.error("Playback failed:", err);
          setIsPlaying(false);
        });
      };

      if (audio.readyState >= 3) {
        startPlayback();
      } else {
        const onCanPlay = () => {
          audio.removeEventListener("canplay", onCanPlay);
          pendingCanPlayRef.current = null;
          startPlayback();
        };
        pendingCanPlayRef.current = onCanPlay;
        audio.addEventListener("canplay", onCanPlay);
        audio.load();
      }
    },
    []
  );

  const advanceToNext = useCallback(() => {
    const pl = playlistRef.current;
    const idx = currentIndexRef.current;
    const loop = loopModeRef.current;

    if (loop === "track") {
      const clip = clipRef.current;
      const audio = audioRef.current;
      if (audio && clip) {
        audio.currentTime = clip.startMs / 1000;
        audio.play().catch(() => setIsPlaying(false));
      } else if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => setIsPlaying(false));
      }
      return;
    }

    if (pl.length > 0 && idx >= 0) {
      let nextIdx = idx + 1;
      if (nextIdx >= pl.length) {
        if (loop === "playlist") {
          nextIdx = 0;
        } else {
          setIsPlaying(false);
          return;
        }
      }
      setCurrentIndex(nextIdx);
      const item = pl[nextIdx];
      if (item) {
        loadAndPlay(item.track, item.clip);
      }
    } else {
      setIsPlaying(false);
    }
  }, [loadAndPlay]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      const timeMs = audio.currentTime * 1000;
      setCurrentTimeMs(timeMs);

      const clip = clipRef.current;
      if (clip && clip.endMs !== null && timeMs >= clip.endMs) {
        audio.pause();
        advanceToNext();
      }
    };

    const handleEnded = () => {
      advanceToNext();
    };

    const handleDurationChange = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDurationMs(audio.duration * 1000);
      }
    };

    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);
    const handleError = () => {
      console.error("Audio error:", audio.error);
      setIsBuffering(false);
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("error", handleError);
    };
  }, [advanceToNext]);

  const playTrack = useCallback(
    (track: Track, clip?: Clip | null) => {
      setPlaylist([]);
      setCurrentIndex(-1);
      loadAndPlay(track, clip ?? null);
    },
    [loadAndPlay]
  );

  const playPlaylist = useCallback(
    (items: PlaylistItem[], startIndex: number = 0) => {
      setPlaylist(items);
      setCurrentIndex(startIndex);
      const item = items[startIndex];
      if (item) {
        loadAndPlay(item.track, item.clip);
      }
    },
    [loadAndPlay]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
  }, []);

  const seek = useCallback((timeMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = timeMs / 1000;
    setCurrentTimeMs(timeMs);
  }, []);

  const next = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

  const prev = useCallback(() => {
    const pl = playlistRef.current;
    const idx = currentIndexRef.current;

    if (pl.length > 0 && idx > 0) {
      const prevIdx = idx - 1;
      setCurrentIndex(prevIdx);
      const item = pl[prevIdx];
      if (item) {
        loadAndPlay(item.track, item.clip);
      }
    } else {
      const audio = audioRef.current;
      if (audio) {
        const clip = clipRef.current;
        audio.currentTime = clip ? clip.startMs / 1000 : 0;
      }
    }
  }, [loadAndPlay]);

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        currentClip,
        playlist,
        currentIndex,
        isPlaying,
        isBuffering,
        currentTimeMs,
        durationMs,
        loopMode,
        audioRef,
        playTrack,
        playPlaylist,
        togglePlay,
        pause,
        seek,
        next,
        prev,
        setLoopMode,
        setCurrentTimeMs,
      }}
    >
      <audio ref={audioRef} preload="auto" />
      {children}
    </PlayerContext.Provider>
  );
}
