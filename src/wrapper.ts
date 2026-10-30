import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuilderJob } from "./job.ts";

/*
 * The demo wrapper is added to the built HTML, not to the template, so every
 * template gets it without cooperating: a noindex robots tag, a slim
 * "Concept preview by Foundry Frame" bar, and a one-per-session view ping.
 */

const MARKER = "data-ff-demo-wrapper";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* JSON inside a <script> must not be able to close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function wrapperHead(): string {
  return `<meta name="robots" content="noindex, nofollow, noarchive" ${MARKER}>`;
}

export function wrapperBody(job: Pick<BuilderJob, "slug" | "wrapper">): string {
  const { bannerText, bannerHref, viewPingUrl } = job.wrapper;
  return `<div ${MARKER} id="ff-demo-banner" role="note" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;justify-content:center;align-items:center;gap:12px;padding:8px 16px;background:#0a0a0a;color:#f5f5f5;font:500 13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 -1px 0 rgba(255,255,255,.12)"><span>${escapeHtml(bannerText)}</span><a href="${escapeHtml(bannerHref)}" target="_blank" rel="noopener" style="color:#6ee7b7;text-decoration:underline">foundryframe.com</a></div>
<style ${MARKER}>body{padding-bottom:44px!important}</style>
<script ${MARKER}>(function(){try{var k="ff-demo-viewed";if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,"1");}catch(e){}var u=${scriptJson(viewPingUrl)},s=${scriptJson(job.slug)};if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([s],{type:"text/plain"}));}else{fetch(u,{method:"POST",body:s,mode:"no-cors",keepalive:true});}})();</script>`;
}

/** Idempotent: a page that already has the wrapper is returned unchanged. */
export function wrapHtml(html: string, job: Pick<BuilderJob, "slug" | "wrapper">): string {
  if (html.includes(MARKER)) return html;
  const head = wrapperHead();
  const body = wrapperBody(job);
  let out = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${head}</head>`) : `${head}${html}`;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${body}</body>`) : `${out}${body}`;
  return out;
}

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Wraps every page in a static export and blocks crawlers site-wide. */
export async function wrapOutDir(outDir: string, job: Pick<BuilderJob, "slug" | "wrapper">): Promise<number> {
  const files = await htmlFiles(outDir);
  for (const file of files) {
    await writeFile(file, wrapHtml(await readFile(file, "utf8"), job));
  }
  await writeFile(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  return files.length;
}
