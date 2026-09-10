import { onYandexApiResponse } from "./utils.js";

type ArtistMeta = { id: string; name: string; avatarUri?: string };
type AlbumMeta = {
  id: number;
  title: string;
  year?: number;
  isAvailable: boolean;
  genre?: string;
  trackCount: number;
};
export type TrackMeta = {
  id: string;
  title: string;
  version?: string;
  coverUri?: string;
  durationMs: number;
  albumId: number;
  type: string;
  genre: string;
  isAvailable: boolean;
  artists: ArtistMeta[];
  albums?: AlbumMeta[];
};

const MAX_META_CACHE_SIZE = 200;
const MAX_URL_MAPPINGS = 1_000;
let currentTrackId: string | null = null;
let currentTrackMeta: TrackMeta | null = null;
const metaCache = new Map<string, TrackMeta>();
const inflight = new Map<string, Promise<TrackMeta | null>>();
const urlToTrackId = new Map<string, string>();

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function getCachedMeta(trackId: string): TrackMeta | undefined {
  const cached = metaCache.get(trackId);
  if (cached) setBounded(metaCache, trackId, cached, MAX_META_CACHE_SIZE);
  return cached;
}

function normalizeAudioUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

async function fetchTrackMeta(trackId: string): Promise<TrackMeta | null> {
  const cached = getCachedMeta(trackId);
  if (cached) return cached;
  const currentRequest = inflight.get(trackId);
  if (currentRequest) return currentRequest;

  const promise = (async () => {
    try {
      const endpoint = new URL("/tracks", "https:" + "//api.music.yandex.net");
      endpoint.searchParams.set("trackIds", trackId);
      const response = await fetch(endpoint, { method: "GET", credentials: "include" });
      if (!response.ok) {
        console.warn(`[track-meta-store] /tracks returned ${response.status}`);
        return null;
      }

      const json = await response.json();
      const tracks = Array.isArray(json) ? json : json?.result;
      const track = Array.isArray(tracks) ? tracks[0] : null;
      if (!track || typeof track !== "object") return null;

      const meta: TrackMeta = {
        id: String(track.id ?? trackId),
        title: String(track.title ?? ""),
        version: typeof track.version === "string" ? track.version : undefined,
        coverUri: track.coverUri || track.ogImage || undefined,
        durationMs: Number(track.durationMs ?? 0),
        albumId: Number(track.albums?.[0]?.id ?? 0),
        type: String(track.type ?? "music"),
        genre: String(track.albums?.[0]?.genre ?? track.genre ?? ""),
        isAvailable: track.available !== false,
        artists: Array.isArray(track.artists)
          ? track.artists.map((artist: any) => ({
              id: String(artist.id ?? ""),
              name: String(artist.name ?? ""),
              avatarUri: artist?.cover?.uri || artist?.ogImage || undefined,
            }))
          : [],
        albums: Array.isArray(track.albums)
          ? track.albums.map((album: any) => ({
              id: Number(album.id),
              title: String(album.title ?? ""),
              year: Number.isFinite(album.year) ? album.year : undefined,
              isAvailable: album.available !== false,
              genre: typeof album.genre === "string" ? album.genre : undefined,
              trackCount: Number(album.trackCount ?? 0),
            }))
          : undefined,
      };

      setBounded(metaCache, trackId, meta, MAX_META_CACHE_SIZE);
      return meta;
    } catch (error) {
      console.warn(`[track-meta-store] fetch failed for ${trackId}:`, error);
      return null;
    } finally {
      inflight.delete(trackId);
    }
  })();

  inflight.set(trackId, promise);
  return promise;
}

function indexFileInfoEntry(entry: any): void {
  if (!entry || typeof entry !== "object") return;
  const trackId = entry.trackId ?? entry.id;
  if (trackId == null) return;
  const normalizedTrackId = String(trackId);
  void fetchTrackMeta(normalizedTrackId);

  const candidates: string[] = [];
  const visit = (value: any): void => {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) candidates.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(entry);

  for (const candidate of candidates) {
    const key = normalizeAudioUrl(candidate);
    if (key) setBounded(urlToTrackId, key, normalizedTrackId, MAX_URL_MAPPINGS);
  }
}

function trackIdFromAudio(audio: HTMLAudioElement | null): string | null {
  const key = audio?.src ? normalizeAudioUrl(audio.src) : null;
  if (!key) return null;
  const id = urlToTrackId.get(key) ?? null;
  if (id) setBounded(urlToTrackId, key, id, MAX_URL_MAPPINGS);
  return id;
}

async function syncCurrentFromAudio(): Promise<void> {
  const audio = window.__yamodGetActiveAudio?.() ?? null;
  const id = trackIdFromAudio(audio);
  if (!id || (id === currentTrackId && currentTrackMeta)) return;

  currentTrackId = id;
  const cached = getCachedMeta(id);
  if (cached) {
    currentTrackMeta = cached;
    return;
  }

  const meta = await fetchTrackMeta(id);
  if (meta && currentTrackId === id) currentTrackMeta = meta;
}

export function initTrackMetaStore(): void {
  if ((window as any).__yamodTrackMetaStoreInit) return;
  (window as any).__yamodTrackMetaStoreInit = true;

  onYandexApiResponse("get-file-info", (context: { url: string; data: any }) => {
    try {
      const url = new URL(context.url);
      const data = context.data;
      const singleId = url.searchParams.get("trackId");
      const batchIds = url.searchParams.get("trackIds");

      if (Array.isArray(data?.result)) {
        data.result.forEach(indexFileInfoEntry);
      } else if (data?.result && typeof data.result === "object") {
        indexFileInfoEntry({ trackId: singleId, ...data.result });
      } else if (data && typeof data === "object") {
        indexFileInfoEntry({ trackId: singleId || batchIds?.split(",")[0], ...data });
      }
    } catch (error) {
      console.warn("[track-meta-store] response handler error:", error);
    }
    return context.data;
  });

  window.setInterval(() => void syncCurrentFromAudio(), 500);

  (window as any).__yamodGetCurrentTrackMeta = () => currentTrackMeta;
  (window as any).__yamodGetCurrentTrackId = () => currentTrackId;
  (window as any).__yamodGetUrlToTrackIdMap = () => Object.fromEntries(urlToTrackId);
  (window as any).__yamodGetActiveAudioSrc = () => window.__yamodGetActiveAudio?.()?.src ?? null;
}

export function getCurrentTrackMeta(): TrackMeta | null {
  return currentTrackMeta;
}

export function getCurrentTrackId(): string | null {
  return currentTrackId;
}
