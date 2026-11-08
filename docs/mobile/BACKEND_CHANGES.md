# What Foundmill must add or configure for the mobile app

The mobile app is a second client of the existing backend. Nothing below changes a product rule; each item makes an existing capability reachable from a native app, or adds the one thing no client has needed before (push). Items 1–3 gate the first sign-in and the push step of the Newly sequence (`PROMPTS.md` 3 and 13) and were done on Nov 8, 2026 (status per item); item 4 is the next piece of backend work.

## 1. Supabase Auth: mobile redirect and the one-time code ✅ in the repo, ⬜ pushed

- `supabase/config.toml` now lists `foundmill://auth/callback` among the redirect URLs, sets the email OTP to 6 digits and 900 seconds, and points the Magic Link template at `supabase/templates/magic_link.html`, which carries both `{{ .ConfirmationURL }}` (the link) and `{{ .Token }}` (the code the phone types). The API already accepts `amr` values `otp` and `magiclink` (`apps/api/src/auth.ts`), so no API change was needed.
- **Left for the founder:** run `supabase link --project-ref sdruubitufjqibsjyxlc` once and `supabase config push` from the repo root (Supabase CLI 2.x; it shows the diff and asks), or set the three in the dashboard (Auth › URL Configuration; Auth › Providers › Email; Auth › Emails › Templates › Magic Link). docs/DEPLOY.md §4 and its status table say which.

## 2. API: allow the native client ✅

- Checked: the CORS layer only adds headers for a browser origin; a request with no `Origin` and a bearer passes through to every procedure (`apps/api/src/__tests__/cors-origins.test.ts`, "a native client without an Origin"). The mobile client sends every call, reads included, straight to `https://api.foundmill.com/trpc`.
- The request log now records `x-foundmill-client` (`mobile/<version> <platform>`, printable and at most 64 characters; anything else logs as null), so mobile traffic is distinguishable in Railway logs; the header is also on the CORS allow list.

## 3. Device registration ✅ (`packages/db/migrations/0073_founder_devices.sql`, `repos/devices.ts`, `apps/api/src/routers/founder.ts`)

- `founder_devices`: `id`, `user_id`, `platform` (ios | android), `provider` (onesignal), `token` unique (8–512 chars), `app_version`, `last_seen_at`, timestamps. Account-scoped; RLS `user_id = auth.uid()` for select, insert, update and delete; the service role reads them all. Cross-user tests in `packages/db/src/__tests__/rls/founder-devices.test.ts` and `apps/api/src/__tests__/founder-devices.test.ts`.
- `founder.devices.list` Q, `founder.devices.register` M `{ platform, provider, token, appVersion }` → `{ device, created }` (an upsert on the token, run with the service role so a token follows the latest sign-in on a phone), `founder.devices.unregister` M `{ token }` → `{ removed }`.
- `account_preferences.notifications` (jsonb, a partial map of the seven kinds; absent is on) and `hide_amounts_on_lock_screen`; `founder.preferences.notifications` Q answers the merged map and the switch; `founder.preferences.update` takes `notifications` (kinds merge) and `hideAmountsOnLockScreen`. `NOTIFICATION_KINDS` and `DEFAULT_NOTIFICATION_PREFS` live in `packages/shared/src/constants.ts`.
- `repos.devices.forUsers(db, userIds)` is the read the push fan-out (item 4) will use.

## 4. Push fan-out ✅ (`packages/connectors/src/connectors/onesignal`, `apps/gateway/src/push.ts`, `apps/api/src/services/push`)

- **Connector `onesignal`** (real + mock, platform key, service-only like `openai_images`): tool `send_push` → `POST https://api.onesignal.com/notifications?c=push` with `include_subscription_ids`, `headings`, `contents`, `data`, `collapse_id`; the mock accepts everything with a deterministic id. Agents can never call it (`SERVICE_ONLY_CONNECTORS`); it is hidden from Settings › Integrations.
- **Gateway route** `POST /v1/push/send` (service token `svc: api` only): the business's own window on the connector, a 503 `push_unconfigured` without the keys, 502 / 429 without the vendor's words, and an audit row `gateway.push.sent` with the kind and the counts, never the title or the body.
- **The api's push notifier** (`services/push/notifier.ts`, started beside the outbox relay and fed by its `onPublished` hook, so no stream consumer and no extra process): for `inbox.item_created` (a decision note, or a warning that holds Continue), `approval.requested`, `customer.converted` (full updates only), `agent.health_changed` to down, `runway.threshold_crossed` below, `cycle.run_ended`, `goal.achieved`. Recipients are the business's members (never the example's visitors) with a registered phone, the kind switched on, and read access to the event's section; amounts need Finance and names need the CRM, and the lock-screen switch drops amounts; agents are named the way each reader chose; readers of the same words share one send. The words are `services/push/decide.ts` (the voice skill's §7). Routing data `{ businessId, kind: inbox | journey | team | today, itemId? | journeyId? | agentId? | approvalId? | goalId? }`.
- **`push.sent` event** (`packages/events`, narratable false, walled to Settings): kind, the source event, recipients, devices, provider, mode, the provider's ids; one per source event (idempotency key `push:<eventId>`), de-duplicated in memory against the relay's at-least-once delivery. No `usage_ledger` row: a push costs nothing and the event plus the gateway's audit row are the record (docs/DECISIONS.md, Nov 8, 2026).
- **Mock mode** runs the whole flow with no key and no network; `push.sent` events appear in the business's event log.
- **Left for the founder:** create Foundmill's own OneSignal app, connect it in the Newly project (Integrations › Push notifications, own account), and set `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` and `LIVE_CONNECTORS=onesignal` on the gateway (docs/DEPLOY.md §5.6).

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
