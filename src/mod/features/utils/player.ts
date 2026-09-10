import { searchProperty } from "./react-fiber-search.js";
import { z } from "zod";
import { ok, err, Result } from "neverthrow";
import * as Sentry from "@sentry/react";
import { getCurrentTrackMeta } from "./track-meta-store";

const LEGACY_PLAYER_SELECTOR = 'section[data-test-id="PLAYERBAR_DESKTOP"]';
const PLAYERBAR_CSS_MODULE_PREFIXES = [
  "PlayerBarDesktop_",
  "PlayerBarDesktopWithBackgroundProgressBar_",
];

let cachedPlayer: Element | null = null;
let hasAdsInPlayer = false;

function isPlayerSection(element: Element): boolean {
  return PLAYERBAR_CSS_MODULE_PREFIXES.some(
    (prefix) => !!element.querySelector(`[class*="${prefix}"]`),
  );
}

function querySelectorByPrefixes(prefixes: string[]): Element | null {
  for (const prefix of prefixes) {
    const element = document.querySelector(`[class*="${prefix}"]`);
    if (element) return element;
  }
  return null;
}

function hasReactFiberKey(element: Element): boolean {
  for (const key in element) {
    if (key.startsWith("__reactFiber$")) return true;
  }
  return false;
}

function findReactAnchor(): Element | null {
  const player = findPlayer();
  if (player && hasReactFiberKey(player)) return player;

  const nextRoot = document.getElementById("__next");
  if (nextRoot && hasReactFiberKey(nextRoot)) return nextRoot;

  for (const child of Array.from(document.body?.children || [])) {
    if (hasReactFiberKey(child)) return child;
  }

  const elements = document.body?.querySelectorAll("*");
  if (elements) {
    const limit = Math.min(elements.length, 50);
    for (let index = 0; index < limit; index++) {
      const candidate = elements[index];
      if (candidate && hasReactFiberKey(candidate)) return candidate;
    }
  }

  return null;
}

function findPlayer(): Element | null {
  if (cachedPlayer && document.contains(cachedPlayer) && isPlayerSection(cachedPlayer)) return cachedPlayer;

  const legacy = document.querySelector(LEGACY_PLAYER_SELECTOR);
  if (legacy) {
    cachedPlayer = legacy;
    return legacy;
  }

  const playerInner = querySelectorByPrefixes(PLAYERBAR_CSS_MODULE_PREFIXES);
  if (!playerInner) return null;

  const section = playerInner.closest("section");
  cachedPlayer = section || playerInner;
  return cachedPlayer;
}

function findPlayPauseButton(player: Element): { kind: "play" | "pause" | null; button: Element | null } {
  const playByTestId = player.querySelector('button[data-test-id="PLAY_BUTTON"]');
  if (playByTestId) return { kind: "play", button: playByTestId };
  const pauseByTestId = player.querySelector('button[data-test-id="PAUSE_BUTTON"]');
  if (pauseByTestId) return { kind: "pause", button: pauseByTestId };

  for (const button of Array.from(player.querySelectorAll("button"))) {
    const icon = button.querySelector("svg, use");
    const href = icon?.getAttribute?.("href") || icon?.getAttribute?.("xlink:href") || "";
    const className = `${icon?.getAttribute?.("class") || ""} ${button.className || ""}`;
    if (/pause/i.test(href) || /pause/i.test(className)) return { kind: "pause", button };
    if (/(^|[^a-z])play([^a-z]|$)/i.test(href) || /(^|[^a-z])play([^a-z]|$)/i.test(className)) {
      return { kind: "play", button };
    }
  }

  return { kind: null, button: null };
}

export function isPlaying(): Result<boolean, string> {
  const audio = (window as any).__yamodGetActiveAudio?.() as HTMLAudioElement | null;
  if (audio) return ok(!audio.paused);

  const player = findPlayer();
  if (!player) return err("[v2.3] Player element not found in DOM");

  const { kind } = findPlayPauseButton(player);
  return kind ? ok(kind === "pause") : err("Neither pause nor play button found in player");
}

export function getProgress(): Result<{ duration: number; progress: number; position: number }, string> {
  const audio = (window as any).__yamodGetActiveAudio?.() as HTMLAudioElement | null;
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    const position = audio.currentTime;
    const duration = audio.duration;
    return ok({ duration, position, progress: Math.min(100, (position / duration) * 100) });
  }

  const player = findPlayer();
  if (!player) return err("[v2.3] Player element not found in DOM");

  const fiber = searchProperty(player, "timecodeClassName") || searchProperty(player, "currentTimecodeClassName");
  if (!fiber) return err("Fiber not found");

  const validatedFiber = z
    .object({
      duration: z.float64(),
      position: z.float64(),
      progress: z.float64(),
    })
    .safeParse(fiber);

  if (!validatedFiber.success) return err(`Validation error: ${validatedFiber.error.message}`);
  return ok(validatedFiber.data);
}

export function getTrackMeta(): Result<any, string> {
  const stored = getCurrentTrackMeta();
  if (stored) return ok(stored);

  const anchor = findReactAnchor();
  if (!anchor) return err("[v2.5] No React-mounted anchor found in DOM");

  let fiber: any;
  try {
    fiber = searchProperty(anchor, "entityMeta");
  } catch (error) {
    return err(`[v2.5] searchProperty failed: ${error}`);
  }
  if (!fiber) return err("[v2.5] entityMeta fiber not found (track-meta-store not ready yet)");

  const meta = fiber.entityMeta;
  if (!meta) return err("entityMeta not found");

  if (meta.title === "Промокод Upgrade") {
    if (!hasAdsInPlayer) {
      console.warn("[getTrackMeta] Обнаружена реклама в плеере");
      if (window.__yandexMusicModAnalyticsEnabled === true) {
        Sentry.captureMessage("upgrade_promocode", { extra: { track: meta } });
      }
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
    artists: z.array(z.object({ id: z.string(), name: z.string() })),
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

  const validatedMeta = entitySchema.safeParse(meta);
  if (!validatedMeta.success) {
    return err(`Validation error: ${validatedMeta.error.message} for ${JSON.stringify(meta, null, 2)}`);
  }

  return ok(JSON.parse(JSON.stringify({ ...meta })));
}
