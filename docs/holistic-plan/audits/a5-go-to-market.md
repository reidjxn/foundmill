# A5. Taking a business to market with the agents

Audit of `main` at 04a0a509 (2026-11-15), read-only. Paths are relative to `/Users/reidjackson/code/founder-manager`.
Evidence classes used below: **[code]** read in the source at the cited line; **[docs]** stated in docs/ and not contradicted by code; **[prod]** the production facts supplied with the brief; **[unverified]** depends on Railway variables I was not allowed to read.

## 0. Verdict

A solo first-timer on production today can reach exactly one go-to-market outcome with the product's help: **publish the project page and share its link by tap**. Everything after that either is not switched on (project email, so also follower confirmation), is not built (payment link, a way to write to followers, a way to read a reply), or is a status change with no outside effect (the channel engine's "launch").

The five facts that explain the production numbers:

1. **Two machines that never meet.** The channel engine (`apps/orchestrator/src/activities/channel.ts`) drafts creative, asks for a `launch_campaign` approval, sets a campaign `live` and emits `campaign.launched`. It calls no connector at any step [code: channel.ts:159-311; no `gateway` call in the file]. Real tools (`platform_mail:send_mail`, `buffer:queue_post`, `github:commit_files`) are only reachable from an agent *session* on a `channel` task, and a session cannot read the engine's approved creative (no tool lists assets) nor the project's followers' addresses.
2. **`launch_campaign` is not a tool.** It is a row the engine writes itself (`connectorKey: "platform", tool: "launch_campaign"`, channel.ts:218). Approving it schedules the campaign, marks it live and writes an event. For a channel in offline tracking it also creates one founder task with the materials. Nothing else.
3. **The 19 `lead.created` events on real projects are fabricated.** At this commit the only emitter in the whole repository is `recordMockLeads` (channel.ts:322-333), which writes fictional people at `.example` addresses. It was closed to real projects on Nov 11 (`mockResultsAllowed`, channel.ts:265) but nothing removed what was already written.
4. **Zero `project_pages` rows is a rollout gap, not a flag.** The team's draft is step 0 of the foundations workflow behind `patched("foundations-project-page")` (businessFoundations.ts:92-98) and runs only for a project committed after the Nov 11 deploy. There is no backfill for the 13 existing projects and no Needs-you note for them; they get one quiet line on Today (`pageReady`, today.ts:269-271). `page.get` shows a starter draft without writing a row (pages.ts:161).
5. **Email is built end to end and off.** `platform_mail` needs `PLATFORM_MAIL_DOMAIN`, SendGrid DNS, Inbound Parse, the event webhook and `sendgrid` in `LIVE_CONNECTORS` on gateway, api and orchestrator (DEPLOY.md:222-229). PROGRESS.md:1563 says "Nothing changes in production until" that is done and no later entry says it was [docs, unverified]. While it is off the public Follow form still renders and tells the visitor to check their email (finding GTM-03).

## 1. How it works today

### 1.0 The moving parts

| Part | Where | What it really does |
| --- | --- | --- |
| Channel Board | `packages/modules/src/distribution/FormationScreen.tsx`, api `distribution.channels.*` (`apps/api/src/routers/distribution.ts:96-131`, `setEnabled` :226) | Shows only channels whose `availability.available` is true, plus ones in offline tracking. Others listed under "Not available yet" in Builder view (`NotAvailableChannels.tsx`). Default inline tabs of the module are only Leads and Campaigns; Board, Channels, Creative and Attribution sit behind "More detail" (`packages/shared/src/constants.ts:103-110`). |
| Availability rule | `packages/connectors/src/channel-availability.ts:22-43` (`CHANNEL_ACTING_TOOLS`), `:76-91` (`channelAvailability`); words in `packages/shared/src/channel-availability.ts` | A channel is `acts` when one of its acting tools is on a connector that is live on the deployment and connected for the business; `by_tap` for social; `no_publisher` when the list is empty (11 of 15 channels); `not_connected` otherwise; `simulated_allowed` for sample businesses and dev/test. |
| Channel engine | workflow `apps/orchestrator/src/workflows/channelEngine.ts`, activity `channelStep` in `activities/channel.ts`, reconciler `channelEngineReconcile` every 15 min (`schedules.ts:47`, `workflows/schedules.ts:115`) | Weekly loop plan → create → approve → launch → measure → learn → report. One model call (create). No vendor call. `measure` writes numbers only in mock mode for sample/dev (channel.ts:265-279); in production it returns "Nothing measured". `channel_metrics` has no other writer in the codebase (`repos.channels.upsertMetric` is called only at channel.ts:276). |
| Agent sessions | `apps/orchestrator/src/workflows/businessCycle.ts:263`, `activities/session.ts:1449` | A `channel` task dispatched by the Chief of Staff's cycle runs the Claude Agent SDK with gateway tools only. Deferred until the founder starts distribution (`channelDeferral`, cycle.ts:189-191). This is the only path that can call `send_mail`, `queue_post`, `commit_files`. |
| Agent schedules | `packages/agents/src/templates/channels/_channel.ts:100` (`schedule: { cron, triggers }`) | **Dead configuration.** Nothing in apps/ or packages/ reads `schedule.cron` or `schedule.triggers` at runtime (grep for `.cron`, `schedule?.`, `.schedule.triggers` returns nothing outside templates and storage). "signup.created → email engine" never happens. |
| Gateway pipeline | `apps/gateway/src/pipeline.ts:286-361` | scope → connector → rate limit → state → Cedar → `deny` / `ask` / `allow`. Connection and platform-mail guards run inside `allow()` (:735-830), i.e. **after** the founder has been asked. |
| Policy | `packages/policy/src/policies/*.cedar` | Suppressed recipient and untrusted recipient are forbidden in every mode (10-recipients.cedar). Augmented asks for every 3P/spend/irreversible; assisted asks for irreversible, contracts and above €250 (`LIMITS.approvalThresholdMinorDefault` 25000); automated asks only above threshold. No rule reads consent, lawful basis or `recipientCountry`. |

### 1.1 (a) Publish and share the project page

Path for a project committed after Nov 11:

1. Commit → `businessFoundations` step 0: Product lead drafts the page from the founder's own words (`packages/agents/src/prompts/project-page.ts`, route `projectPage`), `repos.pages.writeTeamDraft` writes the `project_pages` row unpublished and raises the note "Your project's page is ready" (`packages/db/src/repos/pages.ts:254-288`; note is `blocks_continue: false`).
2. Founder: Needs you → "Check it and publish" (opens Product › Public page; answers the note, publishes nothing, `decidePageNote` pages.ts:278). Or the first-week item "Publish your page" (`FirstWeekChecklist.tsx:36`), visible only for the first 10 days and before distribution starts (`first-week.ts:18,83`).
3. Founder: edits pitch (140), about (1,500), who it is for (300), stage, "show founders", "let people follow" → presses Publish in a dialog. `page.publish` (`apps/api/src/routers/page.ts:55`, `publishPage` pages.ts:218): owner or admin with Product write only; refused for a sample business; held if the text contains markup, an email address or a phone number (`pageHoldReason` pages.ts:205; rules in `packages/agents/src/community-screen.ts:40-66`). Emits `page.published`, awards milestone "Page live", closes the note, queues a post draft (pages.ts:253).
4. Page is live at `APP_URL/p/<slug>` (`apps/web/app/p/[slug]/page.tsx`), indexable, with title, description, canonical, Open Graph and a generated share image.
5. Founder: "Share your page" on Product › Public page opens the share panel (Dugout `SharePost`, `packages/shared/src/share-targets.ts`): X, Threads, Bluesky open ready to post; LinkedIn, Facebook, Reddit open with the link only; Instagram, TikTok copy; WhatsApp, Telegram, copy link. Each press records `share.opened` (`apps/api/src/services/shares.ts`), never "posted".

No agent approval is involved; publishing is never an agent's act (no `publish_page` tool exists; THESIS 1.2 proposed one, the build chose the founder's press, page.ts:6-8).

Where it breaks:

- **Existing projects (all 13 in production).** No draft row, no note, no backfill script (`scripts/` holds only linters; no migration or job writes pages). They see "Your project's public page is ready to check" as one quiet line on Today (`PublicPageNote.tsx`), with no badge, and the first-week checklist is gone after day 10. The feature is four days old and nothing tells an existing founder it exists. (GTM-07)
- **A silent failure is possible.** `draftProjectPage` failures are swallowed by design (businessFoundations.ts:93-97). Check production for `audit` rows with `action = 'page.draft_written'`; none means step 0 never ran or always failed.
- **The page cannot sell.** Three text fields and a Follow form. No link out, no price, no "Buy", "Book" or "Contact", no image, and the publish screen refuses any email or phone number, so a service business cannot even say how to reach it. Every string is rendered as a text node (`packages/dugout/src/components/public/ProjectPage.tsx:9`). (GTM-06)
- Nothing shows the founder whether anyone opened the page: "Visits are never counted or shown" (page.ts:23). (GTM-20)

### 1.2 (b) Collect followers

1. Visitor on `/p/<slug>` fills "Follow ‹project›": email + required consent box + Turnstile (`apps/web/app/p/[slug]/actions.ts` → `publicPage.follow` → `followPage` pages.ts:548).
2. Order of checks: honeypot → address and consent → per-caller limit → Turnstile through the gateway (fails closed) → one a day per page and address, three confirmations a day per address across projects → page public and form on → page hourly/daily caps → one transaction: pending `contact_consents` row + CRM contact "Follower (ma***@example.com)" with no lawful basis + reserved confirmation → `gateway.confirmFollow` (pages.ts:610).
3. Gateway `POST /v1/platform-mail/confirm-follow` (`apps/gateway/src/follow-confirm.ts`): sends the fixed confirmation from the project's Foundmill address, on its own daily count (100 per project, 1,000 per deployment; platform-mail.ts:140-146).
4. Visitor presses the link → ingest `GET|POST /mail/confirm` (`apps/ingest/src/platform-mail.ts:319-337`): confirms the record, sets lawful basis `consent` if none, writes `page.followed` (a real outcome), awards "First follower", starts a post draft.
5. Founder sees "N people follow this project" on Product › Public page (confirmed only) and the contact in Customers with "Agreed to email on ‹date›" or "Not confirmed yet" (`apps/api/src/routers/crm.ts:86-93,175-181`).

Where it breaks:

- `follow-confirm.ts:80`: `if (!config?.domain) return notSent("off")`. With `PLATFORM_MAIL_DOMAIN` unset the visitor still gets `{ ok: true }` and reads "Check your email to confirm"; no email exists. The form's visibility depends only on the page's own `followForm` switch (pages.ts:574, 389), on by default. A founder who publishes today collects only "Not confirmed yet" rows that can never confirm, and every visitor who tried is told something false. (GTM-03, P0)
- No note or email tells the founder a follower arrived (PROGRESS.md:1576 "Not done: a daily Inbox summary of new followers"). (GTM-30)
- Per-visitor rate limiting relies on a Vercel Firewall rule on POST `/p/*` that the operator must create (PROGRESS.md:1575).
- The quiz ("Which one is for you?", `pageQuiz.*`) needs real customers before the team will draft it (`PAGE_QUIZ_MIN_CUSTOMERS`, `apps/api/src/services/page-quiz.ts:8-10`), so it is not a week-one tool.

### 1.3 (c) Send a first email to followers from the project's address

What is built: connector `platform_mail` with one tool `send_mail` (one recipient, text plus simple HTML, `packages/connectors/src/connectors/platform_mail/tools.ts:50-57`); gateway guards in order (`apps/gateway/src/platform-mail.ts:4-22`): switched on → founder's own SendGrid not connected → content → suppression → address not paused → commercial mail needs the founders' postal address (`project_postal_addresses`, 0101) → project daily cap (default 50) → deployment ceiling (default 2,000), both counted in Redis and refused when Redis is down. The envelope (sender "‹project› via Foundmill", Reply-To, signed unsubscribe, custom args) is set by the gateway, never by the agent. `mail.sent` is written with `simulated` (pipeline.ts:419). Bounces, drops, spam reports and unsubscribes suppress and withdraw consent (ingest `/mail/events`, `/mail/unsubscribe`).

The intended path: founder starts distribution → Email channel is `acts` (platform mail counts as connected for every project when live, channel-availability.ts:82) → ... and here the path ends, in four independent ways:

1. **Not live in production** [docs, unverified]. Until DEPLOY §5.7 is done every send is refused `platform-mail-off`.
2. **No agent can address a follower.** The only CRM read an agent holds is `search_entities`, which returns `{ id, kind, name }` (`packages/connectors/src/connectors/platform/tools.ts:145-153`; host at `apps/gateway/src/platform-host.ts:213-216`). A follower's name is the masked "Follower (ma***@example.com)". `send_mail` requires `to.email`. No tool lists followers, returns an address, or sends to an audience. `check_contact` takes an address the agent must already have.
3. **The engine's launch sends nothing.** The Email engine drafts one to three emails with `{{first_name}}` placeholders (prompt `packages/agents/src/prompts/channel-creative.ts`), asks to "launch", and on approval marks the campaign live (channel.ts:232-256). No merge, no recipient list, no send.
4. **No founder path either.** There is no "write to your followers" procedure: `apps/api/src/routers/email.ts` is only Foundmill's own email to founders; `repos.followers` has no consumer that sends (callers listed in §5.6).

Also: the plan-action `send_message` (an Inbox decision that names a recipient) is sent through `gmail` or `sendgrid` only (`apps/orchestrator/src/activities/connector-calls.ts:42-50`); `platform_mail` appears nowhere in the orchestrator's non-test code. (GTM-18)

Approvals that would apply if a session did hold an address: assisted and augmented both ask (the tool is `contactsThirdParty` + `irreversible`); automated sends within the caps without asking, including to people who never opted in, because policy checks suppression and untrusted-origin only (GTM-14).

### 1.4 (d) Publish a first social post

Tap-to-post (the default, live for every real project because it needs no connector):

1. Founder puts Social on the Board (Customers › More detail › Board). `setEnabled` starts no engine for a by-tap channel and queues a post draft if the page is already live (distribution.ts:241-254).
2. A draft is written by `draftTeamPost` (`packages/db/src/team-post-draft.ts:60-112`) only when: not a sample, team not stopped, social on the board, page live, by-tap, credits left, and one of three triggers fired: page published, a milestone shown on the page, the first follower. Caps: 2 a day, 5 a week (`packages/shared/src/team-posts.ts:52`). Prompt `packages/agents/src/prompts/post-draft.ts`: at most two sentences, the fact plus what the project is, no numbers, no hype; `checkPostDraft` rejects links, mentions, emoji, praise, unlisted figures; one retry, else dropped.
3. Founder: Today's quiet line "A post is ready to share" → Customers › Creative → Share → network window → presses Post there. Optional "ready-to-post kit": a Runway clip and ElevenLabs voiceover on the founder's own keys, each asking first (`post_media`, 0102).
4. Recorded as `share.opened`; the draft stops waiting (`repos.teamPosts.markShared`). If someone arrives through the post's `?via=s.<code>` link and later confirms a follow, replies or pays, the post is credited (`post_links`, `post_attributions`, 0106; `apps/ingest/src/post-outcomes.ts`).

Buffer on the founder's own key: `buffer:queue_post` (3P + irreversible, asks in assisted and augmented). When Buffer is live and connected, social becomes `acts`.

Where it breaks:

- In week one the team writes at most two or three posts in total, all announcements ("the page is live"). No content plan, no value posts, no founder-story post, no network-specific variants beyond length fitting. (GTM-12)
- b2b_saas, hardware and services archetypes have no social agent and social is not a default channel (`packages/agents/src/archetypes.ts:194,540,634`); the founder must find the Board and add it.
- When Buffer `acts`, drafts stop: `channelByTap` is false, so `draftTeamPost` returns `not_by_tap` (team-post-draft.ts:83), and the engine that now runs queues nothing (it calls no tool). Connecting Buffer therefore reduces what the product produces unless a Chief of Staff task happens to tell the social agent to queue a post. Recorded as an open follow-up in PROGRESS.md:2075. (GTM-12)
- A published post is never an event: tap is `share.opened` by design; Buffer's `get_post` status `sent` is read by an agent and turned into nothing. `REAL_OUTCOME_EVENT_TYPES` has no post type (`packages/shared/src/morning-brief.ts:45`), although the north star names "a post published". (GTM-13)
- Buffer is not in the documented production `LIVE_CONNECTORS` and has never called the vendor (PROGRESS.md:1797 "No connector has called its vendor for real").

### 1.5 (e) Reach first customers by direct outreach

By default nothing outward is possible, which is lawful and also a dead end:

- Lead generation's acting-tool list is empty on purpose (channel-availability.ts:23-25), so the channel is "not available yet" and has no engine.
- With Apollo on the founder's own key the agent may `search_people` (free) and, after an approval each time, `enrich_person` (spends a credit). The result is untrusted content: every address found is registered "first seen in untrusted content" (`apps/gateway/src/recipients.ts:4-9`) and a later send to it is forbidden by `untrusted-recipient` in every mode. The file header says "until a founder approves", but no code path lets a founder approve an address. What actually lifts the block is time: the register is one Redis set per business with a 12-hour TTL renewed on each write (`recipients.ts:135,239,265`; no override where it is built, `apps/gateway/src/index.ts:135`), so once the business has seen no new untrusted content for 12 hours the addresses are no longer refused. PROGRESS.md:1797 records the rule as kept by design; the lapse is not mentioned.
- The agent cannot save a lead: "new CRM records have no agent tool yet" (`_channel.ts:41-43`). Leads live only in the 4,000-character task summary.
- No email verification tool; the template says so and marks every address unverified (`lead_generation.ts:13`).
- PR, events, influencer and print agents hold `gmail: drafts.create` (leave a draft in the founder's own mailbox). Gmail needs Foundmill's Google OAuth client and `gmail` live; not in documented production.
- Founder-led outreach ("message five people you know") has no surface: no founder task, no script, no tracker. The Product Researcher does draft an interview plan, script, survey and smoke test as artifacts (`apps/api/src/services/product-research.ts`, kinds in `constants.ts:402`), under Product › Research, and nothing records who was spoken to.
- What does work by hand: the founder can create a contact in Customers (`crm.entity.create`), add notes and a `lead` role with a stage (`crm.roles.add`). That is a manual pipeline with no views built for it.

Lawful by default? Yes in the narrow sense that nothing can be sent. Once platform mail is live, the only legal controls on a marketing send are: suppression, the untrusted-origin rule, double opt-in for page signups (a pending follower counts as untrusted, pipeline.ts:502-505), the postal address, the cap, and the founder's approval in two of three modes. There is no consent or lawful-basis check and no country rule; the agent declares `purpose` itself and the gateway only downgrades false `reply`/`receipt` claims to marketing.

### 1.6 (f) Take a first payment

Not built. Evidence:

- "The payment link is not on main yet" (`apps/ingest/src/post-outcomes.ts:49`; `apps/web/lib/via.ts:40`; PROGRESS.md:1576).
- The Stripe connector has `create_checkout_session`, `create_invoice`, `send_invoice`, `create_customer` (`packages/connectors/src/connectors/stripe/tools.ts:72-86`) but `CAPABILITY_TOOLS.stripe` serves reads only (`packages/connectors/src/grants.ts:186-192`), so no agent can be granted them; only the Finance lead and the Affiliate engine hold Stripe at all.
- No api procedure creates a checkout or payment link for a business (`apps/api/src/services/payments.ts` is Foundmill's own credit top-ups on `stripe_billing`).
- The businesses' own `stripe` connector is mock in production ("the businesses' own Stripe connector (`stripe`) stays mock", DEPLOY.md:205). A founder can press Connect on it in Settings and gets a row with status `mock` (integrations.ts:132-145).
- Connect onboarding is a hard-gate descriptor that tells the founder to register at Stripe and paste a restricted key (`stripe/tools.ts:110-115`). For an 18-year-old with no company this is the hardest step of the whole journey and the product gives no help with it.
- The public page has no place for a payment URL (GTM-06), so even a founder who makes a Stripe Payment Link, Gumroad or Ko-fi page alone cannot put it on their Foundmill page.

The only real sources of `payment.received` and `signup.created` are the Stripe and Shopify webhook normalisers (`stripe/webhooks.ts:105,136,165`, `shopify/webhooks.ts:103,131`), mounted only when those connectors run live with per-business secrets.

### 1.7 (g) See where a customer came from; get a Customer Update

- Customer Update: ingest turns `signup.created`, `activation.reached`, `payment.received` into `conversions`, builds a first-pass journey over the customer's `touches` (40/20/40), writes `customer.converted`, and the composer narrates it (`apps/ingest/src/conversions.ts`, `followups.ts`). With no Stripe or Shopify live there is no source event, so no real project can have one. A confirmed follower is `page.followed`, not a conversion: no Customer Update, no journey.
- Attribution that can work today: a follow credited to the team post it came through (`post_attributions`), shown as "Led to …" under the post on Creative and named in the morning brief. Nothing else: no referrer, no UTM capture on the page, no visit counts.
- Distribution › Attribution and › Channels read `channel_metrics` and journeys; for a real project both are empty and stay empty (no real writer of `channel_metrics`). Any figures there today on a real project predate Nov 11 and were generated (GTM-10).
- `attributions` (0088) is Foundmill's own sign-up attribution (who brought a new Foundmill member), not the project's customers.
- A customer's reply: ingest writes `lead.replied` with a summary such as "Email reply from x@y.com (42 words…); body quarantined for the reader" (`packages/connectors/src/connectors/sendgrid/webhooks.ts:241-262`). The comment says the body "goes to the interaction row"; no production code writes that row (`repos.entities.createInteraction` is called only by the two seed files). The Reply-To is the project's Foundmill address, so **the reply's text is discarded and the founder can never read it**. (GTM-04, P0 once mail is live)

### 1.8 Why 79 `launch_campaign` approvals and almost none resolved

What it is: an approvals row the engine creates in its `approve` step (channel.ts:189-231) when `launchApprovalReason` (:98-104) returns a reason: offline tracking (always), augmented mode (always), weekly budget above the threshold, or assisted mode with a "new campaign". In assisted mode a campaign is new when the channel has never launched one (`repos.campaigns.lastLaunched`), so a founder who does not answer is asked again every week, forever. `launch_campaign` is in `BATCHED_TOOLS` (`packages/db/src/approvals.ts:160`) so several open at once share one note.

Who calls it: no template. It is not in `CAPABILITY_TOOLS`, not an MCP tool, not reachable by an agent. The engine writes it with the channel's owner agent as the asker and emits `approval.requested` with `summary: "<agent> wants to launch \"<Channel> — week N, <date>\""`.

What the founder sees: Needs you note from the channel agent, "wants to launch the campaign …" (`apps/web/components/inbox/request.ts:169-172`), reading pane headline "Launch “…” on ‹Channel› with ‹budget›" and each creative draft clipped to 320 characters (`packages/db/src/approval-content.ts:182-197`), Approve / Reject.

What approving does: `approvalWait` resolves → `channelStep(approve)` approves the campaign's drafts and sets `scheduled` → `launch` sets `live`, emits `campaign.launched`, and in offline tracking creates a founder task "Founder action: submit the … materials" (channel.ts:240-252). No email, post, page, ad or booking leaves the product.

Why few resolved: an unanswered approval expires when the week's wait times out (`approvalWait.ts`, `expireApproval` in `activities/approvals.ts:105-111`), which closes the Inbox item and writes **no** `approval.resolved` event. So "79 requested, 14 resolved across all tools" reads as: about 65 or more asked, ignored and silently expired. Rate: one per engine-running channel per roughly nine days (a week's wait, then two 24-hour measure/learn delays, then `continueAsNew`). Five `campaign.launched` events on real projects are the approved or inside-policy ones, or campaigns set live by hand (`distribution.campaigns.setStatus`).

Is it still running? After Nov 11 an engine runs for a real project only when the channel `acts` or is in offline tracking (`channelEngineBlocked`, `listEnginesToEnsure` schedules.ts:322-345). In documented production that means Print and Broadcast (offline tracking by default, `constants.ts:306-307`), any channel the Strategist marked `kit_mode_required`, and SEO/GEO for the one project with GitHub connected. For those, yes: a weekly request to approve work that changes a status. The moment platform mail goes live the Email engine joins them for **every** project that started distribution, and "Live with 2 assets" will be shown for campaigns that sent nothing (GTM-02).

## 2. Real vs simulated vs not connected in production

### 2.1 How "live" is decided

- A connector runs its real implementation when `INTEGRATIONS_MODE=live` or its key is in `LIVE_CONNECTORS` (`packages/shared/src/env.ts:291-294`). The value is per service: gateway (runs the call), api (decides whether to ask the gateway or the mock, and availability), orchestrator (engine availability), ingest (webhook mounts).
- `platform` and `quarantine` are always live (`ALWAYS_LIVE_CONNECTORS`, `packages/connectors/src/catalogue.ts:133`). `platform_mail` and `platform_notify` follow `sendgrid`'s switch (`CONNECTOR_MODE_KEYS`, catalogue.ts:121) and also need `PLATFORM_MAIL_DOMAIN`.
- Last documented production value: `INTEGRATIONS_MODE=mock`, `LIVE_CONNECTORS=github,domains` (DEPLOY.md:272; PROGRESS.md:1251-1253; THESIS_REVIEW.md:187), plus `stripe_billing` for Foundmill's own top-ups where set (DEPLOY.md:205). No PROGRESS entry after Nov 11 records adding `sendgrid`, `web`, `buffer` or any own-key connector [unverified against Railway]. The production rows agree: one GitHub connection, one SendGrid row with status `mock`.
- In mock mode for a real project (staging or production): a connector that needs an account and has no integration row answers 409 `integration_not_connected` (pipeline.ts:757-759). A connector the founder "connected" in Settings while it is not live stores a row with status `mock` and then **runs the mock**, with `simulated: true` and a notice on the result (integrations.ts:132-145; pipeline.ts:923). A connector with `auth.kind: "none"` in mock mode (`web`) also runs its mock for real projects.

Legend for the tables: 3P = `contactsThirdParty`, $ = `spendsMoney`, IRR = `irreversible`, HG = `hardGate`. "Asks" means Cedar answers `ask` in augmented and assisted mode. Real implementation = `index.ts` beside `mock.ts`; every connector has both. "Proven" = a PROGRESS entry says it called its vendor.

### 2.2 Connector catalog (37 in `CONNECTOR_FACTORIES` + 4 built-ins = 41)

| # | Key | What it does | Auth | Real impl / proven | Production (documented) | Tools with hints | Templates granted (capabilities) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `platform` | Task board, typed messages, founder escalation, read-only views of the business | none, built-in | yes / yes | always live | 27 tools, see §2.3. Only `request_human_action` is HG+IRR | every template (`PLATFORM_BASE_TOOLS`); leads add create/assign; channels add `CHANNEL_PLATFORM_TOOLS` |
| 2 | `quarantine` | Quarantined reader for untrusted text | none, built-in | yes / yes | always live | `read_untrusted` | every channel, lead, researcher |
| 3 | `web` | Web search (Anthropic server search on the platform key) and page fetch | none, built-in | yes / not recorded | **mock** (THESIS 1.4 not done; DECISIONS.md:3532) so real projects get generated pages marked simulated | `fetch` (Source Watcher), `search_web`, `fetch_page` | product_lead, legal_lead, distribution_strategist, researcher, product_researcher, specialists. **No channel agent** |
| 4 | `platform_mail` | One email to one person from `<slug>@PLATFORM_MAIL_DOMAIN` on Foundmill's SendGrid | none, built-in (platform) | yes / no | **off** until DEPLOY §5.7 | `send_mail` 3P+IRR | channel_email_automation (`mail.send`) only |
| 5 | `platform_notify` | Foundmill's own email to its users | none, service-only | yes / no | off with the same switch | `send_notification` IRR | none (service route `/v1/notify/email`) |
| 6 | `anthropic` | Model list, key check, answer panel | api_key + platformKey | yes / models are live through `packages/models`, the connector's panel not proven | mock | `list_models`, `get_model`, `validate_key`, `ask_panel` | channel_geo (`panel.query`) |
| 7 | `voyage` | Embeddings | api_key + platformKey | yes / ? | mock | `embed`, `list_models` | none |
| 8 | `openai_images` | Agent faces | platformKey, service-only | yes | mock unless listed | `generate_image` $ | none |
| 9 | `elevenlabs` | Team call speech | platformKey, service-only | yes | mock unless listed | `synthesize_speech` $, `transcribe_speech` $ | none |
| 10 | `onesignal` | Push to the mobile app | platformKey, service-only | yes | mock unless listed | `send_push` | none |
| 11 | `github` | Repos, branches, commits, PRs, checks | GitHub App | yes / **yes** | **live**, 1 real project connected | `list_repos`, `read_tree`, `read_file`, `compare_refs`, `create_branch`, `commit_files`, `run_checks`, `get_checks`, `open_pr`, `get_pull_request`, `list_pull_requests`, `update_branch`, `merge_pr` IRR; route-only `download_archive`, `get_repository` | engineers, engineering_lead, review, QA, planner, docs_writer; **channel_seo, channel_geo, channel_content** (`repos.read`, `pulls.create`, `pulls.read`) |
| 12 | `google_drive` | Search, read, create and append docs | OAuth (Foundmill's Google client) | yes / no | mock | `search_files`, `get_file`, `export_text`, `read_doc`, `create_doc`, `append_to_doc`, `share_file` 3P | operations_lead, specialists, researcher, product_researcher, docs_writer, channel_content, channel_broadcast, channel_print, channel_outdoor |
| 13 | `gmail` | Read threads, leave drafts, send | OAuth | yes / no | mock | `list_messages`, `get_message`, `create_draft`, `list_labels`, `send_message` 3P+IRR (no capability maps to it for agents; used by the plan action `send_message`) | operations_lead, specialists, channel_pr, channel_events, channel_influencer, channel_print (`drafts.create`, `threads.read`) |
| 14 | `google_calendar` | Events and free slots | OAuth | yes / no | mock | `list_calendars`, `list_events`, `get_event`, `find_free_slots`, `create_event` 3P, `update_event` 3P, `delete_event` 3P+IRR | channel_events (`events.create`, `events.list`); plan action `schedule_meeting` |
| 15 | `notion` | Search, read, write pages | OAuth | yes / no | mock | `search`, `get_page`, `get_page_content`, `query_data_source`, `create_page`, `append_paragraphs` | product_lead (read), docs_writer, channel_content |
| 16 | `cloudflare_dns` | DNS records, email-auth check | api_key (own; platform token as fallback per DEPLOY.md:233) | yes / no | mock | `list_zones`, `list_records`, `check_email_auth`, `create_record` 3P+IRR, `update_record` 3P+IRR, `delete_record` IRR | none |
| 17 | `opencorporates` | Company search | platformKey | yes | mock | `search_companies`, `get_company` | legal_lead |
| 18 | `bolagsverket` | Swedish registry | platformKey | yes | mock | `get_organisation`, `list_documents` | legal_lead |
| 19 | `companies_house` | UK registry | platformKey | yes | mock | `search_companies`, `get_company`, `list_officers` | legal_lead |
| 20 | `e2b` | Sandboxes | platformKey | yes / yes (acceptance runs) | sandbox use is via `SANDBOX_MODE`, connector mock | `create_sandbox` $, `list_sandboxes`, `get_sandbox`, `pause_sandbox`, `resume_sandbox` $, `set_timeout` $, `kill_sandbox` IRR | none |
| 21 | `dropbox_sign` | Signature requests | api_key | yes / no | mock | `list_signature_requests`, `get_signature_request`, `send_signature_request` 3P+IRR, `cancel_signature_request` IRR, `sign_as_founder` HG+IRR | legal_lead, channel_influencer (`requests.prepare`) |
| 22 | `ecb_rates` | FX reference rates | none | yes | mock | `get_daily_rates`, `convert` | finance_lead, costing |
| 23 | `domains` | Domain availability (RDAP) | none | yes / yes | **live** | `check_domains` | none (Commit screen through a service route) |
| 24 | `stripe` | Read balance, charges, invoices; create customers, invoices, checkout sessions; hard gates for money out and onboarding | OAuth + platformKey (Connect), or the founder's restricted key (`STRIPE_CONNECT_FIELDS`) | yes / no | **mock** (DEPLOY.md:205) | reads: `get_account`, `get_balance`, `list_customers`, `get_customer`, `list_invoices`, `get_invoice`, `list_charges`, `list_payouts`; writes with no hint: `create_customer`, `create_invoice`, `create_checkout_session`; `send_invoice` 3P+IRR; HG: `create_payout`, `create_transfer`, `refund_payment`, `start_connect_onboarding` | finance_lead (`balance.read`, `charges.list`, `invoices.list`), channel_affiliate (`charges.list`, `refunds.list`). **No capability serves any write tool** |
| 25 | `sendgrid` | The founder's own SendGrid: single sends, campaigns, stats, suppressions | api_key (own; never the platform key) | yes / no | mock (its switch is also the platform mail switch) | `list_verified_senders`, `check_suppression`, `add_suppression`, `list_campaigns`, `create_campaign`, `get_stats`, `send_mail` 3P+IRR, `schedule_campaign` 3P+IRR | channel_email_automation (`mail.send`, `campaigns.create`, `campaigns.schedule`, `stats.read`, `suppressions.read`) |
| 26 | `shopify` | Orders, products, draft orders | OAuth | yes / no | mock | reads `get_shop`, `list_orders`, `get_order`, `list_products`, `list_customers`; `create_draft_order`; `cancel_order` IRR; `refund_order` HG+$+IRR | finance_lead (`orders.list`), channel_influencer (`draft_orders.create`) |
| 27 | `tink` | EU open banking | OAuth | yes / no | mock | `list_accounts`, `list_transactions`, `sync`, `get_consent_status`, `start_consent` | finance_lead |
| 28 | `plaid` | US/UK banking | OAuth | yes / no | mock | same five | finance_lead |
| 29 | `openai` | Ask ChatGPT a panel question | api_key (own) | yes / no ("no connector has called its vendor", PROGRESS.md:1730,1797) | not recorded as live | `ask_panel` | channel_geo |
| 30 | `gemini` | Same, Gemini | own key | yes / no | not recorded | `ask_panel` | channel_geo |
| 31 | `perplexity` | Same, Perplexity | own key | yes / no | not recorded | `ask_panel` | channel_geo |
| 32 | `serpapi` | Google results and AI Overview | own key | yes / no | not recorded | `search_google` | channel_seo, channel_geo |
| 33 | `firecrawl` | A page as a crawler reads it | own key | yes / no | not recorded | `scrape_page` | channel_seo, channel_geo |
| 34 | `indexnow` | Tell search engines an address changed | own key (self-generated, public by protocol) | yes / no | not recorded | `submit_urls` IRR | channel_seo, channel_geo |
| 35 | `apollo` | Find people and companies, look up a work email | own key | yes / no | not recorded | `search_people`; `search_organizations` $+IRR; `enrich_person` $+IRR | channel_lead_generation |
| 36 | `vercel` | Deployments | own key | yes / no | not recorded | `list_deployments`, `get_deployment`, `create_deployment` IRR+$ | engineering_lead, infra_engineer |
| 37 | `posthog` | One read-only insight query | own key | yes / no | not recorded | `query_insights` | distribution_strategist, data_engineer |
| 38 | `resend` | One email from the founder's verified domain | own key | yes / no | not recorded | `list_domains`, `send_mail` 3P+IRR | channel_email_automation (`mail.send`) |
| 39 | `runway` | Short video from text or image | own key | yes / no | not recorded | `generate_video_from_text` IRR+$, `generate_video_from_image` IRR+$, `get_video_task`; route-only `download_video` | channel_social (`video.generate`) |
| 40 | `elevenlabs_voice` | Voiceover on the founder's account | own key | yes / no | not recorded | `list_voices`, `generate_voiceover` IRR+$ | channel_social (`voiceover.generate`) |
| 41 | `buffer` | Queue a post in the founder's Buffer | own key | yes / no | not recorded (DEPLOY.md:213 says add to gateway, api, orchestrator) | `list_channels`, `get_post`, `queue_post` 3P+IRR | channel_social (`channels.read`, `posts.queue`, `posts.read`) |

Notes on the table:

- Own-key connectors with typed reads (`apollo`, `vercel`, `serpapi`, `firecrawl`, the four panels) and `buffer` are to be added to `LIVE_CONNECTORS` only while `.github/workflows/evals-typed-reads.yml` is green (DEPLOY.md:212-213); it passed 5 of 5 on Nov 13.
- Not built at all (kept in `packages/agents/src/templates/PLANNED_GRANTS.md`): every ad platform, every direct social publisher, direct mail, PR wires, affiliate networks, event platforms, email verification, search-console data, page-speed, booking pages, SMS, review sites.
- For a zero-budget founder with no accounts, the only rows that matter are 1 to 4. Rows 29 to 41 each need a paid or at least separately registered vendor account and an API key, which contradicts "little money and no business experience" as a default path.

### 2.3 Platform tools the gateway serves (connector `platform`, `packages/connectors/src/connectors/platform/tools.ts`)

| Tool | Capability names that grant it (`grants.ts:203-253`) | Notes for go-to-market |
| --- | --- | --- |
| `list_tasks`, `get_task` | `tasks.list`, `tasks.history`, `merge_queue.read` | |
| `create_task`, `assign_task`, `update_task` | `tasks.create`, `tasks.assign`, `tasks.reprioritise`, `tasks.update`, `sessions.reassign` | leads only |
| `claim_task`, `block_task`, `handoff_task`, `complete_task` | `tasks.claim/block/handoff/complete` | `complete_task.summary` is at most 4,000 characters: the whole deliverable of a non-code session |
| `send_message`, `list_messages` | `messages.request/inform/review`, `sessions.shout` | agent to agent only |
| `request_human_action` (HG, IRR) | `inbox.request_human_action`, `kit.create_founder_task`, `assets.request_approval` | never runs; becomes a founder task. 36 `approval.requested` in production carry this tool |
| `read_business` | `business.mode.read`, `holiday.read_authority`, `budgets.read` | name, mode, glossary, team. No description of what the business sells |
| `search_entities` | `memory.search`, `crm.entities.search`, `entities.manifest.read` | returns `id`, `kind`, `name` only: **no email, no role, no consent** |
| `check_contact` | `suppression.check`, `consent.check` | suppression only; the name `consent.check` overstates it |
| `list_approvals`, `list_sessions` | `approvals.list`, `sessions.list` | |
| `read_product` | `spec.read`, `roadmap.read`, `sources.list`, `sources.read` | **granted to product_lead, planner and specialists only**; no channel agent, not the strategist |
| `propose_spec_change` | `spec.propose` | product_lead |
| `read_finance`, `read_legal` | `finance.*`, `legal.*` | |
| `read_distribution` | `campaigns.list` | channels and campaigns by name and status; **not the assets** |
| `list_repository_docs`, `read_repository_doc` | `docs.read` | only where a GitHub repository is chosen |
| `list_skills`, `assign_skill`, `remove_skill` | `skills.manage` | Chief of Staff |

Missing platform tools that the templates' own playbooks assume (confirmed absent from `platformTools`): create or read a campaign asset, create a CRM contact or lead, list followers, send to an audience, create an attribution link or code, read the public page, read page or channel results, publish anything on the public page.

Gateway service routes relevant here (`apps/gateway/src/app.ts:5-24`): `POST /v1/platform-mail/confirm-follow` (api), `POST /v1/notify/email` (api, orchestrator), `POST /v1/turnstile/verify`, `POST /v1/integrations/connect|health`, `POST /v1/call`, `ALL /mcp/:connector`.

### 2.4 Channel by channel

"Prod" assumes the documented production switches. "Engine" = the weekly loop of §1.8.

| Channel key | Acting tools (`CHANNEL_ACTING_TOOLS`) | Prod availability and what the Board shows | What an agent can really do today | What it prepares for the founder | Week-one outcome at zero budget? |
| --- | --- | --- | --- | --- | --- |
| `social` | `buffer:queue_post` | **available, `by_tap`**: on the Board "You post it", sentence "You post each one with one press…"; never counted as running; no engine | nothing outward. With Runway/ElevenLabs keys: a clip and voiceover, each asking first | post drafts on three triggers (max 2/day, 5/week), share panel for 10 destinations, optional media kit | **Yes** (a post, by the founder's press), but it is not recorded as an outcome |
| `email_automation` | `sendgrid:send_mail`, `platform_mail:send_mail`, `resend:send_mail` | not available: "Email opens first, as soon as sending is switched on for your project" (`noChannelSentence`) | nothing. When live: a session could send 1:1 to an address it was given in its task; the engine sends nothing | weekly email drafts with placeholders on Creative (only once the engine runs) | **No** today. After §5.7: only the follow confirmation is real; nothing reaches followers (GTM-01) |
| `seo` | `github:commit_files` | not available unless GitHub is connected (1 project). Never named as "opens first" (`REPOSITORY_CONNECTORS`) | with GitHub: open PRs with fixes on the project's own repository through the merge flow. No Search Console, no rank data, no page-speed tool. Nothing for the Foundmill-hosted page | briefs; founder task for sitemap submission | No |
| `geo` | `github:commit_files` | as SEO | panels only on the assistants the founder connected with own keys; PRs for schema and llms.txt on the founder's own site | list of outside profiles to correct | No |
| `lead_generation` | none (deliberate) | not available, `no_publisher` | with Apollo own key: search people; paid lookups ask first. Cannot save leads, cannot mail what it found | a scored list in a task summary | No |
| `content` | none | not available | with Drive/Notion/GitHub connected: write a doc or open a PR | drafts; "hand a newsletter to the email engine as a task" | No |
| `pr` | none | not available | with Gmail connected: leave drafts in the founder's mailbox | release and pitches for the founder to send | No |
| `events` | none | not available | Gmail drafts, calendar events (ask) | outreach drafts | No |
| `influencer` | none | not available | Gmail drafts, Shopify draft orders, signature request prep | shortlist, brief | No |
| `affiliate` | none | not available | read Stripe charges | terms, partner list as a founder task | No |
| `paid_ads` | none | not available | nothing | campaign set-up as a founder task | No (needs budget) |
| `direct_mail` | none | not available (not offline tracking by default) | nothing | mailer brief | No |
| `print` | none | **can be put on the board with offline tracking** (default kit mode) → engine runs → weekly `launch_campaign` approval → founder task with materials | nothing outward | insertion-order draft, artwork brief | No (needs budget) |
| `broadcast` | none | as Print | nothing outward | scripts, production brief | No |
| `outdoor` | none | not available unless the Strategist set `kit_mode_required` (template says kit mode at `outdoor.ts:30`, `CHANNEL_META` at `constants.ts:308` says not: inconsistent) | nothing | artwork, quotes | No |

Answer to "which channels can produce a north-star outcome in week one for a founder with zero budget and no existing accounts": **none through an agent.** By the founder's own hand: the page (`page.published`, counted) and a tap-to-post share (not counted). After the operator finishes DEPLOY §5.7: confirmed followers (`page.followed`, counted). The two engines a real project can actually start today, Print and Broadcast, are the two least suited to this user.

## 3. Findings

Severity: P0 stops the target user reaching a real outcome or breaks trust; P1 seriously weakens the path; P2 quality or completeness; P3 small. Every fix carries the standing definition of done (typecheck, lint, unit tests, Playwright for touched screens, story for new components, eval for new agent behavior, PROGRESS and DECISIONS). New business-scoped tables need `business_id`, RLS and a cross-tenant test in the same change; new events go in `packages/events` with Zod and through the outbox.

### P0

**GTM-01 (P0). Followers can never be written to.**
- Evidence: `search_entities` output is `{ id, kind, name }` (`platform/tools.ts:145-153`, `platform-host.ts:213-216`); a follower's name is masked (`followerDisplayName`, `packages/db/src/repos/followers.ts`); `platform_mail.send_mail` needs `to.email` (`platform_mail/tools.ts:33-45`); the engine's launch calls nothing (channel.ts:232-256); no api procedure sends to followers (`repos.followers.*` callers: pages.ts, crm.ts, ingest platform-mail.ts, gateway pipeline.ts:505 and follow-confirm.ts:92, milestones.ts:204).
- Impact: the one audience a first-timer can build for free is unreachable. "An email sent" cannot happen for the people who asked for it.
- Fix: a platform-run broadcast, not an agent loop over addresses.
  1. Table `project_updates` (business-scoped, RLS: members read, Distribution write drafts, owner/admin send): `id, business_id, subject, text, html, status draft|approved|sending|sent|canceled, audience 'followers', drafted_by_agent_id, approved_by, approved_at, sent_count, skipped_count, created_at`. Table `project_update_deliveries` (`update_id, entity_id, message_ref, state queued|sent|skipped, reason`), service-role writes only.
  2. Platform tool `draft_follower_update` (capability `updates.draft`, hints `{}`) for `channel_email_automation`: writes a draft row; never sends; returns the confirmed follower **count** only.
  3. api `updates.list/get/save/approve/cancel` (`sectionWrite("distribution")`, approve = `sectionAdmin`). Approve shows the exact text, the count, the remaining daily cap and the footer as it will go out.
  4. Gateway service route `POST /v1/platform-mail/send-update` (`svc: api | orchestrator`): resolves confirmed, unwithdrawn `contact_consents` for the business inside the gateway, runs `preparePlatformMail` per recipient (suppression, cap, ceiling, postal address, class `marketing`), sends, writes `mail.sent` per message with `updateId`. Addresses never leave the gateway. A send larger than today's remaining cap continues the next UTC day (orchestrator workflow `followerUpdate` with `updateId`).
  5. Founder surface: Product › Public page gets "Write to your followers (N)" and Customers › Creative lists drafted updates; Today line "An update to your followers is ready to check".
  6. Events: `update.drafted`, `update.approved`, `update.sent` (counts only). `mail.sent` stays the real outcome.
  7. Tests: gateway (addresses never returned to the caller; withdrawn and pending skipped; cap rollover; postal-address refusal), RLS, api, Playwright `follower-update.spec.ts`; eval `channel_email.follower_update` (uses only page facts, no invented offer, no claim of being a person).

**GTM-02 (P0). The channel engine reports launches that do nothing, and asks the founder to approve them every week.**
- Evidence: §1.8; channel.ts:189-256; `approval-content.ts:196` headline "Launch …"; `live-feed.tsx:54` "Campaign launched"; only an offline-tracking channel creates anything (a founder task).
- Impact: breaks "a simulated tool result is never reported as an action" in spirit: nothing is marked simulated because no tool ran, yet the product says launched and live. 65+ ignored approvals trained the first 13 founders that Needs you is noise. When platform mail goes live, every project's Email engine starts doing this.
- Fix (pick one shape and apply it everywhere):
  1. **The engine only runs where its launch step has an executor.** Add `CHANNEL_LAUNCHERS: Partial<Record<ChannelKey, (ctx) => Promise<LaunchResult>>>` in `apps/orchestrator/src/activities/channel-launch.ts`: `email_automation` → creates a `project_updates` draft from the approved email asset and stops at the founder's approval of that update (GTM-01); `social` with Buffer → `buffer:queue_post` per approved post through `gateway.call` (asks per post); `seo`/`geo` → opens a `channel` task for the agent with the approved brief attached, no "live" status. A channel with no launcher has no engine (extend `channelEngineMayRun`).
  2. Campaign status vocabulary for real projects: `prepared` (materials ready, nothing sent) and `sent`/`queued`/`handed_over` set only from a real result id (message refs, Buffer post id, founder task id). Keep `live` for sample and dev. Migration: extend `CAMPAIGN_STATUSES`, backfill real projects' `live`/`ended` campaigns without a result to `prepared`.
  3. Offline tracking: one approval per campaign the founder asked for, not per week; rename the note "Your print materials are ready: check them" (decision type `review_materials`, not `publish_content`). Stop re-asking: if an approval expires unanswered, the engine pauses that channel (`channels.enabled` stays, engine ends with note "waiting for you") instead of drafting a new campaign each week (also saves a model call a week per channel).
  4. Emit `approval.resolved` with `outcome: "expired"` in `expireApproval` (`activities/approvals.ts:105`) so the metric is honest.
  5. Tests: orchestrator `channel.test.ts` (no status `live` without a launcher result on a non-demo business; expiry pauses), api `campaign-status.test.ts`, Playwright Campaigns; eval `channel_engine.reports_prepared_not_launched`.

**GTM-03 (P0). The Follow form promises a confirmation email that cannot be sent while platform mail is off.**
- Evidence: `follow-confirm.ts:80` returns `{ sent: false, reason: "off" }`; `followPage` still answers `{ ok: true }` (pages.ts:548-627); `publicPageBySlug` returns `followForm` from the page content alone (pages.ts:389).
- Impact: every visitor who tries to follow a page published today is misled, and the founder collects contacts that can never confirm.
- Fix: (a) operator: finish DEPLOY §5.7 (domain auth, DMARC, MX + Inbound Parse, event webhook, restricted key, variables on gateway, ingest, api, orchestrator, `REDIS_URL` on gateway) and record it in PROGRESS; (b) code: `publicPageBySlug` and `repos.followers.target` return `followForm: page.followForm && platformMailLive(env)`; the console's Public page tab says "Following opens when email is switched on" instead of the switch; (c) api boot log + `/health` field `platformMail: live|off`; (d) on the day it goes live, re-offer confirmation to pending records younger than 30 days (`repos.followers.reserveConfirmation` allows one per 30 days: add an operator script `scripts/resend-follow-confirmations.mjs` or a one-off workflow). Tests: api `page-follow.test.ts` (form hidden when mail is off), web `public-follow.test.ts`.

**GTM-04 (P0 once mail is live). A person's reply to the project is thrown away.**
- Evidence: `normaliseInboundMail` puts only signals in `lead.replied` (`sendgrid/webhooks.ts:241-266`); ingest `/mail/inbound` writes that event and nothing else (`apps/ingest/src/platform-mail.ts:104-160`); `repos.entities.createInteraction` has no caller outside seeds; no forward to the founder; Reply-To is the project's Foundmill address (`packages/connectors/src/contract.ts:165`).
- Impact: "a customer's reply" is a north-star outcome and the founder cannot read it or answer it. A founder will find out when a customer says "I wrote to you twice".
- Fix: in the same transaction as the event, store the reply: `interactions` row `kind: "email", direction: "inbound", entity_ids: [sender], summary` plus new column `body_untrusted text` (cap 20,000 chars, attachments dropped and counted), written by `ingestPlatformEvents` caller in `platform-mail.ts`. Show it on the contact's profile and in a Needs-you note "‹name› replied" rendered as plain untrusted text (never markdown, never entity-linked, links not clickable until pressed twice), with "Reply" that opens a founder-written reply sent through `platform_mail` with `purpose: "reply"` (the gateway already proves "wrote first", `repos.postalAddress.wroteFirst`). Agents read it only through `quarantine:read_untrusted`. Optional: forward a copy to the founder's own email through `platform_notify`. Retention and deletion: include `body_untrusted` in `crmDeletionSweep`. Tests: ingest (stored once, spam and unverified senders stored nowhere), RLS on the new column (CRM read), api crm, Playwright `crm.spec.ts`; injection eval `email.reply_body_instructions`.

**GTM-05 (P0). There is no way to take a payment, so no project can reach its first sale or a Customer Update.**
- Evidence: §1.6.
- Fix in two steps, cheapest first:
  1. **Founder's own pay link on the page (no integration, days not weeks).** `ProjectPageContent` gains `cta: { label ≤ 30, url }` validated against an allow-list of payment and booking hosts (`buy.stripe.com`, `checkout.stripe.com`, `gumroad.com`, `ko-fi.com`, `buymeacoffee.com`, `paypal.me`, `cal.com`, `calendly.com`, `tally.so`, plus the project's own verified site), https only, no credentials, rendered `rel="nofollow noopener"`. Appends `client_reference_id=s.<code>` for Stripe links so `paymentPostCode` (`post-outcomes.ts:52`) starts working. Founder-attested sale: Customers › "Record a sale" (`crm.sales.record`: amount, currency, contact) writes `payment.received` with `actor.kind: "user"` and `attested: true`; it gives the founder a Customer Update and counts as a real outcome only if the founder decision in DECISIONS says attested sales count (decision needed; default: shown, not counted).
  2. **Stripe on the founder's own restricted key, live.** Add `stripe` to `LIVE_CONNECTORS` (gateway, api, ingest) after SEC N2/N3; capability `payment_links.create` → new tool `create_payment_link` (Stripe Payment Links API; hints `{}` like `create_checkout_session`, since the customer pays) granted to `finance_lead` and `channel_email_automation`; per-business webhook secret entered in Settings and sealed (`apps/ingest/src/secrets.ts`); a guided "Get paid" checklist (create Stripe account, restricted key, webhook) written for a person with no company. Tests: connector contract, gateway, ingest conversions end to end with a Stripe test-mode fixture, Playwright "first payment → Customer Update" (THESIS 1.6 done-when).

**GTM-06 (P0 for conversion). The public page has no call to action, no link, no price and no image.**
- Evidence: `ProjectPageContent` fields (`packages/shared/src/project-page.ts:20-22`), `ProjectPage.tsx:9`, publish hold on emails and phones (`community-screen.ts`).
- Impact: a stranger who likes the project can only follow it, and following does not work yet. A founder with something to sell has nowhere to send them.
- Fix: extend `ProjectPageContent` (jsonb, no migration for the column; bump the shared schema and `readPageContent` defaults): `offer` (what you get, ≤ 300), `price` (free text ≤ 60, labeled by the founder), `cta` (GTM-05), `links[]` (≤ 3, label + https URL, same screening as post links, `nofollow`), `faq[]` (≤ 5 Q/A), `heroImage` (stored like the logo, checked `data:` or a `post_media`-style object). `publicProjectPages` view exposes them. Product lead prompt (`project-page.ts`) drafts `offer` and `faq` only from founder words. `pageHoldReason` keeps refusing emails and phones in free text but the page gets an explicit "Contact" option that routes through the project's Foundmill address as a form (writes a lead with the message through ingest, double opt-in not needed for a message the person sends). Tests: shared schema, api `pages.test.ts`, Dugout story at 390 and 1280, Playwright `public-page.spec.ts`.

**GTM-07 (P0 for the 13 existing projects). No page draft, no note, no backfill.**
- Evidence: businessFoundations.ts:92; `teamDraftNeeded` (`repos/pages.ts:236-246`); today.ts:269-271; no backfill anywhere.
- Fix: orchestrator one-off workflow `projectPageBackfill` (or `SCHEDULES` entry run once with `triggerOnRegister`): for every committed, unarchived, non-sample business with no `project_pages` row, run `draftProjectPage` (same activity; falls back to the starter on any failure) which writes the draft and the Product lead's note; then send the founder the existing "a decision is waiting" email (package 5.1) once mail is live. Idempotent by the `onConflictDoNothing` already in `writeTeamDraft`. Also make the note's primary action publish in one press from Needs you after a preview (keeps "founder's own press"). Tests: orchestrator activity test over a fixture of old businesses; api today (note replaces the quiet line).

### P1

**GTM-08 (P1). No marketing agent can read what the business is, who it is for, or what it offers.**
- Evidence: channel templates hold no `spec.read` (`grep '"spec.read"'` → product_lead, planner, specialists only); the session's "Business brief" is operational (departments, team, tasks, stage, governance; `activities/brief.ts:169-185`); the creative request carries the first six spec blocks cut to 2,000 characters (`creativeBrief`, channel.ts:108-120); post drafts read only the published page; `read_business` returns name, mode, glossary, team.
- Impact: session output is generic by construction; the Distribution Strategist scores channels from `name, archetype, business_mode` and the founder profile (distribution.ts:74-76).
- Fix: one source of truth, **`marketing_context`**, a jsonb column on `business_foundations` (it already holds `vision` with `forWhom`, `problem`, `whyNow`) or its own table `marketing_contexts` (one row per business, versioned): `positioning_statement`, `target_customer` (who, situation, trigger, where they already spend time), `problem_in_their_words[]`, `alternatives[]` (what they do today), `offer` (what, price, guarantee, how to buy), `proof[]` (only real, with source ids), `objections[]`, `voice` (three adjectives, do/don't phrases, person: I/we), `banned_claims[]`, `primary_cta`, `stage`. Written by the Product lead in the foundations workflow (new step after the vision, from founder words + spec Customers/Value proposition/Pricing), reviewed by the second-read agent, **approved by the founder** as one note ("This is how your team will describe you"), editable in Product › Vision. Refreshed by `propose_marketing_context_change` when interviews or replies contradict it. Served by platform tool `read_marketing_context` (capability `marketing.read`, hints `{}`) granted in `CHANNEL_PLATFORM_TOOLS` and to the strategist; also injected into `buildChannelCreativeRequest`, `postDraftFacts`, `projectPagePrompt`, `page-quiz`, `showcase-script` and `distribution.recommend`. Grant `spec.read` to channel agents too. Tests: agents (every marketing request builder includes it), grants contract, RLS; evals: `marketing_context.from_founder_words` (invents nothing), and a specificity grader on channel creative (names the customer and the offer from the context).

**GTM-09 (P1). The founder is asked to approve calls that cannot run.**
- Evidence: pipeline.ts:350-361 answers `ask` before `allow()` checks the connection (:748-759) or platform mail (:794-803); sessions are minted with every granted tool whatever is connected (`resolveGrants`).
- Impact: "Approve → nothing happened, not connected". Same lesson as GTM-02.
- Fix: (a) in `executeToolCall`, before `ask`, run a side-effect-free `canRun(deps, loaded, mode)` (the connection checks of `allow()` and `platformMailSwitchedOn`) and deny with `integration_not_connected` / `platform-mail-off` instead of asking; (b) orchestrator `prepareSession`: drop tool refs of connectors that are neither built-in nor connected-and-live for the business, and tell the agent which are missing in the task prompt. Tests: gateway (assisted + not connected → 409, no approvals row), orchestrator session-contract.

**GTM-10 (P1, trust). Fabricated leads and channel numbers written before Nov 11 are still on real projects.**
- Evidence: `recordMockLeads` is the only `lead.created` emitter; 19 such events on real projects [prod]; `upsertLead` stores them as ordinary contacts with a `lead` role and no marker (`repos/entities.ts:1127-1147`); `channel_metrics` rows with `source = 'estimate'` were written at channel.ts:276 for every business until Nov 11; no migration after 0076 touches them.
- Fix: one audited data fix (service role, per business, non-sample only): end `lead` roles and archive entities whose `identifiers->>'email'` ends in `.example` and whose `source` is a channel key; delete `channel_metrics` where `source = 'estimate'`; set leftover `live` campaigns to `ended`; append `audit` rows `data_fix.mock_results_removed` with counts; tell each affected founder once in plain words. Add a CI test that `mockLead` output can never be written when `mockResultsAllowed` is false (exists for the measure step; add for `upsertLead` callers).

**GTM-11 (P1). There is no zero-budget week-one plan.**
- Evidence: first-week items (`FirstWeekChecklist.tsx:35-43`) end at "Start distribution"; `defaultChannels` per archetype are unavailable in production; default distribution budget 150,000 minor a month (`archetypes.ts:82`), channel spend caps up to 150,000; all strategist and channel examples are funded B2B (`distribution_strategist.ts:39-44`).
- Fix: a "First ten customers" track owned by the Chief of Staff, in code not prose:
  - Table `founder_tasks` (or reuse `tasks` with `kind: "founder"` and `assignee_agent_id null`): `title, how_md, why, done_at, report jsonb`. Seeded on commit from a fixed list scaled to the profile's budget: publish the page; send it to five people you know (opens the share panel with a personal-message draft); ask three of them the interview script's first question; post once; record what they said.
  - Today shows one founder task a day (THESIS 6.3), with "How" and "I did it" that asks for one line back; answers become CRM notes and feed `marketing_context`.
  - Launch checklist screen under Customers (replaces the empty Leads default tab while there are no leads).
  - Budget defaults from the profile (THESIS 6.7): zero budget → distribution budget 0, strategist told so, only by-tap and email channels recommended, "free option recommended".
  - Tests: api today, shared first-week words, Playwright `first-days.spec.ts`.

**GTM-12 (P1). Post drafts are too few and too thin, and stop when a publisher is connected.**
- Evidence: three triggers and the two-sentence prompt (§1.4); `not_by_tap` (team-post-draft.ts:83).
- Fix: add a weekly content plan for by-tap and Buffer alike: trigger `weekly_plan` (orchestrator schedule per business that has social on the board), up to three drafts a week within `TEAM_POST_CAPS`, each a different kind (what it is, who it is for, a lesson from building it, a question to the audience), written from `marketing_context` with a hook line, per-network variants (X ≤ 280, LinkedIn 3 short paragraphs, Threads/Bluesky), alt text for the image. Keep `checkPostDraft`. When social `acts`, keep drafting and add "Queue in Buffer" beside Share (founder press → `buffer:queue_post` through the api's gateway client; no agent needed). Eval: extend `evals/src/post-draft.ts` with kinds and a hook check; run it live once.

**GTM-13 (P1). A published post is never an outcome.**
- Fix: event `post.published` `{ assetId, network, url?, source: "buffer" | "founder_attested" }`. Buffer: orchestrator poll of `buffer:get_post` for queued posts (read, no approval) until `sent` → event, not simulated. Tap: after the share window closes, Creative asks "Did you post it?" with an optional paste of the post's URL (validated host per network); founder-attested events are flagged. Add to `REAL_OUTCOME_EVENT_TYPES` per the founder's decision on attested outcomes (needs a DECISIONS entry; the north star text already names "a post published").

**GTM-14 (P1, compliance). Consent is not enforced anywhere a send is decided.**
- Evidence: Cedar has only `suppressed-recipient` and `untrusted-recipient` (10-recipients.cedar); `consent.check` → `check_contact` → suppression only (`platform-host.ts:225-228`); `purpose` is declared by the agent; `recipientCountry` is in the schema and unused; automated mode sends without asking; the untrusted-recipient block lapses 12 hours after the business last saw untrusted content (`recipients.ts:135,239,265`), with no founder decision involved.
- Impact: once mail is live, an agent in automated mode may send marketing email to any address in its task that is not suppressed. For consumers in the EU and UK that is unlawful without consent; in the US it is lawful but still harms the shared sending domain.
- Fix: gateway computes `recipientBasis` for each email recipient: `consent` (confirmed `contact_consents`), `relationship` (paid, or wrote first within `PROJECT_MAIL_RELATIONSHIP_MS`), `founder_added` (CRM contact created by a user with a lawful basis recorded), `none`. New Cedar policy `marketing-needs-basis`: forbid `contactsThirdParty` mail with `mailClass == "marketing"` and `recipientBasis == "none"` in every mode; `founder_added` always asks, even in automated mode, with the basis shown. `check_contact` returns `{ contactable, basis, confirmedAt }`. First-contact mail to `founder_added` contacts is capped lower (10 a day) than follower mail. Tests: policy unit tests per mode, gateway platform-mail tests, eval `channel_email.refuses_cold_consumer`.

**GTM-15 (P1). Lead generation cannot end in a lead.**
- Evidence: §1.5.
- Fix (decide the product first): for this user, drop agent prospecting as a week-one path and make it founder-led: tool `propose_leads` (capability `crm.leads.propose`, hints `{}`) writes up to 20 proposed contacts with reason and source into a review list; the founder accepts each (creates the CRM contact with `lawful_basis`); persist untrusted-origin addresses per business in the database (table `untrusted_recipients`: `business_id, kind, value_hash, first_seen_at, source, approved_by, approved_at`) instead of a 12-hour Redis set, so an address stays refused until the founder approves it; only accepted contacts can be mailed, and then GTM-14 applies. Keep Apollo optional. Without this, remove "push qualified leads to the CRM and into approved sequences" from `lead_generation.ts:7`.

**GTM-16 (P1, honesty). A real founder can "connect" a connector that is not live and gets a mock.**
- Evidence: integrations.ts:132-145 (status `mock`), one such SendGrid row in production; the gateway then runs the mock for that business (pipeline.ts:757 only refuses when there is **no** row); the UI shows "Test mode" on the tab title (`IntegrationsTab.tsx:95-100`).
- Fix: for a non-sample business on staging or production, `integrations.list` marks non-live connectors `available: false` with "Not available yet" and `integrations.connect` refuses them (`connector_not_live`); delete existing `mock` rows of real businesses in the GTM-10 data fix. The gateway treats a `mock`-status row as not connected when `!mockResultsAllowed`.

**GTM-17 (P1). Agent schedules and event triggers are dead configuration; nothing reacts to a follower, a reply or a sale.**
- Evidence: `_channel.ts:100`; no reader.
- Fix: either delete the field from templates (honest) or implement the three reactions that matter as platform automations, not agent wake-ups: (1) follower confirmed → welcome email from a founder-approved template (a `project_updates` row with `audience: "new_follower"`, approved once, sent by ingest's follow-up through the gateway route of GTM-01); (2) reply received → Needs-you note (GTM-04); (3) payment → Customer Update (exists) + thank-you receipt template. Each asks the founder once at set-up, never per send.

**GTM-18 (P1). The plan action `send_message` ignores the project's address.**
- Evidence: `connector-calls.ts:42-50`.
- Fix: when `platformMailLive` and the business has neither Gmail nor its own SendGrid connected, route to `platform_mail.send_mail` with one recipient per call and `purpose` unset; keep the AI line. Test in `connector-calls.test.ts`.

**GTM-19 (P1). The hosted page has none of the search and AI-answer basics beyond meta tags.**
- Evidence: `apps/web/app/p/[slug]/page.tsx:40-54` (title, description, canonical, Open Graph, Twitter, `index, follow`); no `sitemap.ts`, `robots.ts` or `llms.txt` under `apps/web/app` (the proxy matcher at `apps/web/proxy.ts:54` reserves `robots.txt` and `sitemap.xml`, and no file serves them); no JSON-LD in `ProjectPage.tsx`; `/p/[slug]/[keyFile]/route.ts` serves only an IndexNow key file; the root layout is `noindex` (`layout.tsx:18`); IndexNow for the hosted page needs the founder to generate and paste a key.
- Fix: `apps/web/app/sitemap.ts` (published pages, stories and shown milestone cards from the public views, with `lastModified`), `robots.ts` (allow `/p/`, `/u/`, `/m/`; name the sitemap; allow AI crawlers explicitly), JSON-LD on the page (`Organization` + `WebPage`, `Product`/`Service` + `Offer` only when the founder entered a price, `FAQPage` when FAQ exists; never ratings), `/p/[slug]/llms.txt` (plain-text summary from the published fields), a Foundmill-held IndexNow key for hosted pages submitted by the api on `page.published` (through the gateway, connector `indexnow` with a platform key variant limited to `APP_URL/p/*`: this needs a founder decision because the Nov 12 rule says own key only). Tests: web route tests, a structured-data validator unit test.

**GTM-20 (P1). The founder cannot see whether anyone visited.**
- Evidence: page.ts:22-23; `recordPostVisit` stamps only a post link's first visit.
- Fix: private daily aggregates, no visitor-level data: table `page_visit_days` (`business_id, day, source 'direct'|'post'|'search'|'other', visits`), incremented by the existing beacon (bots excluded as today, members excluded), shown only to members on Product › Public page ("38 visits this week, 12 from your posts"), never public, never an outcome. Feeds the weekly learn step in place of invented CPA.

### P2

**GTM-21 (P2). CAN-SPAM address means a solo founder's home address in every marketing email.** `platform-mail.ts:16-19`, `postal-address.ts`. Fix: say so plainly before they type it, accept a PO box or virtual mailbox, and decide whether Foundmill offers its registered address as a paid-plan-neutral option (legal review: the "sender" must be reachable there).

**GTM-22 (P2). No AI disclosure in project email.** Footer is "Sent by ‹name› with Foundmill. ‹address› To stop getting these emails: …" (`platform_mail/tools.ts:132-133`); house rule 3 only forbids claiming to be human. The plan-action path does add "by its AI assistant" (`connector-calls.ts:48`). Fix: one footer line for agent-written mail ("Written with help from AI and checked by ‹founder first name›" when approved by the founder), decided once in DECISIONS.

**GTM-23 (P2). Templates speak to a funded B2B company.** Every channel example is fintech-ops or DTC with euros to spend (`email_automation.ts:25-30`, `seo.ts:29-34`, `paid_ads.ts:22-27`, `pr.ts:22-27`); `WORKER_COMMON_RULES` demands "a source record id" for every claim (`_shared.ts:67`), which a session with no record access cannot meet. Fix: rewrite examples for a zero-budget first project per archetype; replace the record-id rule for marketing copy with "only facts from the marketing context".

**GTM-24 (P2). Dead surfaces shown first.** Distribution's inline tabs are Leads and Campaigns (`constants.ts:106`); Creative, where the only real work product waits, is behind "More detail". Channels and Attribution can never fill for a real project (no writer of `channel_metrics`). Fix: default tabs Creative and Board; hide Channels/Attribution until a real row exists (THESIS 6.1).

**GTM-25 (P2). Own-email connectors do not feed suppression.** A founder's own Resend or SendGrid bounces and complaints do not reach the project's suppression list (PROGRESS.md:1797; SECURITY_REVIEW N2 for SendGrid). Keep both out of `LIVE_CONNECTORS` until fixed, or accept with a DECISIONS entry.

**GTM-26 (P2). No outcome evals, and no evals in CI.** `.github/workflows/ci.yml` runs typecheck, lint, tests, Storybook build, Playwright; `evals-typed-reads.yml` is manual. THESIS 0.3's done-when ("a live agent given a mock `send_mail` reports that nothing was sent") and 1.8 are open. Simulated-result honesty in a session rests on the model obeying house rule 4; the orchestrator does not mark a session or its summary when a tool result was simulated (no `simulated` handling in `session.ts` beyond design checks), and the Composer never sees tool results (DECISIONS.md:3470).
- Fix: orchestrator records `simulatedCalls` on the session from gateway answers and appends a code-written line to the task summary and Inbox note ("2 steps were simulated and not done: …"); nightly workflow with three end-to-end sessions on live models.

**GTM-27 (P2). No notice of a new follower.** PROGRESS.md:1576. Fix: daily Needs-you-free line on Today and in the morning brief ("3 people followed yesterday"), first follower as a note.

**GTM-28 (P2). Interview material without interviews.** Product › Research artifacts (`interview_plan`, `interview_script`, `survey`, `smoke_test`, `demo_script`, `findings`) are drafts with status draft/ready/shared and no record of conversations. Fix: `research_conversations` (who, date, three answers, quote, would-pay) with a five-minute entry form on a phone; synthesis by the library skill `interview_synthesis` into `findings` and into `marketing_context.problem_in_their_words`.

**GTM-29 (P2). Kit-mode data mismatch.** `outdoor.ts:30` says kit mode, `CHANNEL_META.outdoor.kitModeByDefault` false; `direct_mail` has no connector and is not kit mode, so it can never run. Fix: set both true or remove them from a first-timer's catalog.

**GTM-30 (P2). Distribution is gated behind "the product is built".** `PRODUCT_STAGE_SENTENCES.building`: "no distribution work until the founder starts distribution" (`apps/orchestrator/src/activities/brief.ts:29-34`), and channel tasks are deferred in code (cycle.ts:189). A first-timer should test demand before building. Fix: split "audience" work (page, posts, interviews, follower updates) from "selling" and allow it from day one; keep paid and outbound behind Start distribution.

### P3

- **GTM-31.** A post-draft trigger fired while Temporal is down is lost (PROGRESS.md:1953). Add a sweep that drafts for a published page with no `page_published` draft.
- **GTM-32.** `approval.requested.summary` for campaigns says "wants to launch" with week numbers and dates in the name ("Print — week 3, Nov 10, 2026"): rename campaigns by what they are.
- **GTM-33.** `check_contact` and capability `consent.check` naming (see GTM-14).
- **GTM-34.** The quiz needs existing customers; hide its tab until `PAGE_QUIZ_MIN_CUSTOMERS` is met.
- **GTM-35.** Per-visitor follow limit depends on a Vercel Firewall rule recorded only as a note to the operator (PROGRESS.md:1575); verify it exists.
- **GTM-36.** `distribution.campaigns.setStatus` lets a member set a campaign `live` by hand on an acting channel and emits `campaign.launched` (distribution.ts:169-196) with nothing sent. Covered by GTM-02's status change.

### 3.5 Honesty checks (THESIS 0.3, 0.4) in one table

| Question | Answer | Evidence |
| --- | --- | --- |
| Can a channel metric appear for a real project without a real event? | New ones: no. Old ones: yes, rows written before Nov 11 remain | only writer is channel.ts:276 behind `mockResultsAllowed`; no cleanup (GTM-10) |
| Can a lead appear without a real person? | Old ones: yes (the 19). New ones: no; a real follower is a contact, not `lead.created` | sole emitter channel.ts:331 |
| Can a campaign read "live" with nothing sent? | **Yes**, for any channel whose engine runs, and by hand through `campaigns.setStatus` | channel.ts:239; distribution.ts:169-196 (GTM-02) |
| Can a send be shown that did not happen? | `mail.sent` counts as an outcome only with `simulated === false` (`packages/shared/src/morning-brief.ts:108-110`); a mock send on a real project is refused (`platform-mail-simulated`). A founder's own SendGrid stored as `mock` returns a simulated message id to the agent; whether the agent says so depends on house rule 4 | pipeline.ts:923; GTM-16, GTM-26 |
| Can a post be shown as published? | No. Tap is `share.opened`; Buffer says "queued" until `get_post` is `sent`. The opposite problem: a real post is never recorded (GTM-13) | shares.ts:4-7; social.ts:14 |
| `simulated` end to end for a channel task | gateway result `{ simulated: true, notice }` → the model → its 4,000-character summary → Composer note. Code enforces only the first hop. No session field, no UI chip on the task, no eval in CI | pipeline.ts:923; `session.ts` has no handling; DECISIONS.md:3470 |
| Web research on a real project | Simulated pages and results in production (connector `web` in mock mode, `auth.kind: "none"` so the not-connected refusal does not apply) unless `web` was added to `LIVE_CONNECTORS` | DECISIONS.md:3532; `web/mock.ts` |

### 3.6 Quality of marketing output

What each generator is given and what it can therefore produce:

| Generator | Model input about the business | Output | Specific or generic? |
| --- | --- | --- | --- |
| Project page (`prompts/project-page.ts`, v1) | founder's own idea text, the brief they typed, the idea card as untrusted | pitch ≤ 140, about ≤ 1,500, for whom ≤ 300, stage | Specific and honest, deliberately plain. It is a description, not a page built to convert: no problem-then-outcome order, no offer, no proof, no objection handling, no call to action (there is no field for one) |
| Post draft (`prompts/post-draft.ts`, v2) | the published page (untrusted) + one fact + counts of what earlier posts led to | ≤ 2 sentences, checked by `checkPostDraft` | Specific to the page, minimal by design: no hook, no angle, no question, no network-native form. Good first announcement; nothing to post in week two |
| Channel creative (`prompts/channel-creative.ts`, v1) | business name + first six spec blocks cut at 2,000 chars + learnings; system prompt is the channel template | 1 to 3 assets (email, post, article, ad, mailer, print, script) | Semi-specific where the spec's Customers and Value proposition blocks are good; no voice, no offer or price unless they fit in 2,000 chars, no audience segment. Emails carry `{{first_name}}` and `{{{unsubscribe}}}` placeholders nothing fills |
| Channel agent session (template + operational brief + task goal) | **nothing about the product** unless the task's goal text says it; no `spec.read`, no page read, no web | 4,000-char summary, drafts in Gmail/Drive when connected | Generic by construction (GTM-08) |
| Distribution Strategist (`distribution.recommend`) | name, archetype, mode, founder skills/budget/markets, availability | 15 scores, starters, CPA ranges labeled Estimate | Generic: it never reads the specification or the page. With one or two available channels the exercise is empty |
| Research plan (`prompts/product-research.ts`) | ICP line, markets, vision, Now items, spec as untrusted | interview plan and script, smoke test, survey, demo script | The most specific marketing-adjacent artifact in the product; not connected to distribution |
| Quiz, showcase script | real customers / a finished project | n/a week one | |

Single source of truth for positioning, target customer, offer and voice: **does not exist.** The nearest things are scattered: `business_foundations.vision` (`statement`, `forWhom`, `problem`, `whyNow`, `principles`, `northStar`; `packages/agents/src/foundations.ts:577-588`), the specification blocks "Customers", "Value proposition", "Pricing" (`archetypes.ts:110`), `businesses.glossary` (word substitutions), brand colors and logo, and the published page. None holds brand voice, the offer as a buyer would read it, alternatives, objections, proof or a primary call to action, and marketing agents can read none of them in a session. Proposal in GTM-08: `marketing_context` beside the vision in `business_foundations`, drafted by the Product lead, challenged by the Distribution Strategist, approved by the founder, read by every marketing generator through one platform tool.

### 3.7 What a credible zero-budget go-to-market needs, against the code

| Need | State | Evidence | Concrete build |
| --- | --- | --- | --- |
| Launch checklist | partial | first-week items stop at "Start distribution" (`FirstWeekChecklist.tsx:35-43`) | GTM-11 |
| Founder tasks ("message five people you know") | missing | THESIS 6.3 open; `request_human_action` is agent-raised only | GTM-11 `founder` tasks on Today |
| Customer-interview scripts | exists as drafts | Product › Research artifacts | surface it in week one; GTM-28 |
| Interview tracking / first-10-conversations pipeline | missing | CRM has contacts, notes, roles with stages, no view | GTM-28 + a saved CRM view "First conversations" |
| Pricing and offer design | partial | spec "Pricing" block; library skill `pricing_analysis` (opt-in) | `marketing_context.offer`; a guided "Your first offer" note from the Chief of Staff |
| First-sale path for services (booking + payment) | missing | `google_calendar` not live; no booking page; no pay link | GTM-05 step 1 with `cal.com`/`calendly.com` allowed as CTA hosts |
| Follow / waitlist | built, off | §1.2 | GTM-03 |
| Email sequences for followers | missing | §1.3 | GTM-01, GTM-17 (welcome + update) |
| SEO/AEO basics on the page | partial | meta tags only | GTM-19 |
| Page-visit analytics | missing by design | page.ts:23 | GTM-20 |
| Referral loop for the project's customers | missing | `via` codes credit posts and Foundmill sign-ups only | later: "share this project" on the public page with `via`; ask followers to forward |
| Feedback link (NETWORK F4, "Would you use this?") | missing | only a comment mention in `packages/shared/src/via.ts` | build F4: public three-tap form, answers as evidence in Customers |
| Post content plan | missing | §1.4 | GTM-12 |
| A way to read and answer replies | missing | GTM-04 | GTM-04 |
| Payment | missing | §1.6 | GTM-05 |

### 3.8 Compliance and safety in outreach

| Control | State | Where | Gap |
| --- | --- | --- | --- |
| Suppression list (unsubscribe, bounce, drop, spam report, "stop" in a reply, deletion request) | enforced in policy and again in the mail guard | 10-recipients.cedar; gateway platform-mail.ts step 4; ingest `/mail/events`, `/mail/unsubscribe`; `crm.entity.requestDeletion` | founder's own Resend/SendGrid events do not feed it (GTM-25) |
| One-click unsubscribe (RFC 8058) on every message | built | envelope, `platformUnsubscribeUrl`; also for `resend.send_mail` (`ctx.unsubscribeUrl`) | none found |
| Double opt-in for page signups | built | `contact_consents`, `/mail/confirm`; pending counts as untrusted recipient (pipeline.ts:505) | off in production (GTM-03) |
| Consent or lawful basis at send time | **not enforced** | no Cedar rule; `check_contact` is suppression only | GTM-14 |
| Per-recipient law (country, consumer vs business, quiet hours) | **prose only** | templates and house rule 6; `recipientCountry`, `localTimeAtRecipient` exist in the policy schema and no policy reads them | add at least: no marketing mail to `basis none`; record country on the contact when known |
| Sender identity and postal address (CAN-SPAM) | built | `project_postal_addresses`, refusal + founders' note | privacy of a home address (GTM-21) |
| Daily caps | built, fail closed without Redis | 50 per project, 2,000 per deployment, 100 / 1,000 follow confirmations; Buffer 20 posts a day | no lower cap for first-contact mail |
| Approval gates | built | augmented asks for everything outward; assisted asks for irreversible (all sends and posts); automated does not ask under €250 | automated + no consent rule = unattended marketing mail (GTM-14); approvals asked before availability (GTM-09) |
| Untrusted recipients (found in web, email or vendor results) | forbidden in every mode while remembered; the memory is a 12-hour TTL | `recipients.ts:135,239,265`, 10-recipients.cedar | lapses by time instead of by a founder's decision; no approval path (GTM-14, GTM-15) |
| Content screening | built for pages, posts, mail HTML | `communityScreenLocalFlags`, `checkPostDraft`, `platformMailContentProblem` | none found |
| AI disclosure | partial | house rule 3; plan-action footer | not in project mail footer (GTM-22) |
| Hard gates (pay, sign, accept terms) | built | `00-hard-gates.cedar`; Stripe and Shopify HG tools | none found |
| Scraping, CAPTCHAs | prose + no shell/browser for agents | house rule 5; `sdk-isolation.ts` | none found |
| Age | 18+ at sign-up for founders | 0100 | visitors of public pages and followers are not asked; consent text only |

### 3.9 Where role-specific skills would raise quality most

How skills work today: `craftSkills` on a template (`copywriting`, `deliverability`, `technical_seo`…) are rating attributes with training scenarios (`packages/agents/src/skills/blueprints/channels.ts`), not instructions. Instructions come only from (a) the template's six-line playbook, (b) the 20-entry library (`packages/agents/src/skill-library.ts`; marketing: `landing_page_copy`, `newsletter_writing`, `press_releases`; sales: `discovery_call_prep`, `objection_handling`, `proposal_writing`; finance: `pricing_analysis`; product: `interview_synthesis`) that a founder or the Chief of Staff must add by hand (`skills.manage`), (c) uploaded `SKILL.md` files (max 8 per agent, 20,000 chars each, 60,000 in all; `skill-files.ts:25-29`), and (d) one built-in "role" skill, design principles for code agents (`design-check.ts:79`). No marketing agent starts with any procedural skill. The one-shot generators (page, post, creative) take no skills at all: their prompts are fixed.

| Role or generator | Know-how it lacks today | Skill to map |
| --- | --- | --- |
| Product lead (page draft, `marketing_context`) | positioning (for whom, against what, why now), page structure that converts (outcome headline, problem, how it works, offer, proof, FAQ, one call to action), writing in the customer's words | product-marketing context, landing-page copy, offer design, copy editing |
| Distribution Strategist | choosing channels at zero budget by where the customer already is, launch sequencing (friends → communities → audience), a 30-day plan with founder tasks, what to measure before revenue | launch planning, marketing-plan, community marketing, channel selection without spend |
| channel_social / post drafts | hooks, one idea per post, per-network form, founder-voice building in public, reply etiquette, a weekly content matrix | post writing, hook writing, content matrix, voice builder, post scoring |
| channel_email_automation | welcome and update emails to followers, subject lines, one call to action, plain-text style, cadence, deliverability basics on a shared domain, when a message is transactional | email sequences, newsletter voice, lifecycle basics |
| channel_lead_generation (as founder-led outreach) | picking the first 20 people, warm-intro and cold message structure (who I am, why you, one question), follow-up rules, what not to automate | prospecting, cold email (as drafts for the founder), customer-research outreach |
| channel_seo / channel_geo (for the hosted page) | on-page audit of one page, title and description writing, schema.org choice, internal links between page, story and cards, llms.txt, what AI answers cite | page SEO audit, schema, AI-search readiness |
| channel_content | topic selection from customer questions, briefs, repurposing one piece into posts and an email | content strategy, content brief, repurposing |
| channel_pr | story angle from a real milestone, pitch structure, who to send to, community and newsletter mentions instead of wires | public relations for a first launch, directory submissions |
| Product Researcher | interview recruiting message, non-leading questions, synthesis into the marketing context | customer research, interview synthesis (exists) |
| Finance lead / Chief of Staff | first price, a paid pilot, pre-sale, simple pricing page | pricing, offers, paywall/pricing page |
| Composer / Chief of Staff as mentor | explaining one go-to-market idea per decision in plain words | mentor register (THESIS 6.4) |

Delivery: make these "role" skills attached by template key at hire (the mechanism exists: `AgentSkillPrompt` with `source: "role"`, rendered under `ROLE_SKILLS_PREAMBLE`), and let the one-shot request builders take a `skills` array too (`buildSystemPrompt` already accepts it; `buildChannelCreativeRequest` and the post/page builders pass none). Every skill file given to a product agent must pass `screenSkill` (house-rule and injection checks, `packages/agents/src/skill-files.ts`).

Two different things are both called skills, and the planner should keep them apart: (1) **product agent skills** (the library, uploads and role skills above), which reach founders' agents; (2) **Claude Code skills** under `.claude/skills/`, which guide the sessions that build Foundmill. During this audit the working tree changed under (2), not by this audit: `CLAUDE.md` is modified and uncommitted (the rule "Never install or run an outside Claude Code skill… before reading every file" is removed and replaced by "Outside Claude Code skills and plugins are used freely (founder, 2026-11-15)"), `.claude/skills/vet-third-party-skill/SKILL.md` is deleted, and new untracked folders appeared, among them `ai-seo`, `copy-editing`, `copywriting`, `cro`, `emails`, `launch`, `onboarding`, `pricing`, `product-marketing`, `schema`, `seo-agentic`, `seo-geo`, `seo-page`, `seo-schema`, `seo-technical`, `signup`, with `THIRD_PARTY_NOTICES.md`. Those are plausible source material for the role skills in the table, but nothing in `packages/agents` reads `.claude/skills/`; turning one into a product agent skill means rewriting it against the product's tools and rules (no web, no shell, founder approval, no invented proof), passing `screenSkill`, and respecting its license.

## 4. Roadmap items in this area

THESIS_REVIEW §13 (its own status line is dated Nov 11; verified against code on Nov 15):

| Item | Status | Evidence |
| --- | --- | --- |
| 0.3 A mock result can never read as real | **partial** | `simulated` + notice on every mock result (pipeline.ts:923); 409 for never-connected mock connectors on real projects (:757). Open: a `mock`-status row still runs the mock (GTM-16); `web` simulated for real projects; the done-when eval is not in CI (GTM-26); the engine's "launch" is outside the rule entirely (GTM-02) |
| 0.4 Stop fabricating channel results | **done going forward, not retroactively** | `mockResultsAllowed` (channel.ts:265). Done-when ("a non-demo business in production has no row with invented impressions or leads") is not met: 19 `lead.created` [prod], no cleanup (GTM-10) |
| 0.5 Remove grants nothing serves; Board shows only channels that act | **done** | `NOT_YET_SERVED` empty (grants.ts:289); grants contract test; `channelAvailability`. Side effect: production real projects see no agent-run channel |
| 0.7 Security prerequisites | partial | N2 (per-business SendGrid webhook secrets), N3 (Stripe) still open per THESIS:374 and DEPLOY.md:228 |
| 1.1 Project pages | **done** | 0077; `/p/[slug]`; `page.*`, `publicPage.*`. Missing for conversion: GTM-06, GTM-19, GTM-20 |
| 1.2 Agents write it | **done for new projects**, no backfill | businessFoundations.ts:92; GTM-07. `publish_page` as a tool was dropped on purpose (founder's press) |
| 1.3 First session ends on the link | **done for new projects** | `PAGE_READY_NOTE`, first-week item |
| 1.4 Real web research | **open** | DECISIONS.md:3532; no later entry |
| 1.5 Platform email, to users and from projects | **built, not switched on** [docs]; functionally incomplete | sender, guards, inbound, events, suppression, postal address all present; no audience send (GTM-01), replies dropped (GTM-04), plan action bypasses it (GTM-18) |
| 1.6 Waitlist form and payment link | **form built (dead while mail is off); payment link not started** | §1.2, §1.6. Done-when ("a test payment produces a Customer Update") unmet |
| 1.7 Platform-owned repository and preview | open | not in scope here; SEO/GEO depend on it for anyone without GitHub |
| 1.8 Outcome evals in CI | **open** | ci.yml has no eval job; only `evals-typed-reads.yml`, manual |
| 6.3 Founder tasks | open | GTM-11 |
| 6.7 Money defaults from the profile | open | `DEFAULT_BUDGET_MINOR.distribution = 150_000` (archetypes.ts:82) |

Work shipped Nov 12 to 15 in this area (PROGRESS.md:1721-2161), as found in code:

| Item | Status | Note |
| --- | --- | --- |
| Own-key connectors: openai, gemini, perplexity, serpapi, firecrawl, indexnow, apollo, vercel, posthog, resend | built, mock + real, **never called a vendor**, not recorded live | "AEO/GEO six" serve the founder's own site, not the hosted page (except IndexNow key file) |
| Buffer (#126) | built; social flips to `acts` when live + connected | drafts stop then (GTM-12); no `post.published` (GTM-13) |
| Runway, ElevenLabs voice (#109), ready-to-post kits (#125) | built on own keys, each asks first, `post_media` 0102 | costs money: outside the zero-budget path |
| Tap-to-post share panel, post drafts (#93) | **live and real** | the only working distribution path; thin (GTM-12) |
| Post-to-outcome attribution (#128, 0106) | built | credits follows today; replies and payments once they exist; payment code seam waits for the pay link |
| Follow form + Turnstile (#119) | built | GTM-03 |
| Quiz (#122, 0105) | built | needs real customers first |
| Showcase videos (#130, 0103) | built | Foundmill's own marketing of projects (house business only); not a founder tool |
| CAN-SPAM postal address (#111, 0101) | built | GTM-21 |

NETWORK.md wave 1 ("things that travel"):

| Feature | Status | Evidence |
| --- | --- | --- |
| Attribution and events (§11) | done | 0088 `attributions`, `signup.attributed`, `referral.arrived`, `share.opened`, `visit.attributed` |
| F2 the mark and the story | done | `tierShowsBuiltOnMark`, `/p/[slug]/story`, 0089 |
| F3 milestone cards, four early milestones, tap-to-post | done | `/m/[id]`, `awardPageLiveMilestone`, `awardFirstFollowerMilestone`, share panel |
| F4 feedback links ("Would you use this?") | **open** | no table, route or procedure; only a mention in `packages/shared/src/via.ts` |
| F5 invitations | done (#120) | out of this area |
| F6 credit for bringing people | **open** | `attributions` header: "nothing is paid from this table yet" (0088) |
| F7 "Share it" / posting | partial | share panel yes; "Latest" is wave 2 |

## 5. Interfaces a planner must know

### 5.1 Connector contract (`packages/connectors/src/contract.ts`)

- `Connector { key, displayName, phase, auth: { kind: "none"|"api_key"|"oauth"|"app", platformKey?, authorizationCode?, scopes? }, connectFields?, connect(businessId, input), healthcheck(integration, credential?), tools: McpToolDefinition[], callTool(name, args, ctx), webhooks?, rateLimits, costModel?, estimateCostMinor?, policyHints, mock }`.
- `PolicyHint { spendsMoney?, contactsThirdParty?, requiresKitMode?, irreversible?, hardGate? }`: the only thing Cedar reads about a tool. `hardGate` tools never run; they return a `HumanActionDescriptor` and become a founder task.
- `ToolContext { businessId, agentId, sessionId, integration, credential?, log, mode, onCredentialRefreshed?, platformMail?, unsubscribeUrl? }`. `platformMail` (sender, Reply-To, signed unsubscribe, custom args, `commercial`, `postalAddress`) is set only by the gateway.
- `ToolResult { ok, data?, error?, untrusted?, costMinor }`; the gateway adds `simulated: true` and `notice` in mock mode.
- Tools are declared with `defineTool({ name, description, input (zod), output, hints, untrusted?, untrustedRef?, facts?, humanAction?, annotations? })` (`src/define.ts`) and exported as `<key>Tools` from `connectors/<key>/tools.ts`.
- A new connector: folder `connectors/<key>/{index.ts, mock.ts, tools.ts, webhooks.ts?, fixtures/, <key>.test.ts}`, entry in `CONNECTOR_FACTORIES` (catalogue.ts), `GATEWAY_TOOLS` and `CAPABILITY_TOOLS` (grants.ts), `THIRD_PARTY_CONNECTOR_KEYS` (`packages/agents/src/connectors.ts`), and `CHANNEL_ACTING_TOOLS` + `ACTING_CONNECTOR_NAMES` if it makes a channel act. Own-key rule: `auth: { kind: "api_key" }`, no `platformKey`, throw `ConfigError` without `ctx.credential`.

### 5.2 Grants (`packages/connectors/src/grants.ts`)

- Templates grant capabilities (`grant("sendgrid", ["mail.send"])`); `CAPABILITY_TOOLS[connector][capability]` → tool names; a tool's own name or `*` also resolves.
- `resolveGrants(grants)` → `{ toolRefs: "connector:tool"[], servers, mcpTools: "mcp__<connector>__<tool>"[], builtinTools, unresolved }`; the orchestrator mints the session token and MCP servers from it. `servedGrants` is what screens show.
- `SERVICE_ONLY_CONNECTORS` (`openai_images`, `onesignal`, `platform_notify`, `elevenlabs`), `ROUTE_ONLY_TOOLS` (`github:download_archive`, `github:get_repository`, `runway:download_video`), `SERVICE_MEDIA_TOOLS`.
- `grantsActOutside(toolRefs)` keeps sessions with outward tools off the low-credit model.
- Contract: `apps/orchestrator/src/__tests__/grants-contract.test.ts` fails on any template grant that resolves to nothing; `NOT_YET_SERVED` must stay empty; planned grants live in `packages/agents/src/templates/PLANNED_GRANTS.md`.
- Channel templates: `defineChannelTemplate` (`templates/channels/_channel.ts`) = `PLATFORM_BASE_TOOLS` + `CHANNEL_PLATFORM_TOOLS` (`assets.request_approval`, `suppression.check`, `consent.check`, `budgets.read`, `kit.create_founder_task`, `crm.entities.search`) + quarantine + `init.connectors` + optional `platformTools`.

### 5.3 Channel availability

- `CHANNEL_ACTING_TOOLS` (pinned by `packages/connectors/src/__tests__/channel-availability.test.ts`), `channelAvailability(key, facts)`, `channelAvailabilityFacts(env, business, integrations)`; reasons `acts | by_tap | simulated_allowed | no_publisher | not_connected`.
- `packages/shared/src/channel-availability.ts`: `mockResultsAllowed(appEnv, isDemo)`, `CHANNELS_SHARED_BY_TAP = ["social"]`, `channelMayRun`, `channelTeamRuns`, `channelEngineMayRun`, sentences.
- api `apps/api/src/services/channel-availability.ts`: `channelRowsFor`, `assertChannelMayRun`, `assertChannelMayLaunch`, `runnableChannels`, `FOUNDER_POSTS_CHANNEL`. Orchestrator: `channelBlocked`, `channelEngineBlocked`.

### 5.4 Gateway

- Pipeline order and outcomes: `apps/gateway/src/pipeline.ts` `executeToolCall` (:286). Approvals: `queueApproval` (:629) writes `approvals` + `approval.requested` + the Inbox item; `repos.approvals.useGranted` lets the very same call run once after approval.
- Platform mail: `preparePlatformMail`, `recordPlatformMailSent`, `PLATFORM_MAIL_POLICY` ids (`platform-mail-off`, `-unconfigured`, `-own-sender`, `-content`, `-suppressed`, `-paused`, `-daily-cap`, `-ceiling`, `-simulated`, `-store`, and the postal-address refusal), Redis keys `pm:<businessId>:day`, `pm:all:day`, `pm:<id>:follow`, `pm:all:follow`.
- Service routes: see §2.3.

### 5.5 Ingest

- `POST /webhooks/:connector[/:businessId]` (stripe, sendgrid, sendgrid-inbound, github, shopify, dropbox_sign), mounted only for live connectors on staging/production.
- `/mail/inbound`, `/mail/events`, `GET|POST /mail/unsubscribe`, `/mail/confirm`, `/mail/notify/off`, `/mail/invitations/off` (404 while `PLATFORM_MAIL_DOMAIN` is unset).
- After commit: `followups.dispatch` (Customer Update narration, `journeyBuild`, playbooks), `followups.firstFollower` (post draft).

### 5.6 tRPC procedures

- `page.get | saveDraft | setSlug | publish | unpublish`; `publicPage.bySlug | storyBySlug | cardById | indexNowKeyFile | follow | visited` (`apps/api/src/routers/page.ts`).
- `pageQuiz.get | draft | save | approve | setLive`; `publicQuiz.bySlug | answer`.
- `share.opened` (`routers/share.ts`).
- `distribution.recommend`; `distribution.channels.list | enable | disable | move | budget | metrics`; `distribution.campaigns.list | get | create | update | setStatus`; `distribution.assets.list | approve | reject` (assets carry `sharePost` and `postOutcomes` for team posts).
- `business.startDistribution` (`routers/business.ts:294`, admin).
- `crm.search`; `crm.entity.lookup | list | count | get | update | merge | unmerge | create | requestDeletion`; `crm.notes.list | add`; `crm.roles.list | add | end | byRole`.
- `journey.get | list | forConversion | attribution | markViewed | ribbon | roundup | showMilestone | hideMilestone`.
- `integrations.list | platformMail | setPostalAddress | clearPostalAddress | connect | disconnect | health`; `keys.*`.
- `showcase.*` (house and project sides); `today.get` (`pageReady`, `postsReady`, `firstWeek`); `email.action.get | answer`, `email.pause` (Foundmill's own mail to founders).
- Not present: anything to write to followers, record a sale, create a pay link, read a reply, list page visits.

### 5.7 Events (declared in `packages/events/src/catalogue.ts`; list in `packages/shared/src/constants.ts:451-485`)

`page.published`, `page.unpublished`, `page.followed`, `mail.sent` (payload `simulated`, `messageRef`, `recipientHash`, `fromLocalPart`, `channelKey`), `lead.created` (mock only), `lead.replied` (`sentiment`, `summary`, `requestsMeeting`, `interactionId` that points at no row), `campaign.launched`, `channel.threshold_breached`, `distribution.started`, `signup.created`, `activation.reached`, `payment.received`, `customer.converted`, `share.opened`, `post.drafted`, `visit.attributed`, `post.outcome_attributed`, `milestone.shown | hidden`, `quiz.approved | published | unpublished`, `showcase.*`, `approval.requested | resolved`. Account-scoped: `signup.attributed`, `referral.arrived`. Real outcomes for the north star: `REAL_OUTCOME_EVENT_TYPES` in `packages/shared/src/morning-brief.ts:45`.

### 5.8 Tables (Drizzle in `packages/db/src/schema/`, SQL in `packages/db/migrations/`)

| Table | File / migration | Columns that matter |
| --- | --- | --- |
| `channels` | distribution.ts | `channel_key, enabled, line, fit, potential, recommended, why_md, scored_at, budget_minor, currency, kit_mode, owner_agent_id, engine_workflow_id` |
| `campaigns` | distribution.ts | `channel_id, name, goal, status (draft, pending_approval, scheduled, live, paused, ended), budget_minor, starts_at, ends_at, config` |
| `assets` | distribution.ts | `campaign_id (null for team posts), kind (email, post, ad, video, article, mailer, print, script), title, content_ref, body (≤ 8,000), approval_state (draft, pending, approved, rejected), authored_by_agent_id` |
| `channel_metrics` | distribution.ts | `channel_id, campaign_id, day, spend_minor, impressions, leads, signups, activations, customers, cpa_minor, source (measured or estimate)` |
| `suppression_list` | distribution.ts | `business_id (null = platform-wide), email_hash, address_hash, phone_hash, reason, scope, source` |
| `project_pages` + view `public_project_pages` | pages.ts / 0077, 0081, 0090 | `slug, draft jsonb, published jsonb, published_at, published_by, unpublished_at, updated_by` |
| `project_mail`, `retired_mail_local_parts` | mail.ts / 0078 | `local_part, status (active, paused), daily_cap` |
| `project_postal_addresses` | mail.ts / 0101 | `address, updated_by` (founders only by RLS) |
| `contact_consents` | consents.ts / 0079 | `entity_id, purpose, source, source_ref, page_id, consent_text, agreed_at, confirmed_at, confirmation_sent_at, confirmation_token_hash, withdrawn_at, post_link_id` |
| `post_links`, `post_attributions` | post-links.ts / 0106 | per-network `s.<code>`, `first_visited_at`; credit rows per outcome |
| `post_media` | post-media.ts / 0102 | generated clip and voiceover of a team post |
| `page_quizzes` + view `public_page_quizzes` | page-quizzes.ts / 0105 | |
| `entities`, `entity_roles`, `interactions`, `mentions` | crm.ts | `identifiers jsonb (email, domain…), source, lawful_basis, deletion_requested_at`; roles with `stage` |
| `touches`, `conversions`, `journeys`, `milestones`, `public_project_milestones` | journey.ts / 0089 | |
| `attributions` | 0088 | Foundmill sign-ups, account-scoped |
| `approvals` | governance.ts:133 | `connector_key, tool, args, reasons, outcome, by_kind, resolved_at, amount_minor` |
| `integrations`, `credentials` | governance.ts:18 | `status (connected, degraded, expired, disconnected, mock)` |
| `business_foundations` | foundations.ts | `vision jsonb, summary jsonb, status` (proposed home of `marketing_context`) |

### 5.9 Flags and variables

- `INTEGRATIONS_MODE`, `LIVE_CONNECTORS` (per service), `APP_ENV` (`mockResultsAllowed` is true for development and test; staging and production never simulate for a real project), `MODEL_MODE`.
- Mail: `PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_SIGNING_SECRET` (≥ 32 chars or gateway and ingest do not start), `PLATFORM_MAIL_INBOUND_TOKEN`, `PLATFORM_MAIL_EVENT_PUBLIC_KEY`, `PLATFORM_MAIL_DAILY_CAP` (50), `PLATFORM_MAIL_DAILY_CEILING` (2,000), `PLATFORM_NOTIFY_LOCAL_PART`, `PLATFORM_NOTIFY_DAILY_CEILING`, `SENDGRID_API_KEY` (gateway only), `INGEST_PUBLIC_URL`, `REDIS_URL` (gateway; sends refused without it), `APP_URL`, `APP_POSTAL_ADDRESS`, `NOTIFY_EMAIL`.
- Other: `TURNSTILE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_BILLING_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `SESSION_TOKEN_SECRET`.
- Code flags: `FLAGS` in `packages/config/src/flags.ts` (none gates pages, mail or channels); `tierShowsBuiltOnMark`; `LIMITS.approvalThresholdMinorDefault = 25000`; `TEAM_POST_CAPS = { perDay: 2, perWeek: 5 }`; `FIRST_WEEK_DAYS = 10`; `CHANNEL_WINDOW_DAYS = 35`; Temporal patches `foundations-project-page`, `approval-wait-poll`.
- Workflows: `channelEngine` (`engine:<channelId>`), `approvalWait` (`approval:<id>`), `postDraft` (`post-draft:<businessId>:<trigger>`), `postDraftMedia`, `businessFoundations`, `journeyBuild`, `playbook`; schedule `channel-engine-reconcile` every 15 minutes.

## 6. Tests and evals covering this area, and the gaps

Present (file names only; none were run in this audit):

- Connectors: one `<key>.test.ts` per connector plus `__tests__/{channel-availability, grants, registry, connect-fields, mock-isolation, simulate, webhook-mounts, facts, quarantine}.test.ts`; `platform_mail/{platform_mail, confirm}.test.ts`; `buffer.test.ts` (45 + 7 env-gated live).
- Gateway: `platform-mail.test.ts`, `follow-confirm.test.ts`, `byo-key-connectors-buffer.test.ts`, `post-media.test.ts`.
- Ingest: `platform-mail.test.ts`, `follow-confirm.test.ts`, `post-outcomes.test.ts`, `followups.test.ts`.
- api: `pages`, `page-follow`, `platform-mail`, `distribution`, `campaign-status`, `channel-availability`, `channel-window`, `plan-channel-engine`, `post-drafts`, `post-media`, `post-attribution`, `share-opened`, `page-quiz`, `showcase`, `crm`, `approvals`.
- Orchestrator: `activities.test.ts` (channel steps), `grants-contract.test.ts`.
- Shared: `project-page`, `channel-availability`, `platform-mail`, `post-draft`, `post-outcomes`, `share-targets`, `share-drafts`, `team-posts`, `first-week`, `morning-brief`, `via`, `indexnow`.
- db: RLS suites including `project-pages.test.ts`; journey package tests.
- Playwright (`apps/web/e2e`): `public-page`, `platform-mail`, `post-drafts`, `tap-to-post`, `page-quiz`, `project-story`, `milestones`, `attribution`, `crm`, `money-legal-distribution`, `first-days`, `showcase-consent`. The e2e stack runs no gateway and no ingest, so confirm, inbound and send are covered only by unit tests.
- Evals (`evals/src`): `channel-creative` (two cases: lifecycle email, print offline), `post-draft`, `post-media`, `project-page`, `page-quiz`, `showcase-script`, golden tasks (`channel_geo.connected_assistants`, `channel_lead_generation.own_apollo_account`, `channel_social.own_buffer_account`), injection suites. All skip without a model key; none runs in CI; several are recorded as never run live (PROGRESS.md:1550, 1952).

Gaps:

1. No test asserts that a non-demo campaign cannot be `live` without an outside result (GTM-02).
2. No end-to-end test from "follower confirmed" to "follower receives an update" (the path does not exist).
3. No test that the Follow form is hidden or honest while mail is off (GTM-03).
4. No test that an inbound reply's text is retrievable by the founder (GTM-04).
5. No test of ask-before-availability (the Buffer not-connected test uses automated mode; `byo-key-connectors-buffer.test.ts:131`).
6. No eval of a full channel session with tools ("given a goal and a not-connected or simulated tool, the agent reports nothing was done"): THESIS 0.3 and 1.8.
7. No eval grades specificity of marketing output against the business (only invention and format).
8. No contract test that every marketing request builder receives the same business context.
9. No live run of any own-key connector, Buffer included.
10. No production check script for residual mock data (GTM-10).

## 7. Anything surprising

1. **`launch_campaign` is not a tool and no agent calls it.** The 79 approvals were written by a workflow activity in the channel agent's name.
2. **`lead.created` has exactly one emitter, and it is the mock.** A real lead can never produce this event; real followers produce `page.followed`.
3. **`channel_metrics` has no real writer.** Half of the Distribution module (Channels, Attribution funnel, cost per customer, the weekly "learn" step, the benchmarks schedule) reads a table only the mock fills.
4. **A reply to a project's email is discarded** while the event says "body quarantined for the reader". The `interactionId` in `lead.replied` points at a row nobody writes.
5. **No tool gives an agent an email address**, by construction, so the Email engine could not email a follower even with everything switched on.
6. **Connecting Buffer turns the team's post drafts off** and the engine that replaces them publishes nothing.
7. **The founder is asked for approval before the gateway checks the action can run.**
8. **Agent schedules and triggers on every template are never read.** The lifecycle the Email template describes ("signup → activation → payment → retention") has no trigger.
9. **A real founder in production can still press Connect on a non-live connector** and receives a `mock` integration that then answers agents with simulated successes.
10. **The only channel engines a real project can run today are Print and Broadcast**, the two a first-timer with no money should never see.
11. **Channel agents cannot read the specification, the vision or the page.** The "business brief" in their system prompt is the team roster and the task list.
12. **The public page refuses an email address or phone number and has no link or button**, so a published project has no way to be contacted or bought from.
13. **`approval.resolved` is not written when an approval expires**, which is why the production ratio (79 asked, 14 resolved in total) looks like a stuck queue; it is a silently expiring one.
14. Three archetypes (b2b_saas, hardware, services) get no social agent and no social channel by default, although social by tap is the one channel every real project can use.
15. The default distribution budget is 1,500 a month in the business's currency and every channel example is a funded company, in a product whose stated user has "little money".
16. **The "untrusted recipient" rule expires after 12 quiet hours.** The comment says an address found in outside content is refused "until a founder approves"; in code it is refused until a Redis set times out.
17. **The repository's working tree was not clean by the end of this audit** (it was at the start): `CLAUDE.md` modified, `vet-third-party-skill` deleted, about twenty outside Claude Code skills added under `.claude/skills/`, all uncommitted and made by another session. This audit read the code at 04a0a509 and wrote nothing in the repository. See §3.9.
