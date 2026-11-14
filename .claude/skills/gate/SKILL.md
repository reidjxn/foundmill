---
name: gate
description: Run the gate checks for a build phase from docs/BUILD.md §16 (and docs/GATES.md) and report pass or fail per item. Use when asked to check a phase gate, e.g. "gate 2".
argument-hint: "<phase number>"
---

# Run a phase gate

1. Read `docs/BUILD.md` §16 for the phase in `$ARGUMENTS` (16.1 is phase 0, 16.2 phase 1, and so on) and `docs/GATES.md` for how each gate is checked.
2. For every item, find the evidence in the repo: a test, a spec, an eval, a command's output. Run the command when the item is checkable here (mock mode: `INTEGRATIONS_MODE=mock MODEL_MODE=mock`).
3. Report a table: item, pass / fail / not checkable here, and the evidence (command plus result, or file:line). "Not checkable here" names the missing fact (a live key, production data) instead of guessing.
4. Never mark an item passed from a typecheck alone or from a document that says it is done.
