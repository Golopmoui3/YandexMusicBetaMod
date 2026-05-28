// Workaround для проблемы electron-builder на Windows без админских прав:
//
// При сборке Windows-инсталлера electron-builder скачивает winCodeSign-2.6.0.7z
// и распаковывает его через бандленный 7za 21.07. В архиве лежат darwin .dylib
// symlink-файлы (libcrypto.dylib, libssl.dylib), создание которых на Windows
// требует SeCreateSymbolicLinkPrivilege — это либо запуск от админа, либо
// включённый Developer Mode. Без этого 7za возвращает exit 2 и сборка падает.
//
// Эти .dylib нужны только для подписи macOS-сборок. На Windows-сборке они
// бесполезны.
//
// Workaround: подменяем 7za.exe в bunx-temp-папке electron-builder'а на
// заранее скомпилированную bun-обёртку (`scripts/7za-wrapper.ts`), которая
// проксирует все вызовы в оригинальный 7za, добавляя -xr! фильтры для
// исключения проблемных файлов.
//
// Обёртка должна быть собрана через:
//   bun build --compile --target=bun-windows-x64 ./scripts/7za-wrapper.ts \
//             --outfile ./scripts/7za-wrapper.exe
// (см. scripts/7za-wrapper.ts и README в репозитории).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";

const WRAPPER_FILENAME = "7za-wrapper.exe";

export async function applyWincodesignWorkaround(): Promise<void> {
  if (process.platform !== "win32") {
    return; // Не Windows — проблема не актуальна
  }

  const projectRoot = path.resolve(import.meta.dir, "..", "..");
  const wrapperPath = path.join(projectRoot, "scripts", WRAPPER_FILENAME);

  if (!fs.existsSync(wrapperPath)) {
    console.log(`⚠️  ${WRAPPER_FILENAME} не найден — компилирую...`);
    await $`bun build --compile --target=bun-windows-x64 ./scripts/7za-wrapper.ts --outfile ./scripts/${WRAPPER_FILENAME}`.cwd(
      projectRoot,
    );
  }

  // Ищем bunx-кэш папку с актуальной версией electron-builder
  const tempDir = os.tmpdir();
  const candidates = fs
    .readdirSync(tempDir)
    .filter((name) => name.startsWith("bunx-") && name.includes("electron-builder"))
    .map((name) => path.join(tempDir, name, "node_modules", "7zip-bin", "win", "x64", "7za.exe"))
    .filter((p) => fs.existsSync(p));

  if (candidates.length === 0) {
    console.log(`⚠️  bunx-кэш electron-builder не найден — обёртка будет применена при следующей сборке`);
    return;
  }

  // Размер обёртки используется чтобы детектировать "7za.exe уже подменён".
  // Реальный 7za.exe ~1.5MB; bun-compiled обёртка ~110MB.
  const wrapperSize = fs.statSync(wrapperPath).size;

  for (const target7zaPath of candidates) {
    const dir = path.dirname(target7zaPath);
    const realExePath = path.join(dir, "7za-real.exe");

    const currentIsWrapper = fs.statSync(target7zaPath).size === wrapperSize;

    // Сохраняем оригинал если ещё не сохранён
    if (!fs.existsSync(realExePath)) {
      if (currentIsWrapper) {
        // 7za.exe уже обёртка от прошлого билда, а 7za-real.exe утерян
        // (например temp папка bunx пересоздалась). Берём оригинал из локального
        // bun cache или из node_modules данного репо.
        const fallbacks = [
          path.join(projectRoot, "node_modules", "7zip-bin", "win", "x64", "7za.exe"),
          path.join(os.homedir(), ".bun", "install", "cache", "7zip-bin@5.1.1@@@1", "win", "x64", "7za.exe"),
          path.join(os.homedir(), ".bun", "install", "cache", "7zip-bin@5.2.0@@@1", "win", "x64", "7za.exe"),
        ];
        const fallback = fallbacks.find((p) => fs.existsSync(p) && fs.statSync(p).size !== wrapperSize);
        if (!fallback) {
          console.log(`⚠️  Не удалось найти оригинальный 7za.exe для восстановления в ${dir}`);
          continue;
        }
        fs.copyFileSync(fallback, realExePath);
      } else {
        fs.copyFileSync(target7zaPath, realExePath);
      }
    }

    // Подменяем 7za.exe на нашу обёртку (если ещё не подменён)
    if (!currentIsWrapper) {
      fs.copyFileSync(wrapperPath, target7zaPath);
    }
    console.log(`✔️   7za-wrapper применён: ${target7zaPath}`);
  }
}
