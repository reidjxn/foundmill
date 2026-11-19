# Launch plan (Nov 19, 2026)

The plan for the rest of the build up to the public launch. It began as an outside review of a snapshot of the repository ("Foundmill Launch & Architecture Evaluation", Nov 2026). On Nov 19, 2026 it was checked against main (to #330), the open pull requests and docs/log, and the founder changed two rules (FOUNDMILL.md, "SaaS tools come in through MCP" and "Agents run software through CLI-Anything"). Where this file and FOUNDMILL.md differ, FOUNDMILL.md wins.

## 1. Where the build stands

Strengths the review found and that still hold: Postgres RLS with cross-tenant tests on every business-scoped table; every vendor call through `apps/gateway`, every webhook through `apps/ingest`, every event through the Zod outbox; Cedar hard gates that agents cannot lift; the eval suite in `evals/`; the copy linters in CI; the design system in `packages/dugout`.

Risks, as of Nov 19:

- **Haiku 5.5 on the free plan** failed the injection bar. Done: the free plan's readers, agents, notes and planners left Haiku (#314). What is left is the effort per route (WP-09 T6, T7) and the model dialog (WP-13 T7).
- **Merge debt** is smaller than the review saw. Merged since the snapshot: #208, #234, #235, #237, #251, #255, #264, #265, #271, #288, #291 and #296 to #329. Open: #238 (conflicting), #244, #300 (draft), #303 (draft), #319, #330. Pushed with no pull request: `claude/wp14-t1-resting`, `claude/wp14-t3-team-budget`, `claude/wizardly-turing-skic24` (its migration 0141 collides with main's `0141_skill_defaults.sql`). Local only: `claude/landing-daylight` (3 commits).
- **Company before customer:** WP-04 T2, T4, T7, T9 and T15, and WP-10 T1 to T4, are still not started.
- **What agents can do:** default skills at hire are merged (WP-06 T6, #327) and the pay button with a pasted link is merged (WP-07 T7, #276). Not started: `create_payment_link` (WP-07 T8), the week-one go-to-market tools (WP-08 T4, T5, T6, T8, T12), MCP and CLI-Anything (below).
- `docs/holistic-plan/STATUS.md` was rebuilt on Nov 17 to #274 and is out of date. Session 1 rebuilds it; no other session edits it.

## 2. How agents get more capability

Two sources, kept apart, both behind the gateway. The rules are in FOUNDMILL.md; this is how to build them.

### CLI-Anything (local software that makes files)

[HKUDS/CLI-Anything](https://github.com/HKUDS/CLI-Anything) and its CLI-Hub packages wrap open-source programs as command-line tools for agents, at about 200 tokens a command. The founder chose it on Nov 19, 2026: install it, no evaluation step. Foundmill uses them so the team makes real materials: a logo and brand assets (Inkscape, GIMP), documents and decks (LibreOffice), audio and video (FFmpeg).

1. **Sandbox.** The packages are pinned and built into the E2B template (`infra/e2b/e2b.Dockerfile`), with each license recorded in `infra/e2b/README.md`. A call runs in the project's sandbox through `packages/sandbox`, with egress closed (`closeEgress()`) except to the gateway. The Docker runner gets the same image for local work; the mock runner replays recorded calls, so `INTEGRATIONS_MODE=mock` still runs the golden path.
2. **Gateway tools.** Each program is a connector (`packages/connectors`, real and mock) whose tools are typed, have `policyHints`, are metered and audited and sit behind the kill switch. No raw shell. One JSON call per command, never a REPL.
3. **Inputs.** Text from untrusted content passes the quarantined reader before it becomes an argument. File inputs are the project's own files.
4. **Wrappers.** Subcommands that would cross a hard gate, or reach the network, are removed from the generated wrapper at build time.
5. **Outputs.** Files land in a working copy of the project's files. They reach the project (the Site, the page, a Customer Update) only when the founder approves, through the existing approval note.
6. **First packages:** Inkscape, LibreOffice and FFmpeg, then GIMP. Attach them as default skills of the Design, Product and Marketing roles through WP-06 T6's mechanism.
7. **Install:** add CLI-Anything to the template from its GitHub repository, pinned to one commit (never a moving branch), with its CLI-Hub packages for the programs above. Record the commit and the license in `infra/e2b/README.md`. A later upgrade is a pull request that moves the pin.

### MCP (remote SaaS tools that sign in with OAuth)

For Shopify, Notion, HubSpot and the like, the plan is the vendor's own remote MCP server, not a connector written against the vendor's API. Gmail is the exception: it stays on its API connector (see "Gmail" below).

1. **The gateway is the only MCP client.** It already serves connectors to agents as MCP (`ALL /mcp/:connector`, `src/mcp.ts`). The new part is the other side: the gateway connects to a vendor's remote MCP server for the founder, and the remote tools join the same pipeline (scope, state re-check, Cedar, ask, meter, audit, the untrusted envelope).
2. **Sign-in.** The founder connects in Settings › Integrations with the vendor's own OAuth sign-in. Tokens are sealed in the vault (`src/credentials.ts`) and refreshed by the gateway. Disconnecting revokes them.
3. **Policy.** Foundmill keeps a list per server that maps each tool to `policyHints`. A tool on no list asks first. A tool that would move money, sign, accept terms, delete permanently or change security settings is denied. The server's own annotations are a hint, never the decision.
4. **Schema size.** The gateway gives an agent a server's tool definitions only when the agent uses that skill.
5. **Mock.** A recorded mock of each server (its tool list and sample answers), so mock mode runs the golden path.
6. **Settings.** Hide connectors that are unbuilt or mock-only; keep "Request an integration"; Builder view gets a field to connect a custom MCP server by URL, under the same rules.
7. **Order:** Notion first (a hosted server with OAuth), then Shopify and HubSpot. A connector built on a vendor's API stays until its MCP replacement is live.
8. The session records each vendor's terms and OAuth requirements as it connects them.

### Gmail (the API, not MCP)

Gmail stays on the connector that already exists (`packages/connectors/src/connectors/gmail`: the REST API, per-business OAuth on Foundmill's Google client `GOOGLE_CLIENT_ID`, real and mock). It asks for `gmail.readonly`, `gmail.send` and `gmail.compose` (`GMAIL_SCOPES` in `tools.ts`).

Going through the API does not avoid Google's review: the scope sets it, not the protocol. `gmail.send` and `gmail.compose` are "sensitive" (Google's app verification, usually days). `gmail.readonly` is "restricted" (the same verification plus a yearly outside security assessment, usually weeks). Until verification passes, the app stays in Google's testing mode: at most 100 named test users, and their sign-in lasts seven days.

Recommended, for the founder to confirm: launch with `gmail.send` and `gmail.compose` only, and add `gmail.readonly` once the assessment is done. Session 5b splits the scopes (reading asks for its scope only when the founder turns it on); Session 11 submits the verification on the founder's Google Cloud account. Start that submission now: it is the longest wait in this plan.

## 3. The sessions

Every session loads the `ponytail` and `caveman` skills first, reads FOUNDMILL.md, works on its own branch, writes one docs/log entry and does not edit STATUS.md. A session takes the next free migration number when it rebases before merging, never earlier. The founder merges.

Files that two sessions could both touch have one owner each: `packages/models/src/routing.ts` (Session 2), `apps/gateway/src/pipeline.ts` and `apps/gateway/src/mcp.ts` (Session 5b), `infra/e2b/` and `packages/sandbox/` (Session 4b), `docs/holistic-plan/STATUS.md` (Session 1).

### Wave 0 (Desktop, this checkout)

**Session 1: consolidate.** Land the rule change and this file (`claude/foundmill-md-mcp-cli-hub`). Fix #238's conflict. Land #319. Decide about `claude/landing-daylight`. Rebuild STATUS.md from main, the open pull requests and docs/log, with rows for Sessions 4b and 5b.

### Wave 1 (six cloud sessions in parallel, after Session 1's first pull request merges)

**Session 2: models.** WP-09 T6 and T7 (effort per route, sessions told their effort and limits); WP-13 T7 (the model dialog). Verify, do not redo, T4, T5, T8 and T12 (#322, #251) and #314.

**Session 3: plans and money.** Own #300 (WP-14 T14) and the branches `claude/wp14-t1-resting` (T1) and `claude/wp14-t3-team-budget` (T3): rebase, finish and land in the order T14, T1, T3. WP-09 T13, T16 and the markup are merged (#251, #320).

**Session 4: skills.** Own #330 (WP-09 T9). Then WP-06 T13 (check what #311 already did), T11 and T10. WP-06 T8 and T9 wait for the measuring run on the batch route.

**Session 4b: CLI-Anything in the sandbox.** Section 2, CLI-Anything, items 1 to 7: the template, the connector with its mock, the wrappers, the staged outputs and the approval, the default skills. Do not edit `apps/gateway/src/pipeline.ts`; add the tools through the connector contract. An eval: a Design agent makes a logo file from the brand colors, and the founder's approval puts it on the page.

**Session 5: go-to-market.** Own #244 (WP-08 T7), then #303 (WP-14 T9). Then WP-08 T4, T5, T6, T8 and T12. WP-07 T8 waits on WP-00 S8: build it mock-first.

**Session 5b: MCP in the gateway, and Gmail's scopes.** Section 2, MCP, items 1 to 8, starting with Notion. Owns `pipeline.ts` and `mcp.ts`. Includes the Settings cleanup and the Builder view field (moved here from Session 6). Then the Gmail scope split from section 2, "Gmail", on the existing API connector.

### Wave 2 (three cloud sessions in parallel)

**Session 6: the console by stage.** WP-10 T1 to T4, T10. (T8, T9, T11 and T12 merged in #265 and #316; the integrations cleanup moved to Session 5b.)

**Session 7: waitlist and people.** Own `claude/wizardly-turing-skic24` (WP-14 T15): renumber its migration and land it. WP-12 T3 and T8 merged in #235; check them against the plan's private arrival notice and app banner, and do only what is missing.

**Session 8: data.** WP-11 T6 (split the `for all` write policies) and T9 (demo data out of cross-project numbers). T3, T8 and T10 wait on the founder.

### Wave 3 (two cloud sessions in parallel): the launch's reach

**Session 9: the first thing worth sharing, before the paywall, at 390 px.** Extend the idea box to show a live preview of the project's page and brand before the first paid press; with Session 4b merged, the logo is a real file made by the team. Make sure a 390 px visitor never meets `NeedsLargerWindow` in the first session. A Playwright spec for the 390 px journey from visitor to shared link, in six screens or fewer.

**Session 10: cards and the gallery.** Dynamic 1200 × 630 Open Graph images for `/p/<slug>`, milestone cards and Customer Updates. An opt-in public gallery at `/explore` of recently published project pages and verified Customer Updates. "Share progress card" on Today.

### Wave 4 (Desktop and the founder): the switch

**Session 11: production.** Watch paths and "Wait for CI" (WP-00 S3, S4, S12). Live keys and switches: `STRIPE_SECRET_KEY`, `SITES_DOMAIN`, `LIVE_CONNECTORS`, the E2B key and template for CLI-Anything, the MCP OAuth clients the founder approved, and Google's verification for Gmail, submitted as early as possible (WP-00 S6, S8, S9, S16). The live checks: `evals-free-plan.yml`, `evals-models-live.yml`, `check-production.mjs`. **Founder zero:** run Foundmill's own launch project inside Foundmill to one real outside outcome, then `SIGNUP_OPEN=1`, `PAID_ENTRY=1` and `WAITLIST_ADMIT_PER_DAY`.
