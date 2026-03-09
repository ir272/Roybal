"use client";

import { useState, useCallback, useEffect, useRef, type MouseEvent } from "react";
import {
  X,
  FloppyDisk,
  Play,
  Pause,
  FlagBanner,
  FlagCheckered,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";
import { usePlayerContext } from "@/lib/PlayerContext";
import type { Track, Clip } from "@/types";
import { createClip } from "@/lib/api";

function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const millis = ms % 1000;
  return `${min}:${sec.toString().padStart(2, "0")}.${Math.floor(millis / 10)
    .toString()
    .padStart(2, "0")}`;
}

function timestampToMs(timestamp: string): number | null {
  const match = timestamp.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const min = parseInt(match[1], 10);
  const sec = parseInt(match[2], 10);
  const ms = match[3]
    ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10)
    : 0;
  if (sec >= 60) return null;
  return min * 60000 + sec * 1000 + ms;
}

interface ClipEditorProps {
  track: Track;
  onClose: () => void;
  onClipCreated: (clip: Clip) => void;
}

export function ClipEditor({ track, onClose, onClipCreated }: ClipEditorProps) {
  const {
    currentTrack,
    isPlaying,
    currentTimeMs,
    playTrack,
    togglePlay,
    seek,
  } = usePlayerContext();

  const [label, setLabel] = useState("");
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState<number | null>(null);
  const [startText, setStartText] = useState("0:00.00");
  const [endText, setEndText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isThisTrack = currentTrack?.trackId === track.trackId;
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<"start" | "end" | null>(null);

  useEffect(() => {
    if (!isThisTrack) {
      playTrack(track);
    }
  }, [track, isThisTrack, playTrack]);

  const markStart = useCallback(() => {
    const ms = Math.floor(currentTimeMs);
    setStartMs(ms);
    setStartText(msToTimestamp(ms));
  }, [currentTimeMs]);

  const markEnd = useCallback(() => {
    const ms = Math.floor(currentTimeMs);
    setEndMs(ms);
    setEndText(msToTimestamp(ms));
  }, [currentTimeMs]);

  const handleStartTextChange = useCallback((val: string) => {
    setStartText(val);
    const ms = timestampToMs(val);
    if (ms !== null) {
      setStartMs(ms);
    }
  }, []);

  const handleEndTextChange = useCallback((val: string) => {
    setEndText(val);
    if (val.trim() === "") {
      setEndMs(null);
      return;
    }
    const ms = timestampToMs(val);
    if (ms !== null) {
      setEndMs(ms);
    }
  }, []);

  const handleProgressClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const timeMs = ratio * track.durationMs;
      seek(timeMs);
    },
    [track.durationMs, seek]
  );

  const handleDrag = useCallback(
    (e: MouseEvent<HTMLDivElement>, type: "start" | "end") => {
      e.stopPropagation();
      e.preventDefault();
      setIsDragging(type);

      const onMove = (moveEvent: globalThis.MouseEvent) => {
        if (!progressBarRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const ratio = Math.max(
          0,
          Math.min(1, (moveEvent.clientX - rect.left) / rect.width)
        );
        const ms = Math.floor(ratio * track.durationMs);
        if (type === "start") {
          setStartMs(ms);
          setStartText(msToTimestamp(ms));
        } else {
          setEndMs(ms);
          setEndText(msToTimestamp(ms));
        }
      };

      const onUp = () => {
        setIsDragging(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [track.durationMs]
  );

  const handleSave = useCallback(async () => {
    if (!label.trim()) {
      setError("Label is required");
      return;
    }
    if (endMs !== null && endMs <= startMs) {
      setError("End time must be after start time");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const clip = await createClip({
        trackId: track.trackId,
        label: label.trim(),
        startMs,
        endMs: endMs ?? undefined,
      });
      onClipCreated(clip);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save clip";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [label, startMs, endMs, track.trackId, onClipCreated]);

  const playheadPct =
    track.durationMs > 0 ? (currentTimeMs / track.durationMs) * 100 : 0;
  const startPct =
    track.durationMs > 0 ? (startMs / track.durationMs) * 100 : 0;
  const endPct =
    endMs !== null && track.durationMs > 0
      ? (endMs / track.durationMs) * 100
      : null;

  return (
    <section
      aria-label="Clip editor"
      className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Create clip
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[300px]">
            {track.title}
          </p>
        </div>
        <button
          onClick={onClose}
          className="btn-ghost p-1.5"
          aria-label="Close editor"
        >
          <X size={18} />
        </button>
      </div>

      {/* Progress bar with markers */}
      <div className="space-y-2">
        <div
          ref={progressBarRef}
          onClick={handleProgressClick}
          className="relative h-10 bg-zinc-800 rounded-lg cursor-pointer group"
          role="slider"
          aria-label="Track progress"
          aria-valuemin={0}
          aria-valuemax={track.durationMs}
          aria-valuenow={Math.floor(currentTimeMs)}
        >
          {/* Clip region highlight */}
          {endPct !== null ? (
            <div
              className="absolute top-0 h-full bg-emerald-500/15 rounded"
              style={{
                left: `${startPct}%`,
                width: `${endPct - startPct}%`,
              }}
            />
          ) : (
            <div
              className="absolute top-0 h-full bg-emerald-500/10 rounded-r"
              style={{
                left: `${startPct}%`,
                right: "0",
              }}
            />
          )}

          {/* Playhead */}
          <div
            className="absolute top-0 h-full w-0.5 bg-zinc-300 transition-none z-10"
            style={{ left: `${Math.min(playheadPct, 100)}%` }}
          />

          {/* Start marker */}
          <div
            onMouseDown={(e) => handleDrag(e, "start")}
            className={`absolute top-0 h-full w-1 cursor-ew-resize z-20
              ${isDragging === "start" ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-400"}`}
            style={{ left: `${startPct}%` }}
            aria-label="Start marker"
          >
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-emerald-400 whitespace-nowrap">
              IN
            </div>
          </div>

          {/* End marker */}
          {endPct !== null ? (
            <div
              onMouseDown={(e) => handleDrag(e, "end")}
              className={`absolute top-0 h-full w-1 cursor-ew-resize z-20
                ${isDragging === "end" ? "bg-red-400" : "bg-red-500 hover:bg-red-400"}`}
              style={{ left: `${endPct}%` }}
              aria-label="End marker"
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-red-400 whitespace-nowrap">
                OUT
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600">
          <span>{msToTimestamp(0)}</span>
          <span>{msToTimestamp(track.durationMs)}</span>
        </div>
      </div>

      {/* Tap to mark + playback */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (isThisTrack) {
              togglePlay();
            } else {
              playTrack(track);
            }
          }}
          className="btn-ghost p-2"
          aria-label={isThisTrack && isPlaying ? "Pause" : "Play"}
        >
          {isThisTrack && isPlaying ? (
            <Pause size={18} weight="fill" />
          ) : (
            <Play size={18} weight="fill" />
          )}
        </button>

        <span className="text-xs font-mono text-zinc-500 w-20">
          {msToTimestamp(isThisTrack ? currentTimeMs : 0)}
        </span>

        <div className="flex-1" />

        <button
          onClick={markStart}
          className="btn-ghost text-xs flex items-center gap-1.5 px-2 py-1"
          aria-label="Mark start time"
        >
          <FlagBanner size={14} className="text-emerald-500" />
          Mark start
        </button>
        <button
          onClick={markEnd}
          className="btn-ghost text-xs flex items-center gap-1.5 px-2 py-1"
          aria-label="Mark end time"
        >
          <FlagCheckered size={14} className="text-red-400" />
          Mark end
        </button>
      </div>

      {/* Timestamp inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-500 block">
            Start time (m:ss.ms)
          </label>
          <input
            type="text"
            value={startText}
            onChange={(e) => handleStartTextChange(e.target.value)}
            className="input-field w-full font-mono text-sm"
            placeholder="0:00.00"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-500 block">
            End time (m:ss.ms)
          </label>
          <input
            type="text"
            value={endText}
            onChange={(e) => handleEndTextChange(e.target.value)}
            className="input-field w-full font-mono text-sm"
            placeholder="Optional"
          />
        </div>
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <label className="text-xs text-zinc-500 block">Clip label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (error) setError(null);
          }}
          className="input-field w-full text-sm"
          placeholder='e.g. "the drop", "chorus", "that one part"'
        />
      </div>

      {/* Error */}
      {error ? (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <Warning size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving || !label.trim()}
          className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <CircleNotch size={16} className="animate-spin" />
          ) : (
            <FloppyDisk size={16} />
          )}
          {isSaving ? "Saving" : "Save clip"}
        </button>
      </div>
    </section>
  );
}
