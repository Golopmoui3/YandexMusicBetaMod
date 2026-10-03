const electron = require("electron");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const sanitize = require("sanitize-filename");
const axios = require("axios");

let pathToFfmpeg = null;
try {
  const ffmpegBinary = require("ffmpeg-static");
  if (typeof ffmpegBinary !== "string" || ffmpegBinary.length === 0) {
    throw new Error("ffmpeg-static did not provide a binary for this platform");
  }
  pathToFfmpeg = ffmpegBinary.replaceAll("app.asar", "app.asar.unpacked");
} catch (error) {
  console.error("[yandexMusicMod] ffmpeg-static init failed, track downloads will be disabled:", error);
}
const appFolder = electron.app.getPath("userData");
const settingsFilePath = path.join(appFolder, "mod_settings.json");
const defaultDownloadPath = path.join(appFolder, "Downloads");
const MAX_SETTING_VALUE_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_SETTING_KEYS = new Set(["__proto__", "constructor", "prototype"]);

try {
  fs.mkdirSync(defaultDownloadPath, { recursive: true });
} catch (error) {
  console.error("[yandexMusicMod] Failed to create download directory:", error);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readSettings() {
  try {
    if (!fs.existsSync(settingsFilePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn("Failed to read settings, restoring defaults:", errorMessage(error));
    return {};
  }
}

function writeSettings(settings) {
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
}

function validateSettingKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 200 || FORBIDDEN_SETTING_KEYS.has(key)) {
    throw new TypeError("Invalid settings key");
  }
}

function validateSettingValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Setting value is not JSON-serializable");
  if (Buffer.byteLength(serialized, "utf8") > MAX_SETTING_VALUE_BYTES) throw new RangeError("Setting value is too large");
}

const initialSettings = readSettings();
if (!initialSettings.downloadFolderPath) initialSettings.downloadFolderPath = defaultDownloadPath;
try {
  writeSettings(initialSettings);
} catch (error) {
  console.error("[yandexMusicMod] Failed to initialize settings file:", error);
}

function isAllowedYandexHost(hostname) {
  const host = hostname.toLowerCase();
  return ["yandex.net", "yandex.ru", "yandex.com"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function parseYandexHttpsUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) throw new TypeError("URL is missing");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !isAllowedYandexHost(url.hostname)) {
    throw new TypeError("Only HTTPS URLs on Yandex domains are allowed");
  }
  return url.toString();
}

function validateDirectoryPath(folderPath, mustExist = false) {
  if (typeof folderPath !== "string" || !path.isAbsolute(folderPath)) throw new TypeError("Directory path must be absolute");
  if (mustExist && (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory())) {
    throw new TypeError("Directory does not exist");
  }
  return path.resolve(folderPath);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(pathToFfmpeg, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`FFmpeg failed: ${String(stderr || error.message).trim()}`));
        return;
      }
      resolve();
    });
  });
}

electron.ipcMain.handle("yandexMusicMod.getStorageValue", (_event, key) => {
  validateSettingKey(key);
  const settings = readSettings();
  return settings[key] !== undefined ? settings[key] : null;
});

electron.ipcMain.handle("yandexMusicMod.setStorageValue", (_event, key, value) => {
  validateSettingKey(key);
  validateSettingValue(value);
  const settings = readSettings();
  settings[key] = value;
  writeSettings(settings);

  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("yandexMusicMod.storageValueUpdated", key, value);
  }
});

electron.ipcMain.handle("yandexMusicMod.selectDownloadFolder", async () => {
  const result = await electron.dialog.showOpenDialog({ properties: ["openDirectory"], title: "Выберите папку для загрузки треков" });
  if (result.canceled || result.filePaths.length === 0) return { success: false, path: null };
  return { success: true, path: validateDirectoryPath(result.filePaths[0], true) };
});

electron.ipcMain.handle("yandexMusicMod.openFolder", async (_event, folderPath) => {
  try {
    const safePath = validateDirectoryPath(folderPath, true);
    const openError = await electron.shell.openPath(safePath);
    return openError ? { success: false, error: openError } : { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

electron.ipcMain.handle("yandexMusicMod.downloadTrack", async (_event, downloadInfo, trackMeta, customDownloadPath = null) => {
  let trackTempFilePath = null;
  let trackCoverPath = null;

  try {
    if (!pathToFfmpeg) return { ok: false, error: "ffmpeg is unavailable in this build" };
    if (!downloadInfo || typeof downloadInfo !== "object") throw new TypeError("Invalid download info");
    if (!trackMeta || typeof trackMeta !== "object") throw new TypeError("Invalid track metadata");
    if (typeof downloadInfo.key !== "string" || typeof downloadInfo.codec !== "string") {
      throw new TypeError("Download key or codec is missing");
    }

    const downloadUrl = parseYandexHttpsUrl(downloadInfo.url);
    const configuredPath = customDownloadPath || readSettings().downloadFolderPath || defaultDownloadPath;
    const saveFolder = validateDirectoryPath(configuredPath);
    fs.mkdirSync(saveFolder, { recursive: true });

    const artists = Array.isArray(trackMeta.artists)
      ? trackMeta.artists.map((artist) => String(artist?.name || "")).filter(Boolean)
      : [];
    const title = typeof trackMeta.title === "string" && trackMeta.title.trim() ? trackMeta.title.trim() : "Unknown track";
    const version = typeof trackMeta.version === "string" ? trackMeta.version.trim() : "";
    const fallbackName = `track-${String(trackMeta.id || Date.now())}`;
    const trackFileName =
      sanitize(`${artists.join(", ")} - ${title}${version ? ` ${version}` : ""}`).trim().slice(0, 180) || fallbackName;
    const codec = downloadInfo.codec.toLowerCase();
    const fileExtension = codec.includes("flac") ? "flac" : codec.includes("mp3") ? "mp3" : "m4a";
    const trackFilePath = path.join(saveFolder, `${trackFileName}.${fileExtension}`);
    trackTempFilePath = path.join(saveFolder, `.${randomUUID()}.${fileExtension}`);
    trackCoverPath = path.join(saveFolder, `.${randomUUID()}.jpg`);

    const response = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      timeout: 60_000,
      maxContentLength: 1024 * 1024 * 1024,
      validateStatus: () => true,
    });
    if (response.status !== 200) throw new Error(`Download failed with HTTP ${response.status}`);

    const decryptedData = await decryptYandexAudio(response.data, downloadInfo.key);
    await fs.promises.writeFile(trackFilePath, Buffer.from(decryptedData));
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", trackFilePath, "-c", "copy", "-y", trackTempFilePath]);

    const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-i", trackTempFilePath];
    let hasCover = false;

    if (typeof trackMeta.coverUri === "string" && trackMeta.coverUri.length > 0) {
      try {
        const coverAddress = "https:" + "//" + trackMeta.coverUri.replaceAll("%%", "orig");
        const coverUrl = parseYandexHttpsUrl(coverAddress);
        const coverResponse = await axios.get(coverUrl, {
          responseType: "arraybuffer",
          timeout: 30_000,
          validateStatus: () => true,
        });
        if (coverResponse.status === 200) {
          await fs.promises.writeFile(trackCoverPath, coverResponse.data);
          ffmpegArgs.push("-i", trackCoverPath, "-map", "0:a:0", "-map", "1:v:0", "-disposition:v:0", "attached_pic");
          hasCover = true;
        }
      } catch (error) {
        console.warn("Failed to download cover art:", errorMessage(error));
      }
    }

    if (!hasCover) ffmpegArgs.push("-map", "0:a:0");
    ffmpegArgs.push("-c", "copy", "-id3v2_version", "3");

    const addMetadata = (key, value) => {
      if (value !== undefined && value !== null && String(value).length > 0) {
        ffmpegArgs.push("-metadata", `${key}=${String(value)}`);
      }
    };

    addMetadata("title", title);
    addMetadata("subtitle", version);
    addMetadata("artist", artists.join("/"));
    addMetadata("album", trackMeta.albums?.[0]?.title);
    addMetadata("genre", trackMeta.albums?.[0]?.genre);
    addMetadata("track", trackMeta.albums?.[0]?.trackPosition?.index);
    addMetadata("date", trackMeta.albums?.[0]?.year);
    addMetadata("releaseDate", trackMeta.albums?.[0]?.releaseDate);
    addMetadata("encoded_by", "yandexMusicMod");
    ffmpegArgs.push("-y", trackFilePath);
    await runFfmpeg(ffmpegArgs);

    return { ok: true };
  } catch (error) {
    console.error("Download or decryption failed:", errorMessage(error));
    return { ok: false, error: errorMessage(error) };
  } finally {
    for (const temporaryPath of [trackTempFilePath, trackCoverPath]) {
      if (!temporaryPath || !fs.existsSync(temporaryPath)) continue;
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        console.warn("Failed to remove temporary file:", errorMessage(error));
      }
    }
  }
});

electron.ipcMain.handle("yandexMusicMod.openDownloadDirectory", async () => {
  try {
    const saveFolder = validateDirectoryPath(readSettings().downloadFolderPath || defaultDownloadPath);
    fs.mkdirSync(saveFolder, { recursive: true });
    const openError = await electron.shell.openPath(saveFolder);
    return openError ? { success: false, error: openError } : { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

async function decryptYandexAudio(encryptedData, secretKey) {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(secretKey)) throw new TypeError("Invalid audio decryption key");
  const bytes = secretKey.match(/.{1,2}/g);
  if (!bytes) throw new TypeError("Invalid audio decryption key");
  const keyData = new Uint8Array(bytes.map((byte) => Number.parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "AES-CTR" }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: new Uint8Array(16), length: 128 }, cryptoKey, encryptedData);
}

mod_require("discordRPC");
