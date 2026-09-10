import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getTrackMeta } from "~/mod/features/utils/player";
import {
  getAlbumTracks,
  getArtistTracks,
  getPlaylistTracks,
  getTrackUrl,
  getTracksInfo,
  QualityEnum,
} from "~/mod/features/utils/api";

import { ExpandableCard } from "@ui/components/ui/expandable-card";
import { Button } from "@ui/components/ui/button";
import { If } from "@ui/components/ui/if";
import { Progress } from "@ui/components/ui/progress";
import { toast } from "sonner";
import { Alert } from "@ui/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/components/ui/select";
import { Input } from "@ui/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/components/ui/tooltip";
import { Info, FolderOpen, Folder, Download } from "lucide-react";
import * as Sentry from "@sentry/react";

enum PageType {
  OTHER,
  ARTIST,
  PLAYLIST,
  ALBUM,
}

const qualityLabels: Record<QualityEnum, string> = {
  [QualityEnum.LOSSLESS]: "Максимальное",
  [QualityEnum.NQ]: "Среднее",
  [QualityEnum.LQ]: "Низкое",
};

function resultValueOrThrow<T>(result: { isErr: () => boolean; error?: string; value?: T }): T {
  if (result.isErr()) throw new Error(result.error || "Неизвестная ошибка API");
  return result.value as T;
}

export function Downloader() {
  const [downloadType, setDownloadType] = useState(PageType.OTHER);
  const [downloadQuality, setDownloadQuality] = useState(QualityEnum.LOSSLESS);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatusText, setDownloadStatusText] = useState("");
  const [downloadFolderPath, setDownloadFolderPath] = useState<string | null>(null);
  const operationIdRef = useRef(0);
  const cancellationRequestedRef = useRef(false);
  const operationRunningRef = useRef(false);

  useEffect(() => {
    let active = true;
    void window.yandexMusicMod.getStorageValue("downloadFolderPath").then((savedPath) => {
      if (active && typeof savedPath === "string" && savedPath.length > 0) setDownloadFolderPath(savedPath);
    });
    return () => {
      active = false;
    };
  }, []);

  const saveDownloadPath = async (folderPath: string) => {
    await window.yandexMusicMod.setStorageValue("downloadFolderPath", folderPath);
    setDownloadFolderPath(folderPath);
  };

  const handleSelectFolder = async () => {
    try {
      const result = await window.yandexMusicMod.selectDownloadFolder();
      if (!result.success || !result.path) return;
      await saveDownloadPath(result.path);
      toast.success("Папка для загрузки выбрана", { description: result.path });
    } catch (error) {
      toast.error("Не удалось выбрать папку", { description: String(error) });
    }
  };

  const handleOpenFolder = async () => {
    if (!downloadFolderPath) return;
    const result = await window.yandexMusicMod.openFolder(downloadFolderPath);
    if (!result.success) toast.error("Не удалось открыть папку", { description: result.error });
  };

  const pageType = window.location.href.includes("/artist")
    ? PageType.ARTIST
    : window.location.href.includes("/playlists")
      ? PageType.PLAYLIST
      : window.location.href.includes("/album")
        ? PageType.ALBUM
        : PageType.OTHER;

  useEffect(() => setDownloadType(pageType), [pageType]);

  const urlParams = new URLSearchParams(window.location.search);
  const collectionId =
    pageType === PageType.ARTIST
      ? urlParams.get("artistId")
      : pageType === PageType.ALBUM
        ? urlParams.get("albumId")
        : pageType === PageType.PLAYLIST
          ? urlParams.get("playlistUuid")
          : null;

  const trackMetaQuery = useQuery({
    queryKey: ["current-track-meta"],
    queryFn: async () => {
      const result = getTrackMeta();
      if (result.isErr()) throw new Error(result.error);
      return result.value;
    },
    retry: false,
    staleTime: 500,
    refetchInterval: 500,
  });

  const isCancelled = (operationId: number) =>
    cancellationRequestedRef.current || operationIdRef.current !== operationId;

  async function downloadTracks(trackIds: string[], quality: QualityEnum, operationId: number) {
    if (trackIds.length === 0) throw new Error("В выбранной коллекции нет треков");

    const tracks: any[] = [];
    const chunkSize = 50;

    for (let offset = 0; offset < trackIds.length; offset += chunkSize) {
      if (isCancelled(operationId)) return;
      setDownloadStatusText(`Получение информации о треках ${Math.round((offset / trackIds.length) * 100)}%`);
      setDownloadProgress((offset / trackIds.length) * 100);

      const chunk = trackIds.slice(offset, offset + chunkSize);
      const result = await getTracksInfo(chunk, true);
      if (result.isErr()) {
        throw new Error(`Не удалось получить треки ${offset + 1}–${Math.min(offset + chunk.length, trackIds.length)}: ${result.error}`);
      }
      tracks.push(...result.value);
    }

    for (let index = 0; index < tracks.length; index++) {
      if (isCancelled(operationId)) return;

      const track = tracks[index];
      const trackTitle = `${track.artists?.map((artist: any) => artist.name).join(", ") || "Неизвестный артист"} - ${track.title || "Без названия"}`;
      setDownloadStatusText(`Скачивание треков ${index + 1} / ${tracks.length}`);
      setDownloadProgress((index / tracks.length) * 100);

      if (track.available === false) {
        toast.warning("Трек недоступен", { description: trackTitle });
        continue;
      }

      const downloadInfo = await getTrackUrl(String(track.id), quality);
      if (downloadInfo.isErr()) {
        toast.error("Не удалось получить ссылку для загрузки", { description: trackTitle });
        continue;
      }

      const downloadResult = await window.yandexMusicMod.downloadTrack(
        downloadInfo.value,
        track,
        downloadFolderPath || undefined,
      );
      if (!downloadResult.ok) {
        toast.error("Не удалось скачать трек", { description: downloadResult.error || trackTitle });
        continue;
      }

      if (window.__yandexMusicModAnalyticsEnabled === true) Sentry.metrics.count("tracks_downloaded", 1);
      setDownloadProgress(((index + 1) / tracks.length) * 100);
    }
  }

  async function resolveTrackIds(): Promise<string[]> {
    switch (downloadType) {
      case PageType.OTHER: {
        const trackId = trackMetaQuery.data?.id;
        if (!trackId) throw new Error("Текущий трек не определён");
        return [String(trackId)];
      }
      case PageType.ALBUM:
        if (!collectionId) throw new Error("Не удалось определить альбом");
        return resultValueOrThrow(await getAlbumTracks(collectionId));
      case PageType.ARTIST:
        if (!collectionId) throw new Error("Не удалось определить артиста");
        return resultValueOrThrow(await getArtistTracks(collectionId));
      case PageType.PLAYLIST:
        if (!collectionId) throw new Error("Не удалось определить плейлист");
        return resultValueOrThrow(await getPlaylistTracks(collectionId));
      default:
        throw new Error("Неизвестный тип загрузки");
    }
  }

  async function handleDownloadClick() {
    if (operationRunningRef.current) {
      cancellationRequestedRef.current = true;
      setDownloadStatusText("Остановка после текущего файла…");
      return;
    }

    const operationId = ++operationIdRef.current;
    operationRunningRef.current = true;
    cancellationRequestedRef.current = false;
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const trackIds = await resolveTrackIds();
      await downloadTracks(trackIds, downloadQuality, operationId);
      if (!isCancelled(operationId)) toast.success("Загрузка завершена");
    } catch (error) {
      if (!isCancelled(operationId)) toast.error("Произошла ошибка", { description: String(error) });
    } finally {
      if (operationIdRef.current === operationId) {
        operationRunningRef.current = false;
        cancellationRequestedRef.current = false;
        setIsDownloading(false);
        setDownloadStatusText("");
        setDownloadProgress(0);
      }
    }
  }

  const currentTrackUnavailable = downloadType === PageType.OTHER && !trackMetaQuery.data?.id;

  return (
    <ExpandableCard title="Скачать треки" icon={<Download className="h-4 w-4" />} opened>
      <div className="flex flex-col gap-5 pt-2 px-3">
        <If condition={isDownloading}>
          <div className="flex flex-col gap-3">
            <span className="text-sm text-foreground text-center">{downloadStatusText}</span>
            <Progress value={downloadProgress} />
          </div>
        </If>

        <div className="flex gap-4 items-center justify-center">
          <span className="text-sm text-foreground">Скачать</span>
          <Select value={downloadType.toString()} onValueChange={(value) => setDownloadType(Number.parseInt(value, 10))} disabled={isDownloading}>
            <SelectTrigger className="text-foreground w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PageType.OTHER.toString()}>Текущий трек</SelectItem>
              <If condition={pageType === PageType.ALBUM}><SelectItem value={PageType.ALBUM.toString()}>Весь альбом</SelectItem></If>
              <If condition={pageType === PageType.PLAYLIST}><SelectItem value={PageType.PLAYLIST.toString()}>Весь плейлист</SelectItem></If>
              <If condition={pageType === PageType.ARTIST}><SelectItem value={PageType.ARTIST.toString()}>Все треки артиста</SelectItem></If>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-4 items-center justify-center">
          <span className="text-sm text-foreground">Качество</span>
          <Select value={downloadQuality} onValueChange={(value) => setDownloadQuality(value as QualityEnum)} disabled={isDownloading}>
            <SelectTrigger className="text-foreground w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(QualityEnum).map((quality) => <SelectItem key={quality} value={quality}>{qualityLabels[quality]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-3">
          <Input type="text" value={downloadFolderPath || "Папка не выбрана"} readOnly className="flex-1 text-sm cursor-default w-full" />
          <Tooltip>
            <TooltipTrigger>
              <Button variant="outline" size="sm" className="p-2 h-9 w-9" onClick={handleSelectFolder} disabled={isDownloading}>
                <Folder className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Выбрать папку</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button variant="outline" size="sm" className="p-2 h-9 w-9" onClick={handleOpenFolder} disabled={!downloadFolderPath || isDownloading}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Открыть папку</p></TooltipContent>
          </Tooltip>
        </div>

        <Button variant="default" disabled={!isDownloading && currentTrackUnavailable} onClick={handleDownloadClick}>
          {isDownloading ? "Стоп" : "Скачать"}
        </Button>

        <Alert variant="default" className="cursor-default">
          <Info />
          <div className="text-sm text-muted-foreground">
            Для загрузки всех треков откройте страницу нужного артиста, плейлиста или альбома.
          </div>
        </Alert>
      </div>
    </ExpandableCard>
  );
}
