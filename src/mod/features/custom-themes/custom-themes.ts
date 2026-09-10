import customStyles from "./custom-themes.css?inline";

const stylesheetName = "yandex-music-mod-custom-themes-style";
const allowedMenuItems = new Set(["concerts", "non-music", "kids"]);
let disableVibeAnimationTimer: ReturnType<typeof setInterval> | null = null;
let customThemeEnabled = false;
let customThemeAccent = "#4A9EFF";
let updateGeneration = 0;

function stopDisableTimer() {
  if (disableVibeAnimationTimer !== null) {
    clearInterval(disableVibeAnimationTimer);
    disableVibeAnimationTimer = null;
  }
}

function normalizeAccent(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#4A9EFF";
}

async function updateTheme() {
  const generation = ++updateGeneration;
  const [enabledValue, accentValue, replaceValue, disableVibeValue, disableExplicitValue, hiddenValue] =
    await Promise.all([
      window.yandexMusicMod.getStorageValue("custom-themes/enabled"),
      window.yandexMusicMod.getStorageValue("custom-themes/accent"),
      window.yandexMusicMod.getStorageValue("custom-themes/playerColorsReplace"),
      window.yandexMusicMod.getStorageValue("custom-themes/disableVibeAnimation"),
      window.yandexMusicMod.getStorageValue("custom-themes/disableExplicitMark"),
      window.yandexMusicMod.getStorageValue("custom-themes/hideMenuItems"),
    ]);
  if (generation !== updateGeneration) return;

  const enabled = enabledValue === true;
  const accent = normalizeAccent(accentValue);
  const playerColorsReplaceEnabled = replaceValue !== false;
  const disableVibeAnimation = disableVibeValue === true;
  const disableExplicitMark = disableExplicitValue === true;
  const hiddenMenuItems = Array.isArray(hiddenValue)
    ? hiddenValue.filter((item): item is string => typeof item === "string" && allowedMenuItems.has(item))
    : [];

  customThemeEnabled = enabled;
  customThemeAccent = accent;
  document.getElementById(stylesheetName)?.remove();
  stopDisableTimer();

  if (!enabled) {
    sendMessageToWorkers("vibe-animation-worker-enable", undefined);
    return;
  }

  const rules = [
    customStyles,
    `:root { --yandexMusicModAccent: ${accent}; }`,
  ];

  if (playerColorsReplaceEnabled) {
    rules.push(`
      .ym-dark-theme section[data-test-id="PLAYERBAR_DESKTOP"],
      .ym-dark-theme div[data-test-id="FULLSCREEN_PLAYER_MODAL"] {
        --player-average-color-background: var(--yandexMusicModPalette-200) !important;
      }
      .ym-light-theme section[data-test-id="PLAYERBAR_DESKTOP"],
      .ym-light-theme div[data-test-id="FULLSCREEN_PLAYER_MODAL"] {
        --player-average-color-background: var(--yandexMusicModPalette-700) !important;
      }
      .ym-dark-theme div[class*="_averageColorBackground__"] {
        background: linear-gradient(var(--yandexMusicModPalette-200, var(--ym-background-color-secondary-enabled-blur)) 0, transparent 100%);
      }
      .ym-light-theme div[class*="_averageColorBackground__"] {
        background: linear-gradient(var(--yandexMusicModPalette-light-300, var(--ym-background-color-secondary-enabled-blur)) 0, transparent 100%);
      }
    `);
  }

  if (disableVibeAnimation) {
    rules.push(`
      div[data-test-id="VIBE_BLOCK"] { height: 32vh !important; min-height: unset !important; }
      div[data-test-id="VIBE_ANIMATION"] { display: none !important; }
    `);
    sendMessageToWorkers("vibe-animation-worker-disable", undefined);
    disableVibeAnimationTimer = setInterval(
      () => sendMessageToWorkers("vibe-animation-worker-disable", undefined),
      2_000,
    );
  } else {
    sendMessageToWorkers("vibe-animation-worker-enable", undefined);
  }

  if (disableExplicitMark) {
    rules.push(`
      span[class*="Meta_explicitMarkContainer__"],
      svg[class*="ExplicitMarkIcon_"],
      svg[class*="explicitMark__"] { display: none !important; }
    `);
  }

  for (const menuItem of hiddenMenuItems) {
    rules.push(`aside[data-test-id="NAVBAR"] li:has(a[href="/${menuItem}"]) { display: none !important; }`);
  }

  const styleSheet = document.createElement("style");
  styleSheet.id = stylesheetName;
  styleSheet.textContent = rules.join("\n");
  document.head.appendChild(styleSheet);
  updateVibeBackgroundColor();
}

function hexToHue(hex: string, offset = 0): number {
  const normalized = hex.slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
  }

  return ((hue + offset) % 360 + 360) % 360;
}

function getCssVarNormalizedRgb(varName: string): { r: number; g: number; b: number } | null {
  const element = document.createElement("div");
  element.style.display = "none";
  element.style.color = `var(${varName})`;
  document.body.appendChild(element);
  const computed = getComputedStyle(element).color;
  element.remove();

  const srgb = computed.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (srgb) return { r: Number(srgb[1]), g: Number(srgb[2]), b: Number(srgb[3]) };

  const rgb = computed.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!rgb) return null;
  return { r: Number(rgb[1]) / 255, g: Number(rgb[2]) / 255, b: Number(rgb[3]) / 255 };
}

function updateVibeBackgroundColor() {
  if (!document.body) return;
  const backgroundColor = getCssVarNormalizedRgb("--ym-background-color-primary-enabled-content");
  if (!backgroundColor) return;

  sendMessageToWorkers("vibe-animation-worker-apply-settings", {
    isYandexMusicMod: true,
    backgroundColor: [backgroundColor.r, backgroundColor.g, backgroundColor.b],
  });

  if (customThemeEnabled) {
    const hue = hexToHue(customThemeAccent, 50);
    sendMessageToWorkers("vibe-animation-worker-apply-settings", {
      isYandexMusicMod: true,
      collectionHue: hue,
      hue,
      useDefaultHue: false,
    });
  }
}

function installWorkerHooks() {
  if ((window as any).__yandexMusicModWorkerHooksInstalled) return;
  (window as any).__yandexMusicModWorkerHooksInstalled = true;
  window.__workers = window.__workers || [];

  const OriginalWorker = window.Worker;
  window.Worker = new Proxy(OriginalWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args) as Worker;
      window.__workers.push(worker);

      const originalPostMessage = worker.postMessage.bind(worker);
      worker.postMessage = ((message: any, transfer?: Transferable[]) => {
        if ((message?.payload?.backgroundColor || message?.payload?.collectionHue) && !message?.payload?.isYandexMusicMod) {
          setTimeout(updateVibeBackgroundColor, 500);
        }
        return transfer ? originalPostMessage(message, transfer) : originalPostMessage(message);
      }) as typeof worker.postMessage;

      const originalTerminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        window.__workers = window.__workers.filter((entry) => entry !== worker);
        originalTerminate();
      };
      return worker;
    },
  });

  const originalAtob = window.atob.bind(window);
  window.atob = (value: string) => {
    const decoded = originalAtob(value);
    const target = "updateBackgroundColor(t){this.background=new c(t,t,t)}";
    if (!decoded.includes(target)) return decoded;
    return decoded.replace(
      target,
      "updateBackgroundColor(t){this.background=Array.isArray(t)?new c(t[0],t[1],t[2]):new c(t,t,t)}",
    );
  };
}

function sendMessageToWorkers(type: string, payload: unknown) {
  for (const worker of window.__workers || []) {
    try {
      worker.postMessage({ source: "vibe", type, payload });
    } catch {
      window.__workers = window.__workers.filter((entry) => entry !== worker);
    }
  }
}

installWorkerHooks();
window.yandexMusicMod.onStorageChanged((key: string) => {
  if (key.startsWith("custom-themes/")) void updateTheme();
});
void updateTheme();
