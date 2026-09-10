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
  // Release workflows inject an automatically generated fork build revision.
  // Local and pull-request builds fall back to the Yandex Music app version.
  const injectedModVersion = process.env.VITE_MOD_VERSION?.trim();
  if (
    injectedModVersion &&
    injectedModVersion !== file.version &&
    !injectedModVersion.startsWith(`${file.version}.`)
  ) {
    console.error(`Mod version ${injectedModVersion} does not match Yandex Music ${file.version}`);
    hasFailures = true;
    continue;
  }
  process.env.VITE_MOD_VERSION = injectedModVersion || file.version;
  console.log(`Building Yandex Music ${file.version} with mod version ${process.env.VITE_MOD_VERSION}`);

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
