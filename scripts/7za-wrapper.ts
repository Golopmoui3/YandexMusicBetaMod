// Обёртка над 7za.exe для обхода ошибки "Cannot create symbolic link" при
// извлечении winCodeSign-2.6.0.7z на Windows без прав администратора.
//
// Архив winCodeSign содержит symlink'и для darwin .dylib файлов
// (libcrypto.dylib, libssl.dylib), которые в Windows без Developer Mode и
// без админских прав создать нельзя. Эти файлы нужны только для подписи
// macOS-сборок и для Windows-сборки бесполезны.
//
// Обёртка проксирует все аргументы в реальный 7za, добавляя -xr! фильтры
// для исключения проблемных файлов.

import { spawn } from "bun";
import { dirname, join } from "path";

// В bun-compile process.execPath корректно указывает на физический exe на диске
const exeDir = dirname(process.execPath);
const realExe = join(exeDir, "7za-real.exe");

// В bun-compile process.argv = ["bun", "<virtual path>", ...real_args]
// Реальные аргументы начинаются с argv[2]
const args = process.argv.slice(2);

// Исключаем symlink-файлы, которые ломают распаковку без админских прав.
const extraExcludes = ["-xr!libcrypto.dylib", "-xr!libssl.dylib"];

const finalArgs = [...args, ...extraExcludes];

const proc = spawn({
  cmd: [realExe, ...finalArgs],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const exitCode = await proc.exited;
process.exit(exitCode);
