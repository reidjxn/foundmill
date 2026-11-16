---
date: 2026-11-16
branch: claude/wp03-t7-redraws
title: Try another idea - the idea box replaces a browser's card up to 2 times a day
areas: [web, api, db, shared, landing]
supersedes: []
---
## What changed
WP-03 T7 step 3, after the founder's yes to decision 3 on Nov 15, 2026 (up to 2 redraws;
docs/log/2026-11/2026-11-15-claude-wp03-founder-decisions.md). Stacked on claude/wp03-t7-stall-guard.
- `IdeaBoxDraftRequest` gains `again: z.boolean().default(false)`; `IDEA_BOX_REDRAWS_PER_BROWSER = 2`
  (packages/shared).
- `planIdeaBoxDraft`: with `again: true` and a held, unclaimed card, the browser does not get its card back. The
  request runs the same bot check, the same per-address and all-visitor windows and the same day's ceiling, plus
  `IDEA_BOX_LIMITS.redrawsPerBrowserDay` (2 a day, keyed by the token's hash, taken in the same atomic `take`).
  The card is then drafted and written over the old one under the same token.
- `repos.ideaDrafts.replace(db, tokenHash, …)`: new card, prompt, interest and claim token, a fresh 7 days, the
  cost added to what the draft already cost and dated now. Null for a claimed, expired or unknown draft. Db test.
- `IdeaBox`: the landed state gains a ghost button "Try another idea". It puts the field back with the card's
  words, and the next draft sends `again: true`. A refused redraw (any error line, the browser check, the stall
  timer) goes back to the card the browser still holds, with the refusal's line under it.
- Tests: api "Try another idea: again replaces the held card…", "a third redraw is refused with `limit`", "a redraw
  runs the same checks"; db replace; web "Try another idea gives the field back…" and "a refused redraw goes
  back…"; Playwright "Try another idea replaces the card…" in `idea-box.spec.ts`.
- docs/IDEA_BOX.md (the Money row and the order of checks); WP-03 T7 ticked; T9's note says where the landing
  footer reader was built.

## Decisions
- The redraw's cost is added to the draft's `cost_micro` and `created_at` moves to now, because `spentSince` sums
  costs by `created_at`. Overwriting the cost would let a redraw hide the first card's spend from the day's ceiling.
  Moving the date counts a card made yesterday again today, which is cautious, never generous. The per-card
  reservation in the limit store bounds the day either way.
- A redraw sets the cookie again with the same token, so its 7 days match the card's fresh `expires_at`.
- The old claim token stops working: the sign-in link always carries the card on screen.
- The field comes back holding the card's words (for an interest card it is empty), because the decision's reason
  is a typo. Surprise me still works from there and also replaces the card.
- The refusal for the third redraw is the existing `limit` line, as the spec says. No new sentence.
- If the card is claimed while the redraw is drafting, the stream ends with the `failed` line and nothing is
  written. The draft was paid for, as any started card is.
- The redraw counter lives in the limit store (memory or Redis), keyed by the SHA-256 of the token, never the
  token. A cleared cookie is a new browser, as before: the per-address 5 a day and the $20 ceiling still hold.
- The Playwright case sends its own `X-Forwarded-For` through `page.route`, so its two cards do not fill the
  shared stack's per-address hour for the other specs.
- The spec's "until docs/DECISIONS.md records the founder's answer" is met by the founder-decisions log entry:
  DECISIONS.md is frozen.

## Not done
- No "keep the card I have" control once the field is back: reloading shows the held card, and a refused
  redraw goes back to it.
- The page does not know how many redraws are left; the button shows on every landed card and the third press
  reads the `limit` line.
