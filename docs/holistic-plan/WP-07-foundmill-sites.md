# WP-07: Foundmill Sites

**Goal:** a founder with no GitHub gets a small site, built by their team, with a waitlist form and a pay button, at an address they can send to people.

**Why:** for a founder without a repository a code task saves files nobody can open, each task starts from its own files only, and the only thing a stranger can open is `/p/<slug>` (`audits/a4-building-product.md` A4-02, A4-03, §1.5, §8). Specialists are told to record suppliers and cannot (A4-07). Templates and the acceptance run assume Foundmill's own monorepo (A4-14). The task after "shipped" asks an agent with no browser to record a demo (A4-18). For a founder who does bring a repository, the choice is hidden behind a Builder-view tab and previews that already exist are not shown (A4-04, A4-17). The session runtime this builds on is described in `audits/a3a-agent-runtime.md` §1.4 to §1.7.

**Done when (measured):**
1. On a stack with `SITES_DOMAIN` set, mock integrations and no GitHub connection, the Playwright spec `apps/web/e2e/site.spec.ts` goes from a committed project to a published site in one run: two code tasks finish `done`, the second release contains the first task's files, the founder presses Publish, `GET http://<slug>.<SITES_DOMAIN>/` answers 200 with the page, a form submission followed by the confirmation link produces one `page.followed` event and one contact in Customers.
2. A pay button on the published site redirects to the stored link; in mock mode a simulated payment is labeled simulated and counts for nothing.
3. In production, after both go-aheads below: one real project reaches `site.published`, and a stranger's confirmed sign-up appears in Customers. The nightly numbers (WP-02) show `site.published` as a real outcome.
4. With `SITES_DOMAIN` unset, nothing in the product mentions a site: no tab, no note, no Planner destination. `apps/web/e2e/site.spec.ts` has a case for this.
5. `pnpm test` passes the cross-tenant tests for `sites`, `site_releases`, `pay_links` and the serving functions.

**The founder's answer this package stands on** (docs/DECISIONS.md, "2026-11-11 — The last five answers to docs/THESIS_REVIEW.md §14", item 5):

> "Foundmill-owned repositories and hosting for software projects: yes, after pages and email are proven. Package 1.7 stays last in phase 1."

Two go-aheads are needed, and neither exists on Nov 15, 2026:
- **Go-ahead A, "proven".** The founder says pages and email are proven and it is recorded in docs/DECISIONS.md. On Nov 15 production has 0 public pages and 14 `notify.email_sent` events (`audits/e0-production-evidence.md`), so they are not. Proposed bar, for the founder to change (Decision D1): 5 real projects with a published page and 10 confirmed follows from a confirmation email. T2 to T10 do not start before it.
- **Go-ahead B, a separate domain.** A registrable domain that is not `foundmill.com` or a subdomain of it, bought by the founder (WP-00 S9). Sites carry content written by agents for strangers; on a subdomain they would share cookies' scope and mail and search reputation with the product. T4's deploy and every live step wait for it; the code is built and tested with `SITES_DOMAIN=sites.localhost`.

T1, T11 and T12 need neither and can start with the third wave.

**Scope in:** `sites`, `site_releases`, `pay_links` tables; `apps/sites`; site sessions (start from the latest release, save a release); screening, publish, unpublish, takedown; the Product › Site tab and the Needs you note; the waitlist form on the existing follow path; the pay button and the `create_payment_link` tool; Planner destination `site`, the static starter, first builds for service and physical-product projects; the demo task; CRM write tools for specialists; the repository choice in Settings; previews for a connected repository.

**Scope out:** the A4-01 short-term fix, the `destination` value itself and the Planner request builder (WP-05); the truthful sentences of A4-03 and A4-10 for a founder with no destination (WP-02); `save_report` and `task_reports` (WP-05, AR-02); the price and pay or ask button on `/p/<slug>` and payment attribution to a post (WP-08, which uses `pay_links` and `create_payment_link` from here); site-level robots and sitemap for foundmill.com (WP-03); model routes and prices (WP-09); the Stripe webhook item N3 (WP-11); the look of the tab beyond design-system components (WP-10).

**Depends on:** WP-05 (the task that makes a code task `done` with `landed: "saved_only"`, and the task that adds `destination` to the Planner; both edit `apps/orchestrator/src/activities/session.ts`, so T3 and T9 start after they merge). WP-02 (false sentences removed first). WP-00 S8 for T8, S9 for T4's deploy.

**Collides with:** every WP-05 task that edits `session.ts` (never in parallel with T3, T9); WP-08's public-page task (`packages/shared/src/project-page.ts`, `apps/api/src/services/pages.ts`: T6 touches `followPage`); WP-01 (a seventh service in `scripts/railway-config.test.mjs` and the Railway watch patterns); `claude/blissful-fermat-q03yq1` (touches `packages/dugout/src/components/public/*`: T5 adds no public component, T4 serves plain HTML).

**Setup it needs:** WP-00 S9 (domain, Railway service, wildcard DNS and certificate, plus three additions written in T4: the `sites_reader` database login, the sites domain added to the Turnstile widget's hostnames, `SITES_DOMAIN` on api, orchestrator and sites). WP-00 S8 (Stripe) for T8 only. WP-00 S2 (ingest hears SendGrid) before T6 is switched on, so bounces from confirmation emails are processed.

## What is cut from the audit's design (§8), and why

| §8 proposed | This package | Why |
| --- | --- | --- |
| `site_forms` table, kinds waitlist, contact and booking request, a `<fm-form>` element with a script, a new ingest route | One plain HTML form that posts to the site's own `/_fm/follow`, which calls the existing `publicPage.follow` | The follow path already has double opt-in, the consent record, the limits, the bot check, the CRM lead and `page.followed` (`apps/api/src/services/pages.ts:548`). A second form pipeline would copy it. Contact and booking forms wait until a founder asks. |
| `site_products` with a file delivered after payment | `pay_links` (business-level) and a redirect; no file delivery | Delivery needs the payment webhook live and proven, signed expiring links and storage for files that are not text or images. A Stripe payment link can show the founder's own after-payment message or redirect. Later. |
| JavaScript allowed from the site's own origin | No JavaScript in slice one: `script-src 'none'` | The first sites are a page, a form and a button. With no scripts a site cannot phish with a fake sign-in, mine, redirect or fingerprint, and screening stays a simple text check. |
| Design check and second read on every release | Deterministic screening only; the founder opens the real preview | The design check probably cannot capture in production (A4-11) and each costs an Opus call. A preview link is better evidence than two screenshots. WP-05 owns the second read's hand-back. |
| A CDN in front | Cache headers only | No traffic yet. |
| Release states draft, preview, live, superseded, held | `preview` or `held`; "live" is `sites.live_release_id` | One fact in one place. |
| Events `site.screened`, `site.form_submitted` | Not added | Screening is a column; a form submission is `page.followed` once confirmed. |
| "Site live" milestone | Not added | No finding asks for it. |
| A new `documents` table and `write_document` (A4-07) | WP-05's `task_reports` (`kind: "document"`) | Same thing, already planned once. |
| `init_repository` for an empty GitHub repository (A4-04 fix 2) | An honest message | The target founder has no GitHub, and Sites covers them. |
| Removing the Temporal lines from the acceptance prepare script (A4-14) | Not done | Site tasks skip the acceptance run entirely; the lines only matter for Foundmill's own repository. |

## Security rules that hold in every task

1. **Static only.** A release is HTML, CSS, images, fonts and text. Nothing runs on the server for a site; `apps/sites` only reads bytes and answers three fixed `/_fm/*` routes it owns.
2. **The session stays confined** (docs/DECISIONS.md "2026-10-07 — SEC-3: the SDK host process is confined"): a site task is a `code` task, so it gets `Read, Glob, Grep, Edit, Write` and gateway tools, no shell, no browser, `settingSources: []` (`sdk-isolation.ts:42-44`, `session.ts:1738-1781`). No new SDK tool and no sandbox are added. The release builder applies the same exclusions as a save: `isSdkHomeEntry`, `STARTUP_FILES`, `isSecretFileName` (`workspace-sync.ts:61`, `workspace-store.ts:110-162`).
3. **Publishing is the founder's own press**, as for the page (`publishPage`, `apps/api/src/services/pages.ts:218`). No capability in `packages/connectors/src/grants.ts` reaches `site.publish`; a test asserts it.
4. **Tenant isolation.** Every table has `business_id`, RLS and a cross-tenant test in the task that adds it. `apps/sites` connects as a database login that can execute two functions and nothing else.
5. **A separate domain**, strict response headers, a report link on every site, takedown in one statement, limits on releases, publishes and form posts.
6. **Untrusted input.** A sign-up's email address goes through the follow path unchanged. Nothing a visitor types is put into a prompt.
7. **Simulated is never reported as done.** A mock payment link carries `simulated` and the tab says so.

## Tasks

Order: T1, T11, T12 any time. Then T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10. Migrations take the next free number when the branch is cut (0108, journal idx 96, at `04a0a509`); renumber on rebase.

### T1: Specialists can record a supplier and an interaction   [M] [ships alone] [no go-ahead needed]

- [ ] done

**Why:** A4-07. Acceptance "At least 20 suppliers recorded as CRM entities" against a grant list with no CRM write (`packages/agents/src/templates/specialists/_specialist.ts:33-36`); the description still says "Tools: documents in Google Drive, CRM search, email drafts" (`:39`).

**Files:** modify `packages/connectors/src/connectors/platform/tools.ts`, `packages/connectors/src/connectors/platform/mock.ts` (and `index.ts` if the host interface is declared there), `apps/gateway/src/platform-host.ts`, `packages/connectors/src/grants.ts`, `packages/agents/src/templates/specialists/_specialist.ts`, `packages/agents/src/templates/workers/product_researcher.ts`, `packages/agents/src/archetypes.ts` (the two first-cycle specialist tasks' acceptance lines), `packages/agents/src/templates/PLANNED_GRANTS.md` (delete the two rows). Tests: `packages/connectors/src/connectors/platform/platform.test.ts`, a new `apps/gateway/src/__tests__/platform-crm.test.ts` (in the style of `platform-skills.test.ts`), `apps/orchestrator/src/__tests__/grants-contract.test.ts`.

**Interfaces.**
- Consumes: `repos.entities.create(db, businessId, input: CreateEntityInput): Promise<Entity>` (`packages/db/src/repos/entities.ts:556`), `repos.entities.createInteraction(db, businessId, input: CreateInteractionInput)` (`:812`), `ENTITY_KINDS` (`packages/shared/src/constants.ts:330`), the host pattern of `searchEntities(caller, { query, limit })` (`platform-host.ts:213`), `CAPABILITY_TOOLS.platform` (`grants.ts:215-234`).
- Produces (platform tools, real and mock):
  - `create_entity` input `{ kind: "person" | "organisation", name: string(1..200), role: "supplier" | "lab" | "contact", sourceUrl: url, note?: string(≤500) }`, output `{ entityId, created: boolean }` (an existing record with the same name and kind is returned, not duplicated). Hints `{}`: it writes inside the project only. Capability `crm.entities.create`.
  - `log_interaction` input `{ entityId: Id, summary: string(1..1000), sourceUrl?: url }`, output `{ interactionId }`. Hints `{}`. Capability `crm.interactions.append`.
  - Both audited as the agent (`repos.audit.append`, actor kind `agent`), both refuse an email address or phone number in `name` or `summary` when the task's sources are simulated (the rule "a simulated result is never reported as an action": the record would be an invented company).
- `SPECIALIST_PLATFORM_TOOLS` becomes `["crm.entities.search", "crm.entities.create", "crm.interactions.append", "spec.read"]`; the product researcher gets the same two.

**Copy.** Before (`_specialist.ts:39`): "Tools: documents in Google Drive, CRM search, email drafts, web research through the quarantined reader." After: "Tools: web research through the quarantined reader, CRM search and new CRM records, reports saved on the task." (the last clause only if WP-05's `save_report` has merged; otherwise leave it out.)
Before (`archetypes.ts:455`): "At least 20 suppliers recorded as CRM entities". After: "At least 10 suppliers recorded in Customers, each with the page it was found on" (10 is an Estimate of what one session of 60 turns can do).

**Steps.**
1. Write the failing contract tests for both tools (real host against the test database, mock). verify: `pnpm --filter @foundmill/connectors test platform` fails on the missing tools.
2. Add the tools, the host methods and the capability map entries. verify: the tests pass; `grants-contract.test.ts` passes (every template grant resolves).
3. Re-grant, fix the description and the acceptance lines, delete the PLANNED_GRANTS rows. verify: `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs` pass; `grep -n "Google Drive" packages/agents/src/templates/specialists/_specialist.ts` prints nothing.
4. Add a cross-business test: an agent of business A calling `log_interaction` with an entity of business B is refused. verify: the test passes.

**Tests and evals:** the files above; one session test in `apps/orchestrator/src/__tests__/session.test.ts` style with mock tools: a specialist task ends with at least one `create_entity` call and no `block_task`.
**Done when:** a specialist session on a mock stack leaves supplier records a founder can open in Customers.

### T2: Site tables, the switch and the events   [M] [ships alone] [needs go-ahead A]

- [x] done

**Why:** A4-02, A4-03; §8 architecture items 1 and "Events".

**Files:** create `packages/db/migrations/<next>_sites.sql`, `packages/db/src/schema/sites.ts`, `packages/db/src/repos/sites.ts`, `packages/db/src/__tests__/rls/sites.test.ts`, `packages/shared/src/sites.ts`, `packages/shared/src/sites.test.ts`. Modify `packages/db/src/schema/index.ts`, `packages/db/src/repos/index.ts`, `packages/shared/src/env.ts`, `packages/shared/src/index.ts`, `packages/events/src/catalogue.ts`, `.env.example`, docs/ARCHITECTURE.md (tables and events lists).

**Interfaces.**
- Consumes: `fm_tenant_table('<table>', array['owner','admin','member'], 'read_only')` (as `0013` does for `workspace_snapshots`), `is_member`, `has_role`, `WorkspaceManifestEntry` and `workspace_blobs` (`packages/db/src/schema/workspaces.ts`), `pageSlugProblem` (`packages/shared/src/project-page.ts`), `declareEvent` (`packages/events/src/catalogue.ts`).
- Produces, tables:
  - `sites`: `id uuid pk`, `business_id uuid not null unique references businesses on delete cascade`, `slug text not null unique`, `status text not null default 'draft' check (status in ('draft','live','taken_down'))`, `live_release_id uuid null`, `starter_key text not null default 'static-site'`, `taken_down_reason text null`, `created_at`, `updated_at`. RLS: members read; inserts by the service role only; one update policy `sites_publish` for owner or admin, `using (has_role(business_id, array['owner','admin']) and status <> 'taken_down')`, `with check (status in ('draft','live') and (live_release_id is null or exists (select 1 from site_releases r where r.id = live_release_id and r.business_id = sites.business_id and r.state = 'preview')))`. A founder can never undo a takedown or point the site at a held release.
  - `site_releases`: `id`, `business_id`, `site_id uuid not null references sites on delete cascade`, `number int not null` (unique with `site_id`), `parent_release_id uuid null`, `task_id uuid null references tasks on delete set null`, `session_id uuid null`, `agent_id uuid null`, `files jsonb not null` (`WorkspaceManifestEntry[]`, the whole site), `file_count int`, `total_bytes bigint`, `content_hash char(64) not null` (sha256 over the sorted `path:sha256` lines), `state text not null check (state in ('preview','held'))`, `screening jsonb not null default '{"flags":[]}'`, `preview_token text not null unique` (32 hex characters from `randomBytes(16)`), `published_by uuid null`, `published_at timestamptz null`, `created_at`. RLS: members read; writes by the service role only.
  - `pay_links` is added in T7, not here.
- Produces, functions (security definer, `search_path` pinned, execute granted to `service_role` and to the login role `sites_reader` created in T4): `site_resolve(label text) returns table (release_id uuid, business_id uuid, kind text)` where `label` is the host's first label: a `p-<token>` label resolves a `preview` release of a site that is not taken down; any other label resolves `sites.slug` with `status = 'live'` to `live_release_id`. `site_file(release uuid, path text) returns table (content bytea, sha256 char(64), size int)` joins the release's manifest to `workspace_blobs` on `(business_id, sha256)`.
- Produces, `packages/shared/src/sites.ts`: `SITE_LIMITS = { maxFiles: 200, maxTotalBytes: 10 * 1024 * 1024, maxFileBytes: 2 * 1024 * 1024, publishesPerDay: 20 }` (Estimates), `SITE_FILE_TYPES` (extension to content type: `.html .css .png .jpg .jpeg .webp .gif .svg .ico .woff2 .txt .webmanifest`), `SITE_RESERVED_SLUGS = ["www","api","app","mail","admin","preview","status","report","assets","static"]`, `siteSlugProblem(slug)` (`pageSlugProblem` plus reserved words plus "must not start with `p-`"), `siteUrl(domain, slug)`, `sitePreviewUrl(domain, token)`, `sitesEnabled(env: { SITES_DOMAIN?: string }): boolean`.
- Produces, env (`packages/shared/src/env.ts`): `SITES_DOMAIN` optional, same shape rule as `PLATFORM_MAIL_DOMAIN` (`:112-116`), refused when it equals or ends with the host of `APP_URL`. Unset means the feature is off everywhere.
- Produces, events (Zod, outbox): `site.release_created` `{ siteId: Id, releaseId: Id, number: Count, taskId: Id.nullable(), fileCount: Count, totalBytes: Count, state: z.enum(["preview","held"]), previewUrl: z.url().nullable() }` consumers `["stream","composer"]`; `site.published` `{ siteId, releaseId, number, slug, url: z.url() }` consumers `["stream","metrics"]`, `narratable: false`, doc says it is a real outside result the north star counts, like `page.published` (`catalogue.ts:1772`); `site.unpublished` `{ siteId, slug, url, by: z.enum(["founder","platform"]) }`. `deploy.succeeded` (`:459`) is reused with `provider: "foundmill"`, `commitSha: <content_hash>`, `environment: "preview" | "production"`.
- Produces, repo `repos.sites`: `get(db, businessId)`, `ensure(db, businessId, { slug })`, `latestRelease(db, businessId)` (newest `preview`, else null), `saveRelease(db, businessId, input)`, `publish(tx, businessId, { releaseId, userId })`, `unpublish(tx, businessId)`, `listReleases(db, businessId, limit)`, `resolveHost(db, label)`, `readFile(db, releaseId, path)`, `publishesToday(db, businessId)`.

**Steps.**
1. Write `sites.test.ts` (RLS): a member of A reads A's site and releases and none of B's; a member cannot insert a release; an owner cannot set `live_release_id` to a held release or to B's release; an owner cannot change a `taken_down` site; `site_resolve` returns nothing for a draft site, a held release, a taken-down site or an unknown label; `site_file` of A's release never returns a blob that exists only for B. verify: fails (no tables).
2. Write the migration, schema and repo. verify: the RLS suite passes on real Postgres (WP-11's A8-01 lane) and `pnpm --filter @foundmill/db test`.
3. Add the env variable, the shared helpers with unit tests (slug rules, URL builders, limits), and the three events. verify: `pnpm --filter @foundmill/shared test sites`, `pnpm --filter @foundmill/events test`.
**Tests and evals:** as named; no agent behavior yet.
**Done when:** the tables, functions and events exist, nothing reads them, and the cross-tenant tests pass.

### T3: A site session starts from the latest release and ends in a release   [L] [ships alone] [needs go-ahead A] [after every WP-05 task on `session.ts`]

- [ ] done

**Why:** A4-02 ("Do not patch per-task restore"), A4-03, A4-14; §8 item 2; a3a §1.4 ("After the SDK ends"), §1.6.

**Files:** create `apps/orchestrator/src/activities/site-workspace.ts`, `apps/orchestrator/src/__tests__/site-workspace.test.ts`, `packages/agents/src/starters/static-site/` (`index.html`, `styles.css`, `README.md`), `packages/agents/src/starters/index.ts`. Modify `apps/orchestrator/src/activities/session.ts` (three places named below), `apps/orchestrator/src/activities/types.ts`, `apps/orchestrator/src/__tests__/session-live.test.ts`, `packages/agents/src/index.ts`.

**Interfaces.**
- Consumes: `CheckoutBase` (`checkout.ts:67`: `repo, ref, commitSha, files: Map<path, sha256>, knownSecrets, packageScripts, checkedOutAt`), `restoreWorkspace(db, businessId, taskId, cwd, limits, batchBytes, { checkout: boolean })` (`workspace-store.ts:238`), `saveWorkspace(db, owner, cwd, { base })` (`:357`: with a base only the difference is saved, with `removedPaths`), `repos.workspaces.latest`, `repos.workspaces.readFiles` (`packages/db/src/repos/workspaces.ts:168, 451`), `restorablePath` (`workspace-store.ts:165`), `codeTaskNote(branch)` (`session.ts:2021`), `finishSession` (`:912`), the `policy.fileTools` branch in the run (`:1470-1500`), `runAcceptance` (`:2493`), `keepWorkspace` (called at `:2004`), WP-05's destination reader (expected name `codeDestination(db, businessId): "none" | "github"` beside `loadProductStage` in `packages/db/src/product-stage.ts`; use the name WP-05 merged).
- Produces:
  - `packages/db/src/product-stage.ts`: the destination type gains `"site"`: returned when `sitesEnabled(env)` and the business has no code repository (`repos.integrations.codeRepository` is null) and is not a demo.
  - `site-workspace.ts`: `siteCheckout(db, businessId, cwd): Promise<{ base: CheckoutBase; releaseId: string | null; note: string }>` writes the latest `preview` release's files (or the starter when there is none) into `cwd` and returns a base with `repo: "site"`, `ref: "r<number>"` (`"starter"` for the starter), `commitSha: <content_hash>`, `files` from the manifest, empty `knownSecrets` and `packageScripts`. `applySiteChanges(latest: WorkspaceManifestEntry[], baseFiles: ReadonlyMap<string,string>, changed: WorkspaceManifestEntry[], removed: string[]): { files: WorkspaceManifestEntry[] } | { conflict: string[] }` (pure): a path conflicts when the task changed or removed it and `latest` differs from the base at that path. `buildSiteRelease(deps, { businessId, taskId, sessionId, agentId })` reads the task's newest snapshot (a difference against its base), applies it to the latest release, runs `screenSiteFiles` (T5 adds the content rules; here only the path, type and size rules of `SITE_LIMITS` and `SITE_FILE_TYPES`), saves the release (`preview` or `held`) and emits `site.release_created` and, for `preview`, `deploy.succeeded` (`environment: "preview"`).
  - `siteTaskNote(): string` replaces `codeTaskNote` for a site task. Text: "Work inside your working directory; it holds the project's site as it stands now. The site is static: HTML, CSS and images only. Do not write JavaScript, a server, a package.json or tests; none of them are served. When your session ends the platform saves your changes as a new version of the site and gives the founder a preview link; the founder decides what goes live. Never block the task because you cannot run or open the site yourself. A sign-up form is `<form method=\"post\" action=\"/_fm/follow\">` with one `<input type=\"email\" name=\"email\" required>`; a pay button is `<a href=\"/_fm/pay/<key>\">` for a key that `list_pay_links` returns (T7)." The last sentence is added by T6 and T7.
- `session.ts` changes: (1) in the `policy.fileTools` branch, when the destination is `site`: skip `updateConflicts` and `checkoutRepository`, call `siteCheckout`, then `restoreWorkspace(..., { checkout: true })` only when the task has its own snapshot; pass `base` to the save. (2) After the SDK ends, a site task skips `runAcceptance` (no sandbox is started, so no E2B time is booked) and records `acceptanceTests: 0`. (3) `finishSession`, case `"done"`: a site task calls `buildSiteRelease`; a `preview` or `held` release makes the task `done` with `task.completed.payload.landed = "site"` (extend the optional field WP-05 added for `"saved_only"`); a conflict makes it `blocked` with reason `needs_update` (`catalogue.ts:395`) and the conflict's paths in the detail, so the next session starts from the newest release.
- Workflow safety: `buildSiteRelease` is idempotent on `sessionId` (unique index on `site_releases.session_id` where not null, added to T2's migration if T2 has not merged, else a small migration here), so a Temporal retry of `finishSession` writes one release. No workflow code changes, so no `patched()`.

**Steps.**
1. Unit tests for `applySiteChanges` (add, change, remove, both sides changed the same file, both removed) and `siteCheckout` (starter when no release; refuses a manifest path `restorablePath` rejects). verify: fail, then pass.
2. `session-live.test.ts`: with destination `site` and no repository, task A writes `about.html` and ends `done` with a release 1; task B (depends on A) starts with `about.html` present, writes `pricing.html`, release 2 holds both; two tasks from the same parent editing `index.html` end with one `done` and one `blocked/needs_update`; a retry of `finishSession` leaves one release. verify: fails before the `session.ts` change, passes after.
3. The starter: one `index.html` (headline, one paragraph, the sign-up form block, a footer slot), one `styles.css`, system fonts only, readable at 390 px. `starters/index.ts` exports `starterFiles(key): { path: string; content: string }[]` read at build time (no file system access at run time in the orchestrator image: import the files as strings). verify: a unit test that the starter passes `screenSiteFiles` and the two copy linters.
4. verify: `pnpm --filter @foundmill/orchestrator test` and typecheck.
**Tests and evals:** above; plus `apps/orchestrator/src/__tests__/sdk-isolation.test.ts` gains one assertion that a site task's policy is exactly the `code` policy (no new tool).
**Done when:** two dependent site tasks on a mock stack produce one site whose second release contains both tasks' files, and neither waits in `review`.

### T4: `apps/sites`, the service that serves previews and live sites   [M] [ships alone] [code needs go-ahead A; deploy needs go-ahead B, WP-00 S9]

- [x] done (code; the deploy waits for WP-00 S9)

**Why:** A4-03; §8 item 3 and "Risks".

**Files:** create `apps/sites/` (`package.json` copied from `apps/ingest/package.json` without the Temporal and connectors dependencies, `tsconfig.json`, `src/index.ts`, `src/app.ts`, `src/headers.ts`, `src/pages.ts` for the platform's own small HTML pages, `src/__tests__/app.test.ts`, `CLAUDE.md`), `railway/sites.toml` (copy of `railway/ingest.toml` with `/apps/sites/**`). Modify `Dockerfile` (comment on line 2 lists `sites`), `scripts/railway-config.test.mjs` (`SERVICES` gains `"sites"`), docs/ARCHITECTURE.md §1, docs/DEPLOY.md (a "Sites" section with the setup below), the migration of T2 or a new one for the `sites_reader` role.

**Interfaces.**
- Consumes: `repos.sites.resolveHost`, `repos.sites.readFile`, `SITE_FILE_TYPES`, `tierShowsBuiltOnMark(tier)` (`packages/config/src/pricing.ts:119`), the Hono app shape of `apps/ingest/src/app.ts` (`/health`, `tooLarge`), `loadEnv()`.
- Produces: `createSitesApp(deps): Hono`.
  - `GET /health` on any host.
  - Any other host must be `<label>.<SITES_DOMAIN>`; otherwise 404. `GET` and `HEAD` only for site paths; path normalized, no `..`, no dotfiles, `/` and directory paths map to `index.html`, an unknown path serves the release's `404.html` if it has one, else a plain 404.
  - Headers on every site response (`headers.ts`, one function, unit-tested): `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security` in production, no `Set-Cookie` ever. Content type only from `SITE_FILE_TYPES`; anything else 404. Previews add `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`; live HTML `Cache-Control: public, max-age=60`; other live files `max-age=3600` with an `ETag` of the sha256.
  - Before `</body>` of every HTML response the service appends one fixed footer (escaped, no project text in it): "Report this site" linking to `/_fm/report`, and for a project whose plan shows the mark, "Built on Foundmill" linking to `APP_URL` (see Decision D3).
  - `GET /_fm/report` and `POST /_fm/report`: a platform page with a reason select and a free-text field (≤ 1,000 characters); the post writes one audit row `site.reported` for the site's business with the reason (never the reporter's address), limited to 5 a minute per site and 30 a day per site (in-process counter is not enough across replicas: use the Redis limiter the api uses, or run one replica and say so in DEPLOY.md).
  - A taken-down site answers 410 with a plain page: "This site is no longer available."
- Database login: `sites_reader`, `nologin` in the migration, with `grant execute on function site_resolve(text), site_file(uuid, text) to sites_reader` and nothing else. Setup step for docs/DEPLOY.md and WP-00 S9: the founder sets its password in the Supabase SQL editor (`alter role sites_reader with login password '<generated>'`) and pastes the connection string into the sites service as `DATABASE_URL`. `apps/sites` never holds the service-role connection string.
- Env on the sites service: `SITES_DOMAIN`, `DATABASE_URL` (the `sites_reader` login), `APP_URL`, `API_URL` (T6), `REDIS_URL` (limits). Nothing else: no `SESSION_TOKEN_SECRET`, no vault key, no vendor key. T6 adds one shared secret for the server-to-server follow call only if the api needs it (it does not: `publicPage.follow` is a public procedure).

**Steps.**
1. `app.test.ts` first: a live slug serves `index.html` with the exact header set; a preview label serves with `noindex` and `no-store`; a held release, a draft site, an unknown label, a path with `..`, a `.js` file and a host outside `SITES_DOMAIN` all answer 404; a taken-down site answers 410; no response carries `Set-Cookie`; the footer is present once and a paid project has no mark; `POST /` is 405. verify: fails, then passes.
2. The role and grants; a database test connects as `sites_reader` and proves `select * from sites` is refused while `site_resolve` works. verify: `packages/db/src/__tests__/rls/sites.test.ts`.
3. `railway/sites.toml` and the config test. verify: `node --test scripts/railway-config.test.mjs`.
4. docs/DEPLOY.md "Sites": the S9 steps in order (buy the domain; Railway service with `APP=sites`; watch patterns from `railway/sites.toml` set through the connector, since `railway.toml` files stop being read on Dec 1, 2026; wildcard domain and certificate; the `sites_reader` password; add the sites domain to the Turnstile widget's hostnames; set `SITES_DOMAIN` on api, orchestrator and sites last, because that is the switch). verify: the section's own check, `curl -sI https://<slug>.<domain>/` shows the header set.
**Tests and evals:** as above.
**Done when:** on a local stack `curl -H "Host: <slug>.sites.localhost" localhost:<port>/` returns a published release with the header set, and the service cannot read any table.

### T5: Screening, Publish, the Site tab and the note in Needs you   [L] [ships alone] [needs go-ahead A]

- [ ] done

**Why:** A4-03 ("where is my product?"); §8 items 4 and 5 and "Screens"; CLAUDE.md small-screen rule (Needs you works from 390 px).

**Files:** create `packages/shared/src/site-screen.ts` (+ test), `apps/api/src/services/sites.ts`, `apps/api/src/routers/site.ts`, `apps/api/src/__tests__/site.test.ts`, `packages/modules/src/product/SiteScreen.tsx` (+ story, + `__tests__/site.test.tsx`), `apps/web/e2e/site.spec.ts`. Modify `apps/api/src/router.ts` (mount), `apps/orchestrator/src/activities/site-workspace.ts` (use the content rules; write the note), `packages/shared/src/constants.ts` (`MODULE_TABS.product` gains `{ slug: "site", title: "Site" }`; `DEFAULT_TABS.product` gains `"site"`), the module's tab registry, `packages/modules/src/development/founder-views.tsx` ("Live product" shows the site address), `packages/shared/src/first-week.ts`, `apps/api/src/services/inbox.ts` or wherever `decidePageNote` is dispatched.

**Interfaces.**
- Consumes: `communityScreenLocalFlags(text)` (`packages/agents/src/community-screen.ts:82`), `canPublishPage`'s rule `isAdminRole(ctx.role) && hasSectionAccess(ctx.membership, "product", "write")` (`services/pages.ts:117`), `publishPage`'s shape (`:218-256`: demo refused, role check, `ctx.rls`, `emit`, `audit`, `queuePostDraft`), `decidePageNote(ctx, item, input)` (`:278`) as the pattern for answering from the Inbox, `repos.pages.closeReadyNote`.
- Produces, `screenSiteFiles(files: { path: string; size: number; text?: string }[]): { flags: SiteFlag[] }` (pure, shared by the orchestrator and tests). `SiteFlag = { rule: string; path: string; detail: string }`. Rules: more than `SITE_LIMITS`; a path that is a dotfile, starts with `_fm/`, or has a type outside `SITE_FILE_TYPES`; no `index.html`; in HTML and SVG text, case-insensitive: `<script`, `<iframe`, `<object`, `<embed`, `<base`, `<meta http-equiv`, an `on<word>=` attribute, `javascript:` or `data:text/html` in a URL, a `<form` whose action is not exactly `/_fm/follow`, an `<input` of type `password` or with an `autocomplete` of `cc-*`, `one-time-code` or `current-password`, a link whose scheme is not `https:`, `mailto:` or a relative path; in CSS: `@import` and `url(` pointing off the site; in visible text: the `markup` and `personal_data` flags of `communityScreenLocalFlags`. The response headers of T4 are what enforces; screening exists so a bad release is `held` with a reason the next session can read and fix.
- Produces, tRPC `site.*` (all `businessProcedure`):
  - `site.get` → `{ enabled: boolean, site: { slug, status, url, liveReleaseNumber } | null, releases: { id, number, state, flags: SiteFlag[], previewUrl, taskTitle, createdAt, isLive }[], canPublish: boolean, followers: number, payLinks: [] }` (`enabled` false when `SITES_DOMAIN` is unset: the tab then is not offered).
  - `site.publish({ releaseId })` → `{ outcome: "published", url } | { outcome: "held", flags }`: demo refused; role as `canPublishPage`; the release must be `preview` and of this business; over `publishesPerDay` → a validation error; inside `ctx.rls`: `repos.sites.publish`, `emit site.published`, `emit deploy.succeeded` (`environment: "production"`, `provider: "foundmill"`, `url`), audit `site.published`, close the note.
  - `site.unpublish()` → the view; emits `site.unpublished` (`by: "founder"`).
  - `site.setSlug({ slug })`: `siteSlugProblem`; refused while live unless owner or admin (as `PAGE_LIVE_SLUG_MESSAGE`).
- Produces, the note (written by `buildSiteRelease` for the first `preview` release and again only when a later release is the first since the last publish): from the Product lead, in Needs you. Subject: "Your site is ready to look at". Body: "<Agent name> finished a first version of your site. Open the preview, and if you like it, publish it. Nothing is public until you do." Options: "Publish it", "Not yet". "Publish it" calls the same service as `site.publish`; the preview link opens in a new tab. It works at 390 px because it is an Inbox item.
- Operator takedown (no screen): one statement, run by a Desktop session on the founder's go-ahead and recorded in docs/DEPLOY.md: `update sites set status = 'taken_down', taken_down_reason = '<reason>' where slug = '<slug>';`. The serving function stops resolving it at once.

**Copy changes.**
- `founder-views.tsx:271` (empty "Live product"), only when the project has a live site. Before: "The address of your live product appears here after its first release. Every change waits for your go-ahead before it goes live." After: the site's address as a link, with "Published <date>".
- `packages/shared/src/first-week.ts:102`, only when the destination is `site`. Before: "the first changes going live". After: "a first look at your site, to publish when you like it".
- Site tab empty state: "Your team has not built a site yet. When a first version is ready you get a note with a preview link."
- A held release in the list: "Held back: <rule in plain words>. The next round of work fixes it."

**Steps.**
1. `site-screen.test.ts`: one failing fixture per rule and the starter passing. verify: fails, then passes.
2. `site.test.ts` (api): a member without Product write cannot publish; an admin publishes and `site.published` and `deploy.succeeded` are in the outbox; a held release is refused; the 21st publish of a day is refused; a demo business is refused; no agent capability maps to these procedures (`grep` test over `CAPABILITY_TOOLS`). verify: passes.
3. The screen with the `new-screen` skill: preview in two frames (390 px and desktop width, `sandbox` attribute with no allowances, `referrerpolicy="no-referrer"`), the release list in the founder's words, Publish, Take down, the address with copy. Storybook stories for empty, one preview, live, held. verify: `pnpm storybook` builds; the module test passes.
4. `site.spec.ts` (Playwright): the golden path of "Done when" item 1 up to Publish, and the case with `SITES_DOMAIN` unset. verify: `pnpm test:e2e --grep site`.
**Tests and evals:** above. No model call is added, so no eval.
**Done when:** a founder gets one note, opens a preview, presses Publish from the note or the tab, and the address answers.

### T6: The waitlist form   [M] [ships alone] [needs go-ahead A; switched on after WP-00 S2]

- [ ] done

**Why:** §8 item 6; A4-03; §1.5 row "Sign-ups reaching Customers".

**Files:** modify `apps/sites/src/app.ts`, `apps/sites/src/pages.ts`, `apps/sites/src/__tests__/app.test.ts`, `apps/api/src/services/pages.ts`, `apps/api/src/routers/page.ts`, `packages/db/src/repos/followers.ts`, `packages/shared/src/project-page.ts` (the Turnstile action constant sits beside `FOLLOW_TURNSTILE_ACTION`), `apps/api/src/__tests__/page-follow.test.ts`, the starter's `index.html`.

**Interfaces.**
- Consumes: `followPage(ctx: FollowContext, input: FollowInput): Promise<FollowAnswer>` (`services/pages.ts:548`), `FollowInput { slug, email, consent, website?, turnstile?, post? }` (`:459-470`), `PAGE_FOLLOW_LIMITS`, `checkFollowTurnstile` and `followTurnstileHostname(env)` (`:488-511`), `repos.followers.target(db, slug)` (`followers.ts:92`, a published page only), `repos.followers.record(tx, businessId, { pageId, slug, email, consentText, postLinkId })` (`:112`), `contact_consents.page_id` (nullable, `0079:23`), ingest's `/mail/confirm`, which writes `page.followed`.
- Produces:
  - `FollowInput.via?: "page" | "site"` (default `"page"`). With `"site"`: the target is found by `repos.followers.siteTarget(db, slug)` (new: a `live` site's business, its name, and the project page's id when the project has a page row, else null), `RecordFollowerInput.pageId` becomes `string | null`, the consent's `source_ref` is `site:<slug>`, and the Turnstile hostname expected is `<slug>.<SITES_DOMAIN>`. Everything else in `followPage` is unchanged: the same limits, the same answer whatever happened, the same confirmation email.
  - `apps/sites` routes, both platform-owned pages with their own header set (the site policy plus `script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'none'`):
    - `POST /_fm/follow` (form-encoded, 4 KB cap, from the site's form): shows a page with the address the visitor typed (escaped), the consent sentence from `followConsentText(name)` with an unticked box, the hidden `website` field, the bot check and a "Sign up" button.
    - `POST /_fm/follow/confirm`: calls the api's `publicPage.follow` server to server with `{ slug, email, consent, website, turnstile, via: "site" }` and shows "Check your inbox to confirm." whatever the answer, or the refusal's sentence for an invalid address or a failed bot check.
  - The consent sentence and the checkbox are the platform's, never the agent's HTML, so an agent cannot weaken or pre-tick consent.
- A preview host never submits: `/_fm/follow` on a `p-` label shows "Sign-ups open when the site is published."

**Steps.**
1. `page-follow.test.ts`: `via: "site"` with a live site and no published page records a pending consent with `source_ref = site:<slug>` and sends one confirmation; a draft or taken-down site answers `follow_closed`; the hostname passed to the bot check is the site's; `via: "page"` behaves exactly as before (the existing cases stay green untouched). verify: fails, then passes.
2. `app.test.ts`: the two routes; the typed address is escaped; the checkbox is unticked; a preview label does not post onward; a body over 4 KB is 413; `GET /_fm/follow` is 405. verify: passes.
3. Add the form block to the starter and the sentence to `siteTaskNote`. verify: the starter still passes `screenSiteFiles`.
4. Extend `site.spec.ts`: submit the form, follow the mock confirmation link, see the contact in Customers and the followers count on the Site tab. verify: `pnpm test:e2e --grep site`.
**Tests and evals:** above.
**Done when:** a stranger's confirmed sign-up on a site is a `page.followed` event and a contact in Customers, with no new form pipeline.

### T7: The pay button, with a link the founder pastes   [M] [ships alone] [needs go-ahead A; needs no Stripe setup]

- [ ] done

**Why:** AR-04 (`audits/a3a-agent-runtime.md`: no agent path to a payment link), §1.5 "Payments: Missing", §8 item 7. The smallest thing that puts a working button on a site is a link the founder made in their own Stripe account.

**Files:** create `packages/db/migrations/<next>_pay_links.sql`, `packages/db/src/schema/pay-links.ts`, `packages/db/src/repos/pay-links.ts`, `packages/db/src/__tests__/rls/pay-links.test.ts`, `packages/shared/src/pay-links.ts` (+ test), `apps/api/src/routers/pay-link.ts`, `apps/api/src/__tests__/pay-link.test.ts`. Modify `apps/sites/src/app.ts` (+ test), the function file of T2 (a third function), `packages/connectors/src/connectors/platform/tools.ts` and `apps/gateway/src/platform-host.ts` (`list_pay_links`), `packages/connectors/src/grants.ts`, `packages/modules/src/product/SiteScreen.tsx`.

**Interfaces.**
- Produces, table `pay_links`: `id`, `business_id`, `key text not null` (`^[a-z0-9-]{2,40}$`, unique with `business_id`), `label text not null` (≤ 80), `price_minor bigint null`, `currency char(3) null`, `url text not null`, `source text not null check (source in ('pasted','stripe'))`, `provider_link_id text null`, `simulated boolean not null default false`, `created_by uuid null`, `archived_at timestamptz null`, timestamps. RLS: members read; owner or admin insert, update and archive (it is the founder's own link); cross-tenant test in this task. It is business-level, not site-level, so WP-08's button on `/p/<slug>` reads the same rows.
- Produces, `packages/shared/src/pay-links.ts`: `PAY_LINK_HOSTS = ["buy.stripe.com"]` (Decision D4 to add others), `payLinkUrlProblem(url)`: `https:` only, host exactly on the list, no credentials, ≤ 500 characters.
- Produces, tRPC: `payLink.list`, `payLink.add({ key, label, priceMinor?, currency?, url })` (owner or admin; `payLinkUrlProblem`), `payLink.archive({ id })`.
- Produces, function `site_pay_link(label text, key text) returns text` (security definer, executable by `sites_reader`): the URL of a non-archived, non-simulated link of the business whose live site has that slug.
- Produces, `apps/sites`: `GET /_fm/pay/:key` → 302 to that URL with `Referrer-Policy: no-referrer`, or 404. The agent's HTML never contains the payment URL, so a release cannot swap the destination; a simulated link never redirects and the tab says "Simulated link: not shown on your site".
- Produces, platform tool `list_pay_links` (read, hints `{}`, capability `payments.links.read`, granted to `frontend_engineer` and `docs_writer`): `{ items: { key, label, priceMinor, currency }[] }`, never the URL.
- Site tab: a "Pay buttons" panel: the list, "Add a payment link" with a line of help: "Create a payment link in your own Stripe account and paste it here. Payments go straight to you; Foundmill never holds the money."

**Steps.**
1. RLS and unit tests (cross-tenant read; a member cannot add; a URL off the list, `http:`, or with `@` is refused; `site_pay_link` never returns B's link, an archived link or a simulated one). verify: fail, then pass.
2. Router, the redirect and its tests (unknown key 404; preview hosts redirect too, so the founder can try the button). verify: `pnpm --filter @foundmill/api test pay-link`, `pnpm --filter @foundmill/sites test`.
3. The tool, grant, panel and the last sentence of `siteTaskNote`. verify: `grants-contract.test.ts`; Storybook story "with pay buttons".
**Tests and evals:** above; `site.spec.ts` gains: add a link, the button on the preview redirects.
**Done when:** a founder pastes a link, the team places the button, and a visitor lands on the founder's own checkout.

### T8: `create_payment_link`, so the team can make the link   [M] [ships alone] [needs WP-00 S8 to run live; build with the mock passing]

- [ ] done

**Why:** AR-04; §8 item 7; "the payment link tool lives in WP-07; WP-08 uses it" (OUTLINE boundaries).

**Files:** modify `packages/connectors/src/connectors/stripe/tools.ts`, `index.ts`, `mock.ts`, `stripe.test.ts`, `packages/connectors/src/grants.ts`, one template (Decision D5: the finance lead), `apps/gateway/src/pipeline.ts` only if a result hook is the way `pay_links` is written (else the gateway's stripe post-call handler), `apps/gateway/src/__tests__/` for that hook.

**Interfaces.**
- Consumes: `STRIPE_CONNECT_FIELDS` (the founder's own restricted key, `stripe/tools.ts:17-19`; docs/DECISIONS.md "2026-11-12 — Connectors on the founder's own key"), `defineTool`, `PolicyHint { spendsMoney?, contactsThirdParty?, requiresKitMode?, irreversible?, hardGate? }` (`packages/connectors/src/contract.ts:101-107`), `create_checkout_session` as the shape to copy (`tools.ts:81`), `CAPABILITY_TOOLS.stripe` (`grants.ts:186-192`), `payment.received` (`catalogue.ts:667`) written by the existing Stripe webhook.
- Produces: tool `create_payment_link` input `{ key: string, label: string(1..80), amountMinor: int(50..1_000_000), currency: Currency, afterPaymentMessage?: string(≤300) }`, output `{ id, url, simulated? }`. Real: `prices.create` with inline `product_data` then `paymentLinks.create` on the founder's account, idempotency key `paylink:<businessId>:<key>`. Mock: a `https://buy.stripe.com/test_sim…` URL with `simulated: true` and the notice. Hints `{ contactsThirdParty: true }`: no money moves, but it creates something strangers can pay into, so it asks first in augmented and assisted mode (step 1 proves which hint does that; do not add a new hint). Capability `payments.links.create`, granted to one template. Not connected means the agent says "Stripe is not connected" and writes a founder task; never a platform key.
- On success the gateway writes a `pay_links` row (`source: "stripe"`, `simulated` copied) and audits it as the agent. The founder's hint text for the restricted key gains "and Payment Links" (before: "…write access to customers, invoices and Checkout." after: "…write access to customers, invoices, Checkout and Payment Links.").

**Steps.**
1. Read `packages/policy` for how hints become `ask`; write the policy test: `create_payment_link` asks in augmented and assisted, runs in automated only within the founder's standing rules. verify: the test passes with the chosen hint.
2. Contract tests real (recorded fixture) and mock; the simulated link never reaches `site_pay_link`. verify: `pnpm --filter @foundmill/connectors test stripe`.
3. Grant and the gateway write. verify: `grants-contract.test.ts`; a gateway test that a second call with the same key returns the first link.
**Tests and evals:** above; no eval (no new prompt).
**Done when:** on a mock stack the agent's call asks the founder, then a labeled simulated link appears on the tab; live waits for S8 and one test-mode payment producing `payment.received`.

### T9: The Planner builds for a site; first builds; the demo task   [M] [ships alone] [needs go-ahead A] [after WP-05's Planner task and T3]

- [ ] done

**Why:** §8 item 8; A4-14; A4-18; A4-07 ("For services: replace `firstBuild`").

**Files:** modify `packages/agents/src/prompts/planner.ts` (WP-05's `buildPlannerRequest`), `packages/agents/src/archetypes.ts` (`firstBuild` at `:471` and `:650`), `packages/agents/src/templates/workers/frontend_engineer.ts` (`:19-36`), `apps/orchestrator/src/activities/session.ts` (`offerReadyToSellAfterTask`, `:1136-1152`), `evals/src/planner.ts` (WP-05 creates it; add the site fixture), tests beside each.

**Interfaces.**
- Consumes: WP-05's `destination` input to the Planner, `FIRST_BUILD(title, goal, acceptance[])` (`archetypes.ts:158`), `repos.tasks.create` (the demo task, `session.ts:1140`).
- Produces: with `destination: "site"` the Planner request says: "The project has a static site hosted by Foundmill. Plan code tasks only for pages of that site: HTML and CSS, a sign-up form, pay buttons. Worker types: frontend_engineer, docs_writer. Anything that needs a server, a database or sign-in is not possible yet: say so in questions_for_founder and plan no task for it." A site first build, used when the destination is `site` whatever the archetype: title "Build the offer page", goal "One page that says what this is, who it is for and what it costs, with a way to sign up or pay.", acceptance "The page reads well on a phone", "The sign-up form is on the page", "A price is shown, or the page says how to ask for one".
- Frontend engineer playbook, before: "Every screen touched has a Playwright test and every new component a Storybook story" and "Run typecheck, lint, unit and Playwright tests; capture a screenshot". After: "Write the change and the tests it needs; the platform runs the checks after your session." (the session has no shell: `sdk-isolation.ts:44`).
- The demo task is created only when the project has a live site or a preview release; its goal gains the address. Otherwise it is not created and `demoTaskId` is null.

**Steps.**
1. Tests first: planner request snapshot for `site`; `offerReadyToSellAfterTask` with and without a site; the template lint. verify: fail, then pass.
2. Eval fixture `planner.site`: no task of a kind other than `code` for the site or `research`, no file scope outside the site, at least one question when the idea needs sign-in. verify: `pnpm evals --grep planner` (live key; skipped in CI, as `harness.ts:53-60`).
**Tests and evals:** above.
**Done when:** a service or physical-product project with no repository gets an offer page as its first build, and no task asks for a demo of nothing.

### T10: The proof: idea to published site to a sign-up in Customers   [S] [ships alone] [after T6]

- [ ] done

**Why:** §8 "Done when"; A4 §6.2 gaps 2 and 8; THESIS 1.8.
**Files:** `apps/web/e2e/site.spec.ts` (complete it as the golden path), `e2e/tests/golden-path.spec.ts` (one added stage behind `SITES_DOMAIN`), docs/DEPLOY.md (the production check), a line for WP-02's `scripts/check-production.mjs`: `GET https://<canary-slug>.<SITES_DOMAIN>/` is 200 with the CSP header, and a preview host is `noindex`.
**Steps.** 1. Finish the spec so it asserts every item of the package's "Done when" 1, 2 and 4. verify: `pnpm test:e2e --grep site` green on mock. 2. Add the production check line and hand it to WP-02's script. verify: the script's dry run lists the check as skipped while `SITES_DOMAIN` is unset.
**Done when:** CI proves the path on every pull request that touches `apps/sites`, `site-workspace.ts` or `services/sites.ts`.

### T11: A founder who has a repository can choose it without Builder view   [S] [ships alone] [no go-ahead needed]

- [x] done

**Why:** A4-04 fix 1. The chooser exists only on Development › Code (`packages/modules/src/development/CodeScreen.tsx:227`), a Builder-only tab (`constants.ts:82-83`).
**Files:** modify `apps/web/components/settings/IntegrationsTab.tsx` (the GitHub block, by the string "Connect installation"), `apps/web/components/settings/__tests__/github-install.test.tsx`, `apps/web/e2e/code.spec.ts`.
**Interfaces.** Consumes `dev.code.repository → { connected, status, repository, simulated }` and `dev.code.setRepository({ repository, pushEnabled = false })` (`apps/api/src/routers/dev.ts`). Produces no new procedure: a small panel with the repository select and the switch "Let the team push its work to this repository", and for an empty repository the sentence "This repository has no commits yet. Add a first commit with a README, then choose it again; the team cannot start an empty repository." (the refusal at `checkout.ts:188`).
**Steps.** 1. Component test: the panel renders after connect, saving calls `setRepository`. 2. Playwright: with Builder view off, choose a repository in Settings. verify: `pnpm test:e2e --grep code`.
**Done when:** the choice is reachable in two clicks from Settings with Builder view off.

### T12: Show the previews a connected repository already has   [M] [ships alone] [no go-ahead needed; lowest priority]

- [ ] done

**Why:** A4-17. Every agent pull request on Foundmill's own repository carries a Vercel preview; nothing records it (`packages/connectors/src/connectors/github/webhooks.ts:65-67`).
**Files:** modify `packages/connectors/src/connectors/github/tools.ts`, `index.ts`, `mock.ts`, `github.test.ts`, `packages/connectors/src/grants.ts`, `apps/gateway/src/code-repository.ts` (first-party read rule), `apps/orchestrator/src/activities/merge.ts`, `apps/orchestrator/src/__tests__/merge.test.ts`.
**Interfaces.** Produces read tool `list_deployments` on `github`: input `{ sha: string(7..64) }`, output `{ items: { environment: string, state: "success" | "failure" | "pending" | "inactive", url: string | null }[] }` (`GET /repos/{o}/{r}/deployments?sha=` then statuses; typed facts only; `url` kept only when it is `https:` and its host ends with `.vercel.app`, `.netlify.app` or `.pages.dev`), hints `{}`, capability `deployments.read`, route-only (called by the platform, not granted to a template). In `assessMerge`, after checks: emit `deploy.succeeded` (`environment: "preview"`, `provider` from the host, `url`, `commitSha`, `taskId`) with idempotency key `deploy:<taskId>:<sha>`.
**Steps.** 1. Contract tests real and mock, host filter cases. 2. `merge.test.ts`: one event per head commit, none on a failed deployment, none twice. verify: `pnpm --filter @foundmill/connectors test github`, `pnpm --filter @foundmill/orchestrator test merge`.
**Done when:** on Foundmill's own project the "See it" column opens the preview of an agent's change.

## Corrections to the audits

1. **§8 item 6 places the form on `apps/ingest` "reusing `followPage`".** `followPage` lives in `apps/api/src/services/pages.ts:548` and is reached through the public tRPC procedure `publicPage.follow` (`apps/api/src/routers/page.ts:61-73`); ingest only confirms (`/mail/confirm`). T6 calls the api from `apps/sites`, not ingest.
2. **§8 item 7 says "Stripe on the founder's own account through hosted onboarding".** The connector's connection is the founder's own restricted key (`STRIPE_CONNECT_FIELDS`, `stripe/tools.ts:17-19`), which is also the Nov 12 founder rule; `start_connect_onboarding` is a hard gate (`hints: { hardGate: true, irreversible: true }`, `:111-114`) and is not used here.
3. **§8 item 2 proposes a third checkout source and a "rebase file-wise".** The code already has the shape: a save against a `CheckoutBase` stores only the difference and the removed paths (`SaveWorkspaceOptions.base`, `workspace-store.ts:87-95`; `workspace_snapshots.base_*`, `removed_paths`). T3 presents a release as a base and adds no new save format.
4. **A4-07 proposes a `documents` table.** AR-02's `task_reports` with `kind: 'document'` (a3a) is the same table; one is enough.
5. **§8 "the existing design check runs on the static site (it already serves `index.html`)".** True of `planDesignServe` (`design-check.ts:133-137`), but A4-11 in the same audit says the capture probably cannot run in production. T5 does not depend on it.
6. **`pageSlugProblem` is in `packages/shared/src/project-page.ts`**, not in the api's page service as §8's wording suggests.
7. **WP-00 §1 says there are no watch paths.** The repo's `railway/<service>.toml` files do carry `watchPatterns` (`railway/ingest.toml`); whether Railway applies them is a production fact for WP-01. T4 writes `railway/sites.toml` in the same style and sets the patterns through the connector.

## Decisions for the founder

- **D1. What "proven" means (go-ahead A).** Proposed: 5 real projects with a published page and 10 confirmed follows. Or: allow T2 to T7 to be built behind the unset `SITES_DOMAIN` switch now, and keep only the switch-on for after "proven".
- **D2. The domain (go-ahead B).** A name that reads as a place for a project, not as Foundmill (WP-00 S9). It should be added to the Public Suffix List request later so browsers treat each site as its own origin; until then no site sets a cookie.
- **D3. The "Report this site" link on paid projects.** The rule says only the "Built on Foundmill" mark may differ by plan. Recommended: the report link shows on every site on every plan, as a safety control and not a plan feature; the mark alone follows `tierShowsBuiltOnMark`.
- **D4. Payment hosts.** Only `buy.stripe.com` at first. Add others (PayPal, Gumroad, Lemon Squeezy) on request.
- **D5. Which agent may call `create_payment_link`.** Recommended: the finance lead, asking first.
- **D6. Who watches reports** until WP-12's review queue exists: the nightly check prints the count of `site.reported` audit rows; someone has to read it.

## Risks

- **Abuse of a Foundmill-owned domain** (phishing, scams, illegal content). Held by: no scripts, no outbound forms, no password or card fields, deterministic screening, the founder's own press, the 18-or-older attestation at sign-up, a report link, takedown in one statement, the separate domain, publish limits. Not held: persuasive text alone (a fake giveaway page). The report link and takedown are the answer; D6 needs an owner.
- **The serving service is the most exposed process in the product.** It has no secrets and a database login that can run three functions. A bug in a function is the remaining path; the cross-tenant tests are the check.
- **Stored in Postgres.** 10 MB a release, all releases kept. At 1,000 projects with 20 releases each of 1 MB changed content that is about 20 GB (Estimate; blobs are shared across releases by hash). Add pruning of releases older than the last 20 when the table passes 5 GB.
- **Conflicts between parallel tasks** end one of them `blocked/needs_update` and cost a second session. WP-05's AR-11/A7-01 measure (share of sessions ending blocked) will show it; if it is common, have the Planner chain site tasks.
- **Turnstile on a second domain** needs the widget's hostname list changed; forgetting it makes every site form fail closed (the follow answers `follow_unverified`). T4's DEPLOY section lists it; T10's production check should submit nothing and only assert the widget renders.
- **Agents told "no JavaScript" will sometimes write it.** The release is held with the rule named, and the next round fixes it; the founder sees "Held back" and not a broken preview.
- **Railway config-as-code ends Dec 1, 2026.** `railway/sites.toml` documents intent; the live setting is made through the connector.
- **This package edits `session.ts` in T3 and T9.** Never run them beside a WP-05 task.

## Starting prompt

```
You are executing docs/holistic-plan/WP-07-foundmill-sites.md in the Foundmill repo. Read, in this order: CLAUDE.md; docs/holistic-plan/README.md; the work package file in full; docs/holistic-plan/audits/a4-building-product.md §1.4, §1.5, §3 (A4-02, A4-03, A4-04, A4-07, A4-14, A4-17, A4-18), §5 and §8; docs/holistic-plan/audits/a3a-agent-runtime.md §1.4 to §1.7; the CLAUDE.md of each package you touch.

Before any code: check docs/DECISIONS.md and docs/DEPLOY.md for the two go-aheads the package names (pages and email "proven"; a separate domain). If go-ahead A is not recorded, do only T1, T11 and T12 and stop. If it is, do T2 to T10 in order, building against SITES_DOMAIN=sites.localhost with mock integrations; do not start T3 or T9 while any WP-05 pull request that edits apps/orchestrator/src/activities/session.ts is open.

For each task: run the plan-change skill (overlap with other branches, next free migration number), state your assumptions, write the named tests first and see them fail, make the smallest change that passes them, keep every security rule in the package's "Security rules" section, run verify-done, open one pull request on branch claude/wp-07-t<n>, add the line to docs/PROGRESS.md and tick the task in the work package file. Never merge. Never set a production variable. If the code contradicts the work package, follow the code and say so in the pull request.
```
