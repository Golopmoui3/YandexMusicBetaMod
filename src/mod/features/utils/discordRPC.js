const { BrowserWindow } = require("electron");
const { Client } = require("@xhayper/discord-rpc");

const CLIENT_ID = "1283109459463377011";
const REPOSITORY_URL = "https://github.com/Golopmoui3/YandexMusicBetaMod";
const POLL_INTERVAL_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let client = null;
let reconnectTimer = null;
let reconnectDelay = 3_000;
let pollTimer = null;
let lastActivityKey = null;
let connecting = false;

function destroyClient(target) {
  try {
    target?.destroy?.();
  } catch (error) {
    console.warn("[DISCORD RPC] Failed to destroy old client:", error);
  }
}

function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  console.warn(`[DISCORD RPC] Reconnecting after ${reason} in ${reconnectDelay}ms`);

  const staleClient = client;
  client = null;
  lastActivityKey = null;
  destroyClient(staleClient);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void initRpc();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}

async function initRpc() {
  if (connecting || client) return;
  connecting = true;

  const nextClient = new Client({ clientId: CLIENT_ID });
  client = nextClient;

  const handleDisconnect = (eventName) => {
    if (client === nextClient) scheduleReconnect(eventName);
  };

  nextClient.on("ready", () => {
    reconnectDelay = 3_000;
    lastActivityKey = null;
    console.log("[DISCORD RPC] Connected");
  });
  nextClient.on("disconnected", () => handleDisconnect("disconnect"));
  nextClient.on("error", () => handleDisconnect("error"));
  nextClient.on("close", () => handleDisconnect("close"));

  try {
    await nextClient.login();
  } catch (error) {
    console.error("[DISCORD RPC] Login failed:", error);
    if (client === nextClient) scheduleReconnect("login failure");
  } finally {
    connecting = false;
  }
}

function buildActivity(playerState) {
  const data = playerState.data;
  const trackMeta = data.trackMeta;
  const artists = Array.isArray(trackMeta.artists) ? trackMeta.artists : [];
  const firstArtist = artists[0];
  const showArtist = playerState.showArtist !== false;
  const artistAvatar =
    showArtist && firstArtist?.avatarUri
      ? "https://" + firstArtist.avatarUri.replaceAll("%%", "100x100")
      : undefined;
  const position = Number(data.playback?.position) || 0;
  const duration = Number(data.playback?.duration) || 0;

  const activity = {
    type: 2,
    details: trackMeta.version ? `${trackMeta.title} ${trackMeta.version}` : trackMeta.title,
    largeImageKey: trackMeta.coverUri ? "https://" + trackMeta.coverUri.replaceAll("%%", "300x300") : undefined,
    largeImageText: trackMeta.albums?.[0]?.title || undefined,
    smallImageKey: artistAvatar,
    smallImageText: showArtist ? firstArtist?.name || undefined : undefined,
    state: showArtist ? artists.map((artist) => artist.name).join(", ") : undefined,
    startTimestamp: Math.round(Date.now() - position * 1_000),
    endTimestamp: Math.round(Date.now() + Math.max(0, duration - position) * 1_000),
    buttons: [
      {
        label: "🎵 Открыть",
        url: "https://music.yandex.ru/track/" + encodeURIComponent(String(trackMeta.id)),
      },
    ],
    instance: false,
  };

  if (playerState.showModButton) {
    activity.buttons.push({ label: "💻 Yandex Music Mod", url: REPOSITORY_URL });
  }

  return activity;
}

async function updateActivity() {
  try {
    const activeClient = client;
    if (!activeClient?.user) return;

    const playerState = await getAppPlayerState();
    if (!playerState) return;

    if (!playerState.enabled || !playerState.data?.isPlaying) {
      if (lastActivityKey !== null) {
        await activeClient.user.clearActivity();
        lastActivityKey = null;
      }
      return;
    }

    const activityKey = JSON.stringify({
      id: playerState.data.trackMeta?.id,
      title: playerState.data.trackMeta?.title,
      playing: playerState.data.isPlaying,
      showArtist: playerState.showArtist,
      showModButton: playerState.showModButton,
    });
    if (activityKey === lastActivityKey) return;

    await activeClient.user.setActivity(buildActivity(playerState));
    lastActivityKey = activityKey;
  } catch (error) {
    console.warn("[DISCORD RPC] Activity update failed:", error);
  } finally {
    pollTimer = setTimeout(updateActivity, POLL_INTERVAL_MS);
  }
}

async function getAppPlayerState() {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!window) return undefined;

  return window.webContents.executeJavaScript(`
    (() => typeof window.__getPlayerState === "function" ? window.__getPlayerState() : undefined)()
  `);
}

void initRpc();
if (!pollTimer) void updateActivity();
