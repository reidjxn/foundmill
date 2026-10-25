# E2B template for acceptance sandboxes

The orchestrator runs a code task's acceptance tests in an E2B sandbox: it copies the agent's checkout in, installs
dependencies with the network open to the npm registry only, closes the network, and runs the task's test command
(apps/orchestrator/src/activities/session.ts, `runAcceptance`).

E2B's `base` image ships Node 20 and no pnpm, and its default sandbox is small. The orchestrator copes at run time
(it installs the project's own Node and pnpm from the npm registry and installs only the package under test), but a
template built from `e2b.Dockerfile` makes every run faster and lets Playwright specs run, because Chromium is already
there.

## Build and use

1. Add the E2B API key as a GitHub Actions repository secret named `E2B_API_KEY` (repository → Settings → Secrets and
   variables → Actions → New repository secret). It is the same key the orchestrator holds in Railway.
2. Run the workflow **E2B sandbox template** from the Actions tab (or `gh workflow run e2b-template.yml`). It runs
   `npx @e2b/cli@2.22.3 template create foundmill-sandbox --path infra/e2b --dockerfile e2b.Dockerfile --cpu-count 4 --memory-mb 4096`;
   E2B CLI 2.x builds the image on E2B's side, so no Docker is needed. The same command works from any machine with
   `E2B_API_KEY` in its environment.
3. In Railway, on the orchestrator service, set `E2B_TEMPLATE=foundmill-sandbox` and redeploy.

Rebuild when the repository changes its Node or pnpm pin (root `Dockerfile`, `package.json` `packageManager`) or its
Playwright version (`pnpm-workspace.yaml` catalog). `--cpu-count` and `--memory-mb` are the sandbox's size; raise them
if dependency installs are still killed. Hobby plans cap sandbox sizes lower than Pro (e2b.dev/pricing).

Nothing in this folder holds a secret. The key is read from the repository secret in the workflow and from Railway by
the orchestrator; it is never written to a log.
