---
date: 2026-11-17
branch: claude/wp14-t9-customer-update-card
title: Share a Customer Update as a card (WP-14 T9)
areas: [db, api, events, shared, dugout, web, docs]
supersedes: []
---
## What changed
A founder can share one Customer Update as a public card, built the way milestone cards are. Migration 0166 (0136 until it was rebased on Nov 22, 2026) adds
`customer_update_cards` (members read, only the api's service connection writes) and the view
`public_customer_update_cards`. `journey.updateCard`, `journey.shareUpdate` and `journey.unshareUpdate` are in apps/api
(`services/update-cards.ts`), with `publicPage.updateCardById` for the signed-out read. The card is at
`/m/update/<id>` with a wide and a tall share image; the design system has `CustomerUpdateCard` with a story. The
Customer Update screen's toolbar has "Share as a card". Two events, `customer_update.shared` and
`customer_update.unshared`, carry ids and addresses only. Tests: `rls/update-cards.test.ts`, the api's
`update-cards.test.ts`, `CustomerUpdateCard.test.tsx`, the events catalogue test and `e2e/update-card.spec.ts`.

## Decisions
### A card is a copy made at the press, in its own table
A view over `journeys` would have to derive the lead channel and the standout agent in SQL and would sit one join away
from the customer. The row holds exactly what the card prints: the day as a date, one of two headlines, the channel's
key, the agent's name and the founder's optional line. The public read cannot reach a customer, an amount or a touch.

### Only the service connection writes a card
A client role that could insert a row could put any words under "Verified by Foundmill". The api reads its checks as
the signed-in user through RLS, then writes the row, the event and the audit row in one service transaction.

### "A real payment" is the north star's own rule
DESIGN §9f says public only when tied to a real payment. The conversion must be a payment whose source event is
`payment.received` and passes `isRealOutcome` (written by the payment webhook, not simulated). A signup, a simulated
payment and a payment from the Simulate panel are refused, so on mock integrations nothing can be shared.

### Who may share
The right that shows a milestone (an owner or an admin with Product write), held by someone who can also read
Customer Updates (Distribution). Stopping needs only the first half, and is never refused for another reason.

### The headline has no number
"New customer" for a first payment and "A customer came back" otherwise. No "Customer #1", no nth of its kind (A11).

### The address is under /m/ and is the card's own id
`/m/update/<id>` inherits the public-path, small-screen, robots and app-link rules of `/m/` with no new prefix to
register. The id is the card row's, never the journey's. Stopping deletes the row, so an old link stays dead.

### The founder's line is the only free text, and it is kept apart
T9 leaves the customer's name out "unless the founder adds" it. One optional line of 140 characters, shown as "A note
from <project>" outside the verified block, printed as text. It is not in the share images, which travel without the
page. The dialog's hint asks the founder to leave the customer's name out unless they said it can be used.

### The standout agent is labeled an AI agent, by its title name
Persona names are one person's view setting, so the public card uses the agent's stored name and adds "(AI agent)".

### The browser test needed one real project in the local seed
The test stack runs on mock integrations and both seeded businesses are samples, so no spec could share anything.
`SEED_E2E_PROJECT=1` builds Harbor Bikes (owned by the demo founder, older than both samples so `/` still opens
Northwind) with one win recorded as a real payment. The flag is read for a local PGlite directory only, never for a
hosted database. It is set in `playwright.config.ts` and on the seed line of `ci.yml`; nothing else in CI changed.

### Not stacked on #244
#244 touches the project page, its story page, `routers/page.ts` and migration 0125. This change adds one procedure at
the end of `publicPageRouter` and one import line there, and took 0136 then (0166 now). `git merge-tree` of the two
branches reports no conflict in `routers/page.ts`; the migration journal and `migrations.test.ts` lists need
the usual one-line merge with #244 (#285 merged first and this branch is rebased on it).

### What the security review changed (the `security-reviewer` agent, on the whole change)
- The card table is closed to a collaborator (`is_member_not_collaborator`), and the two events are filed with Settings,
  because a card is about a payment and a collaborator reads no payment. The stream's collaborator list test caught it.
- "Stop sharing" reads nothing first: the right, then the delete. Nothing about the Customer Update can keep a card
  public. It answers `{ stopped }`, and the screen reads the state again.
- The founder's line loses invisible and direction-changing characters before it is stored.
- The card's sentence said less ("...when the project's payment provider reported the payment"); the verified sentence is
  restored below and a pasted-key payment gets its own line.

### Open for the founder: a payment provider's test mode is not told apart
The review's one high finding is older than this change and outside its files. Ingest marks any signed payment webhook
as real: it does not read Stripe's `livemode` or Shopify's `test`, and a founder who connects their own Stripe knows
the signing secret. So a founder can get a "Verified" card, and a real outcome in the north star, from a test payment.
This change does not fix ingest or the connectors. It softens the sentence, and the proposal is: the normalisers mark
test-mode payments `simulated`, and sharing checks the payment through the gateway for an own-key connection. Until
then the founder may prefer to hold this pull request, or to merge it with the softer sentence.
A member can also rewrite an event's actor through the client-writable `events` table (0099); payment conversions are
written only by ingest, so this is not reachable today, and a guard on `events` is the same follow-up.

### Nov 22, 2026: only a "Sign in with Stripe" payment is verified (founder, option (b))
The open finding above is decided. #328 now marks a test-mode payment `simulated`, so it never counts. For the own-key
gap the founder chose option (b), relayed by the coordinating session on Nov 19 and again on Nov 22: a card says
"Verified by Foundmill" only for a payment delivered with Foundmill's own platform webhook secret, which is a Stripe account
the founder signed in to (Connect) and which no founder knows. A payment through a pasted key is signed with a secret the
founder holds, so it can still be shared but reads "Recorded from the founder's Stripe account." and has no chip. A check
against Stripe's API (option a) is deferred.
How it is built: the Stripe webhook re-verifies the signature with the platform secret when it normalizes an event and
writes `platformSigned` on `payment.received` (default false); `customer_update_cards.verified` (and the view's eighth
column) copies it at the press; the card, its title, its description and both share images say "Verified by" or the
recorded line from that flag. A card never claims to be verified unless told (`verified` defaults to false). Tests: the
connector (a platform-signed delivery, a founder-signed one, no platform secret), the api (both paths, public and
console), the card component (both), and the view's column list.
This decides the card only. A pasted-key payment still counts as a real outcome for the north star, since `isRealOutcome`
is unchanged; whether it should count is the founder's to say.

### Left as they are, by judgment
- The checks and the write are two transactions. A page taken down in between leaves a row the view hides; it shows
  again when the page is back up, as a shown milestone does.
- Deleting a customer's record leaves the card (the conversion stays with no customer). The card holds nothing of the
  customer except what the founder typed in their own line.
- `apps/web/lib/widget-data.tsx` gains one name in a list that #244 also changes: a one-line merge.

## Not done
- A refunded or disputed payment keeps its card until the founder stops sharing.
- Gating card sharing by plan is WP-14 T14's. Today every plan can share.
- "Shares for each Customer Update" in the nightly numbers is WP-14 T12's; the two events are there for it.
- No team post is drafted about a shared Customer Update, and the tap-to-post panel is not offered for it.
- The share images do not show the logo (the milestone images do not either).
