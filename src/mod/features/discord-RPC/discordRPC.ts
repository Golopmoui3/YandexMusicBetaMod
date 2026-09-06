import { getTrackMeta, getProgress, isPlaying } from "~/mod/features/utils/player";
import * as Sentry from "@sentry/react";

let isRpcEnabled = true;
let showModButton = true;
let showArtist = true;

// Пока плеер не может отдать состояние (навигация, перерисовка, загрузка трека),
// отдаём последнее валидное состояние, чтобы присутствие в Discord не мигало.
const GRACE_PERIOD_MS = 30_000;
let lastGoodData: PlayerStateData | null = null;
let lastGoodAt = 0;

type PlayerStateData = {
  trackMeta: any;
  playback: { duration: number; progress: number; position: number };
  isPlaying: boolean;
};

// Sentry.captureException со строкой теряет стек — оборачиваем в Error.
// Один и тот же контекст шлём не чаще раза в 5 минут, чтобы не сжечь квоту.
const lastSentAt = new Map<string, number>();
const SENTRY_THROTTLE_MS = 5 * 60_000;

function captureError(context: string, detail: unknown) {
  const now = Date.now();
  const last = lastSentAt.get(context) ?? 0;
  if (now - last < SENTRY_THROTTLE_MS) return;
  lastSentAt.set(context, now);
  Sentry.captureException(detail instanceof Error ? detail : new Error(`${context}: ${String(detail)}`), {
    extra: { context },
  });
  console.error(`[discordRPC] ${context}:`, detail);
}

// Было три одинаковых блока обработки Result-ошибок — теперь один.
function collectPlayerState(): { error: string } | { value: PlayerStateData } {
  const trackMetaRequest = getTrackMeta();
  if (trackMetaRequest.isErr()) return { error: `trackMeta: ${trackMetaRequest.error}` };

  const playbackRequest = getProgress();
  if (playbackRequest.isErr()) return { error: `playback: ${playbackRequest.error}` };

  const isPlayingRequest = isPlaying();
  if (isPlayingRequest.isErr()) return { error: `isPlaying: ${isPlayingRequest.error}` };

  return {
    value: {
      trackMeta: trackMetaRequest.value,
      playback: playbackRequest.value,
      isPlaying: isPlayingRequest.value,
    },
  };
}

// Функция для получения состояния плеера из окна приложения. Её вызывает main процесс - src\mod\main.js
window.__getPlayerState = () => {
  const result = collectPlayerState();

  if ("error" in result) {
    // upgrade_promocode - штатный ответ для аккаунтов без Плюса, это не ошибка.
    if (!result.error.includes("upgrade_promocode")) {
      captureError("Error getting player state", result.error);
    }

    if (lastGoodData && Date.now() - lastGoodAt < GRACE_PERIOD_MS) {
      return { enabled: isRpcEnabled, showModButton: showModButton, showArtist: showArtist, data: lastGoodData };
    }

    return {
      enabled: isRpcEnabled,
      showModButton: showModButton,
      showArtist: showArtist,
      data: null,
    };
  }

  lastGoodData = result.value;
  lastGoodAt = Date.now();

  return {
    enabled: isRpcEnabled,
    showModButton: showModButton,
    showArtist: showArtist,
    data: result.value,
  };
};

window.yandexMusicMod.onStorageChanged((key: string, value: any) => {
  if (key === "discordRPC/enabled" && value !== isRpcEnabled) isRpcEnabled = value;
  if (key === "discordRPC/showModButton" && value !== showModButton) showModButton = value;
  if (key === "discordRPC/showArtist" && value !== showArtist) showArtist = value;
});

(async () => {
  isRpcEnabled = (await window.yandexMusicMod.getStorageValue("discordRPC/enabled")) === false ? false : true;
  showModButton = (await window.yandexMusicMod.getStorageValue("discordRPC/showModButton")) === false ? false : true;
  showArtist = (await window.yandexMusicMod.getStorageValue("discordRPC/showArtist")) === false ? false : true;
})();
