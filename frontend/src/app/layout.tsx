import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { PlayerProvider } from "@/lib/PlayerContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roybal",
  description: "Universal music player with clip-aware playlists",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans min-h-[100dvh] bg-zinc-950 text-zinc-300">
        <PlayerProvider>{children}</PlayerProvider>
      </body>
    </html>
  );
}
