# WP-00: Setup and switches

**Goal:** every switch a real outcome needs is on, recorded in one place, and checked by a script.

**Why:** the repo's record of what is configured (docs/DEPLOY.md §6) stops on Oct 20, 2026. Audits read from that record called several things "off" that are in fact on, and missed several that are off (`audits/a11-roadmap-status.md` §5 and §9; `audits/e0-production-evidence.md`, "Live configuration"). Code merged since Nov 11 does nothing for a founder until its switch is on.

**Done when:** the table below has no row in the state "unknown"; docs/DEPLOY.md carries the same table (WP-02 writes it and `scripts/check-production.mjs` checks the public half every night); a stranger can shape an idea on the landing page, follow a project and get the confirmation email, on production.

**Who does what.** A cloud session cannot reach Vercel, Railway or Supabase. Three kinds of actor appear below:

- **Desktop**: a Claude Code session on the founder's computer with the claude.ai connectors for Vercel, Railway and Supabase (they worked on Nov 15; the `.mcp.json` servers `vercel`, `supabase` and `github` did not). It changes production only on the founder's go-ahead, one step at a time, and writes each change into docs/DEPLOY.md in the same sitting.
- **Cloud**: the session executing the work packages. It writes code, scripts and docs only.
- **Founder**: creating an account with a vendor, accepting terms, paying, pasting a secret into its destination, DNS at Spaceship (no connector), anything in the Claude or GitHub settings pages. These are the only steps the founder has to do by hand, and they are marked so.

Secrets are never typed into a chat or a pull request. Where a step needs one, the founder pastes it into Railway or Vercel directly, or the Desktop session sets a Railway reference (`${{service.VARIABLE}}`) so the value is never read.

## 1. State on Nov 15, 2026

Read through the connectors (names only, no values), public health answers and DNS.

| Area | State | Evidence |
| --- | --- | --- |
| Environment | The api and ingest report `env: "staging"`, integrations `mock`, models `live`. Production runs as "staging" with single connectors switched live by `LIVE_CONNECTORS`. | `GET api.foundmill.com/health`, `GET ingest.foundmill.com/health` |
| Bot check (Turnstile) | On, both sides: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel (production and preview, set Nov 13), `TURNSTILE_SECRET_KEY` on the gateway. Not yet proven by a real submission. | Vercel and Railway variable names |
| Idea cookie | On: `IDEA_COOKIE_DOMAIN` on Vercel and the api. | Variable names |
| Google sign-in | The web flag is on and the sign-in page shows the button. Supabase provider state not read. | Vercel `NEXT_PUBLIC_AUTH_GOOGLE`; the live page |
| Platform mail | Variables present on gateway, ingest, api and orchestrator. DNS present: DKIM `s1` and `s2` for `mail.foundmill.com` point at SendGrid, MX is `mx.sendgrid.net`, DMARC is `p=none`. 14 `notify.email_sent` events exist. Ingest has no `LIVE_CONNECTORS`, which is correct for mail: SendGrid's events arrive at `/mail/events`, switched by the `PLATFORM_MAIL_*` variables that are set. Whether SendGrid's side points there is unconfirmed (S2). Whether `sendgrid` is in the gateway's `LIVE_CONNECTORS` is unknown. | Variable names; `dig`; ingest health `refusedMockWebhooks` |
| Sign-up | Closed to a list. `SIGNUP_OPEN` and `SIGNUP_DAILY_CEILING` are not set. `waitlist_entries`, `invitations` and `account_admissions` have 0 rows. | api variable names; database counts |
| Web research | Unknown, documented as mock. The gateway has `ANTHROPIC_API_KEY`; whether `web` is in `LIVE_CONNECTORS` and `MODEL_MODE` is `live` on the gateway was not read. | `audits/a3a-agent-runtime.md` AR-01 |
| Payments | Off. No `STRIPE_*` variable on any service. | Variable names |
| Push | Off. No `ONESIGNAL_*` variable. | Variable names |
| E2B template | Set on the orchestrator (`E2B_TEMPLATE`). | Variable names |
| Wait for CI | On for ingest and orchestrator; **off for api and gateway**. Composer and stream not read. | Railway service config `checkSuites` |
| Watch paths | None on any service: every push to `main` redeploys all six and restarts agent sessions. `railway.toml` stops being read on Dec 1, 2026. | Railway service config; `railway.toml:2` |
| Search | The landing page sends `noindex, nofollow`; `/robots.txt` and `/sitemap.xml` return 404. | `curl` |
| Database | 131 tables, RLS on all. Advisor findings in `audits/e0-production-evidence.md`. A leftover schema `bak_20261013` with 89 tables. | Supabase connector |
| Hosting plan | The Vercel team is on the Hobby plan (the reason every commit must carry the owner's GitHub noreply address). Hobby is for non-commercial use. | docs/DECISIONS.md "Commit identity for Vercel's commit-author check" |
| Cloud sessions | Two environments exist: "Default" and "Foundmill build". Cloud sessions load the repo's `.claude/skills/`, agents, hooks and CLAUDE.md. They do not load plugins installed on the laptop, and do not install plugins a repo declares. | Claude Code documentation, checked Nov 15 |

## 2. Steps

Ordered by how directly each one stands between a first-time founder and a real outcome. "After" names the code that must be merged first; a step with no "After" can be done today.

### S1. Prove the front door works [Desktop, read-only, then Founder for one test]
1. Desktop: open `https://foundmill.com` in the browser, read the network calls of the idea box without submitting, and confirm the bot check widget renders.
2. Founder (2 minutes, on a phone): type an idea, press "Shape my idea", keep the card, sign in with an address that is on the list. Then follow any test project page and confirm the email arrives.
3. Desktop: read `idea_drafts`, `contact_consents` and the gateway's audit rows for those two actions through the Supabase connector (counts only) and record the result in docs/DEPLOY.md.
verify: one new `idea_drafts` row; one confirmation email received; no row with `simulated` for the send.

### S2. Confirm SendGrid's event webhook reaches ingest [Founder in SendGrid, Desktop records]
Corrected after WP-11 read the code: the platform address's events do not use the connector mounts. They arrive at `POST /mail/events` (`apps/ingest/src/platform-mail.ts`), which is on while `PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_EVENT_PUBLIC_KEY` and `PLATFORM_MAIL_SIGNING_SECRET` are set on ingest, and they are. `webhooks: []` on ingest's health answer lists only the `/webhooks/:connector` mounts. Do not add `LIVE_CONNECTORS=sendgrid` to ingest: docs/DEPLOY.md §5.7 step 6 keeps it out on purpose.
1. In SendGrid (Founder, signed in): Mail Settings, Event Webhook. The URL is `https://ingest.foundmill.com/mail/events`; actions Dropped, Bounced, Spam Reports and Unsubscribes; Signed Event Webhook on, with its verification key equal to `PLATFORM_MAIL_EVENT_PUBLIC_KEY`. Confirm domain authentication for `mail.foundmill.com` shows verified. WP-11 T15 step 4 has the full list.
2. Desktop records the result in docs/DEPLOY.md.
verify: a test bounce from SendGrid writes a suppression row; after WP-11 T15, ingest's health answer names the mail routes.

### S3. Record what `LIVE_CONNECTORS` and `MODEL_MODE` are, per service [Founder reads, Desktop records]
The connector returns variable names, not values. The founder opens Railway, copies the value of `LIVE_CONNECTORS` and `MODEL_MODE` for api, gateway and orchestrator (they are not secrets) into the session, and the Desktop session writes them into docs/DEPLOY.md. Every later step that adds a connector appends to the recorded value instead of guessing.
verify: docs/DEPLOY.md lists the three values with the date.

### S4. Stop redeploying everything on every push [Desktop] (deadline Dec 1, 2026)
After: WP-01's task that writes the per-service watch patterns and proves them in a dry run.
1. For each of api, gateway, orchestrator, composer, stream and ingest, set the watch patterns WP-01 lists (the service's own app folder, the packages it imports, the Dockerfile and lockfile) through the Railway connector's service update.
2. Turn "Wait for CI" on for api and gateway (and composer and stream if off), so a red commit cannot ship.
verify: a docs-only commit on `main` redeploys nothing; a commit touching only `apps/ingest` redeploys only ingest; the orchestrator's running sessions survive both.

### S5. Open the door [Founder decides, Desktop switches]
After: WP-03's tasks for per-domain caps, the bot check on sign-up, and the waitlist that emails.
- Until then, the stopgap needs no deploy: the founder names the addresses to let in, and the Desktop session inserts them into `account_admissions` through the Supabase connector (the exact statement is in `audits/a9-people-network-mobile.md`, P0 item 1), then records who was admitted.
- When WP-03 has merged: set `SIGNUP_OPEN=1` and `SIGNUP_DAILY_CEILING` on api, stream and collab (docs/DEPLOY.md §4 "Open sign-up"). Start with a ceiling the free allowance can bear: WP-09's cost report gives the number.
verify: a new address signs in and reaches "Before you start"; the daily ceiling refuses the next one with the waitlist message, and that person gets an email when admitted.

### S6. Real web research [Desktop]
After: WP-05's task for AR-01 (a mock connector is refused for a real project whatever its auth kind; `search_web` returns snippets and books its cost) and WP-09's booking of that cost.
1. Append `web` to `LIVE_CONNECTORS` on gateway, api and orchestrator (values from S3).
2. Confirm `MODEL_MODE=live` on the gateway (its quarantined reader is documented as mock).
verify: the nightly eval `researcher.real_citations` passes; no report on a real project contains a simulated source.

### S7. Indexing [Cloud, then Desktop checks]
After: WP-03's landing rewrite. The cloud session adds `robots.ts`, `sitemap.ts` and per-route robots; the Desktop session confirms `curl -sI https://foundmill.com/robots.txt` returns 200 and the landing page no longer sends `noindex`. Founder: add the site in Google Search Console (the apex already carries a `google-site-verification` record) and submit the sitemap.

### S8. Payments [Founder, then Desktop]
After: WP-07's payment link tasks and WP-11's work on the open Stripe webhook item (N3).
1. Founder: open or confirm the Stripe account, pass verification, create a restricted key, paste `STRIPE_SECRET_KEY` on the gateway and the webhook signing secrets on ingest.
2. Desktop: append `stripe` (and `stripe_billing` for credit top-ups) to `LIVE_CONNECTORS` on api, gateway and ingest; set the non-secret variables DEPLOY §5.5 lists.
verify: a test-mode payment on a test project produces `payment.received` and a Customer Update; a test top-up adds a credit lot.

### S9. A domain for Foundmill Sites [Founder decides and buys, Desktop wires]
After: WP-07's `apps/sites` task.
1. Founder: choose a registrable domain that is not a subdomain of foundmill.com (cookie and reputation isolation) and buy it.
2. Desktop: create the Railway service for `apps/sites`, set `SITES_DOMAIN`, add the wildcard domain and wait for the certificate. DNS: a wildcard record at the registrar (Founder, or Desktop if the domain's DNS is on Vercel).
verify: `https://<slug>.<sites-domain>` serves a published release; a preview host sends `noindex`.

### S10. Supabase settings [Founder, with the CLI or dashboard]
`supabase/config.toml` in the repo holds the intended auth settings (the six-digit code, 900 s expiry, the mobile redirect, the magic-link template); the dashboard is what is live. The connector has no tool for auth settings. The founder pushes the file with the Supabase CLI or applies it in the dashboard, narrows the redirect list, keeps "Confirm email" on and the Data API off (`audits/a11-roadmap-status.md` §5 A7, C11), and checks the "Confirm signup" template carries the typed code (`audits/a1-first-run.md` FR-13).
verify: a new address receives an email with a six-digit code; `https://<project>.supabase.co/rest/v1/` answers 503.

### S11. Skills in cloud sessions [done in this change; one optional Founder step]
Done: the skills this plan's execution relies on are in `.claude/skills/` (30 folders, sources and licenses in `.claude/skills/THIRD_PARTY_NOTICES.md`), which cloud sessions load.
Optional, to give cloud sessions the full plugins: in claude.ai/code, edit the "Foundmill build" environment's setup script and add one line per plugin, each ending in `|| true`, for example `claude plugin marketplace add obra/superpowers || true` then `claude plugin install superpowers@superpowers-dev || true`. The documentation does not confirm that `claude` is on the path in a setup script: test it in a throwaway session with `claude plugin list` first. Keep the script under five minutes or it is not cached.

### S12. Watching production [Cloud, then Founder for accounts later]
First: WP-02's `scripts/check-production.mjs` on a nightly GitHub Actions schedule, which needs no account. Later, when there are users: `SENTRY_DSN` and an OTLP endpoint on the six services (Founder creates the projects; Desktop sets the variables).

### S13. Spending backstops [Founder]
Monthly limits in the Anthropic Console and on the E2B team; a Redis `maxmemory` and alert on Railway. These are the last line behind the per-account ceilings WP-09 adds.

### S14. Hosting plan [Founder decides]
Vercel's Hobby plan is for non-commercial use, and it is why deployments are blocked unless a commit carries the owner's noreply address. Move the team to Pro before sign-up opens, or record the decision to stay.

### S15. Mail reputation [Founder at Spaceship, later]
Move DMARC for foundmill.com from `p=none` to `p=quarantine` once a week of reports is clean. Confirm `privacy@foundmill.com` is read (the Privacy Policy promises deletion and export by email).

### S16. Leftovers [Desktop, on the founder's go]
- `bak_20261013`: WP-11 has the investigation and the exact drop. Dropping is permanent, so it waits for the founder's yes and a fresh backup.
- Remove from the api the connector platform keys it does not need, and from stream and composer `SESSION_TOKEN_SECRET` and `DEV_MASTER_KEY` (`audits/a11-roadmap-status.md` §5 C3), after WP-11 confirms the list against the code.
- Rename the Railway project from `founder-manager` to `foundmill` (cosmetic).

### S17. Later, with the phone app
OneSignal, universal-link files, the store-links value, Sign in with Apple (a founder decision, `audits/a11-roadmap-status.md` §6 item 2), ElevenLabs voices, own-key connectors into `LIVE_CONNECTORS` after one live run each. None stands between a web founder and a first outcome.

## 3. What only the founder can do, in one list

1. One two-minute test of the idea box and a follow (S1).
2. Read three variable values in Railway aloud (S3).
3. Say who to admit, and when to open sign-up (S5).
4. Stripe: the account, verification and keys (S8).
5. Choose and buy a domain for sites (S9).
6. Supabase auth settings (S10).
7. Spend limits at Anthropic and E2B (S13).
8. The Vercel plan (S14).
9. Merge pull requests, as always.

Everything else in this file is done by a Desktop session through the connectors, on a go-ahead, or by the cloud session in code.

## Starting prompt (Desktop session)

```
Read docs/holistic-plan/WP-00-setup-and-switches.md and audits/e0-production-evidence.md. Using the Vercel, Railway and Supabase connectors, re-read the state table in section 1 (names and health answers only; never read or print a secret value) and tell me what changed since Nov 15. Then do step S<n>. Before any change to production, show me the exact variable or setting and its new value and wait for my yes. After it, run the step's verify line and write the result and the date into docs/DEPLOY.md on a branch, and open a pull request.
```
