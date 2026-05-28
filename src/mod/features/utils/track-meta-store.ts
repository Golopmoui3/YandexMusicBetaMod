// Хранилище метаданных текущего трека.
//
// Стратегия (5.104.2-friendly):
// 1. Перехватываем /get-file-info и /get-file-info/batch на УРОВНЕ ОТВЕТА —
//    response содержит CDN URL аудио-файла (downloadInfoUrl / urls / src).
//    Маппим URL → trackId (host+path как ключ).
// 2. Параллельно прекэшируем TrackMeta для каждого замеченного trackId
//    через /tracks?trackIds=NNN.
// 3. Текущий играющий трек определяем по audio.src — берём активный
//    <audio> элемент через __yamodGetActiveAudio() и смотрим в URL→ID
//    маппинг. Это даёт МОМЕНТАЛЬНУЮ синхронизацию с реально играющим
//    треком, а не с тем что Yandex Music preload-ит.
//
// Резоны:
// - В 5.104.2 entityMeta больше не передаётся через JSX-пропсы, fiber-поиск
//   не работает.
// - /get-file-info/batch шлётся ДЛЯ ПРЕДЗАГРУЗКИ СЛЕДУЮЩЕГО трека —
//   если использовать его trackId напрямую, в Discord будет следующий трек.

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

let currentTrackId: string | null = null;
let currentTrackMeta: TrackMeta | null = null;
const metaCache = new Map<string, TrackMeta>();
const inflight: Map<string, Promise<TrackMeta | null>> = new Map();

// Map: ключ — нормализованный URL аудио (host + первые ~80 символов path,
// без query/fragment), значение — trackId.
const urlToTrackId = new Map<string, string>();

function normalizeAudioUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    // Yandex кладёт сам файл в path: /get-mp3/.../... или /file/...
    // Игнорируем query (sign и ts меняются между запросами того же файла).
    // Хост стабильный (s31vla.storage.yandex.net и т.п.).
    return `${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

async function fetchTrackMeta(trackId: string): Promise<TrackMeta | null> {
  if (metaCache.has(trackId)) return metaCache.get(trackId)!;
  if (inflight.has(trackId)) return inflight.get(trackId)!;

  const promise = (async () => {
    try {
      const res = await fetch(`https://api.music.yandex.net/tracks?trackIds=${encodeURIComponent(trackId)}`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        console.warn(`[track-meta-store] /tracks?trackIds=${trackId} returned ${res.status}`);
        return null;
      }
      const json = await res.json();
      const track = json?.result?.[0];
      if (!track) {
        console.warn(`[track-meta-store] /tracks response has no result[0]:`, json);
        return null;
      }

      const meta: TrackMeta = {
        id: String(track.id ?? trackId),
        title: track.title ?? "",
        version: track.version || undefined,
        coverUri: track.coverUri || track.ogImage || undefined,
        durationMs: track.durationMs ?? 0,
        albumId: track.albums?.[0]?.id ?? 0,
        type: track.type ?? "music",
        genre: track.albums?.[0]?.genre ?? track.genre ?? "",
        isAvailable: !!track.available,
        artists: Array.isArray(track.artists)
          ? track.artists.map((a: any) => ({
              id: String(a.id),
              name: String(a.name ?? ""),
              // У артиста есть cover (тоже c %% placeholder, как coverUri у трека).
              // Поля: cover.uri или ogImage. Иногда null/undefined.
              avatarUri: a?.cover?.uri || a?.ogImage || undefined,
            }))
          : [],
        albums: Array.isArray(track.albums)
          ? track.albums.map((al: any) => ({
              id: Number(al.id),
              title: String(al.title ?? ""),
              year: al.year,
              isAvailable: !!al.available,
              genre: al.genre,
              trackCount: Number(al.trackCount ?? 0),
            }))
          : undefined,
      };

      metaCache.set(trackId, meta);
      return meta;
    } catch (e) {
      console.warn(`[track-meta-store] fetch failed for ${trackId}:`, e);
      return null;
    } finally {
      inflight.delete(trackId);
    }
  })();

  inflight.set(trackId, promise);
  return promise;
}

// Прекэширует мету и URL-маппинг для одного результата /get-file-info(/batch).
// fileInfoResult — это либо { trackId, downloadInfo: {...} } либо плоский ответ.
function indexFileInfoEntry(entry: any): void {
  if (!entry || typeof entry !== "object") return;
  const trackId = entry.trackId ?? entry.id;
  if (!trackId) return;
  const idStr = String(trackId);

  // Прекэшируем мета в фоне
  fetchTrackMeta(idStr);

  // Ищем все URL-подобные строки в ответе — Yandex меняет shape между версиями.
  // Известные поля: urls (Array<string>), src, downloadInfoUrl, mainUrl, fallbackUrl
  const candidates: string[] = [];
  const visit = (v: any) => {
    if (typeof v === "string" && v.startsWith("http")) candidates.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(entry);

  for (const url of candidates) {
    const key = normalizeAudioUrl(url);
    if (key) urlToTrackId.set(key, idStr);
  }
}

// Резолвит trackId из текущего audio.src — находим в маппинге.
function trackIdFromAudio(audio: HTMLAudioElement | null): string | null {
  if (!audio || !audio.src) return null;
  const key = normalizeAudioUrl(audio.src);
  if (!key) return null;
  return urlToTrackId.get(key) ?? null;
}

async function syncCurrentFromAudio(): Promise<void> {
  const audio = (window as any).__yamodGetActiveAudio?.() as HTMLAudioElement | null;
  const id = trackIdFromAudio(audio);
  if (!id) return;
  if (id === currentTrackId && currentTrackMeta) return;

  currentTrackId = id;
  // Если мета уже в кэше — ставим мгновенно
  if (metaCache.has(id)) {
    currentTrackMeta = metaCache.get(id)!;
    console.log(`[track-meta-store] current → ${id} (${currentTrackMeta.title}) [cache hit]`);
    return;
  }
  // Иначе подгружаем
  const meta = await fetchTrackMeta(id);
  if (meta && currentTrackId === id) {
    currentTrackMeta = meta;
    console.log(`[track-meta-store] current → ${id} (${meta.title})`);
  }
}

export function initTrackMetaStore(): void {
  if ((window as any).__yamodTrackMetaStoreInit) return;
  (window as any).__yamodTrackMetaStoreInit = true;

  // Перехватываем RESPONSE /get-file-info — индексируем URL→trackId.
  onYandexApiResponse("get-file-info", (ctx: { url: string; data: any }) => {
    try {
      const url = new URL(ctx.url);
      const data = ctx.data;

      // Одиночный get-file-info: ?trackId=NNN — в ответе нет trackId, добавим.
      const singleId = url.searchParams.get("trackId");
      // Batch: ?trackIds=NNN[,MMM]
      const batchIds = url.searchParams.get("trackIds");

      if (Array.isArray(data?.result)) {
        // Batch ответ: result — массив
        for (const entry of data.result) indexFileInfoEntry(entry);
      } else if (data?.result && typeof data.result === "object") {
        // Single ответ: result — объект. trackId берём из URL.
        const entry = { trackId: singleId, ...data.result };
        indexFileInfoEntry(entry);
      } else if (data && typeof data === "object") {
        // Совсем плоский (старый формат)
        const entry = { trackId: singleId || batchIds?.split(",")[0], ...data };
        indexFileInfoEntry(entry);
      }
    } catch (e) {
      console.warn("[track-meta-store] response handler error:", e);
    }
    // Не модифицируем ответ
    return ctx.data;
  });

  // Polling audio.src каждые 500ms — даёт мгновенную реакцию на смену трека.
  setInterval(syncCurrentFromAudio, 500);

  // Debug
  (window as any).__yamodGetCurrentTrackMeta = () => currentTrackMeta;
  (window as any).__yamodGetCurrentTrackId = () => currentTrackId;
  (window as any).__yamodGetUrlToTrackIdMap = () => Object.fromEntries(urlToTrackId);
  (window as any).__yamodGetActiveAudioSrc = () => {
    const a = (window as any).__yamodGetActiveAudio?.() as HTMLAudioElement | null;
    return a?.src ?? null;
  };
}

export function getCurrentTrackMeta(): TrackMeta | null {
  return currentTrackMeta;
}

export function getCurrentTrackId(): string | null {
  return currentTrackId;
}
