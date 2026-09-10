import { useEffect, useRef, useState } from "react";

import { ExpandableCard } from "@ui/components/ui/expandable-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/components/ui/select";
import { Label } from "@ui/components/ui/label";
import { Switch } from "@ui/components/ui/switch";
import { Button } from "@ui/components/ui/button";
import { If } from "@ui/components/ui/if";

import { Type, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";

import "@ui/assets/fonts/stylesheet.css";
import availableFontsRaw from "@ui/assets/fonts/fonts.json";
const builtInFonts = availableFontsRaw.map((font) => font.name);

type CustomFont = {
  id: string;
  name: string;
  family: string;
  dataUri: string;
  format: string;
};

const MAX_FONT_SIZE_BYTES = 5 * 1024 * 1024;

const FORMAT_BY_EXT: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
};

function getFormat(filename: string): string | null {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match?.[1];
  return extension ? (FORMAT_BY_EXT[extension] ?? null) : null;
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function FontChanger() {
  const [customFontEnabled, setCustomFontEnabled] = useState(false);
  const [selectedFont, setSelectedFont] = useState(builtInFonts[0]);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allFontNames = [...builtInFonts, ...customFonts.map((font) => font.name)];

  useEffect(() => {
    void (async () => {
      const savedCustom = (await window.yandexMusicMod.getStorageValue("font-changer/customFonts")) as
        | CustomFont[]
        | null;
      const safeCustom = Array.isArray(savedCustom) ? savedCustom : [];

      const candidate = await window.yandexMusicMod.getStorageValue("font-changer/savedFont");
      const known = [...builtInFonts, ...safeCustom.map((font) => font.name)];
      const savedFont = known.find((font) => font === candidate) || builtInFonts[0];
      const savedFontEnabled = await window.yandexMusicMod.getStorageValue("font-changer/enabled");

      setCustomFonts(safeCustom);
      setCustomFontEnabled(savedFontEnabled === true);
      setSelectedFont(savedFont);
    })();
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    const format = getFormat(file.name);
    if (!format) {
      toast.error("Неподдерживаемый формат шрифта", {
        description: "Поддерживаются: .woff2, .woff, .ttf, .otf",
      });
      return;
    }

    if (file.size > MAX_FONT_SIZE_BYTES) {
      toast.error("Файл слишком большой", {
        description: `Максимум 5 МБ, у вас ${(file.size / 1024 / 1024).toFixed(2)} МБ`,
      });
      return;
    }

    const defaultName = file.name.replace(/\.[a-z0-9]+$/i, "").trim() || "Мой шрифт";
    const allNames = new Set([...builtInFonts, ...customFonts.map((font) => font.name)]);
    let name = defaultName;
    let counter = 2;
    while (allNames.has(name)) name = `${defaultName} (${counter++})`;

    let dataUri: string;
    try {
      dataUri = await readFileAsDataUri(file);
    } catch (error) {
      toast.error("Не удалось прочитать файл", { description: String(error) });
      return;
    }

    const id = `ymm-custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const updated = [...customFonts, { id, name, family: id, dataUri, format }];
    setCustomFonts(updated);
    await window.yandexMusicMod.setStorageValue("font-changer/customFonts", updated);
    toast.success("Шрифт добавлен", { description: name });
  };

  const handleRemove = async (id: string) => {
    const removed = customFonts.find((font) => font.id === id);
    const updated = customFonts.filter((font) => font.id !== id);
    setCustomFonts(updated);
    await window.yandexMusicMod.setStorageValue("font-changer/customFonts", updated);

    if (removed && selectedFont === removed.name) {
      setSelectedFont(builtInFonts[0]);
      await window.yandexMusicMod.setStorageValue("font-changer/savedFont", builtInFonts[0]);
    }

    if (removed) toast.success("Шрифт удалён", { description: removed.name });
  };

  return (
    <ExpandableCard title="Замена шрифтов" icon={<Type className="h-4 w-4" />}>
      <div className="flex flex-col gap-5 pt-2 px-3">
        <div className="flex items-center gap-3">
          <Switch
            id="font-changer-toggle"
            checked={customFontEnabled}
            onCheckedChange={(enabled) => {
              setCustomFontEnabled(enabled);
              void window.yandexMusicMod.setStorageValue("font-changer/enabled", enabled);
            }}
          />
          <Label htmlFor="font-changer-toggle" className="cursor-pointer">
            Заменить шрифты в приложении
          </Label>
        </div>

        <If condition={customFontEnabled}>
          <div className="flex gap-4 items-center justify-center">
            <span className="text-sm text-foreground whitespace-nowrap">Шрифт:</span>
            <Select
              value={selectedFont}
              onValueChange={(value: string) => {
                setSelectedFont(value);
                void window.yandexMusicMod.setStorageValue("font-changer/savedFont", value);
              }}
              disabled={!customFontEnabled}
            >
              <SelectTrigger className="w-full text-foreground">
                <SelectValue placeholder="Выбрать шрифт" />
              </SelectTrigger>
              <SelectContent>
                {allFontNames.map((font) => (
                  <SelectItem key={font} value={font}>
                    {font}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </If>

        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".woff2,.woff,.ttf,.otf,font/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button variant="outline" size="sm" className="w-full" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Добавить свой шрифт
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Поддерживаются .woff2, .woff, .ttf, .otf — до 5 МБ
          </p>
        </div>

        <If condition={customFonts.length > 0}>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground mb-1">Мои шрифты</span>
            {customFonts.map((font) => (
              <div
                key={font.id}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted/40"
              >
                <span className="text-sm truncate">{font.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleRemove(font.id)}
                  title="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </If>
      </div>
    </ExpandableCard>
  );
}
