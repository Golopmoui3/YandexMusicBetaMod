import { searchProperty } from "./react-fiber-search.js";
import { z } from "zod";
import { ok, err, Result } from "neverthrow";
import * as Sentry from "@sentry/react";

// В production-билде Яндекс Музыки атрибуты data-test-id не выставляются
// (см. window.__CONFIG_ENV__ === "production" в bundler-коде).
// Поэтому ищем плеер через React Fiber: единственный <section>, у которого
// в fiber-дереве есть проп entityMeta — это и есть плеер.

// Старые селекторы — для случая, когда атрибут всё-таки есть (dev-сборки).
const LEGACY_PLAYER_SELECTOR = 'section[data-test-id="PLAYERBAR_DESKTOP"]';
const PLAY_BUTTON_ARIA = ["player-actions.play"];
const PAUSE_BUTTON_ARIA = ["player-actions.pause"];

let cachedPlayer: Element | null = null;
let hasAdsInPlayer = false;

function isPlayerSection(el: Element): boolean {
  try {
    const fiber = searchProperty(el as HTMLElement, "entityMeta");
    return !!fiber;
  } catch {
    return false;
  }
}

function findPlayer(): Element | null {
  // 1) Проверяем кэш
  if (cachedPlayer && document.contains(cachedPlayer) && isPlayerSection(cachedPlayer)) {
    return cachedPlayer;
  }

  // 2) Старый путь — data-test-id (если вдруг работает)
  const legacy = document.querySelector(LEGACY_PLAYER_SELECTOR);
  if (legacy) {
    cachedPlayer = legacy;
    return legacy;
  }

  // 3) Перебор всех <section> с поиском fiber-пропа entityMeta
  const sections = document.querySelectorAll("section");
  for (const section of Array.from(sections)) {
    if (isPlayerSection(section)) {
      cachedPlayer = section;
      return section;
    }
  }

  return null;
}

function findPlayPauseButton(player: Element): { kind: "play" | "pause" | null; button: Element | null } {
  // Сначала через data-test-id (если есть)
  const playByTestId = player.querySelector('button[data-test-id="PLAY_BUTTON"]');
  if (playByTestId) return { kind: "play", button: playByTestId };
  const pauseByTestId = player.querySelector('button[data-test-id="PAUSE_BUTTON"]');
  if (pauseByTestId) return { kind: "pause", button: pauseByTestId };

  // В production: ищем кнопку по содержимому иконки (svg variant "play"/"pause")
  // или по fiber-пропам.
  const buttons = player.querySelectorAll("button");
  for (const btn of Array.from(buttons)) {
    const icon = btn.querySelector("svg, use");
    const href = icon?.getAttribute?.("href") || icon?.getAttribute?.("xlink:href") || "";
    const cls = (icon?.getAttribute?.("class") || "") + " " + (btn.className || "");
    if (/pause/i.test(href) || /pause/i.test(cls)) {
      return { kind: "pause", button: btn };
    }
    if (/(^|[^a-z])play([^a-z]|$)/i.test(href) || /(^|[^a-z])play([^a-z]|$)/i.test(cls)) {
      return { kind: "play", button: btn };
    }
  }

  return { kind: null, button: null };
}

export function isPlaying(): Result<boolean, string> {
  const player = findPlayer();
  if (!player) {
    return err("Player element not found in DOM");
  }

  const { kind } = findPlayPauseButton(player);
  if (!kind) {
    return err("Neither pause nor play button found in player");
  }

  return ok(kind === "pause");
}

export function getProgress(): Result<{ duration: number; progress: number; position: number }, string> {
  const player = findPlayer();
  if (!player) {
    return err("Player element not found in DOM");
  }

  const fiber = searchProperty(player, "timecodeClassName") || searchProperty(player, "currentTimecodeClassName");
  if (!fiber) {
    return err("Fiber not found");
  }

  const validatedFiber = z
    .object({
      duration: z.float64(),
      position: z.float64(),
      progress: z.float64(),
    })
    .safeParse(fiber);

  if (validatedFiber.error) {
    return err(`Validation error: ${validatedFiber.error.message}`);
  }

  return ok({
    duration: validatedFiber.data.duration,
    position: validatedFiber.data.position,
    progress: validatedFiber.data.progress,
  });
}

export function getTrackMeta(): Result<any, string> {
  const player = findPlayer();
  if (!player) {
    return err("Player element not found in DOM");
  }

  const fiber = searchProperty(player, "entityMeta");
  if (!fiber) {
    return err("Fiber not found");
  }

  const meta = fiber.entityMeta;
  if (!meta) {
    return err("entityMeta not found");
  }

  if (meta.title === "Промокод Upgrade") {
    if (!hasAdsInPlayer) {
      console.warn("[getTrackMeta] Обнаружена реклама в плеере");
      Sentry.captureMessage("upgrade_promocode", {
        extra: {
          track: meta,
        },
      });
    }
    hasAdsInPlayer = true;
    return err("upgrade_promocode");
  }

  const entitySchema = z.object({
    id: z.string(),
    title: z.string(),
    durationMs: z.number(),
    albumId: z.number(),
    type: z.string(),
    genre: z.string(),
    isAvailable: z.boolean(),
    artists: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
    albums: z
      .array(
        z.object({
          id: z.number(),
          title: z.string(),
          year: z.number().optional(),
          isAvailable: z.boolean(),
          genre: z.string().optional(),
          trackCount: z.number(),
        }),
      )
      .optional(),
  });

  const validatedFiber = entitySchema.safeParse(meta);

  if (validatedFiber.error) {
    return err(`Validation error: ${validatedFiber.error.message} for ${JSON.stringify(meta, null, 2)}`);
  }

  // convert proxy object meta to default object
  return ok(JSON.parse(JSON.stringify({ ...meta })));
}
