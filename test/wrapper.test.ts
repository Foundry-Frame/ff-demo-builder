import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { wrapHtml, wrapOutDir } from "../src/wrapper.ts";
import { makeJob } from "./fixtures.ts";

const page = "<!DOCTYPE html><html><head><title>Pine</title></head><body><main>Hi</main></body></html>";

describe("wrapHtml", () => {
  it("adds noindex, the concept banner and the view ping", () => {
    const html = wrapHtml(page, makeJob());
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive" data-ff-demo-wrapper></head>');
    expect(html).toContain("Concept preview by Foundry Frame");
    expect(html).toContain('href="https://www.foundryframe.com/"');
    expect(html).toContain('var u="https://admin.test/api/demo-view",s="harbor-and-pine"');
    expect(html.indexOf("ff-demo-banner")).toBeGreaterThan(html.indexOf("<main>"));
    expect(html.trimEnd().endsWith("</body></html>")).toBe(true);
  });

  it("is idempotent", () => {
    const once = wrapHtml(page, makeJob());
    expect(wrapHtml(once, makeJob())).toBe(once);
  });

  it("escapes banner text and keeps script values from closing the tag", () => {
    const html = wrapHtml(
      page,
      makeJob({
        wrapper: {
          bannerText: '<img src=x onerror="alert(1)">',
          bannerHref: 'https://x.test/"><script>alert(1)</script>',
          viewPingUrl: "https://admin.test/</script><script>alert(1)</script>",
        },
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  it("handles pages without head or body tags", () => {
    const html = wrapHtml("<p>bare</p>", makeJob());
    expect(html.startsWith('<meta name="robots"')).toBe(true);
    expect(html).toContain("ff-demo-banner");
  });
});

describe("wrapOutDir", () => {
  it("wraps every HTML page in a static export and blocks crawlers", async () => {
    const out = await mkdtemp(join(tmpdir(), "ff-wrap-"));
    await mkdir(join(out, "about"), { recursive: true });
    await writeFile(join(out, "index.html"), page);
    await writeFile(join(out, "about", "index.html"), page);
    await writeFile(join(out, "data.txt"), "<body>not html</body>");

    expect(await wrapOutDir(out, makeJob())).toBe(2);
    expect(await readFile(join(out, "about", "index.html"), "utf8")).toContain("noindex");
    expect(await readFile(join(out, "data.txt"), "utf8")).toBe("<body>not html</body>");
    expect(await readFile(join(out, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /\n");
  });
});
