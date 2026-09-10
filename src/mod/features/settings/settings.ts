let exceptionsCaptureEnabled = false;

function applyExceptionsCaptureSetting() {
  window.__yandexMusicModAnalyticsEnabled = exceptionsCaptureEnabled;
}

const unsubscribe = window.yandexMusicMod.onStorageChanged((key: string, value: unknown) => {
  if (key !== "settings/exeptionsCaptureEnabled") return;
  exceptionsCaptureEnabled = value === true;
  applyExceptionsCaptureSetting();
});

void window.yandexMusicMod
  .getStorageValue("settings/exeptionsCaptureEnabled")
  .then((value) => {
    exceptionsCaptureEnabled = value === true;
    applyExceptionsCaptureSetting();
  })
  .catch(() => {
    exceptionsCaptureEnabled = false;
    applyExceptionsCaptureSetting();
  });

window.addEventListener("beforeunload", unsubscribe, { once: true });
