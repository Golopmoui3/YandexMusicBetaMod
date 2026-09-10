declare global {
  interface Window {
    __yamodAudioElements?: Set<HTMLAudioElement>;
    __yamodGetActiveAudio?: () => HTMLAudioElement | null;
  }
}

const MAX_TRACKED_AUDIO_ELEMENTS = 50;

export function initAudioElementTracker(): void {
  if (typeof document === "undefined" || window.__yamodGetActiveAudio) return;

  const audioElements = new Set<HTMLAudioElement>();
  const lastActivity = new WeakMap<HTMLAudioElement, number>();
  let activitySequence = 0;
  window.__yamodAudioElements = audioElements;

  const markActive = (audio: HTMLAudioElement) => {
    lastActivity.set(audio, ++activitySequence);
  };

  const trackAudio = (audio: HTMLAudioElement) => {
    audioElements.add(audio);
    const updateWhilePlaying = () => {
      if (!audio.paused) markActive(audio);
    };
    audio.addEventListener("play", () => markActive(audio));
    audio.addEventListener("playing", () => markActive(audio));
    audio.addEventListener("timeupdate", updateWhilePlaying);

    if (audioElements.size > MAX_TRACKED_AUDIO_ELEMENTS) {
      const removable = [...audioElements]
        .filter((candidate) => candidate !== audio && candidate.paused)
        .sort((left, right) => (lastActivity.get(left) ?? 0) - (lastActivity.get(right) ?? 0))[0];
      if (removable) audioElements.delete(removable);
    }
  };

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName: string, options?: ElementCreationOptions) {
    const element = originalCreateElement(tagName, options as any);
    if (tagName.toLowerCase() === "audio") trackAudio(element as HTMLAudioElement);
    return element;
  } as typeof document.createElement;

  window.__yamodGetActiveAudio = (): HTMLAudioElement | null => {
    const loaded = [...audioElements].filter(
      (audio) => !!audio.src && Number.isFinite(audio.duration) && audio.duration > 0,
    );
    const playing = loaded.filter((audio) => !audio.paused);
    const candidates = playing.length > 0 ? playing : loaded;
    if (candidates.length === 0) return null;

    return candidates.reduce((latest, candidate) =>
      (lastActivity.get(candidate) ?? 0) > (lastActivity.get(latest) ?? 0) ? candidate : latest,
    );
  };
}
