# ff-demo-builder

Builds and deploys Foundry Frame demo sites. The admin at foundryframe.com starts a run with `repository_dispatch`; this repo has no server and holds the only credentials that can check out templates and deploy.

## What a run does

`build-demo.yml` (event `build-demo`):

1. Checks the dispatch payload, then checks out the template repo at the pinned tag.
2. `prepare`: fetches the job from the admin with the signed URL, reports `building`, writes `content/site.json`, and downloads every image, re-encoding it with sharp (photos to WebP at most 2400px wide, logos to WebP, favicon to a 64px PNG). Re-encoding also strips anything an SVG logo carries.
3. Builds the template (`npm run build`, static export to `out/`).
4. `wrap`: adds a `noindex` tag, the "Concept preview by Foundry Frame" bar and a one-per-session view ping to every page, and writes a `robots.txt` that blocks crawlers.
5. Deploys to Vercel (`vercel deploy --prebuilt` into the `ff-demos` project, then `vercel alias set <slug>.<DEMO_DOMAIN>` when that variable is set) or to EC2 (`rsync` to `/srv/demos/<slug>/`).
6. Reports `live` with the URL, or `failed` with a link to the run log. Reports are HMAC-signed.

`expire-demos.yml` (event `expire-demos`) removes Vercel deployments and EC2 folders for demos the admin has expired or deleted.

## Setup

1. Create a private repo (for example `foundryframe/ff-demo-builder`) with the contents of this folder, and run `npm install` once to commit a `package-lock.json`.
2. On Vercel, create an empty project `ff-demos`, and turn off Deployment Protection for it so leads can open links. For `<slug>.demo.foundryframe.com` links, add the wildcard domain `*.demo.foundryframe.com` to the project (this needs Vercel nameservers for the domain); until then, demos use the generated `*.vercel.app` URL.
3. Repository **secrets**:
   - `DEMO_BUILDER_SECRET`: the same value as the admin's `DEMO_BUILDER_SECRET`.
   - `TEMPLATES_TOKEN`: fine-grained token with Contents: read on the template repos only.
   - `VERCEL_TOKEN`: token scoped to the team that owns `ff-demos`.
   - `EC2_SSH_KEY` (EC2 target only): a key that can only write to `/srv/demos`.
4. Repository **variables**:
   - `ADMIN_ORIGIN`: `https://www.foundryframe.com`. Jobs, callbacks and view pings must be on this origin.
   - `ALLOWED_TEMPLATE_OWNER`: the GitHub owner of your template repos; other repos are refused.
   - `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`: from `vercel link` on the `ff-demos` project.
   - `DEMO_DOMAIN` (optional): `demo.foundryframe.com`.
   - `EC2_HOST`, `EC2_KNOWN_HOSTS` (EC2 target only).
5. In the admin, set `DEMO_BUILDER_REPO` to this repo and `DEMO_GITHUB_TOKEN` to a fine-grained token with Contents: write on this repo only (that permission is what `repository_dispatch` needs).

### EC2 target (optional)

A t4g.small running Caddy with `caddy/Caddyfile` serves one folder per demo with on-demand TLS. Caddy asks the admin (`/api/demo-builder/domain-check`) before issuing a certificate, so only live EC2 demos get one. DNS needs one wildcard record, `*.demo`, pointing at the instance's Elastic IP. Create a `deploy` user that owns `/srv/demos` and nothing else.

## Code

Node 24 runs the TypeScript directly (type stripping), so there is no build step.

- `src/job.ts`: the job shape and the checks on everything that ends up in a path, URL or shell argument.
- `src/content.ts`: writes `site.json` and processes images.
- `src/wrapper.ts`: the demo wrapper.
- `src/vercel.ts`: Build Output API staging, deploy, alias, remove.
- `src/callback.ts`: signed status reports.
- `src/cli.ts`: the commands the workflows call.

Tests live in `test/` and run from the Foundry Frame site repo with `npm test`.
