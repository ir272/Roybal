import type { Track, Clip, Playlist, PlaylistWithItems, PlaylistItem, ResolveResponse, BatchResolveResponse } from "@/types";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "Unknown error");
    throw new ApiError(errorBody, res.status);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export async function getTracks(): Promise<Track[]> {
  return request<Track[]>("/api/tracks");
}

export async function getAllClips(): Promise<Clip[]> {
  return request<Clip[]>("/api/clips");
}

export async function deleteTrack(trackId: string): Promise<void> {
  await request<void>(`/api/tracks/${trackId}`, { method: "DELETE" });
}

export async function deletePlaylist(id: string): Promise<void> {
  await request<void>(`/api/playlists/${id}`, { method: "DELETE" });
}

export async function resolveTrack(url: string): Promise<ResolveResponse | BatchResolveResponse> {
  return request<ResolveResponse | BatchResolveResponse>("/api/resolve", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function isBatchResponse(
  response: ResolveResponse | BatchResolveResponse
): response is BatchResolveResponse {
  return "tracks" in response && Array.isArray((response as BatchResolveResponse).tracks);
}

export function getAudioUrl(trackId: string): string {
  return `/api/audio/${trackId}`;
}

export async function createClip(data: {
  trackId: string;
  label: string;
  startMs: number;
  endMs?: number;
}): Promise<Clip> {
  return request<Clip>("/api/clips", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getClips(trackId: string): Promise<Clip[]> {
  return request<Clip[]>(`/api/clips?trackId=${encodeURIComponent(trackId)}`);
}

export async function updateClip(
  id: string,
  data: { label?: string; startMs?: number; endMs?: number }
): Promise<Clip> {
  return request<Clip>(`/api/clips/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteClip(id: string): Promise<void> {
  await request<void>(`/api/clips/${id}`, { method: "DELETE" });
}

export async function createPlaylist(data: {
  name: string;
  description?: string;
}): Promise<Playlist> {
  return request<Playlist>("/api/playlists", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getPlaylists(): Promise<Playlist[]> {
  return request<Playlist[]>("/api/playlists");
}

export async function getPlaylist(id: string): Promise<PlaylistWithItems> {
  return request<PlaylistWithItems>(`/api/playlists/${id}`);
}

export async function addPlaylistItem(
  playlistId: string,
  data: { trackId: string; clipId?: string }
): Promise<PlaylistItem> {
  return request<PlaylistItem>(
    `/api/playlists/${playlistId}/items`,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
}

export async function reorderPlaylistItems(
  playlistId: string,
  items: { id: string; position: number }[]
): Promise<void> {
  await request<void>(`/api/playlists/${playlistId}/items`, {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });
}

export async function removePlaylistItem(
  playlistId: string,
  itemId: string
): Promise<void> {
  await request<void>(`/api/playlists/${playlistId}/items/${itemId}`, {
    method: "DELETE",
  });
}
