/* Mirrors BuilderJob in the admin (src/lib/demos/types.ts). This repo is
   deployed on its own, so the shape is checked here rather than imported. */

export type AssetKind = "logo" | "logo_dark" | "favicon" | "photo";

export type BuilderJob = {
  demoId: string;
  slug: string;
  target: "vercel" | "ec2";
  template: { repo: string; version: string };
  siteJson: Record<string, unknown>;
  assets: Array<{ id: string; kind: AssetKind; publicPath: string; url: string }>;
  wrapper: { bannerText: string; bannerHref: string; viewPingUrl: string };
  callbackUrl: string;
};

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
export const PUBLIC_PATH_PATTERN = /^\/(?:media|brand)\/[a-z0-9-]+\.(?:webp|png)$/;
const ASSET_KINDS: AssetKind[] = ["logo", "logo_dark", "favicon", "photo"];

function fail(message: string): never {
  throw new Error(`Invalid job: ${message}`);
}

/** Checks everything later steps put into paths, URLs or shell arguments. */
export function assertJob(raw: unknown, options: { adminOrigin?: string } = {}): BuilderJob {
  if (!raw || typeof raw !== "object") fail("not an object");
  const job = raw as BuilderJob;

  if (typeof job.demoId !== "string" || !/^[0-9a-f-]{36}$/i.test(job.demoId)) fail("demoId");
  if (typeof job.slug !== "string" || !SLUG_PATTERN.test(job.slug)) fail("slug");
  if (job.target !== "vercel" && job.target !== "ec2") fail("target");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(job.template?.repo ?? "")) fail("template.repo");
  if (!/^[A-Za-z0-9_./-]+$/.test(job.template?.version ?? "")) fail("template.version");
  if (!job.siteJson || typeof job.siteJson !== "object" || Array.isArray(job.siteJson)) fail("siteJson");
  if (!Array.isArray(job.assets)) fail("assets");
  for (const asset of job.assets) {
    if (!ASSET_KINDS.includes(asset.kind)) fail(`asset kind ${asset.kind}`);
    if (!PUBLIC_PATH_PATTERN.test(asset.publicPath)) fail(`asset path ${asset.publicPath}`);
    if (!/^https?:\/\//.test(asset.url)) fail(`asset url for ${asset.publicPath}`);
  }
  for (const url of [job.callbackUrl, job.wrapper?.viewPingUrl]) {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) fail("callback or view ping URL");
    if (options.adminOrigin && !url.startsWith(options.adminOrigin)) fail(`${url} is not on ${options.adminOrigin}`);
  }
  if (typeof job.wrapper.bannerText !== "string" || typeof job.wrapper.bannerHref !== "string") fail("wrapper");

  return job;
}

export async function fetchJob(jobUrl: string, options: { adminOrigin?: string } = {}): Promise<BuilderJob> {
  if (options.adminOrigin && !jobUrl.startsWith(`${options.adminOrigin}/`)) {
    throw new Error(`Job URL is not on ${options.adminOrigin}.`);
  }
  const response = await fetch(jobUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Fetching the job failed (${response.status}): ${await response.text()}`);
  return assertJob(await response.json(), options);
}
