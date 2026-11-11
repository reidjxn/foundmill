# What Foundmill must add or configure for the mobile app

The mobile app is a second client of the existing backend. Nothing below changes a product rule; each item makes an existing capability reachable from a native app, or adds the one thing no client has needed before (push). Items 1–4 were done on Nov 8–9, 2026 and are on main since PR #75 (Nov 11); item 8 is the next piece of backend work (it gates prompt 12B's areas); item 9 is the people side the thesis review plans.

## 1. Supabase Auth: mobile redirect and the one-time code ✅ in the repo, ⬜ pushed

- `supabase/config.toml` now lists `foundmill://auth/callback` among the redirect URLs, sets the email OTP to 6 digits and 900 seconds, and points the Magic Link template at `supabase/templates/magic_link.html`, which carries both `{{ .ConfirmationURL }}` (the link) and `{{ .Token }}` (the code the phone types). The API already accepts `amr` values `otp` and `magiclink` (`apps/api/src/auth.ts`), so no API change was needed.
- **Left for the founder:** run `supabase link --project-ref sdruubitufjqibsjyxlc` once and `supabase config push` from the repo root (Supabase CLI 2.x; it shows the diff and asks), or set the three in the dashboard (Auth › URL Configuration; Auth › Providers › Email; Auth › Emails › Templates › Magic Link). docs/DEPLOY.md §4 and its status table say which.

## 2. API: allow the native client ✅

- Checked: the CORS layer only adds headers for a browser origin; a request with no `Origin` and a bearer passes through to every procedure (`apps/api/src/__tests__/cors-origins.test.ts`, "a native client without an Origin"). The mobile client sends every call, reads included, straight to `https://api.foundmill.com/trpc`.
- The request log now records `x-foundmill-client` (`mobile/<version> <platform>`, printable and at most 64 characters; anything else logs as null), so mobile traffic is distinguishable in Railway logs; the header is also on the CORS allow list.

## 3. Device registration ✅ (`packages/db/migrations/0075_founder_devices.sql`, `repos/devices.ts`, `apps/api/src/routers/founder.ts`)

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

## 5. Deep links from the web (needed now: founder email will carry links and one-click answers)

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

## 8. Area opening sentences as one read ✅ in the repo (Nov 11), ⬜ deployed (needed by `PROMPTS.md` 12B message A)

- The web computes each area's opening sentence in the browser (`packages/modules/src/areas/AreaOpening.tsx` feeds the pure builders in `packages/shared/src/area-words.ts` from the same widget reads as the tiles). A phone that did the same would carry six fact-gathering paths and drift from the web's words; the rule is that server-written sentences are shown, never recomputed.
- `business.areas.words` Q (any member) → `{ today, plan, customers, money, company, product, team }`, each `AreaWords | null` (null when the reader's walls hide the facts). `apps/api/src/services/area-words.ts` gathers the facts in one transaction under the caller's RLS with the reads the api already has (the cash position and net burn as `finance.overview` computes them, the primary entity and the compliance calendar, `goalView` and the roadmap, the channel window and live campaigns, the product stage with the same rows as `dev.prs.list` and `dev.deployments.list`, the agents' tiers) and hands them to the shared builders. The fact mappings moved out of the web's `AreaOpening.tsx` into `packages/shared/src/area-facts.ts` (and `runwayState` into `packages/shared/src/runway-state.ts`, re-exported by widgets), so the web and the api build each sentence from one function; the web still reads through its tiles' cache and may switch to the procedure later.
- Tests: `apps/api/src/__tests__/area-words.test.ts` (a fresh business's six sentences, the roadmap and live-change counts with the Estimate chip, a walled reader's nulls, another business's owner refused); the modules, widgets and shared suites still pass on the moved builders.
- Deployed when the api next deploys from main; the mobile card shows "Reading the numbers" until then.

## 9. The people side (Phase B of the prompts; THESIS_REVIEW §13 phases 1–5) ⬜

- Nothing to add for the phone beyond what each package adds for the web: project pages (1.1), the widened person profile and Home for a person (2.3, 2.4), open sign-up or the waitlist (2.2), invitations (3.1), cofounder and collaborator roles (3.3), join requests and trials (3.4, 3.5), notes for a named person (3.6), the project thread (3.7), open roles, browse and suggestions (4.1–4.3), milestone cards (5.3). Each ships with its tRPC procedures, and the backend skill gets the shapes in the same PR.
- The vocabulary rule (People, cofounders, collaborators, project) already applies to the app's own strings; the API's role enum stays `owner | admin | member | viewer | advisor` until 3.3 adds `cofounder` and `collaborator`.
- Hand-over (2.1): once the app is in the stores, one config value on the web holds the store links; the app needs only the universal links of item 5.

## 10. The rebuild branch and this pack

- Branch `claude/vibrant-euler-uua9pw` (the thesis review, phase 0) has merged main (#75) since the morning, so the devices migration and the `onesignal` connector are safe there. It adds migration `0076_drop_leaderboards.sql`: `live.leaderboards.*` and its tables are gone once it merges, and the app must never call them (prompt 12A removes every trace). Its package 5.6 ("the mobile prompt pack follows the thesis") is done by this pack's Nov 11 update; nothing else in that branch changes a procedure the app uses yet.

## 12. Google sign-in, Apple, 18 or older, the waitlist ⬜ (planned in the retention and roadmap sessions; prompt 13B waits for it)

- **The api refuses anything but an inbox-proven email today** (`apps/api/src/auth.ts` accepts the `amr` methods `otp` and `magiclink`). Google sign-in needs it to accept Google-proven sessions too (`amr` `oauth` with provider `google`, email verified by Google), for the web and the app alike.
- **Supabase**: the Google provider with the web client id plus the iOS and Android client ids (the app signs in natively with `signInWithIdToken`, so the provider must list the native client ids as authorized), and the `foundmill://auth/callback` redirect already there.
- **Apple on iOS (a decision for the founder)**: App Store Review Guideline 4.8 asks an app that offers a third-party sign-in (Google) to also offer an equivalent option that limits data to name and email and lets the person keep the email private; Sign in with Apple is the usual answer. Without it, an iOS build that offers Google is likely to be rejected. The email code alone may not count, since it is not the "equivalent" private option the guideline describes. If Apple is offered: the Supabase Apple provider, the api accepting `apple` the same way, and an Apple Services id.
- **18 or older** (THESIS_REVIEW package 2.2): one confirmation procedure at sign-up and one refusal code the app can recognize before any business call; the app shows the screen and calls it.
- **The waitlist** (package 2.2): the refusal the app gets while waiting (place, referral link) in the API's own words, replacing `not_invited`.
- Done when: the backend skill's sign-in section names the methods, the confirmation procedure and the refusal codes.

## 13. Collisions to watch between sessions

- Resolved Nov 11: the retention work (branch `claude/brave-allen-52yii5`) took **0076_founder_return** and keeps email preferences in their own column and procedures (`founder.email.*`) beside the push map; folding the shared kinds into one vocabulary is its noted follow-up. The roadmap branch also has a 0076, so whichever of the two merges second renumbers.
- Originally: the retention session planned **migration 0075** (`founder_visits`, `founder_signals`) and email columns on `account_preferences`. Main already has `0075_founder_devices` and `account_preferences.notifications` (#75), and the roadmap branch has 0076 and 0077. The retention work must take the next free number after whatever merges first and add its email kinds beside the push kinds in `founder.preferences.notifications`, not as a second preferences shape, so the app keeps one place to read them.
- The roadmap branch edited `docs/mobile` too (its commit "The mobile prompt pack follows the thesis"). This pack (PR #77) already carries the same rules; whichever merges second resolves the conflict by keeping both sets of lines (channel availability, "simulated is never done").

## 11. Repo hygiene

- `docs/DECISIONS.md` records (Nov 8, 2026) that the mobile app is a separate native client built with Newly from this pack; `CLAUDE.md`'s "Never build mobile layouts" keeps applying to `apps/web`.
- Keep this folder as the source of truth for the mobile contract. When a procedure the skill names changes, update `docs/mobile/skills/foundmill-backend/SKILL.md` in the same PR and re-add the skill in Newly (Settings › Skills, replace the body; running chats keep the old one until they wake).
- Add the Newly project's GitHub repository (`foundmill-mobile`) to the Foundmill GitHub organization once it exists, so CI can run the banned-terms and US-English scanners over its `app/`, `components/` and `features/` folders too.
