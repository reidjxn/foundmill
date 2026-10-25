# E2B template for acceptance sandboxes

The orchestrator runs a code task's acceptance tests in an E2B sandbox: it copies the agent's checkout in, installs
dependencies with the network open to the npm registry only, closes the network, and runs the task's test command
(apps/orchestrator/src/activities/session.ts, `runAcceptance`).

E2B's `base` image ships Node 20 and no pnpm, and its default sandbox is small. The orchestrator copes at run time
(it installs the project's own Node and pnpm from the npm registry and installs only the package under test), but a
template built from `e2b.Dockerfile` makes every run faster and lets Playwright specs run, because Chromium is already
there.

## Build and use

1. Install Docker and sign in to E2B once: `npx e2b@latest auth login`.
2. From the repository root:

   ```sh
   npx e2b@latest template build --name foundmill-sandbox --cpu-count 4 --memory-mb 4096 --dockerfile infra/e2b/e2b.Dockerfile --path infra/e2b
   ```

3. In Railway, on the orchestrator service, set `E2B_TEMPLATE=foundmill-sandbox` and redeploy.

Rebuild when the repository changes its Node or pnpm pin (root `Dockerfile`, `package.json` `packageManager`) or its
Playwright version (`pnpm-workspace.yaml` catalog). `--cpu-count` and `--memory-mb` are the sandbox's size; raise them
if dependency installs are still killed. Hobby plans cap sandbox sizes lower than Pro (e2b.dev/pricing).

Nothing in this folder holds a secret. The E2B API key stays in Railway (`E2B_API_KEY`); the CLI uses your own login.
