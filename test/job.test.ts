import { describe, expect, it } from "vitest";
import { assertJob, type BuilderJob } from "../src/job.ts";
import { makeJob } from "./fixtures.ts";

describe("assertJob", () => {
  it("accepts a well-formed job", () => {
    expect(assertJob(makeJob())).toEqual(makeJob());
  });

  it.each<[string, Partial<BuilderJob>]>([
    ["slug", { slug: "../../etc" }],
    ["target", { target: "s3" as BuilderJob["target"] }],
    ["template.repo", { template: { repo: "owner/repo; rm -rf /", version: "v1" } }],
    ["template.version", { template: { repo: "a/b", version: "v1 && curl evil" } }],
    ["asset path", { assets: [{ id: "x", kind: "photo", publicPath: "/media/../../.github/x.webp", url: "https://s.test/x" }] }],
    ["asset path", { assets: [{ id: "x", kind: "photo", publicPath: "/app/page.tsx", url: "https://s.test/x" }] }],
    ["asset kind", { assets: [{ id: "x", kind: "script" as "photo", publicPath: "/media/x.webp", url: "https://s.test/x" }] }],
    ["siteJson", { siteJson: [] as unknown as Record<string, unknown> }],
  ])("rejects a bad %s", (field, overrides) => {
    expect(() => assertJob(makeJob(overrides))).toThrow(new RegExp(field.replace(".", "\\.")));
  });

  it("pins callbacks to the admin origin when one is configured", () => {
    expect(() => assertJob(makeJob(), { adminOrigin: "https://admin.test" })).not.toThrow();
    expect(() =>
      assertJob(makeJob({ callbackUrl: "https://attacker.test/collect" }), { adminOrigin: "https://admin.test" }),
    ).toThrow(/not on https:\/\/admin\.test/);
  });
});
