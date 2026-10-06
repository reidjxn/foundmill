#!/usr/bin/env bash
# Stop hook: run unit tests for packages affected since HEAD. Gated by FM_HOOKS=1.
[ "${FM_HOOKS:-0}" = "1" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0
pnpm -w turbo run test --filter='...[HEAD]' --output-logs=errors-only 2>&1 | tail -80
exit 0
