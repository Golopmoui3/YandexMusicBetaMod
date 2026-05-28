import { searchProperty } from "./react-fiber-search.js";
import { z } from "zod";
import { ok, err, Result } from "neverthrow";
import * as Sentry from "@sentry/react";
import { getCurrentTrackMeta } from "./track-meta-store";

// В production-билде Яндекс Музыки атрибуты data-test-id не выставляются
// (см. window.__CONFIG_ENV__ === "production" в bundler-коде).
// Поэтому ищем плеер по стабильному префиксу CSS-модуля Next.js: имена классов
// плеера всегда начинаются с PlayerBarDesktopWithBackgroundProgressBar_,
// хеш суффикса меняется между сборками, префикс — стабильный.

const LEGACY_PLAYER_SELECTOR = 'section[data-test-id="PLAYERBAR_DESKTOP"]';
// Префиксы CSS-модулей плеера. Менялись между версиями Яндекс Музыки:
// 5.103.x — PlayerBarDesktopWithBackgroundProgressBar_
// 5.104.x — PlayerBarDesktop_
const PLAYERBAR_CSS_MODULE_PREFIXES = [
  "PlayerBarDesktop_",
  "PlayerBarDesktopWithBackgroundProgressBar_",
];

let cachedPlayer: Element | null = null;
let hasAdsInPlayer = false;

function isPlayerSection(el: Element): boolean {
  // Проверяем, есть ли внутри <section> элемент с классом плеера
  return PLAYERBAR_CSS_MODULE_PREFIXES.some(
    (prefix) => !!el.querySelector(`[class*="${prefix}"]`),
  );
}

function querySelectorByPrefixes(prefixes: string[]): Element | null {
  for (const prefix of prefixes) {
    const el = document.querySelector(`[class*="${prefix}"]`);
    if (el) return el;
  }
  return null;
}

function hasReactFiberKey(el: Element): boolean {
  // React 16+ хранит fiber в свойстве вида __reactFiber$<random>
  for (const key in el) {
    if (key.startsWith("__reactFiber$")) return true;
  }
  return false;
}

function findReactAnchor(): Element | null {
  // 1) Если есть плеер с fiber — отличный якорь
  const player = findPlayer();
  if (player && hasReactFiberKey(player)) return player;

  // 2) Next.js корень
  const nextRoot = document.getElementById("__next");
  if (nextRoot && hasReactFiberKey(nextRoot)) return nextRoot;

  // 3) Обходим прямых детей body и ищем первый с fiber-ключом
  const children = Array.from(document.body?.children || []);
  for (const child of children) {
    if (hasReactFiberKey(child)) return child;
  }

  // 4) Глубокий поиск — первые ~50 элементов в DOM
  const all = document.body?.querySelectorAll("*");
  if (all) {
    const limit = Math.min(all.length, 50);
    for (let i = 0; i < limit; i++) {
      if (hasReactFiberKey(all[i])) return all[i];
    }
  }

  return null;
}

function findPlayer(): Element | null {
  // 1) Проверяем кэш
  if (cachedPlayer && document.contains(cachedPlayer) && isPlayerSection(cachedPlayer)) {
    return cachedPlayer;
  }

  // 2) Старый путь — data-test-id (для dev-сборок)
  const legacy = document.querySelector(LEGACY_PLAYER_SELECTOR);
  if (legacy) {
    cachedPlayer = legacy;
    return legacy;
  }

  // 3) Поиск по CSS-модулю — стабильный признак плеера на production-сборках
  const playerInner = querySelectorByPrefixes(PLAYERBAR_CSS_MODULE_PREFIXES);
  if (playerInner) {
    const section = playerInner.closest("section");
    if (section) {
      cachedPlayer = section;
      return section;
    }
    // На всякий случай — возвращаем сам элемент, fiber-поиск из react-fiber-search
    // ходит от root, так что якорь не критичен.
    cachedPlayer = playerInner;
    return playerInner;
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
  // 1) Самый надёжный путь — реальный <audio> элемент
  const audio = (window as any).__yamodGetActiveAudio?.() as HTMLAudioElement | null;
  if (audio) {
    return ok(!audio.paused);
  }

  // 2) Fallback на DOM-кнопку плеера
  const player = findPlayer();
  if (!player) {
    return err("[v2.3] Player element not found in DOM");
  }

  const { kind } = findPlayPauseButton(player);
  if (!kind) {
    return err("Neither pause nor play button found in player");
  }

  return ok(kind === "pause");
}

export function getProgress(): Result<{ duration: number; progress: number; position: number }, string> {
  // 1) Самый надёжный путь — реальный <audio> элемент. Position и duration
  // в секундах. progress в процентах (0..100).
  const audio = (window as any).__yamodGetActiveAudio?.() as HTMLAudioElement | null;
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    const position = audio.currentTime;
    const duration = audio.duration;
    const progress = Math.min(100, (position / duration) * 100);
    return ok({ duration, position, progress });
  }

  // 2) Fallback на fiber-проп
  const player = findPlayer();
  if (!player) {
    return err("[v2.3] Player element not found in DOM");
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
  // 1) Самый надёжный путь — мета из track-meta-store, который слушает
  // /get-file-info и подтягивает её через /tracks. Работает независимо от
  // DOM/fiber-структуры (которая в 5.104.2 больше не передаёт entityMeta
  // через JSX-пропсы).
  const stored = getCurrentTrackMeta();
  if (stored) {
    return ok(stored);
  }

  // 2) Fallback — fiber-поиск (на случай если store ещё не успел подтянуть мета)
  const anchor = findReactAnchor();
  if (!anchor) {
    return err("[v2.5] No React-mounted anchor found in DOM");
  }

  let fiber: any;
  try {
    fiber = searchProperty(anchor, "entityMeta");
  } catch (e) {
    return err(`[v2.5] searchProperty failed: ${e}`);
  }
  if (!fiber) {
    return err("[v2.5] entityMeta fiber not found (track-meta-store not ready yet)");
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
