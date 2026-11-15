# Production evidence (read-only checks, Nov 15, 2026, by the planning session)

Sources: Supabase project `foundermanager` (ref sdruubitufjqibsjyxlc, eu-north-1, Postgres 17) via read-only aggregate SQL; Supabase advisors; Vercel project `foundmill` (team fm-2f083c2b); Railway project `founder-manager` (id 88ed6cdd-f191-4578-804d-7f8c660ce437); GitHub Actions.

## Infra state
- Vercel: project `foundmill` (prj_VPAppeKuyQZt74ef8IEQWew5IMii), production = main 04a0a509, READY; domains foundmill.com, www, foundmill.vercel.app, founder-manager.vercel.app; SSO protection on all except custom domains; no runtime errors in the last 7 days.
- Railway (project still named `founder-manager`): services api, gateway, orchestrator, composer, stream, ingest (all redeployed 2026-11-15 08:52 UTC, online, 1 replica each), temporal + temporal-ui (Oct 6/8), Postgres (Temporal's), Redis. No collab or social service deployed.
- Supabase: 131 public tables, all RLS-enabled; `list_migrations` is empty (migrations run from the api at boot through drizzle, not Supabase's table). Extensions: pg_trgm and vector in `public`, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault. A leftover schema `bak_20261013` holds 89 backup tables without primary keys.
- CI: `CI` workflow takes 1h00 to 1h08 per run on main and PRs; `Security scans` 25 s. Both green on main.
- Cloud environments for Claude Code now exist: "Default" (default) and "Foundmill build".

## Supabase advisors
Security: 10 tables with RLS on and no policy (account_admissions, account_outbox, attributions, credentials, founder_cancel_links, idea_drafts, person_handle_releases, persona_portraits, retired_mail_local_parts, waitlist_entries: service-only by design, INFO); 13 functions with a mutable search_path (fm_set_updated_at, fm_track_updated_at, fm_tenant_table, fm_idea_table, entities_search_update, audit_log_chain, audit_log_immutable, fm_agents_clear_paused_reason, fm_business_currency, fm_page_content_ok, fm_person_tags_ok, admission_existing_before, fm_page_quiz_ok: WARN); pg_trgm and vector in public (WARN); leaked-password protection off (WARN; sign-in is by link and Google).
Performance: 45 RLS policies re-evaluate auth.uid() per row (auth_rls_initplan: wrap as `(select auth.uid())`), on memberships, connections, dashboard_layouts, posts, community_members, ideas, idea_versions, idea_comparisons, adult_confirmations, founder_profiles, businesses, messages, message_threads, communities, account_preferences, post_reports, network_attestations, saved_table_views, inbox_item_reads, founder_devices, founder_notifications, account_events, invitations, founder_presence, founder_visit_days; 320 "multiple permissive policies" (the `T_select` + `T_write for all` pattern evaluates two policies on every select); 6 unindexed foreign keys (account_outbox, agent_messages, inbox_item_reads, showcase_consents, team_call_actions, team_call_turns); 149 unused indexes (pre-launch volume; ignore for now); Auth connection cap is absolute (10).

## People and projects
- auth.users: 19 total; 1 created in the last 14 days; 2 signed in during the last 14 days. founder_profiles: 12.
- waitlist_entries 0, invitations 0, account_admissions 0, idea_drafts 1 (the landing idea box has produced one draft).
- businesses: 15 = 2 demo + 13 real. All 13 real: free tier, assisted mode, committed. 12 on credits, 1 on its own key. Created Oct 5 to Oct 25; none since. 10 distinct owners. Archetypes: b2b_saas 7, consumer_app 4, marketplace 1, content_media 1 (no physical product, no services).
- Every real project was given 25 to 27 agents at commit.
- project_pages: 0 rows. No project has a draft or published public page. followers, posts, post links, quizzes, showcase: 0 rows.
- founder_visit_days: 2 users in the last 14 days, 1 or 2 per day.
- Per real project: 11 of 13 ran 1 to 3 cycles on their first day and never again; founders answered 0 to 1 decisions (5 at most) and the last founder decision is the creation date. They received 4 to 17 notes on day one. Only two projects show sustained work: Foundmill's own (41 cycles, 224 sessions, 17 decisions answered, GitHub connected) and one marketplace project (16 cycles).
- integrations (real projects): github connected 1, anthropic connected 1, sendgrid mock 1, bolagsverket mock 1.

## Agent work (real projects only)
- agent_sessions: 319 = done 81 (25%), blocked 215 (67%), failed 23 (7%). 17,174 further sessions belong to the two demo projects (seed data).
- By model: opus 142 sessions, $58.25, average 388k input / 7.2k output tokens, 1.7 min; sonnet 176 sessions, $24.67, average 222k input / 3.7k output tokens, 2.3 min; haiku 1.
- usage_ledger total about $119: opus on own key $65.41, opus on credits $24.35, sonnet own key $22.32, sonnet credits $5.40, haiku credits $0.91, sandbox $0.58, tools $0.50. One project (Foundmill's own) is $93.85 of it; the other twelve spent $0.57 to $7.36 each.
- Monthly free credit is $5.00; November balances of the other projects sit at $3.47 to $4.92 (they barely run).
- events: task.blocked 299 vs task.completed 80; blocked by task kind: code 138, ops 77, research 55, legal 17, finance 8, channel 4. approval.requested 127 vs approval.resolved 14; requested by tool: launch_campaign 79, request_human_action 36, merge_pr 12. agent.health_changed 744.
- tasks: research done 28, legal done 13, code done 10, finance done 9; code stopped 9, blocked 8, failed 3; many planned/ready never started.
- inbox_items: decision archived 60, answered 31, unread 19; update unread 47; warning unread 32.
- skill_definitions: 196 platform, 4 uploaded (real projects), 0 from the library. skill_tests: 0 rows. training_runs: 1 real (awaiting a decision since Oct 22, cost $12.78), 1 demo.

## Live configuration, read on Nov 15, 2026 (names only; no values were read)

The repo's record of what is configured (docs/DEPLOY.md §6) stops on Oct 20. This is what the services actually carry. Values of `LIVE_CONNECTORS`, `MODEL_MODE` and the secrets were not read.

- `GET https://api.foundmill.com/health`: `env: "staging"`, `modes: { integrations: "mock", models: "live" }`, db, redis, temporal, composer, vault and both worker queues healthy.
- `GET https://ingest.foundmill.com/health`: `mode: "mock"`, `webhooks: []`, `refusedMockWebhooks: ["dropbox_sign","github","sendgrid","shopify","stripe"]`, nonce store redis, `simulate: true`. So ingest accepts no vendor webhook at all today, SendGrid's event webhook (bounces, spam reports, unsubscribes) included: ingest has no `LIVE_CONNECTORS` variable.
- Vercel `foundmill` (production): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (set Nov 13, production and preview), `IDEA_COOKIE_DOMAIN` (Nov 13), `NEXT_PUBLIC_AUTH_GOOGLE` (Nov 12), `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STREAM_URL`, `NEXT_PUBLIC_INGEST_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_INTEGRATIONS_MODE`, `APP_ENV`, `INTEGRATIONS_MODE`, `MODEL_MODE`. No store-links value. Deployment protection: SSO on everything except custom domains.
- Railway gateway variables: `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY`, `PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_SIGNING_SECRET`, `PLATFORM_MAIL_DAILY_CEILING`, `SENDGRID_API_KEY`, `INGEST_PUBLIC_URL`, `INGEST_URL`, `LIVE_CONNECTORS`, `MODEL_MODE`, `INTEGRATIONS_MODE`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, the five `GITHUB_APP_*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_TOKEN_SECRET`, `DEV_MASTER_KEY`, `DATA_REGION`, plus URLs and Temporal. Missing: any `STRIPE_*`, `ONESIGNAL_*`. "Wait for CI" (`checkSuites`) is off.
- Railway api variables: `IDEA_COOKIE_DOMAIN`, `INGEST_URL`, `NOTIFY_EMAIL`, `PLATFORM_MAIL_DOMAIN`, `LIVE_CONNECTORS`, `SEED_ON_BOOT`, `SEED_OWNER_EMAILS`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and the shared set. Missing: `SIGNUP_OPEN`, `SIGNUP_DAILY_CEILING` (sign-up is closed to a list). "Wait for CI" is off.
- Railway ingest variables: `PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_SIGNING_SECRET`, `PLATFORM_MAIL_INBOUND_TOKEN`, `PLATFORM_MAIL_EVENT_PUBLIC_KEY`, `ANTHROPIC_API_KEY`, the shared set. Missing: `LIVE_CONNECTORS`, `STRIPE_BILLING_WEBHOOK_SECRET`. "Wait for CI" is on.
- Railway orchestrator variables: `E2B_API_KEY`, `E2B_TEMPLATE`, `SANDBOX_MODE`, `PLATFORM_MAIL_DOMAIN`, `LIVE_CONNECTORS`, `ANTHROPIC_API_KEY`, the shared set. "Wait for CI" is on.
- All four services: builder Railpack, one replica in `ams`, healthcheck set, 60 s draining, no watch paths, source `reidjxn/foundmill` branch `main`.
- DNS: nameservers at Spaceship. `mail.foundmill.com` MX is `mx.sendgrid.net` (inbound parse is pointed). `_dmarc.foundmill.com` is `p=none`; `_dmarc.mail.foundmill.com` is `p=none` with a report address.
- Search: `https://foundmill.com/robots.txt` and `/sitemap.xml` return 404; the landing page sends `<meta name="robots" content="noindex, nofollow">`.
- So, against the "pending setup" list in audits/a11-roadmap-status.md §5: A3 (Turnstile) and A4 (idea cookie) look done on both sides; A8's Vercel flag is on (the sign-in page shows "Continue with Google"); A1/A2 (platform mail) have their variables and the inbound MX, with domain authentication and the event webhook not confirmed, and ingest still refusing SendGrid's webhook; A5 (web research), A6 (Stripe), A9 (open sign-up), B1 (push), C1 (wait for CI on api and gateway) and C2 (watch paths) are not done.
