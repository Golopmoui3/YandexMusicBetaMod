declare global {
  interface Window {
    yandexMusicMod: {
      getStorageValue: (key: string) => Promise<unknown>;
      setStorageValue: (key: string, value: unknown) => Promise<void>;
      onStorageChanged: (cb: (key: string, value: unknown) => void) => () => void;
      downloadTrack: (
        downloadInfo: unknown,
        trackMeta: unknown,
        customDownloadPath?: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      openDownloadDirectory: () => Promise<{ success: boolean; error?: string }>;
      selectDownloadFolder: () => Promise<{ success: boolean; path: string | null }>;
      openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
    };
    VERSION: string;
    __getPlayerState: () => unknown;
    __yandexMusicModAnalyticsEnabled?: boolean;
    __workers: Worker[];
  }
}

export {};
