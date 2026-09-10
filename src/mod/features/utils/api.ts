import axios from "axios";
import type { AxiosInstance } from "axios";
import { ok, err, type Result } from "neverthrow";

const SECRET_KEY = "kzqU4XhfCaY6B6JTHODeq5";
const API_ORIGIN = "https:" + "//api.music.yandex.net";

export enum QualityEnum {
  LOSSLESS = "lossless",
  NQ = "nq",
  LQ = "lq",
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readOAuthToken(): string | undefined {
  try {
    const raw = localStorage.getItem("oauth");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { value?: unknown };
    return typeof parsed?.value === "string" && parsed.value.trim()
      ? `OAuth ${parsed.value.trim()}`
      : undefined;
  } catch {
    return undefined;
  }
}

function requestHeaders(skipAuth = false): Record<string, string> {
  const result: Record<string, string> = {
    "X-Yandex-Music-Client": `YandexMusicDesktopAppWindows/${window.VERSION}`,
    "X-Yandex-Music-Frontend": "new",
    "X-Yandex-Music-Without-Invocation-Info": "1",
  };
  const token = skipAuth ? undefined : readOAuthToken();
  if (token) result.Authorization = token;
  return result;
}

const yandexMusicClient: AxiosInstance = axios.create({
  baseURL: API_ORIGIN,
  timeout: 30_000,
  validateStatus: () => true,
});

export async function getSign(params: { secretKey: string; data: string }): Promise<Result<string, string>> {
  try {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(params.secretKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(params.data));
    return ok(btoa(String.fromCharCode(...new Uint8Array(signature))).slice(0, -1));
  } catch (error) {
    return err(`Failed to generate HMAC signature: ${errorMessage(error)}`);
  }
}

export async function getTrackUrl(trackId: string, quality: QualityEnum): Promise<Result<any, string>> {
  try {
    const normalizedTrackId = String(trackId).trim();
    if (!normalizedTrackId) return err("Track ID is empty");

    const timestamp = Math.floor(Date.now() / 1000);
    const audioCodecs = ["flac", "aac", "he-aac", "mp3", "flac-mp4", "aac-mp4", "he-aac-mp4"];
    const transports = "encraw";
    const signResult = await getSign({
      data: `${timestamp}${normalizedTrackId}${quality}${audioCodecs.join("")}${transports}`,
      secretKey: SECRET_KEY,
    });
    if (signResult.isErr()) return err(signResult.error);

    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await yandexMusicClient.get("/get-file-info", {
        headers: requestHeaders(),
        params: {
          ts: timestamp,
          trackId: normalizedTrackId,
          quality,
          codecs: audioCodecs.join(","),
          transports,
          sign: signResult.value,
        },
      });
      if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);

      const downloadInfo = response.data?.downloadInfo;
      if (!downloadInfo || typeof downloadInfo !== "object") return err("Invalid response: downloadInfo is missing");
      if (String(downloadInfo.trackId) !== normalizedTrackId) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      return ok(downloadInfo);
    }

    return err("Failed to get track URL: too many mismatched responses");
  } catch (error) {
    return err(`Failed to get track URL: ${errorMessage(error)}`);
  }
}

export async function getAlbumTracks(id: string): Promise<Result<string[], string>> {
  try {
    const response = await yandexMusicClient.get(`/albums/${encodeURIComponent(id)}/with-tracks`, {
      headers: requestHeaders(),
      params: { resumeStream: false, richTracks: false, withListeningFinished: false },
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    if (!Array.isArray(response.data?.volumes)) return err("Invalid response format: missing volumes");

    return ok(
      response.data.volumes
        .flatMap((volume: unknown) => (Array.isArray(volume) ? volume : []))
        .map((track: any) => track?.id)
        .filter((trackId: unknown) => trackId != null)
        .map(String),
    );
  } catch (error) {
    return err(`Failed to get album tracks: ${errorMessage(error)}`);
  }
}

export async function getPlaylistTracks(id: string): Promise<Result<string[], string>> {
  try {
    const response = await yandexMusicClient.get(`/playlist/${encodeURIComponent(id)}`, {
      headers: requestHeaders(),
      params: { resumeStream: false, richTracks: false },
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    if (!Array.isArray(response.data?.tracks)) return err("Invalid response format: missing tracks");

    return ok(
      response.data.tracks
        .map((entry: any) => entry?.id ?? entry?.track?.id)
        .filter((trackId: unknown) => trackId != null)
        .map(String),
    );
  } catch (error) {
    return err(`Failed to get playlist tracks: ${errorMessage(error)}`);
  }
}

export async function getArtistTracks(id: string): Promise<Result<string[], string>> {
  try {
    const response = await yandexMusicClient.get(`/artists/${encodeURIComponent(id)}/track-ids`, {
      headers: requestHeaders(),
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    const values = Array.isArray(response.data) ? response.data : response.data?.result;
    if (!Array.isArray(values)) return err("Invalid response format: missing tracks");
    return ok(values.filter((trackId) => trackId != null).map(String));
  } catch (error) {
    return err(`Failed to get artist tracks: ${errorMessage(error)}`);
  }
}

export async function getTracksInfo(trackIds: string[], skipAuth = false): Promise<Result<any[], string>> {
  try {
    const normalizedIds = trackIds.map(String).map((id) => id.trim()).filter(Boolean);
    if (normalizedIds.length === 0) return ok([]);

    const response = await yandexMusicClient.get("/tracks", {
      headers: requestHeaders(skipAuth),
      params: {
        trackIds: normalizedIds.join(","),
        removeDuplicates: false,
        withProgress: true,
      },
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);

    const tracks = Array.isArray(response.data) ? response.data : response.data?.result;
    return Array.isArray(tracks) ? ok(tracks) : err("Invalid response format: expected track array");
  } catch (error) {
    return err(`Failed to get tracks info: ${errorMessage(error)}`);
  }
}

export async function likeTrack(userId: number, trackId: string): Promise<Result<any, string>> {
  try {
    if (!Number.isSafeInteger(userId) || userId <= 0) return err("Invalid user ID");
    const response = await yandexMusicClient.post(
      `/users/${userId}/likes/tracks/add`,
      {},
      {
        headers: { ...requestHeaders(), "Content-Type": "application/json" },
        params: { trackId: String(trackId) },
      },
    );
    if (response.status !== 200 && response.status !== 201) {
      return err(`HTTP ${response.status}: ${response.statusText}`);
    }
    return ok(response.data);
  } catch (error) {
    return err(`Failed to add track to likes: ${errorMessage(error)}`);
  }
}

export async function getAccountInfo(): Promise<Result<{ uid: number }, string>> {
  try {
    const response = await yandexMusicClient.get("/account/about", { headers: requestHeaders() });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    if (!response.data || !Number.isFinite(response.data.uid)) return err("Invalid response format: missing UID");
    return ok(response.data);
  } catch (error) {
    return err(`Failed to get account info: ${errorMessage(error)}`);
  }
}

export async function getLikesAndHistory(): Promise<
  Result<{ favorites: { playlistUuid: string }; count: number }, string>
> {
  try {
    const response = await yandexMusicClient.get("/landing-blocks/likes-and-history", {
      headers: requestHeaders(),
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    if (!response.data?.favorites?.playlistUuid) return err("Invalid response format: missing favorites playlist");
    return ok(response.data);
  } catch (error) {
    return err(`Failed to get likes and history: ${errorMessage(error)}`);
  }
}

export async function getAccountSettings(): Promise<
  Result<{ adsDisabled: boolean; userMusicVisibility: string }, string>
> {
  try {
    const response = await yandexMusicClient.get("/account/settings", { headers: requestHeaders() });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    if (!response.data || typeof response.data !== "object") return err("Invalid account settings response");
    return ok(response.data);
  } catch (error) {
    return err(`Failed to get account settings: ${errorMessage(error)}`);
  }
}

export async function updateAccountSettings(
  key: string,
  value: string | number | boolean,
): Promise<Result<any, string>> {
  try {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) return err("Invalid account setting key");
    const response = await yandexMusicClient.post("/account/settings", undefined, {
      headers: requestHeaders(),
      params: { [key]: value },
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    return ok(response.data);
  } catch (error) {
    return err(`Failed to update account settings: ${errorMessage(error)}`);
  }
}

export async function getAccountExperiments(): Promise<Result<any, string>> {
  try {
    const response = await yandexMusicClient.get("/account/experiments/details", {
      headers: requestHeaders(),
    });
    if (response.status !== 200) return err(`HTTP ${response.status}: ${response.statusText}`);
    return ok(response.data);
  } catch (error) {
    return err(`Failed to get account experiments: ${errorMessage(error)}`);
  }
}
