import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { assetTarget, processImage, writeJobIntoTemplate } from "../src/content.ts";
import { makeJob } from "./fixtures.ts";

const photo = () =>
  sharp({ create: { width: 3200, height: 1800, channels: 3, background: { r: 20, g: 83, b: 45 } } }).jpeg().toBuffer();

describe("processImage", () => {
  it("re-encodes photos as WebP no wider than 2400px", async () => {
    const meta = await sharp(await processImage(await photo(), "photo")).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 2400, height: 1350 });
  });

  it("makes a 64px PNG favicon and keeps logo transparency", async () => {
    expect(await sharp(await processImage(await photo(), "favicon")).metadata()).toMatchObject({
      format: "png",
      width: 64,
      height: 64,
    });
    const transparent = await sharp({
      create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    expect((await sharp(await processImage(transparent, "logo")).metadata()).hasAlpha).toBe(true);
  });

  it("rasterizes SVG logos, dropping any embedded script", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><script>alert(1)</script><rect width="200" height="80" fill="#14532d"/></svg>',
    );
    const output = await processImage(svg, "logo");
    expect((await sharp(output).metadata()).format).toBe("webp");
    expect(output.includes(Buffer.from("<script"))).toBe(false);
  });
});

describe("assetTarget", () => {
  it("keeps files inside public/", () => {
    expect(assetTarget("/repo/template", "/media/abc.webp")).toBe(resolve("/repo/template", "public", "media", "abc.webp"));
    expect(() => assetTarget("/repo/template", "/media/../../package.json")).toThrow(/Refusing/);
    expect(() => assetTarget("/repo/template", "/content/site.json")).toThrow(/Refusing/);
  });
});

describe("writeJobIntoTemplate", () => {
  it("writes site.json and the processed images", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-template-"));
    const bytes = await photo();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(bytes))) as unknown as typeof fetch;

    const result = await writeJobIntoTemplate(makeJob(), dir, { fetchImpl });
    expect(JSON.parse(await readFile(join(dir, "content", "site.json"), "utf8"))).toEqual(makeJob().siteJson);
    expect(result.assets).toEqual([join(dir, "public", "media", "aaaaaaaa.webp")]);
    expect((await sharp(await readFile(result.assets[0])).metadata()).format).toBe("webp");
    expect(fetchImpl).toHaveBeenCalledWith("https://storage.test/a.jpg?token=1");
  });

  it("fails clearly when an asset can't be downloaded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-template-"));
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 403 })) as unknown as typeof fetch;
    await expect(writeJobIntoTemplate(makeJob(), dir, { fetchImpl })).rejects.toThrow(
      "Downloading https://storage.test/a.jpg failed (403).",
    );
  });
});
