#!/usr/bin/env bash
# Vercel's Ignored Build Step for apps/web (WP-01 T5; apps/web/vercel.json "ignoreCommand"). Vercel runs it in apps/web:
# exit 0 skips the build, anything else builds. It skips when nothing the web app is built from changed since the
# branch's last deployed commit: its own folder, the workspace packages it reaches through dependencies (transitively;
# scripts/vercel-ignore.test.mjs keeps this list complete), the api's source (the web app imports its router's types)
# and the root manifests. Vercel builds on exit 1 only: any other non-zero code is a failed deployment. So a previous
# commit the clone does not have (a branch that was force-pushed) and a failed diff both exit 1, never git's 128.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git cat-file -e "${base}^{commit}" 2>/dev/null || exit 1
git diff --quiet "$base" HEAD -- . \
  ../../packages/agents ../../packages/config ../../packages/db ../../packages/dugout ../../packages/entity-linker \
  ../../packages/events ../../packages/journey ../../packages/models ../../packages/modules ../../packages/shared \
  ../../packages/widgets ../../apps/api/src \
  ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../patches ../../turbo.json || exit 1
