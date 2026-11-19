---
date: 2026-11-18
branch: claude/wp09-plan-first
title: WP-09 T16 follow-up, the plan goes first for every model call, and canceling is one press
areas: [api, gateway, connectors, db, web]
supersedes: []
---
## What changed
- **The plan goes first (founder, Nov 18, 2026, relayed by the coordinator).** The founder said "the plan should
  always go first and agents should always check the plan before working". With `PAID_ENTRY` on, every model-backed
  procedure inside a project on the platform key now needs the entry plan. The check sits in the api's `modelLimited`
  middleware, which all of them carry. It answers with the same 402 `entry_plan_required` and the same Subscribe
  request as Continue, and the request is still written once.
  - Covered: conversations, Team call and its speech, Inbox Refresh, plan previews and free-text decisions, task
    planning, the legal and distribution recommenders, the research plan retry, the positioning draft, logo sets
    inside a project, training, Continue and starting a task.
  - Open without the plan (`OPEN_WITHOUT_PLAN`): everything before the first AI run, that is shaping an idea, idea-stage
    logos, Take charge and retrying its foundations draft. The rules that call a vendor rather than a model stay open
    too: registry lookup, domain check, checkout, emailing a link, answering an email, sending an update.
- **Manage or cancel (founder, Nov 18, 2026: canceling is never harder than subscribing).** Settings › Billing shows
  "Manage or cancel" to a founder who holds a plan.
  - Live: `billing.manage` asks the gateway (`POST /v1/billing/portal-sessions`, api only). The gateway opens Stripe's
    customer portal on the platform account through the Stripe connector's new `create_billing_portal_session` tool,
    which refuses on any business's own account. Cancellation then reaches ingest as `customer.subscription.updated`
    and `.deleted`, which T16 already handles.
  - Mock: `billing.manage` cancels the simulated plan at once (`accountPlans.cancelMock`), labeled "Mock cancel (no money
    moves)", and the button reads "Cancel plan (mock)".
  - `billing.plan.entryPlan.mine` now carries the plan's mode.
- **Tests.**
  - api `entry-plan.test.ts`: the gate on Refresh and plan preview, the own-key and switch-off exemptions, and the mock
    cancel.
  - gateway `billing.test.ts`: the portal on the platform account, refused for other services.
  - connectors `stripe.test.ts`: the tool runs in mock and is refused off the platform record.
  - `service-connection.test.ts`: the billing router's count goes from 9 to 11.

## Decisions
1. **A project on its own Anthropic key skips the new gate.** The founder's words were "on the platform key", and
   CLAUDE.md says the own key works on every plan. The T16 gates (Continue, Autopilot, tasks, training, Start
   distribution) stay as built, because they also spend the platform's sandbox and dispatch.
2. **Logo sets inside an existing project are gated; idea-stage logos are not.** No project exists when an idea's logos
   are drawn, so the gate never sees them. The coordinator was told before shipping. If "Studio" also means the project's
   logo screen, add `logo` to `OPEN_WITHOUT_PLAN`.
3. **The background model calls the composer and the orchestrator make on their own are not gated here.** The
   orchestrator's brief and dispatch guard already refuse work without the plan (T16). The composer's event-driven notes
   are not gated, because a person never presses anything for them. That is a wider change.

## Not done
- **Stripe setup for the founder's S8 list:**
  - The customer portal must be configured in the Stripe dashboard (Settings › Billing › Customer portal): allow
    canceling the subscription and updating the payment method, and save the configuration once in test mode and once
    in live mode. Stripe refuses a portal session until then.
  - The webhook endpoint keeps `customer.subscription.updated` and `.deleted`, already on the list.
- The live path of `billing.manage` has no api test; the gateway test covers the route with Stripe's canned answer.
- No Playwright spec runs with `PAID_ENTRY` on, as before: the e2e stack runs with it off.
