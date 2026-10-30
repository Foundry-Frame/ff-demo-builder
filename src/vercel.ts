import { spawn } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Run = (args: string[], env?: NodeJS.ProcessEnv) => Promise<string>;

/** Runs the pinned Vercel CLI from this package and returns stdout. */
export const runVercel: Run = (args, env) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["--no-install", "vercel", ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`vercel ${args[0]} exited with ${code}`));
    });
  });

/**
 * Vercel's Build Output API: a static export becomes .vercel/output/static,
 * so `vercel deploy --prebuilt` uploads files as-is and never runs the
 * project's build settings.
 */
export async function stagePrebuiltOutput(outDir: string, workDir: string): Promise<string> {
  const outputDir = join(workDir, ".vercel", "output");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(outDir, join(outputDir, "static"), { recursive: true });
  await writeFile(join(outputDir, "config.json"), JSON.stringify({ version: 3 }));
  return outputDir;
}

export function lastUrl(stdout: string): string {
  const urls = stdout.match(/https:\/\/[^\s]+/g);
  if (!urls?.length) throw new Error(`Vercel did not print a deployment URL:\n${stdout}`);
  return urls[urls.length - 1];
}

/**
 * Deploys to the ff-demos project (VERCEL_ORG_ID / VERCEL_PROJECT_ID in the
 * environment) and, when DEMO_DOMAIN is set, aliases <slug>.<DEMO_DOMAIN>.
 */
export async function deployToVercel(args: {
  outDir: string;
  workDir: string;
  slug: string;
  token: string;
  domain?: string;
  run?: Run;
}): Promise<{ url: string; deploymentId: string }> {
  const run = args.run ?? runVercel;
  await stagePrebuiltOutput(args.outDir, args.workDir);
  const env = { VERCEL_TELEMETRY_DISABLED: "1" };
  const deploymentUrl = lastUrl(
    await run(["deploy", "--prebuilt", "--yes", "--token", args.token, "--cwd", args.workDir], env),
  );

  if (!args.domain) return { url: deploymentUrl, deploymentId: deploymentUrl };

  const alias = `${args.slug}.${args.domain}`;
  await run(["alias", "set", deploymentUrl, alias, "--token", args.token, "--cwd", args.workDir], env);
  return { url: `https://${alias}`, deploymentId: deploymentUrl };
}

export async function removeVercelDeployment(deploymentId: string, token: string, run: Run = runVercel) {
  await run(["remove", deploymentId, "--yes", "--token", token], { VERCEL_TELEMETRY_DISABLED: "1" });
}
