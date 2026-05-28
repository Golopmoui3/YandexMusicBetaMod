// Yandex Music создаёт <audio> через document.createElement('audio') и
// никогда не вставляет их в DOM — поэтому document.querySelectorAll('audio')
// их не видит. Чтобы достать прогресс трека (currentTime / duration / paused)
// мы перехватываем создание audio-элементов и сохраняем ссылку на последний
// "активный" — то есть тот, у которого реально что-то играет.
//
// Должно запуститься ДО первой загрузки чанков Yandex Music (renderer.js
// инжектится в <head> раньше Next.js-кода — этот файл подключается
// первой строкой в renderer.ts).

declare global {
  interface Window {
    __yamodAudioElements?: Set<HTMLAudioElement>;
    __yamodGetActiveAudio?: () => HTMLAudioElement | null;
  }
}

export function initAudioElementTracker(): void {
  if (typeof document === "undefined") return;
  if (window.__yamodGetActiveAudio) return; // уже инициализирован

  const audioElements = new Set<HTMLAudioElement>();
  window.__yamodAudioElements = audioElements;

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName: string, options?: ElementCreationOptions) {
    const el = originalCreateElement(tagName, options as any);
    if (typeof tagName === "string" && tagName.toLowerCase() === "audio") {
      audioElements.add(el as HTMLAudioElement);
    }
    return el;
  } as typeof document.createElement;

  // Активный audio — это тот, у которого есть src и он играет (или недавно играл).
  // Если играет несколько — берём с самым свежим currentTime > 0.
  window.__yamodGetActiveAudio = function (): HTMLAudioElement | null {
    // Чистим мёртвые ссылки на всякий
    const alive = Array.from(audioElements).filter((a) => !!a);

    // Сначала ищем не на паузе с реальным src и положительной длительностью
    const playing = alive.filter(
      (a) => !!a.src && !a.paused && Number.isFinite(a.duration) && a.duration > 0,
    );
    if (playing.length > 0) {
      // Самый "продвинутый" по позиции
      return playing.reduce((best, cur) => (cur.currentTime > best.currentTime ? cur : best));
    }

    // На паузе но с загруженной длительностью
    const loaded = alive.filter(
      (a) => !!a.src && Number.isFinite(a.duration) && a.duration > 0,
    );
    if (loaded.length > 0) {
      return loaded.reduce((best, cur) => (cur.currentTime > best.currentTime ? cur : best));
    }

    return null;
  };
}
