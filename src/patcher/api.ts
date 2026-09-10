import axios from "axios";
import yaml from "js-yaml";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ok, err, Result } from "neverthrow";

import type { AppBuild } from "~/types/AppBuild";

const UPDATE_DOMAIN = "https://music-desktop-application.s3.yandex.net";
const UPDATE_ORIGIN = new URL(UPDATE_DOMAIN).origin;

const UpdateInfoSchema = z.object({
  files: z
    .array(
      z.object({
        url: z.string().min(1),
        sha512: z.string().min(1),
        size: z.number().int().positive(),
      }),
    )
    .min(1),
  releaseDate: z.string().optional(),
  updateProbability: z.number().optional(),
  version: z.string().regex(/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/),
  commonConfig: z
    .object({
      DEPRECATED_VERSIONS: z.string().optional(),
    })
    .default({}),
});

export async function getStableBuild(): Promise<Result<AppBuild[], Error>> {
  try {
    const response = await axios.get(`${UPDATE_DOMAIN}/stable/latest.yml`, {
      responseType: "text",
      timeout: 30_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const parseResult = UpdateInfoSchema.safeParse(yaml.load(response.data));
    if (!parseResult.success) return err(parseResult.error);

    const info = parseResult.data;
    const files = info.files.map((file) => ({
      path: file.url,
      hash: file.sha512,
      size: file.size,
      releaseDate: info.releaseDate,
      updateProbability: info.updateProbability,
      version: info.version,
      deprecatedVersions: info.commonConfig.DEPRECATED_VERSIONS,
    })) as AppBuild[];

    return ok(files);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function downloadBuild(build: AppBuild, filePath: string): Promise<Result<void, Error>> {
  try {
    const downloadUrl = new URL(build.path, `${UPDATE_DOMAIN}/stable/`);
    if (downloadUrl.origin !== UPDATE_ORIGIN || downloadUrl.protocol !== "https:") {
      return err(new Error("The update manifest points outside the trusted Yandex update origin"));
    }

    const response = await axios.get(downloadUrl.toString(), {
      responseType: "arraybuffer",
      timeout: 120_000,
      maxContentLength: 1024 * 1024 * 1024,
    });

    const contents = Buffer.from(response.data);
    if (contents.byteLength !== build.size) {
      return err(new Error(`Downloaded size mismatch: expected ${build.size}, received ${contents.byteLength}`));
    }

    const actualHash = createHash("sha512").update(contents).digest("base64");
    if (actualHash !== build.hash.trim()) {
      return err(new Error("Downloaded SHA-512 checksum does not match latest.yml"));
    }

    await Bun.write(filePath, contents);
    return ok();
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
