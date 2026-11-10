---
name: foundmill-backend
description: Use whenever the Foundmill mobile app signs a person in, reads or changes business data, opens the live stream, handles an API error, formats money, or parses agent text. This is the only source of truth for how the app talks to Foundmill's backend. Never invent an endpoint, a field or a storage layer that is not described here.
---

# Foundmill backend contract for the mobile app

Foundmill already has a complete backend. The mobile app is a **second client** of it, next to the desktop web app at foundmill.com. The app owns no business data of its own. Everything a founder sees comes from, and goes back to, these three services:

| Service | URL (production) | What it is |
| --- | --- | --- |
| Supabase Auth | `https://sdruubitufjqibsjyxlc.supabase.co` | Sign-in only. Email magic link / one-time code. Never read or write tables through Supabase. |
| Foundmill API | `https://api.foundmill.com/trpc` | tRPC v11 over HTTP, **superjson** transformer. Every read and every change. |
| Foundmill stream | `wss://stream.foundmill.com` | WebSocket fan-out of live events. A signal to refetch, never a source of record. |

Keep these four values in `app.json` under `expo.extra` and read them from one `config.ts`: `FOUNDMILL_API_URL`, `FOUNDMILL_STREAM_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. They are public, not secrets. **There are no secrets in this app.** Do not create a Newly Backend for business data. Do not connect the Newly Supabase integration to Foundmill's Supabase project (it would try to deploy migrations and Edge Functions into a production database). The app needs only `@supabase/supabase-js` with the anon key for auth.

## 1. Sign-in

- The founder types an email. Call `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: "foundmill://auth/callback", shouldCreateUser: true } })`.
- Show a six-digit code screen. The email carries both a link and a code; both expire after 15 minutes and work once. Verify a typed code with `supabase.auth.verifyOtp({ email, token, type: "email" })`. If the person taps the link instead, the app opens on `foundmill://auth/callback?...`; hand the URL to `supabase.auth.exchangeCodeForSession` (PKCE `code`) or `verifyOtp` with the `token_hash` it carries.
- Send `x-foundmill-client: mobile/<app version> <ios|android>` on every API request (letters, digits, dots, slashes and dashes only). The API logs it so mobile traffic can be told apart; it grants nothing.
- Persist the session in `expo-secure-store` through a custom storage adapter passed to `createClient`. Turn on `autoRefreshToken` and `persistSession`; turn off `detectSessionInUrl` (we handle the deep link ourselves).
- The API wants `Authorization: Bearer <access_token>` on every call. Read the current token with `supabase.auth.getSession()` right before each request; the SDK refreshes it. Never cache a token for longer than one request.
- The API accepts only tokens whose email was proven by an inbox method (magic link, OTP, invite, recovery). Anonymous sessions are refused. There is no password, Google, Apple or GitHub sign-in on Foundmill. Do not add any. Do not add Newly Backend sign-in.
- **Invite list.** Some deployments admit only invited addresses. A protected call then fails with tRPC `FORBIDDEN` and `data.appCode === "not_invited"`, with `data.details.reason` either `not_listed` or `email_unconfirmed`. Show the "Not on the list yet" screen (copy in the product skill) and a Sign out action.
- **Sign out:** `supabase.auth.signOut()`, clear the MMKV cache, close the stream, go to the sign-in screen.
- **Re-auth.** Permanent deletion of a business needs a sign-in within the last 10 minutes. The API answers `PRECONDITION_FAILED` with `appCode: "reauth_required"`. The mobile app does not offer permanent deletion; it links to Settings on the web instead.

## 2. The tRPC client

Use `@trpc/client` 11 with `superjson`. The app has no access to the server's TypeScript types, so use the **untyped client** and address procedures by dotted path:

```ts
import { createTRPCUntypedClient, httpBatchLink, httpBatchStreamLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { fetch as expoFetch } from "expo/fetch"; // supports streamed bodies

const STREAMING = new Set(["agent.conversation.sendStream", "agent.conversation.inboxReplyStream", "idea.draft", "idea.askStream", "idea.logo.stream", "business.logo.stream"]);

export const api = createTRPCUntypedClient({
  links: [
    splitLink({
      condition: (op) => STREAMING.has(op.path),
      true: httpBatchStreamLink({ url: `${API_URL}/trpc`, transformer: superjson, headers: authHeaders, fetch: expoFetch as any, maxItems: 1 }),
      false: httpBatchLink({ url: `${API_URL}/trpc`, transformer: superjson, headers: authHeaders, maxItems: 10, maxURLLength: 8000 }),
    }),
  ],
});
// api.query("inbox.list", { businessId, tab: "respond", limit: 50 })
// api.mutation("inbox.decide", { businessId, itemId, chosenOption })
```

Wrap it in TanStack Query (`@tanstack/react-query`). Query keys are `[path, input]`. Timeouts: 45 s for a read, 4 minutes for a change (the composer can take a while to write a note); streams have no timeout, the person stops them.

**Every business-scoped call takes `businessId` in its input.** There is no tenant in the token. The person's businesses come from `founder.businesses.list`. Remember the last opened business id in MMKV (key `fm_last_business`).

### Errors

Every tRPC error carries `data.code` (tRPC code) and often `data.appCode` plus `data.details`. Map them like this, and never show a raw code to a founder:

| Situation | tRPC code / appCode | What the app does |
| --- | --- | --- |
| Not signed in, token expired | `UNAUTHORIZED` | Refresh the session once, retry once, then go to sign-in. |
| Not invited | `FORBIDDEN` + `not_invited` | "Not on the list yet" screen. |
| Not a member of that business | `FORBIDDEN` + `not_a_member` | Drop it from the switcher, open another business. |
| No access to a section | `FORBIDDEN`, message starts "You do not have read access to <section>" | Show the "No access to Finance. Ask an owner or admin if you need it." state for that screen. |
| Viewer or advisor tried to change something | `FORBIDDEN`, message "Your role (viewer) cannot perform …" | "As a viewer you can follow this business, but not change it." Hide write actions for viewers and advisors up front. |
| Rate limit | `TOO_MANY_REQUESTS` | Show the API's own sentence when it contains "Try again", else "That's a lot of requests in a short time. Wait a minute, then try again." |
| Credits used up, billing problem | `PAYMENT_REQUIRED` + `credits_exhausted` | A card: "The team has stopped: credits are used up." with "Top up" (opens the Stripe Checkout URL from `billing.topUp` in the system browser; owners only). |
| Continue not possible | `CONFLICT` + `continue_blocked` | Open the first item that needs an answer. |
| Team stopped (Stop all agents, revoked key, credits) | `CONFLICT` | "The team is stopped." with "Resume" for owners and admins (`business.resumeAgents`). |
| Plan tier limit | `appCode: "tier_limit"`, `details.limit` | "Your plan allows N businesses. Change it in Settings › Billing on the web." |
| Field conflict (slug taken) | `appCode: "conflict"`, `details.field` | Show under that field. |
| Validation | `BAD_REQUEST`, `details` is a list of `{path, message}` | Show the first message under its field. |
| Network | fetch failure | "You're offline. Showing what you last saw." banner; keep the cached screen. |

### Rate limits the app must respect

A shared ceiling for every model-backed call: per person 60 a minute, 600 an hour, 3,000 a day; per business 1,200 an hour. On top: `inbox.refresh` 10 a minute, free-text plans 10 a minute, `business.continue` 20 a minute, starting an agent session 30 an hour, `idea.commit` 10 an hour, checkout 10 an hour. Debounce every button that reaches a model. Pull-to-refresh refetches queries; it must **never** call `inbox.refresh` (that writes a new note and costs money).

### Idempotency

- `agent.conversation.send`, `sendStream`, `inboxReply`, `inboxReplyStream` take `clientMessageId` (8–100 chars). Generate a UUID per message and reuse it on retry; the server returns the same exchange.
- `plan.confirm` is idempotent. `inbox.decide` is not: disable the option buttons the moment one is pressed and show the pressed one in its loading state.

## 3. The live stream

Open one WebSocket per signed-in session, when the app is in the foreground. Close it when the app goes to the background for more than 30 seconds; reopen on foreground and **refetch Today and the Inbox before trusting it again**.

Handshake (the token never goes in the URL):

```ts
const protocols = ["foundmill.stream.v1", "foundmill.bearer." + base64url(accessToken)];
const ws = new WebSocket(STREAM_URL, protocols);
```

Frames the app sends: `{"t":"sub","ch":"ev:<businessId>"}`, `{"t":"unsub","ch":"..."}`, `{"t":"ping"}`, `{"t":"auth","token":"<fresh access token>"}` (send before the current token's `exp`; the server closes with code 4001 at expiry otherwise), `{"t":"focus","ch":"...","focused":true|false}`.

Frames the server sends: `{"ch":"ev:…","e":{…}}` for one event, an **array** of those for a burst, `{"t":"subscribed","ch"}` (only from here on is the channel live), `{"t":"pong"}`, `{"t":"authed","exp"}`, `{"t":"err","code":"bad_frame|invalid_channel|forbidden|unavailable|too_many_subscriptions|shutting_down","message"}`. Close codes: 4000 heartbeat timeout, 4001 unauthorized, 4003 account refused. Reconnect with exponential backoff from 1 s to 30 s, with jitter.

**Heartbeat, exactly.** The server pings every 30 s at the **WebSocket protocol level** (RFC 6455 ping frames); React Native's WebSocket answers those pongs by itself, so the app never sends a JSON pong. A socket that neither answered a protocol ping nor sent any frame by the next tick is closed with 4000. On top of that the app may send `{"t":"ping"}` every 20 s and expects `{"t":"pong"}` back; if no frame of any kind arrives within two intervals, close and reconnect.

Channels: `ev:<businessId>` (the business's events), `as:<sessionId>` (one agent session's live log; subscribe only while a "watch an agent work" screen is open), `u:<userId>` (the person's own LIVE social signals: `connection_requested`, `connection_changed`, `message_received`, `community_invited`, `moderation`; no content, just a nudge to refetch).

The event envelope on `ev:` is `{ id, businessId, type, occurredAt, actor: { kind, id }, entityIds, payload, narrated }`, sometimes with `redacted: [...]` when the person lacks access to a section. **There is no replay**: after any gap, refetch.

What the app does on each event type (refetch the named queries, show the named toast; never render the raw payload):

| Event type | Refetch | Toast or effect |
| --- | --- | --- |
| `inbox.item_created` | inbox.list (all tabs' counts), today.get | If `payload.blocksContinue`: a red toast "Needs your answer: <subject>". Else a quiet toast with the sender. Haptic light. |
| `inbox.item_updated` | inbox.list, inbox.get(item) | none |
| `decision.made` | inbox.list, inbox.get | none (this device or another just answered) |
| `cycle.started`, `cycle.run_started` | cycle.status | Continue button enters its processing state |
| `cycle.completed`, `cycle.run_ended` | today.get, inbox.list, cycle.status | One ring pulse on Continue; "The team finished a round · N notes" |
| `task.started`, `task.progressed`, `task.completed`, `task.blocked` | dev.tasks.list, team.agents.list, department cards | Live feed row; `task.blocked` with `approvalId` is also an Inbox item |
| `approval.requested` | inbox.list, team.approvals.pending | Red toast "Needs your go-ahead: <summary>" |
| `approval.resolved` | team.approvals.pending | none |
| `customer.converted` | journey.list, journey.ribbon, today.get | **Gold** toast "New customer: <name>" with "Watch the update". Haptic success. |
| `payment.received`, `signup.created`, `activation.reached` | journey.ribbon, finance.overview | none (the converted event carries the moment) |
| `agent.health_changed` | team.agents.list, agent.profile.get | If `to === "injured"`: amber toast "<Agent> is down · expected back <time>" |
| `runway.threshold_crossed` | finance.overview, today.get | Amber or red toast with the sentence from Today's Health panel |
| `credential.expiring` | integrations.list | Amber toast |
| `goal.proposed`, `goal.approved`, `goal.achieved`, `goal.change_requested` | goal.current, today.get | `goal.achieved`: gold toast "Goal reached" |
| `holiday.started`, `holiday.ended` | business.get, cycle.continueState | Continue switches to or from its vacation state |
| `mode.changed`, `business.updated`, `autopilot.changed` | business.get | none |
| `membership.changed` | founder.businesses.list | resubscribe |
| `training.completed`, `agent.promoted` | agent.profile.get, agent.training.results | "Training finished for <Agent>" |
| `pr.merged`, `deploy.succeeded` | dev.tasks.list, dev.code.list | Quiet toast |
| `conversation.message_posted` | agent.conversation.get(subject) | Append to the open thread |
| anything else | nothing | nothing |

On `as:<sessionId>` the event kinds are `tool_call`, `stdout`, `file_changed`, `test_result`, `phase_changed`, `progress`, `note`. Render them as a scrolling log on the ink surface (see the design skill); never try to execute or interpret them.

## 4. The procedures the app uses

Q = query (GET), M = mutation (POST). Every call below also takes `businessId` unless it is marked **P** (person-level, no business). Field names are exact.

### Person and businesses (P)

- `founder.businesses.list` Q P → the businesses the person belongs to, with role, logo and `isDemo`.
- `founder.profile.get` Q P, `founder.profile.update` M P.
- `founder.preferences.get` Q P → `{ date, time }`; `founder.preferences.guidance` Q P → `{ guidance, textSize, explainersSeen, toursDone, checklistDismissedAt, anthropomorphicAgents, agentStyle }`; `founder.preferences.notifications` Q P → `{ notifications: { decision, approval, customer, agent_down, runway, run_finished, goal }, hideAmountsOnLockScreen }` (every kind true until turned off).
- `founder.preferences.update` M P takes any of `date`, `time`, `guidance`, `textSize`, `anthropomorphicAgents`, `agentStyle`, `notifications` (a partial map of the kinds above to booleans; kinds merge over what is stored), `hideAmountsOnLockScreen`, and answers the whole preferences row.
- `founder.devices.list` Q P → `[{ id, platform, provider, token, appVersion, lastSeenAt, createdAt }]`, newest first; `founder.devices.register` M P `{ platform: "ios" | "android", provider: "onesignal", token, appVersion }` → `{ device, created }` (call after sign-in and on every launch; a token another account held on this phone moves to this one); `founder.devices.unregister` M P `{ token }` → `{ removed }` (call on sign-out).
- `business.example.get` Q P, `business.example.open` M P (joins the read-only example business), `business.example.leave` M P.
- `business.listArchived` Q P.

### The business

- `business.get` Q → business (name, slug, currency, `gameMode` live|personal, `businessMode` augmented|assisted|automated, `spendCapMinor`, kit colors `kitPrimary` `kitSecondary`, `agentsStoppedAt`, `agentsStoppedReason`, `timeZone`, `isDemo`, autopilot fields, `distributionStartedAt`), membership (role, `sectionPermissions`, `source` invite|founder|example), logo metadata.
- `business.logo.get` Q {version?} → logo image data.
- `business.continue` M (write) → starts a run of cycles. `business.pauseCycle` M, `business.resumeCycle` M.
- `business.stopAllAgents` M (admin) {reason}, `business.resumeAgents` M (admin).
- `business.startHoliday` M (admin) {until, authority[], budgetCeilingMinor}, `business.endHoliday` M (admin) {reason}.
- `business.setBusinessMode` M (admin) {businessMode}, `business.setSpendCap` M (admin) {spendCapMinor}.
- `business.autopilot.get` Q, `business.autopilot.set` M (admin).
- `cycle.status` Q, `cycle.history` Q {limit}.
- `cycle.continueState` Q → exactly one of `{ kind: "idle" }`, `{ kind: "blocked", count }` (N notes hold Continue: the pill reads "Respond · N" and opens the Inbox's Needs you), `{ kind: "processing", run?: boolean }` (a cycle or a run is working: dark slab, orbiting arc, "Pause"), `{ kind: "matchday", journeyId: string | null, itemId: string }` (a customer was won: gold "Watch the update", opens the Customer Update when `journeyId` is set, else the note), `{ kind: "holiday", until: string | null, untilLabel: string | null }` (vacation: neutral "Come back", opens the vacation sheet; admins end it with `business.endHoliday`). In the example business the slot reads "Start your own" and opens Start.

### Today

- `today.get` Q → `{ today: "2026-11-08", needsYou: { items, total } | null, week: { done: string[], next: string[] } | null, spend: { aiUsage: { amountMinor, currency: "USD" }, channel: { amountMinor, currency, otherCurrencies: [{ currency, amountMinor }] } } | null, chiefOfStaff: { id, name } | null }`. A null section means the reader lacks that section's access (Inbox, Development, Finance): hide the panel. Each `needsYou.items[]` row: `{ id, type, subject, createdAt, blocksContinue, kind: "approval" | "signoff" | "goal" | "decision" | "warning" | "go_ahead", fromAgent: { id, name, role, personaKey, layer } | null, quickOption: { id, label } | null }`. A `quickOption` is the one option a single tap may choose: send `inbox.decide { itemId: id, chosenOption: quickOption.id }`; without one, open the note.
- Health tiles: Cash and Runway come from `finance.overview` (`cash: { amountMinor, currency, accounts, asOf }`, `runway: { months | null, label: "Estimate", warnings }`, plus `burn`, `revenue`, `payingCustomers: { count, months }`); null months reads "Not known yet" (or "No limit" when the business is cash-flow positive, which `burn` tells). Customers this week comes from the last seven business-wide `journey.ribbon().rows` (`departmentId === null`). AI usage and channel spend come from `today.get().spend`.
- `goal.current` Q → `{ active, proposed, canDecide }`; `goal.ensure` M (call once when Today opens) → the same plus `proposedNow`, `achievedNow`. A goal view: `{ id, revision, status, sentence, kind, target, currency, dueOn, reason, startValue, approvedAt, achievedAt, inboxItemId, proposedBy: { id, name } | null, progress: { current, pace } | null }`; `pace` is the ready-made line ("4 of 10 so far, 38 days left: on pace (Forecast)."). `goal.approve` M {goalId}, `goal.requestChange` M {goalId, notes}; both need `canDecide`.

### Inbox

- `inbox.list` Q {tab: all|respond|customers|updates|messages|archive, limit ≤ 500, cursor?, fromAgentId?, type?} → `{ items, nextCursor, counts, blocking, continueState }`. `counts` comes only on the first page. Item fields: `id`, `type` (decision|customer_won|warning|update|milestone|report|human_message), `fromAgentId`, `fromAgent` (name, role, persona, department), `subject`, `preview`, `createdAt`, `state` (unread|read|answered|archived), `blocksContinue`, `entityIds`, `redacted?`.
- `inbox.get` Q {itemId} → the full note: `bodyMd` (markdown with `[[ent:uuid|Name]]` mentions), `statusStrip` (up to four metric tiles `{label, value, caption, estimate?}`), `exhibit` `{kind: chart|diagram|entity_card|table|diff|agent_tile|none, ...}`, `decision` `{options: [{id, label, recommended?, consequence?, because?, cost?, reversible?}], expiresAt?}`, `plan?`, `confirmation?` (a plan waiting for `plan.confirm`), `approval?`, `signoff?`, `answer?` (what was decided and by whom).
- `inbox.decide` M {itemId, chosenOption?: optionId, freeText?: string}. Free text is compiled into a plan; the response says whether it ran or is `pending_confirmation` (then show the plan and a Confirm button → `plan.confirm` {planId}). The API refuses questions and greetings as decisions; send those through `agent.conversation.inboxReply` instead.
- `inbox.markRead` M {itemId}. Call when a note has been on screen for 1 s.
- `inbox.archive` M {itemId}. Swipe action on informational notes.
- `inbox.refresh` M → exactly one new note. Only behind the explicit "Ask for an update" button. Never on pull-to-refresh.
- `plan.preview` M {text, inboxItemId?}, `plan.confirm` M {planId}, `plan.status` Q {planId}, `plan.list` Q.

### Talking to agents

- `agent.conversation.get` Q {subject: {kind: inbox_item|agent|task, id}} → `{ subject, thread, messages, persona, starters, quickReplies }`. A message: `{ id, threadId, author: "founder" | "agent", bubbles: string[] (markdown with mentions; one bubble per paragraph, render each through EntityText), at, reaction: none|noted|thinking|concerned|pleased, quickReplies, chosenQuickReplyId, handOff: { instruction, gated } | null, planId, planStatus, clientMessageId, state }`. A quick reply: `{ id, kind: ask|acknowledge|hand_off|choose_option|decline|write, label, optionId? }`. The persona: `{ id, name, role, avatarSeed, personaKey, layer, colourToken, status, presence: working|available|away|down, presenceLabel ("In a session · Carton artwork proof round 2", "Available", "Away · paused", "Down"), currentTask, voice, thinkingLine, nudges, isAgent: true }`. `quickReplies` on the view is the chip row to show now (the latest agent message's, or the starters). A note and its agent are two different subjects with two different threads.
- `agent.conversation.sendStream` M (stream) {subject, text? or quickReplyId? (+ optionId when the chip names one), clientMessageId} yields `{ type: "bubble", … }` events with the reply's words as the model writes them, possibly `{ type: "reset" }`, then `{ type: "done", result }`. **Only a reply the model writes streams**: an acknowledgment chip, a decision chip, a staged hand-off or a repeated message arrives as one `done` with no bubble events, which is correct. `result`: `{ thread, messages (the founder's message then the reply), quickReplies, decision: DecideItemResult | null, handOff: { messageId, instruction, summary, planId, plan, requiresConfirmation, hardGates } | null }`. Fall back to `agent.conversation.send` (same input, `result` at once) if the stream link fails.
- `agent.conversation.handOff` M {messageId} → stages a plan; show it; `plan.confirm` runs it.
- `agent.conversation.inboxReplyStream` M (stream) {itemId, text, clientMessageId} for what a founder types on a note: a question or a remark becomes a conversation turn (`route: "conversation"` plus the send result), an instruction on a note that decides by text becomes a decision (`route: "decision", decision: DecideItemResult`). `inboxReply` is the non-streamed twin.
- `inbox.decide` and the chips' decisions answer a `DecideItemResult`: `{ item, decision, plan: { ...plan, summaryMd, actions: [{ type, params, status }] }, evaluations, requiresConfirmation, executed, deferred, denied, dispatch, followUp }`. When `requiresConfirmation` is true the plan waits as `pending_confirmation` until `plan.confirm { planId }` → `{ plan, exec, item, alreadyConfirmed }`. Plan statuses: pending_confirmation | executing | done | failed.
- `dev.tasks.shout` M {taskId?, preset?, text ≤ 280} is a **Nudge** into a running session. `preset` accepts only the server's five fixed strings ("Focus on tests", "Simplify", "Ask before schema changes", "Match the design system", "Hurry up"); anything else is a 400. The chips the app shows come from the conversation's `persona.nudges`, so **send a chosen chip as `text`**, never as `preset`. Without `taskId` the nudge reaches every running task.

### Team and agents

- `team.agents.list` Q {departmentId?, includeArchived?} → agent rows: the stored agent (`id`, `name`, `role`, `agentType`, `layer`, `personaKey`, `departmentIds`, `lineManagerId`, `status` healthy|degraded|failing|injured|paused|idle, `pausedReason`, `modelKey`, `wageCapMinor`), plus `departments: [{ id, name, colourToken }]`, `currentTask` (the running task row with `title`, `founderTitle`, `progress`, `phase`; null when idle), `skills`, `rating20` (the 1–20 mean, one decimal; stars = rating20 / 4 in halves), `wage: { costMinor, currency: "USD", capMinor, period, label: "Estimate" }`, `chiefOfStaff: boolean`, `tier` (chief|lead|specialist|background), `tools`, `form` (the last five outcomes), `latestUpdate`, `health: { lastHeartbeatAt, errorRate, loopDetected, credentialExpired, rateLimited, expectedReturnAt, reason }`. There is no `presence` field. `currentTask` is the agent's open task in any of the statuses `running`, `paused`, `blocked` or `review`, so read `currentTask.status`: `running` is "Working", `paused` "Paused", `blocked` "Waiting for you" when an approval or go-ahead is pending (link the note) else "Blocked", `review` "In review"; only `running` lights Live now. "Down" means `status === "injured"` with `health.expectedReturnAt`. The task's `phase` (planning|implementing|testing|review|merge|done) and `progress` (0–1) are on the task row and move with `task.progressed` events; a session's own `phase_changed` stream events are the same phases. A short session may end without ever reporting a phase: "Phase not reported yet" is then correct, not a bug. Portraits: `GET /personas/<style>/<personaKey>`. Hide `background` tier agents everywhere except the "Background helpers" sheet.
- `agent.profile.get` Q {agentId, period?} → `{ agent (the stored agent: name, role, agentType, layer, status, personaKey, modelKey, wageCapMinor, expectedReturnAt, lineManagerId…), current (the live **version**: instructions and tools, not a task), versions, skills, traits, metrics (one row per active day), recent { days: 30, tasksDone, sessions, failed, successRate, reviewFindings, approvalsRejected, costMinor, currency: "USD", label: "Estimate" }, trainingRuns, sessions (each with outcome, startedAt, cost and `task: { id, title, status } | null`; a session itself has no status), wage { costMinor, currency: "USD", capMinor?, period, label }, departments [{ id, name, colourToken }], lineManager, reportsToOwner, stars { current, potential } (1–5), neverDoes, route, modelLock }`. A skill: `{ skillKey, name (the catalogue name; "Prioritization", "Test automation"), group: "craft" | "judgement" | "execution" (the enum keeps the British spelling; the heading a founder reads is "Judgment"), displayed (1–20), tested, proven, potential, source }`. Nudge presets are **not** on the profile: they come with the conversation's `persona.nudges`. The current task comes from `team.agents.list` rows, not from the profile. There is no procedure that pauses or resumes one agent (only a task, the cycle, or every agent); do not offer one.
- `agent.profile.update` M {agentId, patch} (name, instructions draft).
- `agent.training.saveDraft` M, `agent.training.estimate` Q, `agent.training.run` M {agentId, versionId}, `agent.training.results` Q {runId}, `agent.training.promote` M {runId}, `agent.training.discard` M {runId}, `agent.training.rollback` M {agentId}.
- `agent.model.compare` Q, `agent.model.set` M {agentId, modelKey: opus|sonnet|haiku, applyScope: this|type|all}.
- `team.agents.catalogue` Q {family?}, `team.agents.hire` M {templateKey, departmentId, name?, skills}, `team.agents.release` M {agentId}, `team.agents.clone` M, `team.agents.loan` M.
- `team.humans.list` Q; `team.humans.invite` M (admin) {email, role, sectionPermissions} (adds an existing account; no email is sent, tell the person that).
- `team.approvals.pending` Q {forMe?}, `team.approvals.resolve` M {approvalId, outcome: approved|rejected, note?}.
- `team.responsibilities.get` Q, `team.responsibilities.set` M (admin).
- Persona portraits are public images: `GET https://api.foundmill.com/personas/<style>/<key>`. Cache them with `expo-image`.

### Departments and their screens

- `department.list` Q {includeHidden?, includeArchived?} → rows in the founder's order (`position` ascending): `{ id, name, slug, icon, colourToken: "dept-1"…"dept-8" (British spelling in the field name), position, leadAgentId, moduleKeys: string[], budgetMinor: number | null, currency, hidden, shortcut, lead: { id, name, role, status, modelKey, avatarSeed, personaKey, layer, tier } | null, squad: [the same shape, every agent of the department; the field name is internal, the word a founder reads is "team"], tabs: [{ id, slug, title, position }] }`. There is no `order`, `budget`, `unreadNotes` or tab `kind`. "2 of 3 working" = the department's agents (join `squad[].id` with `team.agents.list`) whose `currentTask.status === "running"`, over the agents whose `tier !== "background"`. "Working on now" is that agent's `currentTask.founderTitle ?? currentTask.title`. "Next" is the first task of `dev.tasks.list { departmentId, status: ["ready", "planned"], limit: 1 }`, else "Nothing planned yet". The headline metric and its sparkline come from the `journey.ribbon` rows whose `departmentId` is this department (tasks done in the last 7 days; the last 14 days as the sparkline). The health pill is the worst `status` among the department's agents (injured → "Down", failing/degraded → "Needs attention", else "Healthy"). **Departments are data**: never hard-code their names; render whatever comes back, in order.
- `screen.get` Q {departmentId, tabSlug} → `{ screen: { id, departmentId, tabSlug, title, position, layout: { widgets: [{ key, x, y, w, h, settings, i? }] } }, department, tabs }`. **Every default department tab holds exactly one widget whose key is `module:<module>/<tabSlug>`** (for example `module:product/vision`, `module:distribution/formation`, `module:finance/overview`): that key means "render this module's native screen" (the product skill's module screens, built in prompt 11 B and C), never a dashboard widget. The dashboard widget keys (`status_strip`, `live_feed`, `squad_pulse`, `roadmap_timeline`, `revenue_customers`, `cash_runway`, `funnel`, `channel_form_guide`, `journey_ribbon`, `trophy_cabinet`, `inbox_preview`, `league_table`, `agent_of_the_week`, `department_card`, `community_feed`, `first_week_checklist`, `custom_metric`) appear only on tabs a founder customized on the web; render the ones the app supports in `y` then `x` order. A module key the app has no native screen for yet, and any other key, shows "Open on the web for this view" with a link to `https://foundmill.com/b/<businessId>/d/<department slug>/<tabSlug>` (the web routes departments by `slug`, not id).
- Module tab slugs and the web's names for them: product `vision`, `specification`, `roadmap`, `changes`, `sources`, `research`; development `training-ground` ("Working now"), `plan` ("Work list"), `pull-requests` ("What changed"), `code`, `environments` ("Live product"), `specialists`; distribution `formation` ("Board"), `channels`, `leads`, `campaigns`, `creative`, `attribution`; finance `overview`, `pnl` ("Profit and loss"), `cash`, `runway`, `wage-bill` ("Payroll"), `cap-table`; team `squad` ("Agents"), `staff`, `responsibilities`, `health`, `hierarchy`, `recruitment`; legal `entity` ("Company"), `incorporate`, `compliance`, `contracts`, `ip`, `policies`, `regulatory`. Show the quoted founder names when the stored `title` is still the module default. **Tab order and visibility**: show each module's default pair first (`specification`+`roadmap`, `pull-requests`+`environments`, `leads`+`campaigns`, `overview`+`runway`, `squad`+`recruitment`, `entity`+`compliance`) and the rest behind a "More" menu; hide `code`, `health` and `hierarchy` entirely unless `founder.preferences.guidance().builderView` is true.
- **Product** (module screens): `product.foundations.get` Q → `{ status: none|pending|drafting|ready|failed, door, attempt, startedAt, finishedAt, error, vision: { statement, forWhom, problem, whyNow, principles: [{ title, detail }], northStar: { metric, definition, target, label } } | null, progress, summary, stale }` (the Vision tab is `vision`; there is no `product.vision` procedure). `product.signoff.get` Q → `{ stage, spec, roadmap, readyToSell }`, each a round `{ id, kind, round, status, requestedAt, decidedAt, decidedBy, notes, specVersion, inboxItemId } | null`; `product.signoff.decide` M {kind: "spec" | "roadmap", decision: "approve" | "request_changes", notes? (required words for changes)}. `product.spec.get` Q {section?} → `{ blocks: [{ id, section, position, content (a TipTap JSON doc: `{ type: "doc", content: [...] }`, render paragraphs, headings and bullet lists; never show raw JSON), sources, pinned, version, authoredByKind }], latestVersion, versionCount }`. `product.roadmap.list` Q {horizon?: now|next|later, status?} → `{ items: [{ id, title, descriptionMd, horizon, targetStart, targetEnd, confidence (1–5), ownerRef, status, position, tasks: [{ id, title, status, progress }] }], dependencies }`. `product.proposals.list` Q {status?: open|accepted|partially_accepted|rejected, limit, cursor} → page of `{ id, title, status, rationaleMd, severity: low|normal|critical, proposedByAgentId, inboxItemId, resolvedAt, createdAt }`; `product.proposals.get` {proposalId} adds `hunks: [{ id, specBlockId, roadmapItemId, base, ours, theirs, decision: pending|accepted|rejected|edited, position }]` and `publishedVersion`; `product.proposals.decideHunk` M {hunkId, decision}, `product.proposals.acceptAll` M {proposalId}, `product.proposals.reject` M {proposalId}.
- **Development**: `dev.tasks.list` Q {status?, assigneeAgentId?, kind?, departmentId?, roadmapItemId?, limit, cursor} → `{ items, nextCursor, edges, counts }`; `dev.tasks.get`, `dev.tasks.pause|resume|stop|upgradeModel|reassign`, `dev.sessions.list` {agentId?, taskId?, openOnly?, limit}, `dev.sessions.replay` {sessionId, after?, kinds?}, `dev.code.list`.
- **Distribution**: `distribution.channels.list` Q → `{ channels: [{ id, channelKey (one of lead_generation, email_automation, seo, geo, content, social, paid_ads, influencer, affiliate, direct_mail, print, broadcast, outdoor, pr, events), enabled, line, fit (1–20), potential, recommended, whyMd, scoredAt, budgetMinor, currency, kitMode, ownerAgentId, meta: { label, line, coreMetric, kitModeByDefault }, form: { spendMinor, impressions, leads, signups, activations, customers, days, estimate } | null }], lines: Record<line, channelKey[]>, blended }`. **The `line` enum keeps internal names; the words a founder reads are** `attack` → "Acquisition", `midfield` → "Engagement", `defence` → "Organic", `wings` → "Offline". Cost to win a customer = `form.spendMinor / form.customers` when customers > 0, labeled Estimate when `form.estimate`. `distribution.channels.enable|disable` M {channelKey}, `distribution.channels.budget` M {channelId, budgetMinor, currency?}, `distribution.channels.metrics` Q {channelId?, from?, to?} (daily rows for the five-week trend), `distribution.campaigns.list` Q {channelId?, status?: draft|pending_approval|scheduled|live|paused|ended, limit, cursor} → page of `{ id, channelId, name, goal, status, budgetMinor, currency, startsAt, endsAt }`, `distribution.assets.list` Q {campaignId?, approvalState?: draft|pending|approved|rejected} → `[{ id, campaignId, kind: email|post|ad|video|article|mailer|print|script, title, body, approvalState, authoredByAgentId }]`, `distribution.assets.approve|reject` M {assetId}, `distribution.recommend` M (admin, model call), `journey.attribution` Q for the Attribution tab, `business.startDistribution` M (admin) to start distribution once the product is signed off (`business.get().distributionStartedAt` is null until then).
- **Finance**: `finance.overview` Q → `{ cash: { amountMinor, currency, accounts, asOf, label }, burn: { netBurnMinor, …, label: "Estimate", definition }, runway: { months | null, label: "Estimate", warnings, blocksContinue }, revenue: { monthly: [...], basis: "cash", label, recurring }, customers30d, payingCustomers: { count, months, from, to }, forecasts }` (the app writes the one opening sentence from these: "Cash £X, burning £Y a month, N months of runway (Estimate)"); `finance.pnl` Q {from?, to?} → `{ monthly, categories, snapshots, source, label }`; `finance.accounts.list` Q {includeArchived?}; `finance.transactions.list` Q {accountId?, from?, to?, q?, limit, cursor}; `finance.forecast.list` Q; `finance.wages` Q {period?} → `{ period, label: "Estimate", currency: "USD", rows: [{ agentId, costMinor, …, wageCapMinor, wageCapCurrency }], totalMinor }` (Payroll); `finance.capTable.get` Q → `{ securities, entries, summary: { byHolder: [{ holderEntityId, displayName, fullyDilutedPct }], … } }`.
- **Legal**: `legal.entity.*`, `legal.incorporate.*`, `legal.compliance.list` {pendingOnly, days}, `legal.contracts.list|get`, `legal.policies.*`, `legal.regulatory.list`, `legal.recommend` M (admin). Every legal recommendation is captioned "Information, not legal or tax advice."

### Journey, wins, milestones, chapters

- `journey.ribbon` Q {from?, to?, departmentId?, slim?} (days as "2026-11-08"; default range the last year) → `{ rows, conversions, conversionCount, milestones, chapters, kickoff, firstDay, today, forecastLabel: "Forecast", redacted }`. `rows` are per-department daily rows, one per day **and** department, plus one business-wide row per day whose `departmentId` is null: `{ day, departmentId, agentHours, tasksDone, spendMinor, revenueMinor, signups, activations, payments, decisions }`. For business totals (the revenue line, Customers this week) use only the rows with `departmentId === null`; Customers this week is the sum of their `payments` over the last seven days. `conversions` (empty with `slim: true`) are the first-time wins in the range: `{ id, kind: signup|activation|payment, amountMinor, currency, occurredAt, entityId, entityName (null behind the CRM wall), journeyId (null until the update exists) }`. **Never read the hero's revenue from `conversions`**: it is the sum of `revenueMinor` over the business-wide rows of the range, and the delta pill compares it with the same sum over the window before (a second `slim: true` call with `from`/`to` shifted back). A business with no revenue yet reads "No revenue yet", not "£0.00".
- `milestones` rows: `{ id, kind: customer|revenue|release|decision|incorporation|funding|launch|trophy, label, achievedAt, ref: Record<string, unknown> | null, visibility }`. **The trophy key lives inside `ref`**: `ref.trophyKey` is one of `customer_1`, `customer_10`, `customer_100`, `customer_1000`, `mrr_1k`, `mrr_10k`, `mrr_100k`, `first_enterprise_contract` (the eight Milestones tiles). Draw a gold ring pin and light the tile when `ref.trophyKey` is set; every other milestone is an ordinary blue pin. `ref.estimate === true` means the MRR behind it is an Estimate (label it). `ref.conversionId` links a customer milestone to its win (`journey.forConversion { conversionId }` → `{ journeyId | null }` opens the update).
- `chapters` cover the business's whole life by quarter **plus two quarters ahead**: `{ id: "2026-Q4", index, year, quarter, startsOn, endsOn, status: past|current|future, title (null until the composer writes it), provisionalTitle (always set: show it when `title` is null), summary: { days, agentHours, tasksDone, spendMinor, revenueMinor, signups, activations, payments, decisions, milestoneLabels[] } }`. The two `future` chapters are expected and come last: show them dimmed as "Ahead" cards with no numbers, never first in the carousel, and open the carousel on the `current` chapter.
- `journey.list` Q {limit ≤ 100, cursor?, from?, to?, matchdayLevel?: friendly|league|cup (or an array), kind?, unviewedOnly?, orderBy?: created|converted} → `{ items, nextCursor }`. **An item is the journeys row with its conversion nested**: `{ id, conversionId, touchIds, weights, xcSeries, commentary (narrated lines, may be empty), agents: [{ agentId, name, role, departmentId, contribution, touchIds, rating (1–10) }], matchdayLevel: friendly|league|cup (display **Brief / Standard / Featured**), attributionModel, xcModelSource, viewedAt, createdAt, consent, partialJourney, conversion: { id, kind: signup|activation|payment, amountMinor, currency, occurredAt, entityId, firstPayment } }`. There is no top-level `customer`, `amount` or `kind`: the kind and the amount are `item.conversion.kind` and `item.conversion.amountMinor`; the standout agent of a card is the `agents` entry with the highest `rating`. The customer's name is not on the list row: resolve `conversion.entityId` through `crm.entity.lookup { entityIds }` in one batch per page (null entityId or a walled CRM reads "A customer").
- `journey.get` Q {journeyId} → the list row plus `entity: { id, kind, displayName } | null`, `touches[]` (the stored touch rows), `journeyTouches[]` (the same touches as the player reads them), `journey` (the record: `channels[]`, `captain` { touchId, channelKey | null, agentId | null, weight } | null = the **Lead channel** (name it through `channels[]` / `distribution.channels.list`), `playerOfTheMatch` (an agentId) = the **Standout agent**, `attributionModel`, `partialJourney`, `nthOfKind`, `fullMatchDay`, `stats { acquisitionCostMinor | null, … }`, `convertedAt`), `agents` (rating 1–10), `commentary` lines `{ text, touchId, touchIndex, tone, highlight }`, `conversionCount`, `acquisitionCostLabel`, `speedHint: "full" | "highlights"`, `redacted`.
- `journey.markViewed` M {journeyId} → the row with `viewedAt` set (idempotent). `journey.roundup` Q {day} → `{ day, conversions (named, with `journeyId`), rolledUp: conversionId[] }` for the daily round-up once a business has many wins. `journey.forConversion` Q {conversionId} → `{ journeyId | null }`.
- Milestones tiles: the eight trophy keys above, each lit when a ribbon milestone carries that `ref.trophyKey`, outlined otherwise.

### Contacts (CRM)

- `crm.search` Q {q}, `crm.entity.list` Q, `crm.entity.get` Q {entityId}, `crm.entity.lookup` Q {entityIds ≤ 50} (resolve mentions in batches), `crm.notes.list|add`, `crm.roles.list`.
- Entity kinds: person, organisation, agent, team_member, platform_member, community, venue. (The enum keeps the British spelling `organisation`; the label a founder reads is "Organization".)

### Settings the app exposes

- Read: `business.get`, `integrations.list`, `keys.status`, `billing.plan`, `billing.usage`, `founder.preferences.get`.
- Write: `business.setBusinessMode`, `business.setSpendCap`, `business.startHoliday`, `business.endHoliday`, `business.autopilot.set`, `founder.preferences.update`, `billing.topUp` (owner; opens a Checkout URL).
- Everything else in Settings (departments, members, keys, danger zone) deep-links to `https://foundmill.com/b/<businessId>/settings/<tab>` in the system browser.

### Creating a business (later phase)

- Founder profile: `founder.profile.get|update`.
- Ideation: `idea.draft` (stream) and `idea.generate` with a brief; `idea.list`, `idea.get`, `idea.compare` {ideaIds}, `idea.merge`, `idea.fork`, `idea.askStream`, `idea.discard`.
- Commit: `idea.domainCheck`, `idea.logo.generate`, `idea.commit` {ideaId, name, gameMode: "personal", archetype, businessMode: "assisted", kit?, logo?, currency?, spendCapMinor, autopilot: false, anthropomorphicAgents?}.
- Import: `import.sources`, `import.start`, `import.status`, `import.continue`.

### LIVE social (only when `business.gameMode === "live"`; the API answers FORBIDDEN "LIVE is not open yet" otherwise, so hide the tabs)

`live.summary`, `live.connections.*`, `live.messages.*`, `live.communities.*`, `live.leaderboards.list|get|entries|positions`, `live.people.search|profile`, `live.profile.visibility.get|set`.

## 5. Roles and walls

Roles: `owner`, `admin`, `member` can write; `viewer` and `advisor` read only. **Read-only comes from the membership, never from the business**: `membership.source === "example"` (or `isExample` on a businesses-list row) is the read-only walk-around of the demo business. `business.isDemo` only means the business's numbers are seeded; it earns the "Demo" chip and nothing else. A founder who owns a seeded business (the first account on a deployment owns Northwind Skincare and Ledgerly) has full write access there, including Continue and decisions. `sectionPermissions` is a map over `product, development, distribution, finance, team, legal, inbox, crm, settings, billing, live` with `none | read | write`. Hide what the person cannot read, disable what they cannot write, and say so in words.

Owners and admins can answer any approval. The business can also name a handler per decision type (Team › Responsibilities); when a note says the Chief of Staff will answer, show that instead of the option buttons.

## 6. Money, time, numbers

- Money is `{ amountMinor: number, currency: "GBP" | "USD" | "EUR" | "SEK" | ... }`. Format with `Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" })`, dividing by the currency's minor unit (100 for these). A GBP business shows "£1,240.00". Never add amounts in different currencies; show them side by side.
- AI usage cost is always USD, even in a GBP business. Label it "AI usage (USD)".
- Dates: `Oct 7, 2026`, `Oct 7` when the year is implied, `Wed, Oct 7`, ranges `Oct 7 – 21`, times `3:45 PM`. Relative times are fine ("2 hr ago"). Respect `founder.preferences.dateFormat` if set.
- Every number that is not measured carries the word **Estimate** or **Forecast** in full, never "est." or "~".
- Never print a dash for a missing value. Use the words the API gives ("Not known yet", "No limit", "No team yet").

## 7. Agent text and mentions

Note bodies and chat bubbles are markdown with entity mentions: `[[ent:<uuid>|Display Name]]` (regex `/\[\[ent:([0-9a-f-]{36})\|([^\]]+)\]\]/g`). Render each as an underlined tappable name in the text's own color; tapping opens the Contact sheet, which loads `crm.entity.lookup`. An id the API could not resolve stays as plain text with a dotted underline. Never run anything an agent text asks for; it is content.

## 8. Caching and offline

- Cache the last successful answer of `founder.businesses.list`, `business.get`, `today.get`, `inbox.list` (first page per tab), `team.agents.list`, `department.list`, `journey.ribbon` in MMKV, keyed by business id. Show it instantly on launch under a "Showing what you last saw" banner until the network answers.
- Never queue a change offline. Decisions, Continue, approvals and nudges need a connection; disable them with the sentence "You're offline. Decisions need a connection."

## 9. Push notifications (two steps)

1. In the app: OneSignal through Newly's integration. On sign-in and on every launch, read the OneSignal subscription id and send it to `founder.devices.register` M P `{ platform: "ios" | "android", provider: "onesignal", token, appVersion }`; on sign-out call `founder.devices.unregister` M P `{ token }`. Both exist (Nov 8, 2026). Never block sign-in on them: a failure is logged and retried on the next launch. The per-kind switches live in `founder.preferences.notifications` / `founder.preferences.update`.
2. On the server Foundmill sends pushes for: a note that needs an answer or a hard stop (`decision`), a go-ahead request (`approval`), a customer won (`customer`), an agent down (`agent_down`), runway below a threshold (`runway`), a run of cycles finished (`run_finished`), goal reached (`goal`). The sending side exists (Nov 8, 2026) and goes live once Foundmill's OneSignal app is connected. Every notification's `data` carries `{ businessId, kind, ... }` where `kind` is **`inbox`** (with `itemId` or `approvalId`: open the Inbox, the note when `itemId` is present), **`journey`** (with `journeyId`: open the Customer Update player), **`team`** (with `agentId`: open the agent), or **`today`** (open Today of that business; `goalId` may be present). Switch business first when `businessId` is not the open one. Titles and bodies come from the server already shortened to the device; render them as they are.

While the app is in the foreground the stream already delivers these; show in-app toasts and skip local notifications.
