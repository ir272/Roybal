"use client";

import { useState, useCallback } from "react";
import { usePlayerContext } from "@/lib/PlayerContext";
import { createClip } from "@/lib/api";
import type { Clip, Track } from "@/types";

interface ClipEditorState {
  isOpen: boolean;
  track: Track | null;
  label: string;
  startMs: number;
  endMs: number | null;
  isSaving: boolean;
  error: string | null;
}

interface UseClipEditorReturn {
  state: ClipEditorState;
  openEditor: (track: Track) => void;
  closeEditor: () => void;
  setLabel: (label: string) => void;
  setStartMs: (ms: number) => void;
  setEndMs: (ms: number | null) => void;
  markStart: () => void;
  markEnd: () => void;
  saveClip: () => Promise<Clip | null>;
}

export function useClipEditor(): UseClipEditorReturn {
  const { currentTimeMs } = usePlayerContext();

  const [state, setState] = useState<ClipEditorState>({
    isOpen: false,
    track: null,
    label: "",
    startMs: 0,
    endMs: null,
    isSaving: false,
    error: null,
  });

  const openEditor = useCallback((track: Track) => {
    setState({
      isOpen: true,
      track,
      label: "",
      startMs: 0,
      endMs: null,
      isSaving: false,
      error: null,
    });
  }, []);

  const closeEditor = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false, track: null }));
  }, []);

  const setLabel = useCallback((label: string) => {
    setState((prev) => ({ ...prev, label }));
  }, []);

  const setStartMs = useCallback((ms: number) => {
    setState((prev) => ({ ...prev, startMs: ms }));
  }, []);

  const setEndMs = useCallback((ms: number | null) => {
    setState((prev) => ({ ...prev, endMs: ms }));
  }, []);

  const markStart = useCallback(() => {
    setState((prev) => ({ ...prev, startMs: Math.floor(currentTimeMs) }));
  }, [currentTimeMs]);

  const markEnd = useCallback(() => {
    setState((prev) => ({ ...prev, endMs: Math.floor(currentTimeMs) }));
  }, [currentTimeMs]);

  const saveClip = useCallback(async (): Promise<Clip | null> => {
    if (!state.track) return null;
    if (!state.label.trim()) {
      setState((prev) => ({ ...prev, error: "Label is required" }));
      return null;
    }

    setState((prev) => ({ ...prev, isSaving: true, error: null }));

    try {
      const clip = await createClip({
        trackId: state.track.trackId,
        label: state.label.trim(),
        startMs: state.startMs,
        endMs: state.endMs ?? undefined,
      });
      setState((prev) => ({
        ...prev,
        isSaving: false,
        isOpen: false,
        track: null,
      }));
      return clip;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save clip";
      setState((prev) => ({ ...prev, isSaving: false, error: message }));
      return null;
    }
  }, [state.track, state.label, state.startMs, state.endMs]);

  return {
    state,
    openEditor,
    closeEditor,
    setLabel,
    setStartMs,
    setEndMs,
    markStart,
    markEnd,
    saveClip,
  };
}
