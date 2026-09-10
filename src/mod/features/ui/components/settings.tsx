import { useEffect, useState } from "react";

import { ExpandableCard } from "@ui/components/ui/expandable-card";
import { Label } from "@ui/components/ui/label";
import { Switch } from "@ui/components/ui/switch";
import { Alert, AlertDescription } from "@ui/components/ui/alert";
import { Info, Settings as SettingsIcon } from "lucide-react";

export function Settings() {
  const [exceptionsCaptureEnabled, setExceptionsCaptureEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void window.yandexMusicMod.getStorageValue("settings/exeptionsCaptureEnabled").then((value) => {
      if (active) setExceptionsCaptureEnabled(value === true);
    });

    const unsubscribe = window.yandexMusicMod.onStorageChanged((key, value) => {
      if (key === "settings/exeptionsCaptureEnabled") setExceptionsCaptureEnabled(value === true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <ExpandableCard title="Настройки" icon={<SettingsIcon className="h-4 w-4" />}>
      <div className="flex flex-col gap-4 pt-2 px-3">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-exceptions-capture-toggle"
            checked={exceptionsCaptureEnabled}
            onCheckedChange={(enabled) => {
              setExceptionsCaptureEnabled(enabled);
              void window.yandexMusicMod.setStorageValue("settings/exeptionsCaptureEnabled", enabled);
            }}
          />
          <Label htmlFor="settings-exceptions-capture-toggle" className="cursor-pointer">
            Отправлять обезличенные отчёты об ошибках
          </Label>
        </div>

        <Alert variant="default" className="cursor-default">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Выключено по умолчанию. Токены, логин, UID, HTTP-заголовки и консольные сообщения не отправляются.
          </AlertDescription>
        </Alert>
      </div>
    </ExpandableCard>
  );
}
