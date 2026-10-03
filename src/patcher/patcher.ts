import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "asar";
import { $ } from "bun";

import { prettifyDirectory } from "./prettier";
import { downloadBuild } from "./api";
import { applyWincodesignWorkaround } from "./wincodesign-workaround";
import type { AppBuild } from "~/types/AppBuild";

const _7z = require("7zip-min");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function processBuild(build: AppBuild): Promise<string[]> {
  const buildDir = path.resolve(projectRoot, ".versions", build.version);
  const tempDir = path.join(buildDir, "temp");
  const buildBinaryPath = path.join(tempDir, "build.bin");
  const extractDir = path.join(tempDir, "extracted");
  const buildSourceDir = path.join(buildDir, "src");
  const buildModdedDir = path.join(buildDir, "mod");
  const modSourcesDir = path.join(projectRoot, "src", "mod");
  const modCompiledDir = path.join(modSourcesDir, "dist");
  const progress: string[] = [];

  const logProgress = (message: string) => {
    progress.push(message);
    console.log(message);
  };
  const fail = (message: string): never => {
    logProgress(`❌ ${message}`);
    throw new Error(message);
  };
  const requireFile = (filePath: string, label: string) => {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`${label} was not found`);
  };
  const replaceRequired = (
    contents: string,
    pattern: RegExp | string,
    replacement: string,
    label: string,
  ): string => {
    if (typeof pattern === "string") {
      const stringMatchCount = contents.split(pattern).length - 1;
      if (stringMatchCount === 0) fail(`Patch target not found: ${label}`);
      if (stringMatchCount > 1) fail(`Expected a single patch target for ${label}, found ${stringMatchCount}`);
      return contents.replaceAll(pattern, replacement);
    }
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
    );
    const matchCount = (contents.match(globalPattern) || []).length;
    if (matchCount === 0) fail(`Patch target not found: ${label}`);
    if (matchCount > 1) fail(`Expected a single patch target for ${label}, found ${matchCount}`);
    return contents.replace(globalPattern, replacement);
  };

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(buildSourceDir, { recursive: true });
  fs.mkdirSync(buildModdedDir, { recursive: true });

  logProgress(`[1] Downloading build ${build.version}`);
  const downloadResult = await downloadBuild(build, buildBinaryPath);
  if (downloadResult.isErr()) fail(`Failed to download build ${build.version}: ${downloadResult.error.message}`);
  logProgress("✔️   Done");

  logProgress(`[2] Extracting build ${build.version}`);
  try {
    await _7z.unpack(buildBinaryPath, extractDir);
  } catch (error) {
    fail(`Failed to extract build ${build.version}: ${errorMessage(error)}`);
  }
  logProgress("✔️   Done");

  logProgress("[3] Finding and extracting app.asar");
  const appAsarPath = path.resolve(extractDir, "resources", "app.asar");
  const appIconPath = path.resolve(extractDir, "resources", "assets", "icon.ico");
  requireFile(appAsarPath, "app.asar");

  try {
    asar.extractAll(appAsarPath, buildSourceDir);
  } catch (error) {
    fail(`Failed to extract app.asar: ${errorMessage(error)}`);
  }

  try {
    const assetsDir = path.join(buildModdedDir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    requireFile(appIconPath, "Application icon");
    fs.copyFileSync(appIconPath, path.join(assetsDir, "icon.ico"));
    fs.copyFileSync(path.join(projectRoot, "yaicon.png"), path.join(assetsDir, "icon.png"));
  } catch (error) {
    fail(`Failed to prepare app icons: ${errorMessage(error)}`);
  }
  logProgress("✔️   Done");

  logProgress("[4] Cleaning temporary files");
  fs.rmSync(tempDir, { recursive: true, force: true });
  logProgress("✔️   Done");

  logProgress("[5] Copying sources before modding");
  try {
    fs.cpSync(buildSourceDir, buildModdedDir, { recursive: true });
  } catch (error) {
    fail(`Failed to copy sources: ${errorMessage(error)}`);
  }
  logProgress("✔️   Done");

  logProgress("[6] Patching app.asar");
  const staticFiles = {
    packageJson: path.join(buildModdedDir, "package.json"),
    indexJs: path.join(buildModdedDir, "index.js"),
    preloadJs: path.join(buildModdedDir, "preload.js"),
  };
  for (const [label, filePath] of Object.entries(staticFiles)) requireFile(filePath, label);

  const stubPrivateRequires = (source: string, fileName: string): string => {
    const requirePattern = /require\(["']@yandex-music-int\/([a-zA-Z0-9_-]+)["']\)/g;
    const privateModules = new Set<string>();
    for (const match of source.matchAll(requirePattern)) {
      if (match[1]) privateModules.add(match[1]);
    }

    for (const moduleName of privateModules) {
      for (const quote of ["'", '"']) {
        source = source.replaceAll(
          `require(${quote}@yandex-music-int/${moduleName}${quote})`,
          `/* yandexMusicMod: private module stub */ ((() => { const makeStub = () => { const fn = function stub() {}; return new Proxy(fn, { get: (target, prop) => { if (prop === "prototype") return target.prototype; if (prop === "then" || prop === "catch" || prop === "finally") return undefined; return makeStub(); }, apply: () => undefined, construct: () => ({}) }); }; return makeStub(); })()) /* @yandex-music-int/${moduleName} */`,
        );
      }
    }
    if (privateModules.size > 0) {
      logProgress(`🛠️  Stubbed private requires in ${fileName}: ${[...privateModules].join(", ")}`);
    }
    return source;
  };

  logProgress("🛠️  Patching package.json");
  let packageJsonContents: any;
  try {
    packageJsonContents = JSON.parse(fs.readFileSync(staticFiles.packageJson, "utf8"));
  } catch (error) {
    fail(`Invalid package.json in app.asar: ${errorMessage(error)}`);
  }

  const bannedDependencies = new Set(["@yandex-chats/signer"]);
  const bannedScopes = ["@yandex-music-int/"];
  const isBanned = (name: string) => bannedDependencies.has(name) || bannedScopes.some((scope) => name.startsWith(scope));
  packageJsonContents.dependencies = Object.fromEntries(
    Object.entries(packageJsonContents.dependencies || {}).filter(([name]) => !isBanned(name)),
  );
  packageJsonContents.devDependencies = Object.fromEntries(
    Object.entries(packageJsonContents.devDependencies || {}).filter(([name]) => !isBanned(name)),
  );
  packageJsonContents.name = "YandexMusicMod";
  packageJsonContents.author = "Golopmoui3 [github.com/Golopmoui3]";
  packageJsonContents.repository = {
    type: "git",
    url: "https://github.com/Golopmoui3/YandexMusicBetaMod.git",
  };
  packageJsonContents.build = {
    appId: "ru.yandex.desktop.music.mod",
    productName: "Яндекс Музыка",
    publish: [{ provider: "github", owner: "Golopmoui3", repo: "YandexMusicBetaMod" }],
    win: {
      icon: "assets/icon.ico",
      requestedExecutionLevel: "asInvoker",
      target: ["nsis", "portable"],
    },
    nsis: {
      artifactName: "Setup.${version}.${ext}",
    },
    portable: {
      artifactName: "Portable.${version}.${ext}",
      requestExecutionLevel: "user",
    },
    linux: { icon: "assets/icon.png" },
    extraResources: [{ from: "assets/", to: "assets/", filter: ["**/*"] }],
    asarUnpack: ["**/node_modules/ffmpeg-static/**"],
  };

  const rootPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  Object.assign(packageJsonContents.dependencies, rootPackageJson.dependencies || {});
  Object.assign(packageJsonContents.devDependencies, rootPackageJson.devDependencies || {});
  fs.writeFileSync(staticFiles.packageJson, JSON.stringify(packageJsonContents, null, 2));
  logProgress("✔️   Done");

  logProgress("🛠️  Applying scoped patches to index.js");
  let indexJsContents = stubPrivateRequires(fs.readFileSync(staticFiles.indexJs, "utf8"), "index.js");
  indexJsContents = `
    const yandexMusicMod_fs = require("fs");
    const yandexMusicMod_path = require("path");
    const yandexMusicMod_electron = require("electron");
    const yandexMusicMod_appFolder = yandexMusicMod_electron.app.getPath("userData");
    const yandexMusicMod_settingsFilePath = yandexMusicMod_path.join(yandexMusicMod_appFolder, "mod_settings.json");
    let enableSystemToolbar = false;
    try {
      enableSystemToolbar = JSON.parse(yandexMusicMod_fs.readFileSync(yandexMusicMod_settingsFilePath, "utf8"))["devtools/systemToolbar"] === true;
    } catch {}\n\n${indexJsContents}`;

  indexJsContents = replaceRequired(
    indexJsContents,
    /constructor\(\)\s+{\s+this\.logger = new Logger\("UpdateLogger"\)/,
    "constructor() { return\n",
    "updater constructor",
  );
  indexJsContents = replaceRequired(indexJsContents, /minWidth:\s*768/, "minWidth: 360", "minimum width");
  indexJsContents = replaceRequired(indexJsContents, /minHeight:\s*650/, "minHeight: 550", "minimum height");
  indexJsContents = replaceRequired(
    indexJsContents,
    /titleBarStyle:\s*["']hidden["']/,
    "titleBarStyle: !enableSystemToolbar ? 'hidden' : 'default'",
    "title bar style",
  );
  indexJsContents = replaceRequired(
    indexJsContents,
    /const window = new electron\.BrowserWindow\(\{\s*show:\s*false/,
    "const window = new electron.BrowserWindow({\n show: true",
    "main BrowserWindow",
  );
  indexJsContents = replaceRequired(
    indexJsContents,
    /const webPreferences = \{/,
    "const webPreferences = {\n devTools: true,",
    "web preferences",
  );

  if (!/webSecurity:\s*true/.test(indexJsContents)) fail("Expected webSecurity: true in index.js");
  if (/webSecurity:\s*false/.test(indexJsContents)) fail("Refusing to build with webSecurity disabled");

  indexJsContents = replaceRequired(
    indexJsContents,
    /window\.once\(["']ready-to-show["'],\s*\(\) => \{/,
    `window.once("ready-to-show", () => {
      const accelerator = "CommandOrControl+Shift+I";
      if (!electron.globalShortcut.isRegistered(accelerator)) {
        electron.globalShortcut.register(accelerator, () => {
          const focusedWindow = electron.BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) focusedWindow.webContents.toggleDevTools();
        });
      }`,
    "ready-to-show handler",
  );

  const blockedAnalyticsUrls = [
    "https://yandex.ru/clck/*",
    "https://mc.yandex.ru/*",
    "https://api.music.yandex.net/dynamic-pages/trigger/*",
    "https://api.music.yandex.net/lyric-views",
    "https://log.strm.yandex.ru/*",
    "https://api.acquisition-gwe.plus.yandex.net/*",
    "https://api.events.plus.yandex.net/*",
    "https://events.plus.yandex.net/*",
    "https://plus.yandex.net/*",
    "https://yandex.ru/ads/*",
    "https://strm.yandex.ru/ping",
    "https://yandex.ru/an/*",
  ];
  const browserWindowMarker = `const window = new electron.BrowserWindow({
 show: true`;
  const browserWindowStart = indexJsContents.indexOf(browserWindowMarker);
  const returnWindowIndex = indexJsContents.indexOf("return window", browserWindowStart);
  if (browserWindowStart < 0 || returnWindowIndex < 0) fail("Main BrowserWindow return point was not found");

  const beforeWindowReturn = `
      ${process.env.AUTO_OPEN_DEVTOOLS?.toLowerCase() === "true" ? "window.webContents.openDevTools();" : ""}
      window.webContents.session.webRequest.onBeforeRequest(
        { urls: ${JSON.stringify(blockedAnalyticsUrls)} },
        (_details, callback) => callback({ cancel: true }),
      );
      window.webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ["https://api.music.yandex.net/*"] },
        (details, callback) => {
          delete details.requestHeaders["x-yandex-music-device"];
          delete details.requestHeaders["x-request-id"];
          callback({ requestHeaders: details.requestHeaders });
        },
      );
      `;
  indexJsContents =
    indexJsContents.slice(0, returnWindowIndex) + beforeWindowReturn + indexJsContents.slice(returnWindowIndex);
  fs.writeFileSync(staticFiles.indexJs, indexJsContents);
  logProgress("✔️   Done");

  logProgress("🛠️  Removing startup video intro");
  const splashScreenPath = path.join(buildModdedDir, "app", "media", "splash_screen");
  if (!fs.existsSync(splashScreenPath)) fail("Startup splash screen directory was not found");
  fs.rmSync(splashScreenPath, { recursive: true, force: true });
  logProgress("✔️   Done");

  logProgress("🛠️  Building and copying mod sources");
  const modPreloadScript = path.join(modSourcesDir, "preload.ts");
  const modMainScript = path.join(modSourcesDir, "main.js");
  requireFile(modPreloadScript, "Mod preload source");
  requireFile(modMainScript, "Mod main source");

  await $`bun ui:build`;
  const preloadBuildResult = await Bun.build({
    target: "browser",
    format: "cjs",
    sourcemap: "linked",
    minify: false,
    entrypoints: [modPreloadScript],
    outdir: modCompiledDir,
  });
  if (!preloadBuildResult.success) {
    fail(`Preload build failed: ${preloadBuildResult.logs.map(String).join("\n")}`);
  }

  const compiledPreloadPath = path.join(modCompiledDir, "preload.js");
  requireFile(compiledPreloadPath, "Compiled preload.js");
  let preloadJsContents =
    fs.readFileSync(staticFiles.preloadJs, "utf8") +
    `\n\n// yandexMusicMod preload.js\n(async () => {\n${fs.readFileSync(compiledPreloadPath, "utf8")}\n})();`;
  preloadJsContents = stubPrivateRequires(preloadJsContents, "preload.js");

  indexJsContents += `\n\n// yandexMusicMod main.js\n(async () => {\n${fs.readFileSync(modMainScript, "utf8")}\n})();`;
  const discordPlaceholder = 'mod_require("discordRPC");';
  const discordPlaceholderCount = indexJsContents.split(discordPlaceholder).length - 1;
  if (discordPlaceholderCount !== 1) {
    fail(`Expected one Discord RPC placeholder, found ${discordPlaceholderCount}`);
  }
  indexJsContents = indexJsContents.replace(
    discordPlaceholder,
    `\n\n// yandexMusicMod Discord RPC\n(async () => {\n${fs.readFileSync(
      path.join(modSourcesDir, "features", "utils", "discordRPC.js"),
      "utf8",
    )}\n})();`,
  );

  const appModDirectory = path.join(buildModdedDir, "app", "yandexMusicMod");
  fs.cpSync(modCompiledDir, appModDirectory, { recursive: true });
  const rendererPath = path.join(appModDirectory, "renderer.js");
  requireFile(rendererPath, "Compiled renderer.js");
  fs.writeFileSync(rendererPath, `(function () {\n${fs.readFileSync(rendererPath, "utf8")}\n})();`);

  const appPath = path.join(buildModdedDir, "app");
  const htmlFiles = (fs.readdirSync(appPath, { recursive: true }) as string[]).filter((file) => file.endsWith(".html"));
  if (htmlFiles.length === 0) fail("No HTML entry points were found");
  let patchedHtmlCount = 0;
  for (const htmlFile of htmlFiles) {
    const fullHtmlPath = path.join(appPath, htmlFile);
    const html = fs.readFileSync(fullHtmlPath, "utf8");
    if (!html.includes("<head>")) continue;
    fs.writeFileSync(
      fullHtmlPath,
      html.replace(
        "<head>",
        `<head><script src="/yandexMusicMod/renderer.js"></script>\n<link rel="stylesheet" href="/yandexMusicMod/renderer.css">`,
      ),
    );
    patchedHtmlCount++;
  }
  if (patchedHtmlCount === 0) fail("No HTML entry point contained a patchable <head>");

  fs.writeFileSync(staticFiles.indexJs, indexJsContents);
  fs.writeFileSync(staticFiles.preloadJs, preloadJsContents);
  logProgress("✔️   Done");

  logProgress(`🛠️  Prettifying files in ${buildModdedDir}`);
  await prettifyDirectory(buildModdedDir);

  indexJsContents = stubPrivateRequires(fs.readFileSync(staticFiles.indexJs, "utf8"), "index.js (post-prettier)");
  preloadJsContents = stubPrivateRequires(
    fs.readFileSync(staticFiles.preloadJs, "utf8"),
    "preload.js (post-prettier)",
  );
  if (/webSecurity:\s*false/.test(indexJsContents)) fail("Prettified build disabled webSecurity");
  fs.writeFileSync(staticFiles.indexJs, indexJsContents);
  fs.writeFileSync(staticFiles.preloadJs, preloadJsContents);
  logProgress("✔️   Done");

  logProgress("🛠️  Building modded application");
  await $`bun install`.cwd(buildModdedDir);
  await applyWincodesignWorkaround();
  await $`bunx electron-builder --publish never`.cwd(buildModdedDir);

  const setupPath = path.join(buildModdedDir, "dist", `Setup.${build.version}.exe`);
  const portablePath = path.join(buildModdedDir, "dist", `Portable.${build.version}.exe`);
  requireFile(setupPath, "Setup executable");
  requireFile(portablePath, "Portable executable");
  logProgress(`✔️   Produced ${path.basename(setupPath)} and ${path.basename(portablePath)}`);

  return progress;
}
