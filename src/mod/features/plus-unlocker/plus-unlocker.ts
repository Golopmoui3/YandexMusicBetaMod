import { onYandexApiResponse } from "~/mod/features/utils/utils";
import { getTrackUrl, getTracksInfo, QualityEnum } from "~/mod/features/utils/api";
import { toast } from "sonner";

onYandexApiResponse("api.music.yandex.net/account/about", async (response: any) => {
  const data = response.data;
  if (!data || typeof data !== "object") return data;
  return { ...data, hasPlus: true };
});

onYandexApiResponse("/editorial-promotion", async () => ({ promotions: [] }));
onYandexApiResponse("/proxy/plus-red-alert/v1/alerts", async () => ({ alerts: [] }));

onYandexApiResponse("api.music.yandex.net/get-file-info", async (response: any) => {
  const data = response.data;
  const trackId = new URL(response.url).searchParams.get("trackId");
  if (!trackId || !data?.downloadInfo) return data;
  if (String(data.downloadInfo.trackId) === trackId) return data;

  const trackData = await getTrackUrl(trackId, data.downloadInfo.quality as QualityEnum);
  if (trackData.isErr()) {
    console.error("[PlusUnlocker] Error getting track URL for ad bypass:", trackData.error);
    return data;
  }

  return { ...data, downloadInfo: trackData.value };
});

onYandexApiResponse("api.music.yandex.net", async (response: any) => {
  const source = response.data;
  if (!source || typeof source !== "object") return source;

  function walk(obj: any, callback: (node: any) => void): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => walk(item, callback));
      return;
    }
    callback(obj);
    Object.values(obj).forEach((value) => walk(value, callback));
  }

  const ids = new Set<string>();
  walk(source, (node) => {
    if (node.type === "music" && node.id != null && "realId" in node && "coverUri" in node && "ogImage" in node) {
      ids.add(String(node.id));
    }
  });
  if (ids.size === 0) return source;

  const trackMetaResponse = await getTracksInfo([...ids], true);
  if (trackMetaResponse.isErr()) {
    console.error("[PlusUnlocker] Error getting replacement images:", trackMetaResponse.error);
    return source;
  }

  const metaById = new Map<string, any>(trackMetaResponse.value.map((meta: any) => [String(meta.id), meta]));
  walk(source, (node) => {
    if (node?.id == null || !("coverUri" in node) || !("ogImage" in node)) return;
    const meta = metaById.get(String(node.id));
    if (!meta) return;
    node.coverUri = meta.coverUri;
    node.ogImage = meta.ogImage;
  });

  return source;
});

onYandexApiResponse("/donation", async () => ({ donations: [] }));

onYandexApiResponse("/concerts", async (response: any) => {
  const hiddenMenuItems = (await window.yandexMusicMod.getStorageValue("custom-themes/hideMenuItems")) || [];
  return Array.isArray(hiddenMenuItems) && hiddenMenuItems.includes("concerts") ? { concerts: [] } : response.data;
});

onYandexApiResponse("/rotor/session/", async (response: any) => {
  const data = response.data;
  if (response.url.includes("feedback") || !Array.isArray(data?.sequence)) return data;

  const isUpgradeAd = (trackInfo: any) => trackInfo?.track?.title === "Промокод Upgrade";
  const isAllAds = data.sequence.length > 0 && data.sequence.every(isUpgradeAd);
  const sequence = data.sequence.filter((trackInfo: any) => !isUpgradeAd(trackInfo));

  if (isAllAds) {
    toast.error("Моя Волна больше не работает", {
      description:
        "Яндекс ограничил рекомендации для этого аккаунта. Плейлисты и поиск продолжат работать.",
      icon: null,
    });
  }

  return { ...data, sequence };
});
