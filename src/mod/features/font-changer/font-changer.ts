import availableFonts from "@ui/assets/fonts/fonts.json";

const stylesheetName = "yandex-music-mod-font-changer-style";
const customFontFacesId = "yandex-music-mod-font-changer-custom-faces";

export type CustomFont = {
  // Уникальный id (используется как family и значение в Select)
  id: string;
  // Отображаемое имя в UI
  name: string;
  // CSS font-family — совпадает с id, чтобы избежать коллизий с системными шрифтами
  family: string;
  // data: URL содержимого шрифта (base64). woff2/woff/ttf/otf
  dataUri: string;
  // MIME-формат для @font-face src: format("woff2"|"woff"|"truetype"|"opentype")
  format: string;
};

async function getCustomFonts(): Promise<CustomFont[]> {
  const raw = await window.yandexMusicMod.getStorageValue("font-changer/customFonts");
  if (!Array.isArray(raw)) return [];
  // Базовая валидация — отсекаем мусор
  return raw.filter(
    (f: any) =>
      f && typeof f === "object" && typeof f.id === "string" && typeof f.family === "string" && typeof f.dataUri === "string",
  );
}

// Регистрируем все пользовательские @font-face в одном <style>. Перевешиваем
// блок целиком при каждом изменении — это проще и достаточно быстро.
async function injectCustomFontFaces(): Promise<void> {
  const customFonts = await getCustomFonts();
  document.getElementById(customFontFacesId)?.remove();
  if (customFonts.length === 0) return;

  const css = customFonts
    .map(
      (f) => `@font-face {
  font-family: "${f.family}";
  src: url("${f.dataUri}") format("${f.format}");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`,
    )
    .join("\n");

  const style = document.createElement("style");
  style.id = customFontFacesId;
  style.innerHTML = css;
  document.head.appendChild(style);
}

async function updateFont() {
  await injectCustomFontFaces();

  const savedFontValue = await window.yandexMusicMod.getStorageValue("font-changer/savedFont");
  const fontChangerEnabled = await window.yandexMusicMod.getStorageValue("font-changer/enabled");
  const customFonts = await getCustomFonts();

  // Сначала ищем среди встроенных, потом среди пользовательских
  const builtIn = availableFonts.find((font) => font.name === savedFontValue);
  const custom = customFonts.find((font) => font.name === savedFontValue);
  const savedFont = builtIn || custom || availableFonts[0];

  console.log("[font-changer]", {
    savedFont,
    fontChangerEnabled,
    customFontsCount: customFonts.length,
  });

  document.getElementById(stylesheetName)?.remove();

  if (!fontChangerEnabled) return;

  if (!savedFont) {
    console.error("[font-changer]", "No font found");
    return;
  }

  const extraStylesheet = (savedFont as any).extraStylesheet || "";

  const styleSheet = document.createElement("style");
  styleSheet.id = stylesheetName;
  styleSheet.innerHTML = `* {
  font-family: "${savedFont.family}" !important;
}
${extraStylesheet}
`;
  document.head.appendChild(styleSheet);
}

window.yandexMusicMod.onStorageChanged((key: string, value: any) => {
  if (key.includes("font-changer")) updateFont();
});

updateFont();
