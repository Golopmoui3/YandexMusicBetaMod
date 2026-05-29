const { BrowserWindow } = require("electron");
const { Client } = require("@xhayper/discord-rpc");

const CLIENT_ID = "1283109459463377011";

let lastTrackId = null;
let lastIsPlaying = null;
let client;

function initRpc() {
  client = new Client({ clientId: CLIENT_ID });

  client.login().catch((e) => {
    console.error("[DISCORD RPC]", e);
    setTimeout(initRpc, 3000);
  });

  client.on("ready", () => {
    console.log("[DISCORD RPC] Hooked!");
    console.log("client.user", client.user?.username);
  });

  client.on("disconnected", () => {
    console.log("[DISCORD RPC] Disconnected");
    setTimeout(initRpc, 3000);
  });

  client.on("error", () => {
    console.log("[DISCORD RPC] Error");
    setTimeout(initRpc, 3000);
  });
  client.on("close", () => {
    console.log("[DISCORD RPC] Closed");
    setTimeout(initRpc, 3000);
  });
}

async function updateActivity() {
  setTimeout(updateActivity, 500);

  if (!client.user) return;

  try {
    const playerState = await GetAppPlayerState();

    // Discord RPC не включен
    if (!playerState.enabled) {
      if (lastTrackId !== null) {
        client.user.clearActivity();
        lastTrackId = null;
        lastIsPlaying = null;
      }
      return;
    }

    const playerStateData = playerState.data;

    if (!playerStateData || !playerStateData.isPlaying) {
      if (lastIsPlaying !== false) {
        client.user.clearActivity();
        lastIsPlaying = false;
        lastTrackId = null;
      }
      return;
    }

    const currentTrackId = playerStateData.trackMeta?.id;

    const startTimestamp = Math.round(Date.now() - playerStateData.playback.position * 1000);
    const endTimestamp = Math.round(
      Date.now() + (playerStateData.playback.duration - playerStateData.playback.position) * 1000,
    );

    const firstArtist = playerStateData.trackMeta.artists?.[0];
    const showArtist = playerState.showArtist !== false;
    const artistAvatar =
      showArtist && firstArtist?.avatarUri
        ? `https://${firstArtist.avatarUri.replaceAll("%%", "100x100")}`
        : undefined;
    const artistsLine = showArtist
      ? playerStateData.trackMeta.artists.map((a) => a.name).join(", ")
      : undefined;

    const rpcRequest = {
      type: 2,
      details: playerStateData.trackMeta.version
        ? `${playerStateData.trackMeta.title} ${playerStateData.trackMeta.version}`
        : playerStateData.trackMeta.title,
      largeImageKey: playerStateData.trackMeta.coverUri
        ? `https://${playerStateData.trackMeta.coverUri.replaceAll("%%", "300x300")}`
        : undefined,
      largeImageText: playerStateData.trackMeta.albums?.[0]?.title || undefined,
      smallImageKey: artistAvatar,
      smallImageText: showArtist ? firstArtist?.name || undefined : undefined,
      state: artistsLine,
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      buttons: [
        {
          label: "🎵 Открыть",
          url: `https://music.yandex.ru/track/${playerStateData.trackMeta.id}`,
        },
      ],
      instance: false,
    };

    if (playerState.showModButton) {
      rpcRequest.buttons.push({
        label: "💻 Yandex Music Mod",
        url: `https://github.com/Stephanzion/YandexMusicBetaMod`,
      });
    }

    client.user.setActivity(rpcRequest);
    lastTrackId = currentTrackId;
    lastIsPlaying = true;
  } catch (ex) {
    console.log("[DISCORD RPC]", ex);
  }
}

initRpc();
updateActivity();

async function GetAppPlayerState() {
  const [win] = BrowserWindow.getAllWindows();
  if (win && !win.isDestroyed()) {
    return win.webContents.executeJavaScript(`
        (()=>{
            return window.__getPlayerState();
        })()
       `);
  }
}
