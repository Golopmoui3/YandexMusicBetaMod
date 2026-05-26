import fs from "fs";
import path from "path";
import { prettifyDirectory } from "~/patcher/prettier";

// Автоматически берём самую свежую версию из .versions/
const versionsDir = ".versions";
if (!fs.existsSync(versionsDir)) {
  console.error(`❌ Папка ${versionsDir} не найдена. Сначала запустите 'bun start' хотя бы один раз.`);
  process.exit(1);
}

const versions = fs
  .readdirSync(versionsDir)
  .filter((name) => fs.statSync(path.join(versionsDir, name)).isDirectory())
  .sort((a, b) => {
    const parse = (v) => v.split(".").map((n) => parseInt(n, 10) || 0);
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

const latestVersion = versions.at(-1);
if (!latestVersion) {
  console.error(`❌ В ${versionsDir} нет ни одной версии. Сначала запустите 'bun start'.`);
  process.exit(1);
}

const modPath = `${versionsDir}/${latestVersion}/mod`;
console.log(`📦 Prettifying ${modPath}`);

await prettifyDirectory(modPath);
