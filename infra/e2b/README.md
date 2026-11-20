# E2B template for acceptance sandboxes

The orchestrator runs a code task's acceptance tests in an E2B sandbox: it copies the agent's checkout in, installs
dependencies with the network open to the npm registry only, closes the network, and runs the task's test command
(apps/orchestrator/src/activities/session.ts, `runAcceptance`).

E2B's `base` image ships Node 20 and no pnpm, and its default sandbox is small. The orchestrator copes at run time
(it installs the project's own Node and pnpm from the npm registry and installs only the package under test), but a
template built from `e2b.Dockerfile` makes every run faster and lets Playwright specs run, because Chromium is already
there.

## Build and use

The build is one command, run anywhere `E2B_API_KEY` is in the environment (E2B CLI 2.x builds the image on E2B's
side, so no Docker is needed):

    npx @e2b/cli@2.22.3 template create foundmill-sandbox --path infra/e2b --dockerfile e2b.Dockerfile --cpu-count 4 --memory-mb 4096

`template create` creates the template or rebuilds it under the same name. Two places already hold the key:

- **Railway, as the orchestrator's pre-deploy command** (used Oct 27, 2026, so the key never left Railway). The
  service image carries `infra/` (root `Dockerfile`), and the pre-deploy command runs the command above with the
  service's variables before the new deployment starts; its output is in the deployment's logs, and a failure fails the
  deployment while the previous one keeps serving. Set it on the orchestrator (Settings → Deploy → Pre-deploy command)
  with a timeout of 3600 s, deploy once (a push to main; a redeploy of an existing deployment reuses that deployment's
  settings and skips it), then **clear it** so later deploys do not rebuild the template.
- **GitHub Actions**: add the key as the repository secret `E2B_API_KEY` and run the workflow **E2B sandbox template**
  from the Actions tab (`.github/workflows/e2b-template.yml`).

Then, in Railway, on the orchestrator service, set `E2B_TEMPLATE=foundmill-sandbox` (the variable change redeploys it).

Rebuild when the repository changes its Node or pnpm pin (root `Dockerfile`, `package.json` `packageManager`) or its
Playwright version (`pnpm-workspace.yaml` catalog). `--cpu-count` and `--memory-mb` are the sandbox's size; raise them
if dependency installs are still killed. Hobby plans cap sandbox sizes lower than Pro (e2b.dev/pricing).

## CLI-Anything programs

The template also holds [HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything) packages and the programs they drive,
so the team can make real files (a logo, a document, a clip): `packages/connectors` `cli_inkscape`, `cli_libreoffice`,
`cli_ffmpeg` and `cli_gimp`, run through `packages/sandbox` `runCliAnything` with egress closed.

| Item | Value |
| --- | --- |
| Source | https://github.com/HKUDS/CLI-Anything |
| Pinned commit | `34f519533bc175d2fe287ab8316b0dd99bb9cc43` (Dockerfile `CLI_ANYTHING_COMMIT`) |
| License | Apache-2.0 (the repository's `LICENSE`); each package's `setup.py` classifier says MIT, so both are recorded |
| Packages | `cli-anything-inkscape` 1.0.1, `cli-anything-libreoffice` 1.0.1, `cli-anything-gimp` 1.0.0, installed from the commit's `<program>/agent-harness` folders |
| Programs | `inkscape` (GPL-2.0-or-later), `libreoffice` (MPL-2.0), `ffmpeg` (LGPL-2.1+/GPL, Debian build), `gimp` (GPL-3.0-or-later): Debian packages, run as separate programs, not linked |

CLI-Hub has no FFmpeg package at this commit (the registry holds `shotcut`, `kdenlive` and `openscreen`, which use it), so
FFmpeg is installed alone and `cli_ffmpeg` is Foundmill's own typed wrapper. Founder's choice: no evaluation step.
To upgrade, change `CLI_ANYTHING_COMMIT`, update the table, and rebuild the template.

Nothing in this folder holds a secret. The key is read from the repository secret in the workflow and from Railway by
the orchestrator; it is never written to a log.
