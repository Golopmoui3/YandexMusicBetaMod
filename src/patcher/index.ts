import { getStableBuild } from "./api";
import { processBuild } from "./patcher";

const stableBuild = await getStableBuild();

if (stableBuild.isErr()) {
  console.error(stableBuild.error);
  process.exit(1);
}

const files = stableBuild.value;
let hasFailures = false;

for (const file of files) {
  // Vite inherits this value and embeds the actual Yandex Music build version
  // into the mod. No manual .env version bump is needed.
  process.env.VITE_MOD_VERSION = file.version;

  try {
    const result = await processBuild(file);
    if (!result) {
      hasFailures = true;
      console.error(`Build ${file.version} did not complete`);
    }
  } catch (error) {
    hasFailures = true;
    console.error(`Build ${file.version} failed:`, error);
  }
}

if (hasFailures) process.exit(1);
