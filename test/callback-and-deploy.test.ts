import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { sendCallback, signCallback } from "../src/callback.ts";
import { deployToVercel, lastUrl, stagePrebuiltOutput } from "../src/vercel.ts";

const secret = "q".repeat(40);

describe("sendCallback", () => {
  it("signs timestamp.body with the shared secret", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const expected = createHmac("sha256", secret)
        .update(`${headers.get("x-ff-timestamp")}.${String(init?.body)}`)
        .digest("hex");
      const valid = headers.get("x-ff-signature") === `sha256=${expected}`;
      return new Response(null, { status: valid ? 200 : 401 });
    });

    await sendCallback("https://admin.test/cb", secret, { status: "live", url: "https://x.vercel.app" }, fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries server errors but not client errors", async () => {
    vi.useFakeTimers();
    try {
      const flaky = vi
        .fn()
        .mockResolvedValueOnce(new Response("down", { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      const pending = sendCallback("https://admin.test/cb", secret, { status: "building" }, flaky as typeof fetch);
      await vi.runAllTimersAsync();
      await pending;
      expect(flaky).toHaveBeenCalledTimes(2);

      const rejected = vi.fn().mockResolvedValue(new Response("bad signature", { status: 401 }));
      const failing = sendCallback("https://admin.test/cb", secret, { status: "building" }, rejected as typeof fetch);
      const assertion = expect(failing).rejects.toThrow(/401 bad signature/);
      await vi.runAllTimersAsync();
      await assertion;
      expect(rejected).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("produces the documented header format", () => {
    expect(signCallback(secret, 1, "{}")).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe("Vercel deploys", () => {
  async function outDir() {
    const dir = await mkdtemp(join(tmpdir(), "ff-out-"));
    await mkdir(join(dir, "_next"), { recursive: true });
    await writeFile(join(dir, "index.html"), "<html></html>");
    await writeFile(join(dir, "_next", "app.js"), "1");
    return dir;
  }

  it("stages a static export as Build Output API v3", async () => {
    const work = await mkdtemp(join(tmpdir(), "ff-work-"));
    const output = await stagePrebuiltOutput(await outDir(), work);
    expect(JSON.parse(await readFile(join(output, "config.json"), "utf8"))).toEqual({ version: 3 });
    expect(await readFile(join(output, "static", "_next", "app.js"), "utf8")).toBe("1");
  });

  it("deploys prebuilt and aliases the demo subdomain", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce("Inspect: https://vercel.com/ff/ff-demos/abc\nhttps://ff-demos-abc123.vercel.app")
      .mockResolvedValueOnce("Success!");
    const result = await deployToVercel({
      outDir: await outDir(),
      workDir: await mkdtemp(join(tmpdir(), "ff-work-")),
      slug: "pine",
      token: "tok",
      domain: "demo.foundryframe.com",
      run,
    });

    expect(run.mock.calls[0][0]).toEqual(expect.arrayContaining(["deploy", "--prebuilt", "--yes"]));
    expect(run.mock.calls[1][0].slice(0, 4)).toEqual([
      "alias",
      "set",
      "https://ff-demos-abc123.vercel.app",
      "pine.demo.foundryframe.com",
    ]);
    expect(result).toEqual({ url: "https://pine.demo.foundryframe.com", deploymentId: "https://ff-demos-abc123.vercel.app" });
  });

  it("uses the deployment URL when no demo domain is set", async () => {
    const run = vi.fn().mockResolvedValueOnce("https://ff-demos-xyz.vercel.app");
    const result = await deployToVercel({
      outDir: await outDir(),
      workDir: await mkdtemp(join(tmpdir(), "ff-work-")),
      slug: "pine",
      token: "tok",
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.url).toBe("https://ff-demos-xyz.vercel.app");
  });

  it("fails when Vercel prints no URL", () => {
    expect(() => lastUrl("Error: no project")).toThrow(/did not print/);
  });
});
