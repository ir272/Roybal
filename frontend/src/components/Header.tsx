"use client";

import { Waveform, Archive } from "@phosphor-icons/react";

export type ActiveView =
  | { type: "archive" }
  | { type: "playlist"; playlistId: string; playlistName: string };

interface HeaderProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
}

export function Header({ activeView, onNavigate }: HeaderProps) {
  return (
    <header className="border-b border-zinc-900">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-6">
        <div className="flex items-center gap-3">
          <Waveform size={28} weight="bold" className="text-emerald-500" />
          <h1 className="text-xl font-semibold tracking-tighter text-zinc-100">
            Roybal
          </h1>
        </div>

        <nav className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => onNavigate({ type: "archive" })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ease-spring active:scale-[0.98]
              ${
                activeView.type === "archive"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              }`}
          >
            <Archive size={16} />
            Archive
          </button>
        </nav>
      </div>
    </header>
  );
}
