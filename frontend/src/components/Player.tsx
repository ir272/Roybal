"use client";

import { useCallback, useRef, type MouseEvent } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  RepeatOnce,
  SpeakerHigh,
  CircleNotch,
} from "@phosphor-icons/react";
import { usePlayerContext } from "@/lib/PlayerContext";

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function Player() {
  const {
    currentTrack,
    currentClip,
    isPlaying,
    isBuffering,
    currentTimeMs,
    durationMs,
    loopMode,
    playlist,
    togglePlay,
    next,
    prev,
    seek,
    setLoopMode,
  } = usePlayerContext();

  const progressRef = useRef<HTMLDivElement>(null);

  const handleSeek = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || !currentTrack) return;
      const rect = progressRef.current.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      seek(ratio * durationMs);
    },
    [durationMs, seek, currentTrack]
  );

  const cycleLoopMode = useCallback(() => {
    const modes: Array<"none" | "track" | "playlist"> = [
      "none",
      "track",
      "playlist",
    ];
    const currentIdx = modes.indexOf(loopMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    setLoopMode(nextMode);
  }, [loopMode, setLoopMode]);

  const progressPct =
    durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;

  const clipStartPct =
    currentClip && durationMs > 0
      ? (currentClip.startMs / durationMs) * 100
      : null;
  const clipEndPct =
    currentClip && currentClip.endMs && durationMs > 0
      ? (currentClip.endMs / durationMs) * 100
      : null;

  const hasPlaylist = playlist.length > 0;

  return (
    <footer
      className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-800"
      aria-label="Audio player"
    >
      {/* Progress bar */}
      <div
        ref={progressRef}
        onClick={handleSeek}
        className="h-1 bg-zinc-800 cursor-pointer group relative"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={Math.floor(currentTimeMs)}
      >
        {/* Clip region */}
        {clipStartPct !== null ? (
          <div
            className="absolute top-0 h-full bg-emerald-500/20"
            style={{
              left: `${clipStartPct}%`,
              width: clipEndPct
                ? `${clipEndPct - clipStartPct}%`
                : `${100 - clipStartPct}%`,
            }}
          />
        ) : null}

        {/* Progress fill */}
        <div
          className="h-full bg-emerald-500 transition-none relative"
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-emerald-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-6">
        {/* Now playing */}
        <div className="flex items-center gap-3 w-[280px] min-w-0 shrink-0">
          {currentTrack ? (
            <>
              <div className="w-10 h-10 rounded bg-zinc-800 overflow-hidden shrink-0">
                {currentTrack.thumbnailUrl ? (
                  <img
                    src={currentTrack.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <SpeakerHigh size={16} className="text-zinc-600" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate leading-tight">
                  {currentTrack.title}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {currentClip ? (
                    <span className="text-emerald-500/80">
                      {currentClip.label}
                    </span>
                  ) : (
                    currentTrack.artist
                  )}
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-600">Nothing playing</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 justify-center flex-1">
          <button
            onClick={prev}
            disabled={!currentTrack}
            className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous"
          >
            <SkipBack size={18} weight="fill" />
          </button>
          <button
            onClick={togglePlay}
            disabled={!currentTrack}
            className="w-9 h-9 rounded-full bg-zinc-200 text-zinc-950 flex items-center justify-center
                       hover:bg-zinc-100 active:scale-[0.95] transition-all duration-200 ease-spring
                       disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={isBuffering ? "Loading" : isPlaying ? "Pause" : "Play"}
          >
            {isBuffering ? (
              <CircleNotch size={18} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={18} weight="fill" />
            ) : (
              <Play size={18} weight="fill" />
            )}
          </button>
          <button
            onClick={next}
            disabled={!currentTrack}
            className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next"
          >
            <SkipForward size={18} weight="fill" />
          </button>
        </div>

        {/* Time + loop */}
        <div className="flex items-center gap-3 w-[280px] justify-end shrink-0">
          <span className="text-[11px] font-mono text-zinc-500">
            {currentTrack
              ? `${formatTime(currentTimeMs)} / ${formatTime(durationMs)}`
              : "--:-- / --:--"}
          </span>
          <button
            onClick={cycleLoopMode}
            className={`btn-ghost p-1.5 ${
              loopMode !== "none" ? "text-emerald-400" : ""
            }`}
            aria-label={`Loop mode: ${loopMode}`}
            title={`Loop: ${loopMode}`}
          >
            {loopMode === "track" ? (
              <RepeatOnce size={18} />
            ) : (
              <Repeat size={18} />
            )}
          </button>
        </div>
      </div>
    </footer>
  );
}
