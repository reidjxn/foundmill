#!/usr/bin/env bash
# Vercel's Ignored Build Step for apps/web (WP-01 T5; apps/web/vercel.json "ignoreCommand"). Vercel runs it in apps/web:
# exit 0 skips the build, anything else builds. It skips when nothing the web app is built from changed since the
# branch's last deployed commit: its own folder, the workspace packages it reaches through dependencies (transitively;
# scripts/vercel-ignore.test.mjs keeps this list complete), the api's source (the web app imports its router's types)
# and the root manifests. Vercel reads exit 0 as "skip" and exit 1 as "build", and fails the deployment on any other
# code, so every other outcome of git diff becomes 1: a change, or a previous commit the clone does not have (a branch
# rebased after its last preview: `git diff` exits 128, which failed reidjxn/foundmill#250).
if git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- . \
  ../../packages/agents ../../packages/config ../../packages/db ../../packages/dugout ../../packages/entity-linker \
  ../../packages/events ../../packages/journey ../../packages/models ../../packages/modules ../../packages/shared \
  ../../packages/widgets ../../apps/api/src \
  ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../patches ../../turbo.json; then
  exit 0
fi
exit 1
