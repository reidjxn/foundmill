# What Foundmill must add or configure for the mobile app

The mobile app is a second client of the existing backend. Nothing below changes a product rule; each item makes an existing capability reachable from a native app, or adds the one thing no client has needed before (push). Items 1–4 gate the first sign-in and the push step of the Newly sequence (`PROMPTS.md` 3 and 13).

## 1. Supabase Auth: mobile redirect and the one-time code

- Add `foundmill://auth/callback` to Authentication › URL Configuration › Redirect URLs on the `foundermanager` project. Keep the web callback.
- The magic-link email template must also carry the six-digit code: include `{{ .Token }}` next to the link in the "Magic Link" template, so `verifyOtp({ type: "email" })` works from the phone. The API already accepts `amr` values `otp` and `magiclink` (`apps/api/src/auth.ts`), so no API change is needed.
- Decide the OTP expiry (Supabase default 1 hour; 10 minutes is enough for a code typed on a phone).

## 2. API: allow the native client

- CORS does not apply to a native app, but the API's origin checks on streaming procedures and the same-origin query path should be reviewed: the mobile client sends every call, including reads, straight to `https://api.foundmill.com/trpc` with a bearer. Confirm `apps/api` accepts bearer-only requests with no `Origin` header on all procedures (it should; the web's server renders already do this).
- Add `User-Agent` / `x-foundmill-client: mobile/<version>` to the request log so mobile traffic is distinguishable in Railway logs and rate-limit reports.

## 3. Device registration (new, `apps/api/src/routers/founder.ts`)

Two person-level procedures, both `protectedProcedure`:

- `founder.devices.register` M `{ platform: "ios" | "android", provider: "onesignal", token: string, appVersion: string }` → upserts into a new table `founder_devices` (`id`, `user_id`, `platform`, `provider`, `token` unique, `app_version`, `last_seen_at`, `created_at`). Not business-scoped (a person's devices follow them across businesses), so RLS is `user_id = auth.uid()`; add the cross-user test anyway.
- `founder.devices.unregister` M `{ token }` → deletes the row.
- Also store the per-kind notification switches on `account_preferences.notifications` (JSON: `{ decision, approval, customer, agent_down, runway, run_finished, goal }` booleans, default all on) and `account_preferences.hide_amounts_on_lock_screen` (boolean). Extend `AccountPreferencesPatch` and `founder.preferences.update`.

## 4. Push fan-out (new consumer in `apps/orchestrator` or a small worker next to the api's outbox relay)

- Consume `ev:*` and `u:*` streams (or the outbox relay directly) for these event types and send a push through OneSignal's REST API **from the gateway** (vendor calls only through `apps/gateway`; add a `onesignal` connector with real and mock implementations, `packages/connectors`): `inbox.item_created` with `blocksContinue` (decision), `approval.requested` (go-ahead), `customer.converted` (customer), `agent.health_changed` to `injured` (agent_down), `runway.threshold_crossed` (runway), `cycle.run_ended` (run_finished), `goal.achieved` (goal).
- Recipients: every member of the business whose role may read the relevant section, minus anyone whose preference for that kind is off; the person-addressed `u:` signals go to that person only.
- Payload: `{ businessId, kind, itemId?, journeyId?, agentId? }`. Title and body from `docs/mobile/skills/foundmill-voice/SKILL.md` §7. When `hide_amounts_on_lock_screen` is on, drop amounts from the body.
- Declare a `push.sent` event in `packages/events` (Zod) for the audit trail; write it through the outbox. Metering: one row per push in `usage_ledger` at zero cost so it shows in the audit.
- Mock mode: the mock connector logs and records; the golden path in `INTEGRATIONS_MODE=mock` must still run.

## 5. Deep links from the web

- Add `apple-app-site-association` and `assetlinks.json` under `apps/web/public/.well-known/` once the bundle id (`com.foundmill.app`) and the Apple Team ID are known, so `https://foundmill.com/b/<id>/inbox/<item>` can open the app. Until then the app's own scheme `foundmill://` is enough for notifications and the auth callback.
- The magic-link email can carry `foundmill://` only if the template branches on the client; keep one template with both the link and the code (item 1) instead.

## 6. Procedures the app expects that need a check

These exist in `apps/api` today and the skill documents their names. Confirm the exact output shapes the app relies on, or add the fields:

- `today.get`: the `needsYou` rows carry the recommended option id and label so Today can offer a one-tap answer without a second call.
- `inbox.list`: items carry `fromAgent` (name, role, persona key, department color token) and `preview`, so the list needs no per-row profile call.
- `team.agents.list`: items carry `presence`, `currentTask.founderTitle`, `currentTask.progress`, `expectedReturnAt` for down agents, and `persona.portraitUrl`.
- `journey.ribbon`: carries `chapters`, `milestones` (all eight with reached/outlined), `runway` sentence and months, and daily series in minor units with the currency.
- `journey.get`: carries the staged structure the player needs (`stages`, `commentary` per stage, `debrief.agentRatings`, `standoutAgentId`, `leadChannelKey`).
- `cycle.continueState`: a single discriminated value the Continue pill can render (`idle | blocked(n) | processing(cycle) | customer_update(journeyId) | vacation(until)`).
- `agent.profile.get`: carries `nudgePresets` for the agent's type.
- `distribution.channels.list`: carries `line`, `fit`, `enabled`, `costTrend` (five weeks), `costToWin`.

Where a field is missing, add it to the existing procedure rather than a mobile-specific one; the web benefits too.

## 7. Repo hygiene

- `docs/DECISIONS.md` records (Nov 8, 2026) that the mobile app is a separate native client built with Newly from this pack; `CLAUDE.md`'s "Never build mobile layouts" keeps applying to `apps/web`.
- Keep this folder as the source of truth for the mobile contract. When a procedure the skill names changes, update `docs/mobile/skills/foundmill-backend/SKILL.md` in the same PR and re-add the skill in Newly (Settings › Skills, replace the body; running chats keep the old one until they wake).
- Add the Newly project's GitHub repository (`foundmill-mobile`) to the Foundmill GitHub organization once it exists, so CI can run the banned-terms and US-English scanners over its `app/`, `components/` and `features/` folders too.
