# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **not an Electron app** — it is a *patcher* that downloads the latest stable Yandex Music desktop build, unpacks it, mutates its `index.js` / `preload.js` / HTML, builds and injects the mod renderer/preload/main bundles, then re-packs everything via `electron-builder` into a redistributable installer.

`index.ts` at the repo root is a stub; the real entry point is `src/patcher/index.ts` (invoked via `bun start`).

## Runtime and tooling

- **Runtime:** Bun (uses `Bun.build`, `bun shell` `$`, `Bun.write`). Do not switch to Node without porting these.
- **Package manager:** `bun install`. The project ships `bun.lock`.
- **Build tool for the renderer:** Vite (`vite.config.ts`) — produces a single `renderer.js` + `renderer.css` into `src/mod/dist/`.
- **Preload bundling:** `Bun.build` (CJS target, sourcemap linked) inside `processBuild()`. Not Vite.
- **Main process:** `src/mod/main.js` is NOT bundled. It is read as text and appended verbatim into the Yandex Music `index.js`. Consequences (see "Authoring main.js" below).
- **Prettier config:** `.prettierrc` (2-space, 120 print width). The patcher prettifies the entire output build directory at the end.

## Commands

```bash
bun start          # Full pipeline: download → patch → build installer (long)
bun ui:build       # Vite build of the renderer to src/mod/dist/
bun ui:dev         # Build renderer + copy into the already-patched .versions/<v>/mod/app/yandexMusicMod/
bun prettier:dev   # Re-prettify a previously patched .versions/<v>/mod directory
```

There is **no test suite** and no lint script wired up (ESLint deps are listed but no script exists).

### Iteration loop (important)

`bun start` is slow because it re-downloads and re-extracts the upstream installer. For UI iteration:

1. Run `bun start` ONCE to produce `.versions/<version>/mod/`.
2. Edit `scripts/debug-copy-ui.js` — the version is hard-coded (`const modPath = ".versions/5.86.0/mod/app/yandexMusicMod/";`) — point it at whatever version `bun start` produced.
3. Loop: edit renderer code → `bun ui:dev` → reload renderer in the running app with `Ctrl+Shift+I` then `F5`.

For changes to `main.js` / `preload.ts`, `bun ui:dev` does NOT redeploy them. Either re-run `bun start`, or edit the unpacked `.versions/<v>/mod/index.js` / `preload.js` directly and run `bunx electron .versions/<v>/mod/index.js` to test, then mirror the change back into the patcher source.

### Running without building an installer

`src/patcher/patcher.ts` ends with `bunx electron-builder` (slow). To smoke-test the patched build directly, comment that line and uncomment the `bunx electron .` line above it.

## The patch pipeline (`src/patcher/patcher.ts`)

`processBuild(build)` is the core. Numbered stages — all paths under `.versions/<version>/`:

1. Download `build.bin` from `https://music-desktop-application.s3.yandex.net/stable/...` (`src/patcher/api.ts`, schema validated with Zod).
2. Extract installer with `7zip-min`.
3. Extract `resources/app.asar` with `asar` → `src/`. Copy to `mod/`.
4. Rewrite `mod/package.json`: strip banned deps (`@yandex-chats/signer`), inject `build` config for `electron-builder`, merge dependencies from this repo's `package.json` into the modded one.
5. **Regex-patch `index.js`** — neutralizes the updater, opens DevTools, disables `webSecurity`, lowers min window size, blocks analytics URLs via `webRequest.onBeforeRequest`, strips `x-yandex-music-device` / `x-request-id` headers. **Every regex has a corresponding `❌ ... is not found` early-return**: when Yandex ships a new build that changes a matched string, the patcher fails loudly at that step. Read the existing regexes before adding a new one — they all assume specific upstream formatting.
6. Delete `app/media/splash_screen`.
7. Build renderer (`bun ui:build`) and preload (`Bun.build`).
8. Append the compiled `preload.js` to upstream `preload.js` (wrapped in `(async () => { ... })()`).
9. Append `src/mod/main.js` text to upstream `index.js` (same wrapping). The string `mod_require("discordRPC");` inside `main.js` is replaced at this stage with the inlined contents of `src/mod/features/utils/discordRPC.js` — that is the manual import mechanism for `main.js` (see below).
10. Copy `src/mod/dist/` → `mod/app/yandexMusicMod/`. Wrap `renderer.js` in an IIFE.
11. Inject `<script src="/yandexMusicMod/renderer.js">` and `<link rel="stylesheet" href="/yandexMusicMod/renderer.css">` into every `.html` under `app/`.
12. Prettify the whole `mod/` directory (skips `node_modules`).
13. `bun install` inside `mod/`, then `bunx electron-builder`.

## Three execution contexts after patching

The mod source is split into three trees that run in different Electron contexts:

| Source | Runs in | Bundler | What it can do |
|---|---|---|---|
| `src/mod/renderer.ts` + `src/mod/features/**` | Renderer (browser-ish) | Vite | DOM, React UI, `window.fetch` interception, talk to preload via `window.yandexMusicMod.*` |
| `src/mod/preload.ts` | Preload (privileged bridge) | `Bun.build` (CJS) | Exposes IPC methods via `contextBridge.exposeInMainWorld("yandexMusicMod", ...)`. **`// @ts-nocheck`** at the top — globals like `electron` come from the host preload it's appended to. |
| `src/mod/main.js` | Main (Node) | **None — appended as text** | `ipcMain.handle/on`, fs, ffmpeg-static, native modules |

### Authoring `main.js`

Because `main.js` is concatenated as a string into upstream `index.js`:

- Use `require(...)`, never `import`. Bare specifiers are resolved against the modded build's `node_modules` (so the dep must be in this repo's root `package.json` — the patcher merges them).
- `mod_require("name")` is a placeholder syntax: at patch time, the patcher replaces `mod_require("discordRPC");` with the literal contents of `src/mod/features/utils/discordRPC.js`. If you add another "fake import", you must also add a `replaceAll` in `patcher.ts` step 9.
- `ffmpeg-static` returns a path inside `app.asar`. The mod rewrites it to `app.asar.unpacked` — keep that pattern.

### Three-layer wiring for a new IPC method

1. Handler in `src/mod/main.js`: `electron.ipcMain.handle("yandexMusicMod.foo", ...)`.
2. Bridge in `src/mod/preload.ts`: add `foo: (...) => electron.ipcRenderer.invoke("yandexMusicMod.foo", ...)` inside the `exposeInMainWorld` object.
3. Type in `src/types/global.d.ts`: extend `Window["yandexMusicMod"]`.

Renderer code then calls `window.yandexMusicMod.foo(...)`.

## Settings storage

User settings live in a single `mod_settings.json` inside `electron.app.getPath("userData")`. IPC: `getStorageValue(key)` / `setStorageValue(key, value)` / `onStorageChanged(cb)`. The main process broadcasts changes to all windows via `yandexMusicMod.storageValueUpdated`. **Use namespaced keys**: `feature-name/setting`, e.g. `devtools/enabled`, `compact-player/size`.

Note that the patcher also reads `mod_settings.json` synchronously during main-process bootstrap to know whether to use a system or custom title bar (`devtools/systemToolbar`) — this is the only setting needed before the window is created.

## Renderer architecture

`src/mod/renderer.ts` is the import-only entry point. Each feature is its own folder under `src/mod/features/` with an `index.ts` barrel. **Order matters**: `initFetchInterceptor()` must run before any feature that registers `onYandexApiRequest` / `onYandexApiResponse` handlers (the imports in `renderer.ts` are ordered accordingly).

The UI (`src/mod/features/ui/`) is a React 19 app mounted into a `#yandex-music-mod-sidebar` div appended to `document.body` on `DOMContentLoaded`. The sheet trigger is portaled into Yandex Music's own DOM next to `NavbarDesktopUserWidget_userProfileContainer` — a `MutationObserver` re-attaches it if Yandex re-renders that area. **UI components use shadcn-style primitives in `src/mod/features/ui/components/ui/` and feature cards in `src/mod/features/ui/components/`.**

The fetch interceptor (`src/mod/features/utils/utils.js`) only routes requests to `https://api.music.yandex.net/*` through handler chains. Other URLs pass through.

## TypeScript path aliases

Defined in **two places** (must stay in sync):

- `tsconfig.json`: `~/*` → `./src/*`, `@ui/*` → `./src/mod/features/ui/*`
- `vite.config.ts`: same two aliases (used at build time)

If you add an alias, update both.

## Environment

- `.env` defines `VITE_MOD_VERSION` (shown in the sidebar header), `AUTO_OPEN_DEVTOOLS` (read by the patcher, **not** by Vite — controls whether `index.js` is patched to auto-open DevTools), and `VITE_PUBLIC_SENTRY_DSN`.
- Sentry is initialized but only sends events when `window.__yandexMusicModAnalyticsEnabled` is truthy (opt-in).

## winCodeSign workaround (Windows-only)

`electron-builder` падает на этапе распаковки `winCodeSign-2.6.0.7z` если запущен без admin / без Developer Mode: внутри лежат darwin symlink'и (`libcrypto.dylib`, `libssl.dylib`), которые требуют `SeCreateSymbolicLinkPrivilege`. `src/patcher/wincodesign-workaround.ts` подменяет `7za.exe` в `bunx`-кэш папке electron-builder'а на bun-compiled обёртку (`scripts/7za-wrapper.ts`), которая исключает эти файлы из распаковки. Обёртка собирается через `bun build --compile`, занимает ~110 МБ (бандленный bun runtime), поэтому в `.gitignore`.

При первом запуске `bun start` обёртка соберётся автоматически (см. `applyWincodesignWorkaround()`). Если апстрим починит проблему — workaround можно убрать целиком вместе с `scripts/7za-wrapper.ts` и `src/patcher/wincodesign-workaround.ts`.

## Common pitfalls

- A new Yandex Music version breaks regex matches in `patcher.ts` step 5. The fix is updating regexes, not the rest of the pipeline.
- `bun ui:dev` does nothing for `main.js` / `preload.ts` changes — see "Iteration loop" above.
- Editing `.versions/<v>/mod/...` is for debugging only; those files are wiped on the next `bun start` (the patcher does `fs.rmSync(buildDir, ...)` at the start).
- Don't `import` in `main.js`. Don't add bundler-specific syntax to `main.js`. It's a string.
- New `main.js` dependencies belong in the root `package.json` `dependencies` (not `devDependencies`) — step 4 of the pipeline merges only those into the modded `package.json`.

## More

`MODDING_GUIDE.md` (Russian) walks through adding a feature end-to-end with a "compact player" example. Read it when adding a feature card to the sidebar.
