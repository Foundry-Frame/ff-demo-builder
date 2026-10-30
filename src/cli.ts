/*
 * Entry point for the GitHub Actions steps. Each command reads what it needs
 * from flags and environment variables and keeps state in $RUNNER_TEMP/job.json.
 *
 *   node src/cli.ts prepare --template-dir template
 *   node src/cli.ts wrap --out-dir template/out
 *   node src/cli.ts deploy-vercel --out-dir template/out
 *   node src/cli.ts report --status live|failed [--url U] [--deployment-id D] [--error E]
 *   node src/cli.ts expire
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { sendCallback, type CallbackBody } from "./callback.ts";
import { writeJobIntoTemplate } from "./content.ts";
import { SLUG_PATTERN, assertJob, fetchJob, type BuilderJob } from "./job.ts";
import { deployToVercel, removeVercelDeployment } from "./vercel.ts";
import { wrapOutDir } from "./wrapper.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const jobFile = () => join(process.env.RUNNER_TEMP || process.cwd(), "job.json");

async function loadJob(): Promise<BuilderJob> {
  return assertJob(JSON.parse(await readFile(jobFile(), "utf8")));
}

/** Writes step outputs for later workflow steps. */
async function output(values: Record<string, string>) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "template-dir": { type: "string" },
    "out-dir": { type: "string" },
    status: { type: "string" },
    url: { type: "string" },
    "deployment-id": { type: "string" },
    error: { type: "string" },
  },
});

async function report(body: CallbackBody) {
  const job = await loadJob();
  await sendCallback(job.callbackUrl, env("DEMO_BUILDER_SECRET"), {
    buildLogUrl: process.env.BUILD_LOG_URL,
    ...body,
  });
}

async function main() {
  switch (positionals[0]) {
    case "prepare": {
      const adminOrigin = process.env.ADMIN_ORIGIN?.replace(/\/$/, "");
      const job = await fetchJob(env("JOB_URL"), { adminOrigin });
      /* The dispatch payload chose what was checked out; it must match the signed job. */
      if (process.env.TEMPLATE_REPO && process.env.TEMPLATE_REPO !== job.template.repo) {
        throw new Error("Dispatched template repo does not match the job.");
      }
      if (process.env.TEMPLATE_VERSION && process.env.TEMPLATE_VERSION !== job.template.version) {
        throw new Error("Dispatched template version does not match the job.");
      }
      await writeFile(jobFile(), JSON.stringify(job));
      await sendCallback(job.callbackUrl, env("DEMO_BUILDER_SECRET"), {
        status: "building",
        buildLogUrl: process.env.BUILD_LOG_URL,
      });
      const result = await writeJobIntoTemplate(job, values["template-dir"] ?? "template");
      console.log(`Wrote ${result.siteJsonPath} and ${result.assets.length} image(s).`);
      await output({ slug: job.slug, target: job.target });
      return;
    }
    case "wrap": {
      const count = await wrapOutDir(values["out-dir"] ?? "template/out", await loadJob());
      console.log(`Wrapped ${count} page(s).`);
      return;
    }
    case "deploy-vercel": {
      const job = await loadJob();
      const result = await deployToVercel({
        outDir: values["out-dir"] ?? "template/out",
        workDir: process.env.RUNNER_TEMP || process.cwd(),
        slug: job.slug,
        token: env("VERCEL_TOKEN"),
        domain: process.env.DEMO_DOMAIN || undefined,
      });
      await output({ url: result.url, deployment_id: result.deploymentId });
      return;
    }
    case "report": {
      const status = values.status as CallbackBody["status"];
      if (status !== "live" && status !== "failed") throw new Error("--status must be live or failed.");
      await report({
        status,
        url: values.url || undefined,
        deploymentId: values["deployment-id"] || undefined,
        error: values.error || undefined,
      });
      return;
    }
    case "expire": {
      /* Payload from the expire-demos dispatch: [{ slug, target, deploymentId }]. */
      const demos = JSON.parse(env("DEMOS_JSON")) as Array<{ slug: string; target: string; deploymentId: string | null }>;
      const ec2Slugs: string[] = [];
      for (const demo of demos) {
        if (!SLUG_PATTERN.test(demo.slug)) continue;
        if (demo.target === "vercel" && demo.deploymentId) {
          await removeVercelDeployment(demo.deploymentId, env("VERCEL_TOKEN")).catch((error: unknown) =>
            console.warn(`Could not remove ${demo.deploymentId}: ${String(error)}`),
          );
        } else if (demo.target === "ec2") {
          ec2Slugs.push(demo.slug);
        }
      }
      await output({ ec2_slugs: ec2Slugs.join(" ") });
      return;
    }
    default:
      throw new Error(`Unknown command "${positionals[0] ?? ""}".`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
