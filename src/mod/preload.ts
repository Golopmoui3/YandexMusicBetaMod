// @ts-nocheck

electron.contextBridge.exposeInMainWorld("yandexMusicMod", {
  getStorageValue: (key: string) => electron.ipcRenderer.invoke("yandexMusicMod.getStorageValue", key),
  setStorageValue: (key: string, value: unknown) =>
    electron.ipcRenderer.invoke("yandexMusicMod.setStorageValue", key, value),
  onStorageChanged: (cb: (key: string, value: unknown) => void) => {
    const listener = (_event: unknown, key: string, value: unknown) => cb(key, value);
    electron.ipcRenderer.on("yandexMusicMod.storageValueUpdated", listener);
    return () => electron.ipcRenderer.removeListener("yandexMusicMod.storageValueUpdated", listener);
  },
  downloadTrack: (downloadInfo: unknown, trackMeta: unknown, customDownloadPath?: string) =>
    electron.ipcRenderer.invoke("yandexMusicMod.downloadTrack", downloadInfo, trackMeta, customDownloadPath),
  openDownloadDirectory: () => electron.ipcRenderer.invoke("yandexMusicMod.openDownloadDirectory"),
  selectDownloadFolder: () => electron.ipcRenderer.invoke("yandexMusicMod.selectDownloadFolder"),
  openFolder: (folderPath: string) => electron.ipcRenderer.invoke("yandexMusicMod.openFolder", folderPath),
});
