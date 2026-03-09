"use client";

import { Waveform } from "@phosphor-icons/react";

export function Header() {
  return (
    <header className="border-b border-zinc-900">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center gap-3">
        <Waveform size={28} weight="bold" className="text-emerald-500" />
        <h1 className="text-xl font-semibold tracking-tighter text-zinc-100">
          Roybal
        </h1>
        <span className="text-xs text-zinc-600 font-mono mt-0.5">
          clip-aware player
        </span>
      </div>
    </header>
  );
}
