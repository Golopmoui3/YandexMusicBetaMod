import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import { ThemeProvider } from "./contexts/ThemeContext";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@ui/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/components/ui/tooltip";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import { Toaster } from "@ui/components/ui/sonner";
import { Button } from "./components/ui/button";

import { FontChanger } from "@ui/components/font-changer";
import { Devtools } from "@ui/components/devtools";
import { Downloader } from "@ui/components/downloader";
import { AutoBestQuality } from "@ui/components/auto-best-quality";
import { DiscordRPC } from "@ui/components/discord-rpc";
import { Settings } from "@ui/components/settings";
import { AutoLiker } from "@ui/components/auto-liker";
import { ExperimentsToggle } from "@ui/components/experiments-toggle";
import { ScaleChanger } from "@ui/components/scale-changer";
import { CustomThemes } from "@ui/components/custom-themes";
import { NewYearSnowfall, NewYearSnowfallAnimation } from "@ui/components/snowfall-animation";

import logo from "@ui/assets/logo.webp?inline";
import discordBg from "@ui/assets/discord-bg.png?inline";
import { FaDiscord, FaGithub } from "react-icons/fa";
import { RxUpdate } from "react-icons/rx";

const IS_DEV = false;
const DISCORD_INVITE_URL = "https://discord.gg/4nK7nk2sY8";
const REPOSITORY_URL = "https://github.com/Golopmoui3/YandexMusicBetaMod";
const RELEASES_URL_PREFIX = `${REPOSITORY_URL}/releases/`;
const META_URL = "https://raw.githubusercontent.com/Golopmoui3/YandexMusicBetaMod/master/.meta/meta.json";
const CURRENT_VERSION = import.meta.env.VITE_MOD_VERSION;

type AppMeta = {
  modStable: string;
  downloadUrl: string;
};

function numericVersion(version: string): number[] {
  return version
    .replace(/^app-/, "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter(Number.isFinite);
}

function isNewerVersion(latest: string, current: string): boolean {
  const left = numericVersion(latest);
  const right = numericVersion(current);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }

  return false;
}

function validateMeta(value: unknown): AppMeta {
  if (!value || typeof value !== "object") throw new TypeError("Invalid update metadata");
  const candidate = value as Partial<AppMeta>;
  if (typeof candidate.modStable !== "string" || typeof candidate.downloadUrl !== "string") {
    throw new TypeError("Invalid update metadata fields");
  }

  const downloadUrl = new URL(candidate.downloadUrl);
  if (!downloadUrl.href.startsWith(RELEASES_URL_PREFIX)) {
    throw new TypeError("Update URL points outside the fork releases");
  }

  return { modStable: candidate.modStable, downloadUrl: downloadUrl.href };
}

export default function App() {
  const [mountNode, setMountNode] = useState<HTMLDivElement | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(IS_DEV);
  const [devtoolsEnabled, setDevtoolsEnabled] = useState(false);

  const appMetaQuery = useQuery({
    queryKey: ["appMeta", REPOSITORY_URL],
    queryFn: async () => {
      const response = await fetch(META_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to fetch app metadata: HTTP ${response.status}`);
      return validateMeta(await response.json());
    },
    retry: 2,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    let active = true;
    void window.yandexMusicMod.getStorageValue("devtools/enabled").then((value) => {
      if (active) setDevtoolsEnabled(value === true);
    });

    const unsubscribe = window.yandexMusicMod.onStorageChanged((key, value) => {
      if (key === "devtools/enabled") setDevtoolsEnabled(value === true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const targetSelector = 'div[class*="NavbarDesktopUserWidget_userProfileContainer"]';
    const containerId = "mod-sheet-container";
    let animationFrame = 0;

    const placeButton = () => {
      animationFrame = 0;
      const targetElement = IS_DEV ? document.body : document.querySelector(targetSelector);
      let container = document.getElementById(containerId) as HTMLDivElement | null;

      if (targetElement) {
        if (!container) {
          container = document.createElement("div");
          container.id = containerId;
          container.style.display = "flex";
          container.style.justifyContent = "center";
          targetElement.parentNode?.insertBefore(container, targetElement);
        }
        setMountNode((current) => (current === container ? current : container));
      } else {
        container?.remove();
        setMountNode(null);
      }
    };

    const schedulePlacement = () => {
      if (animationFrame === 0) animationFrame = window.requestAnimationFrame(placeButton);
    };

    placeButton();
    const observer = new MutationObserver(schedulePlacement);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      document.getElementById(containerId)?.remove();
    };
  }, []);

  const updateAvailable =
    appMetaQuery.isSuccess && isNewerVersion(appMetaQuery.data.modStable, CURRENT_VERSION);

  const sheetTrigger = (
    <>
      <SheetTrigger className="flex w-full items-center justify-center gap-2.5 rounded-full border-2 border-[var(--ym-outline-color-primary-disabled)] p-[5px] text-[var(--ym-controls-color-primary-text-enabled_variant)] transition-colors duration-100 ease-in-out hover:bg-[var(--ym-surface-color-primary-enabled-list)] px-6">
        <div className="h-[25px] w-[25px] bg-contain bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} />
        <span className="trigger-text hidden lg:inline">Меню мода</span>
      </SheetTrigger>
      <Toaster position="bottom-right" />
      <NewYearSnowfallAnimation />
    </>
  );

  return (
    <ThemeProvider>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        {mountNode && createPortal(sheetTrigger, mountNode)}
        <SheetContent side="left" className="w-full" onOpenAutoFocus={(event) => event.preventDefault()}>
          <SheetTitle className="sr-only">Yandex Music Mod</SheetTitle>
          <SheetDescription className="sr-only">Настройки и функции мода</SheetDescription>

          <div
            id="header"
            className="flex items-center justify-between px-4"
            style={{
              height: "var(--ym-spacer-size-xxxl)",
              backgroundColor: "var(--ym-background-color-primary-enabled-basic)",
            }}
          />

          <div className="bg-secondary/20 m-3 mb-0 flex justify-between rounded-md border px-4 py-2 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 bg-contain bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} />
              <span className="text-foreground text-base font-semibold">Yandex Music Mod</span>
              <span className="text-muted-foreground text-xs font-semibold">v{CURRENT_VERSION}</span>
            </div>

            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger>
                  <Button variant="outline" size="icon" onClick={() => window.open(DISCORD_INVITE_URL, "_blank", "noreferrer")}>
                    <FaDiscord className="text-blue-500 h-[1.3rem]! w-[1.3rem]!" fill="currentColor" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Discord сервер</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger>
                  <Button variant="outline" size="icon" onClick={() => window.open(REPOSITORY_URL, "_blank", "noreferrer")}>
                    <FaGithub className="text-foreground h-[1.3rem]! w-[1.3rem]!" fill="currentColor" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Исходный код на GitHub</p></TooltipContent>
              </Tooltip>
            </div>
          </div>

          <ScrollArea className="flex h-full flex-col p-1 pt-0 overflow-hidden overflow-x-auto overflow-y-auto rounded-md" viewportClassName="gap-2">
            {updateAvailable && (
              <div
                className="m-4 py-4 px-5 flex flex-row justify-center items-center gap-3 bg-secondary border-border rounded-xl hover:scale-105 transition-all cursor-pointer"
                onClick={() => window.open(appMetaQuery.data.downloadUrl, "_blank", "noreferrer")}
              >
                <RxUpdate className="text-foreground h-[2.5rem]! w-[2.5rem]!" fill="currentColor" />
                <div className="flex flex-col gap-1 justify-center items-start">
                  <span className="text-foreground text-base font-semibold">Доступно обновление v{appMetaQuery.data.modStable}</span>
                  <span className="text-muted-foreground text-sm">Нажмите, чтобы скачать новую версию мода</span>
                </div>
              </div>
            )}

            <Downloader />
            <NewYearSnowfall />
            <DiscordRPC />
            <AutoLiker />
            <CustomThemes />
            <FontChanger />
            <ScaleChanger />
            <AutoBestQuality />
            <Settings />
            <Devtools />
            {devtoolsEnabled && <ExperimentsToggle />}

            <div className="flex flex-col gap-4 justify-center items-center m-6">
              <div
                className="py-3 px-2 w-full flex flex-row justify-center items-center gap-4 border-violet-400 border-1 rounded-xl hover:scale-105 transition-all cursor-pointer opacity-90 dark:opacity-100"
                style={{ backgroundImage: `url(${discordBg})`, backgroundSize: "contain", backgroundRepeat: "repeat-x", zoom: ".9" }}
                onClick={() => window.open(DISCORD_INVITE_URL, "_blank", "noreferrer")}
              >
                <FaDiscord className="text-white h-[2.5rem]! w-[2.5rem]!" fill="currentColor" />
                <div className="flex flex-col gap-1 justify-center items-start">
                  <span className="text-white text-lg font-semibold">Yandex Music Mod</span>
                  <span className="text-slate-200 text-sm mt-[-3px]">Присоединяйтесь к нам в Discord</span>
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="m-4 flex flex-row">
            <Button variant="outline" className="text-foreground flex-1" onClick={() => setIsSheetOpen(false)}>Назад</Button>
          </div>
        </SheetContent>
      </Sheet>
    </ThemeProvider>
  );
}
