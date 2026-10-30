import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import sharp from "sharp";
import { PUBLIC_PATH_PATTERN, type AssetKind, type BuilderJob } from "./job.ts";

const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;

/* Every upload is re-encoded. That resizes it for the web and also strips
   anything an SVG logo could carry (scripts, external references), because
   sharp rasterizes it to pixels. */
export async function processImage(input: Buffer, kind: AssetKind): Promise<Buffer> {
  const image = sharp(input, { density: 300, limitInputPixels: 80_000_000 }).rotate();
  switch (kind) {
    case "favicon":
      return image.resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    case "logo":
    case "logo_dark":
      return image.resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    default:
      return image.resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  }
}

/** Resolves a /media or /brand path inside public/, refusing anything that escapes it. */
export function assetTarget(templateDir: string, publicPath: string): string {
  if (!PUBLIC_PATH_PATTERN.test(publicPath)) throw new Error(`Refusing asset path ${publicPath}.`);
  const publicDir = resolve(templateDir, "public");
  const target = resolve(publicDir, `.${publicPath}`);
  if (!target.startsWith(publicDir + sep)) throw new Error(`Refusing asset path ${publicPath}.`);
  return target;
}

async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Downloading ${url.split("?")[0]} failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`Asset ${url.split("?")[0]} is too large.`);
  return bytes;
}

/**
 * Drops the job's content into a checked-out template: content/site.json
 * (the only file the contract lets the builder write) plus processed images.
 */
export async function writeJobIntoTemplate(
  job: BuilderJob,
  templateDir: string,
  options: { fetchImpl?: typeof fetch; readLocal?: (url: string) => Promise<Buffer> } = {},
): Promise<{ siteJsonPath: string; assets: string[] }> {
  const siteJsonPath = join(templateDir, "content", "site.json");
  await mkdir(dirname(siteJsonPath), { recursive: true });
  await writeFile(siteJsonPath, `${JSON.stringify(job.siteJson, null, 2)}\n`);

  const written: string[] = [];
  for (const asset of job.assets) {
    const target = assetTarget(templateDir, asset.publicPath);
    const source = options.readLocal
      ? await options.readLocal(asset.url)
      : await download(asset.url, options.fetchImpl ?? fetch);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await processImage(source, asset.kind));
    written.push(target);
  }

  return { siteJsonPath, assets: written };
}
