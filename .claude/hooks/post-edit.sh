#!/usr/bin/env bash
# PostToolUse hook: after any file edit, typecheck + lint the affected packages;
# after any migration change, run the RLS cross-tenant suite.
# Gated by FM_HOOKS=1 so bulk generation (many parallel agents) is not slowed down.
# See docs/DECISIONS.md "Hooks".
[ "${FM_HOOKS:-0}" = "1" ] || exit 0
set -u
input="$(cat)"
file="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')"
[ -n "$file" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0
case "$file" in
  *.ts|*.tsx|*.mts|*.cts|*.js|*.mjs|*.sql) ;;
  *) exit 0 ;;
esac
if [[ "$file" == *"packages/db/migrations"* ]]; then
  pnpm --filter @founder-manager/db test:rls 2>&1 | tail -40
fi
pnpm -w turbo run typecheck lint --filter='...[HEAD]' --output-logs=errors-only 2>&1 | tail -60
exit 0
