---
date: 2026-11-23
branch: claude/founder-only-approvals-audit
title: Founder-only approvals, closed shut: every call in the founder's own accounts, the own Google account, and approve_spend grants
areas: [db, api, orchestrator, gateway]
supersedes: []
---
## What changed
Launch Session 23 audited every path by which someone other than the founder could approve, or cause to run, a hosted-browser step, a payment or spend, a CLI-Anything release, or a change in or a send from the founder's own accounts.
It started from main after #369 and also covered #379 once it merged. The security-reviewer agent audited the same paths on its own and then reviewed the diff. Three real gaps were found and closed.

- **Gap 1: founder-account calls that were still delegable.** `founderOnlyCall` listed some tools by name, so the gateway still typed other calls as `message_customers` and handed them to whoever Team › Responsibilities names. An agent named there approved them the moment they opened. The calls left out were:
  - `call_unlisted_tool` on `notion_mcp`, `hubspot_mcp`, `shopify_mcp` and `mcp_custom`;
  - `notion_create_comment`;
  - `google_drive:share_file`;
  - `cloudflare_dns` record changes;
  - `stripe:send_invoice`;
  - `vercel:create_deployment`;
  - `shopify:cancel_order`;
  - a coupon on the founder's Stripe.
- **The fix for Gap 1 (`packages/db` `repos/approvals.ts`, the single source).** `FOUNDER_ACCOUNT_CONNECTORS` makes every call of a connector that acts in the founder's own accounts founder-only, whatever the tool is: Gmail, Google Calendar, Google Drive, Notion, HubSpot and Shopify MCP, custom MCP, Shopify, Stripe, GitHub, Cloudflare DNS and Vercel.
  Every `cli_*` connector and every `browser_*` connector is covered too. Routing, `resolve`, `useGranted`, `useDecided`, `approvalDecisionType` (api), plan `approve_spend` and the replay's hold bookkeeping all read this one list.
- **Gap 2: another cofounder could approve mail from someone else's mailbox.** A send from one cofounder's Gmail, an invitation from their calendar or a share from their Drive could be approved by any owner or admin. Now only the person who connected that Google account approves it (`yesStands`, as `setContextReads` already does).
  A yes from anyone else is refused, and an earlier such yes never runs the call.
- **Gap 3: `approve_spend` with `approval_id` granted approvals without the founder.** The plan was judged on its own amount, which a model writes. At amount 0 it was "allow" in assisted and automated mode, so either of these approved a pending spend or send approval as the system:
  - a member's free-text answer to a note;
  - an agent's option on a note.
- **The fix for Gap 3, in two places:**
  - The orchestrator (`plan.ts`) now grants only for a plan a person confirmed (`confirmedAt`).
  - `plan.confirm` (`assertMayGrantFromPlan`, api `services/approvals.ts`) runs the checks Needs you runs on that approval: section write, the handler named when it opened, and Team › Responsibilities. It refuses an `approval_id` from another project.
  - The orchestrator also refuses a grant when the action states a smaller amount, or another currency, than the approval it names, so the confirm screen cannot understate what is granted (reviewer, second pass).
- **A smaller fix: the payment link.** `stripe:create_payment_link` is now in `PAYMENT_RECORD_TOOLS` (gateway). A payment link therefore asks in automated mode and on vacation unless the inbound payment power is on, like an invoice or a checkout page. The Nov 19 log left this open.
- **Tests that fail before the fix and pass after:**
  - `approvals-founder-only.test.ts`: the new connectors, and a cross-account Gmail case where the owner cannot approve a send from the admin's mailbox.
  - `staff-authority.test.ts`: a member cannot confirm such a plan, and another project's approval is refused.
  - `plan.test.ts`: an unconfirmed plan grants nothing.
  - `payment-powers.test.ts`: the payment link is a payment record.
- **Tests changed because they used Gmail or Stripe as the example of a delegable call:**
  - `team.test.ts` and `team-roster.test.ts` now use SendGrid.
  - The replay tests in `session.test.ts` and `approvals.test.ts` now expect the Stripe coupon hold to close as expired, and expect the founder, not the delegated agent, to answer it.

## Decisions
### Founder-account means the connector, not a tool list
A list of tools missed every tool added later and every unlisted remote call. Naming the connectors is shorter and fails closed. A read on these connectors never asks, so the change only affects calls that already asked the founder.

### Business sending channels stay delegable
SendGrid, Resend, Buffer and the platform's own mail send in the project's name, through its own sending channel, and are what "messaging customers" delegation is for. #369 pinned SendGrid delegation, and it still works. The reviewer pointed out that SendGrid and Resend run on the founder's own key.
If the founder counts those as "the founder's own accounts", add them to `FOUNDER_ACCOUNT_CONNECTORS`.

### The own-Google-account rule covers Google only
Gmail, Calendar and Drive are one person's identity, which is the same line `setContextReads` draws. Notion, HubSpot, Shopify, Stripe and the hosted-browser sites stay with any owner, cofounder or admin. That matches the browser router's existing rule that "the people who may connect the site" control the page.
With no `connectedBy` (mock mode, an older row), any owner or admin approves. A solo founder sees no change.

### approve_spend keeps approval_id for confirmed plans
Removing `approval_id` entirely was the reviewer's alternative. Keeping it for a plan a person confirmed, and checking that person against the approval, keeps "approve that spend" working in chat for the founder and closes every path that has no press.

## Paths checked and found closed
- **Hosted-browser steps:**
  - `decisionTypeFor` returns null for them.
  - A website hard stop is denied before any approval is used.
  - Take over and hand back are admin-only.
  - #379's keep-sign-in note is admin-only and opens no approval.
- **Hard gates** are denied before anyone is asked: Stripe payouts, transfers and refunds, Shopify refunds and `complete_checkout`, and the remote hard-gate names.
- **Platform spend:** `billing.topUp`, `subscribe` and `changeTier` are owner-only.
- **Team › Responsibilities** is admin-only, and never names a non-founder for merges or an agent for signing.
- **Vacation:** the Chief of Staff never answers approval notes (`foundersOwnReason`), and a `chief_of_staff` or system yes never runs a founder-only or null-type call.
- **Replays:**
  - `useGranted` and `useDecided` re-check at use time.
  - `usedAt` stops a second use.
  - Only the session that used an approval can release it.
  - Approvals are scoped to the business under RLS.
- **The one-click answer `/a/<token>`** re-checks admin and Inbox write, and refuses approval and sign-off notes.
- **Batched Inbox items** check every approval.
- **GitHub pushes** reach only `agent/<name>` branches. The default branch changes only through `merge_pr`, which is founder-only.

## Not done
- #368 (patents through Lightbringer, founder-executed tools) had not merged when this was written. On rebase it should fold `FOUNDER_ACCOUNT_CONNECTORS`-style keys for its connector into `founderOnlyCall`, as #369's notes say.
- **Assisted mode** still lets some founder-account writes run unasked. These include `share_file`, Notion page creation and Shopify carts. This is a policy-hint question, not an approval one, and is left for the founder.
- **`resolve()`** still checks the role and updates in two statements. Use-time re-checks cover founder-only and null-type calls.
- **`yesStands`** accepts `admin` as well as owners and cofounders. Whether CLI-Anything releases and website steps need an owner's standing is the founder's call.
- **Team › Responsibilities** still offers a delegation for every decision type. A delegation now does nothing for calls on the founder-account connectors, and the screen does not say so yet.
- **A recorded hold** on a founder-account connector that moves on by itself now closes as expired, not approved. It is bookkeeping only, since the call already ran, and the replay tests pass. The Playwright golden path was not run here.
- **The Temporal workflow suites** could not run in this container: the test server's download was blocked. CI runs them.
