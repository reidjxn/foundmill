#!/usr/bin/env bash
# Usage: scripts/open-or-update-issue.sh <label> <title> <body-file>   (GH_TOKEN must be set)
# Comments on the open issue that carries <label>, or opens one with that label. Creates the label if it is missing.
# Used by .github/workflows/ci-alert.yml (a red main) and nightly.yml (a failed nightly check). No other side effect.
set -euo pipefail
label="$1"; title="$2"; body="$3"
gh label create "$label" --force --description "Opened by a workflow; close it when fixed" > /dev/null
number="$(gh issue list --label "$label" --state open --json number --jq '.[0].number // empty')"
if [ -n "$number" ]; then
  gh issue comment "$number" --body-file "$body"
else
  gh issue create --label "$label" --title "$title" --body-file "$body"
fi
