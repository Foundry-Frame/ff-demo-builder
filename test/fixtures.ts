import type { BuilderJob } from "../src/job.ts";

export function makeJob(overrides: Partial<BuilderJob> = {}): BuilderJob {
  return {
    demoId: "dddddddd-0000-4000-8000-000000000000",
    slug: "harbor-and-pine",
    target: "vercel",
    template: { repo: "foundryframe/ff-template-landing-local", version: "v1.0.0" },
    siteJson: { brand: { name: "Harbor & Pine" } },
    assets: [{ id: "a1", kind: "photo", publicPath: "/media/aaaaaaaa.webp", url: "https://storage.test/a.jpg?token=1" }],
    wrapper: {
      bannerText: "Concept preview by Foundry Frame",
      bannerHref: "https://www.foundryframe.com/",
      viewPingUrl: "https://admin.test/api/demo-view",
    },
    callbackUrl: "https://admin.test/api/demo-builder/dddddddd-0000-4000-8000-000000000000/callback",
    ...overrides,
  };
}
