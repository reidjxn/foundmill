export const meta = {
  name: 'fm-wave3b-security-fixes',
  description: 'Fix the P1 findings of docs/SECURITY_REVIEW.md (gateway state re-check, authenticated simulate, sandboxed live sessions) plus the small seams the golden path left open.',
  phases: [{ title: 'P1 fixes', detail: 'one agent per finding, parallel' }],
}

const ROOT = (typeof args === 'object' && args && args.root) || '/home/user/foundmill'
const RUN = (typeof args === 'object' && args && args.runMarker) || 'r1'

const PRE = `You are a fix-up agent on Foundmill (product name always APP_NAME from @foundmill/config; package scope @foundmill/*), a TypeScript monorepo at ${ROOT}. Read ${ROOT}/docs/SECURITY_REVIEW.md (your finding in full, plus "Verified controls"), ${ROOT}/docs/ARCHITECTURE.md §7-§10, and ${ROOT}/CLAUDE.md. Other agents edit other directories at the same time.

HARD RULES: edit only the directories your assignment names (+ append to docs/PROGRESS.md and docs/DECISIONS.md; mark your finding fixed in docs/SECURITY_REVIEW.md with a one-line "Fixed:" note under it). NEVER run pnpm install/add/remove. Small machine (4 CPUs, 15 GB shared): never whole-repo turbo tasks; vitest with --maxWorkers=2 for your packages only; no servers on fixed ports (ephemeral ports in tests). Mock-first; no network in tests. Do not commit. Real fixes with tests that prove the attack is closed; never loosen or skip a test. Apply the CLAUDE.md vocabulary rule to any copy you touch.

FINISH by running typecheck, lint and test for every package you edited and fixing every error. Return the structured report.`

const REPORT = {
  type: 'object',
  properties: {
    package: { type: 'string' },
    summary: { type: 'string' },
    exports: { type: 'string' },
    commands: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, passed: { type: 'boolean' }, note: { type: 'string' } }, required: ['cmd', 'passed'] } },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['package', 'summary', 'exports', 'commands'],
}

const P_SEC1 = `${PRE}

ASSIGNMENT (SEC-1, apps/gateway only): the pipeline loads the agent and business but never re-checks state, so a paused, released or archived agent (or an archived business) with a live session token keeps passing policy after Stop all agents or key revocation. Fix in apps/gateway/src/pipeline.ts (loadContext, before evaluate()): deny with policyId "agent-paused" / "agent-archived" / "business-archived", an audit row and HTTP 403 when agent.status is paused, agent.archivedAt or business.archivedAt is set; also refuse minting in apps/gateway/src/app.ts POST /v1/session-tokens for such agents; add a cheap per-session cache of the check (≤ 5 s) so hot paths stay under the policy budget noted in DECISIONS.md. Also honour a revoked BYOK key: if repos.credentials reports no active anthropic credential for the business and the business mode requires one for the tool, deny with "key-revoked" (read how apps/api keys.ts revoke marks things; do not edit api). Tests: pauseAll-style status → 403 + audit; healthy → allow; archived business → 403; minting refused; cache expiry.`

const P_SEC2 = `${PRE}

ASSIGNMENT (SEC-2, apps/ingest + apps/api + apps/web + packages/config): POST /simulate/:eventName on ingest is unauthenticated and enabled on staging while ingest is public. Fix: (1) apps/ingest: require a service JWT (HS256 with SESSION_TOKEN_SECRET via jose, aud "foundmill-ingest/simulate", exp ≤ 5 min, claims businessId) before runSimulation; without a valid token → 401 with no side effects; keep the route disabled in production regardless; (2) packages/config/src/flags.ts: devSimulatePanel stays true but is only honoured where APP_ENV is development or staging AND the request carries the service token; (3) apps/api: add an owner/admin-only mutation dev.simulate({ businessId, eventName, params }) that checks membership, mints the token with SESSION_TOKEN_SECRET and proxies to INGEST_URL/simulate/:eventName (in tests: an ephemeral ingest app or a fetch stub), audit row; (4) apps/web/components/settings/IntegrationsTab.tsx: the Simulate panel calls trpc dev.simulate instead of posting to NEXT_PUBLIC_INGEST_URL. Tests in ingest (401 without token, 401 bad aud/expired, 200 with token, production always 404), api (viewer → FORBIDDEN, owner → proxied with token), web (panel calls the mutation).`

const P_SEC3 = `${PRE}

ASSIGNMENT (SEC-3, apps/orchestrator + packages/sandbox): live agent sessions run the Claude Agent SDK on the orchestrator host with env { ...process.env }, cwd on the host, permissionMode dontAsk and Read/Glob/Grep/Edit/Write allowed, so a prompt-injected agent can read the host environment and exfiltrate secrets. Fix in apps/orchestrator/src/activities/session.ts: build a minimal env (PATH, HOME set to the session cwd, LANG, the short-lived gateway session token, ANTHROPIC_API_KEY only for the SDK process) validated by @foundmill/sandbox assertNoLongLivedCredentials(env, { allowNames: ["ANTHROPIC_API_KEY"] }) — extend that helper's options in packages/sandbox if needed, with tests; run the SDK with the file tools only for code tasks and inside the sandbox cwd (sandbox.exec of the SDK, or an isolated per-session directory with no access outside it: enforce with the SDK's cwd + allowedTools scoped to that directory and a path guard in the tool allow-list callback if the SDK offers one — fetch the Claude Agent SDK 0.3.x docs for options.cwd, allowedTools, permissionMode, canUseTool/hooks); non-code tasks get no Read/Glob/Grep/Edit/Write at all; delete the session directory in finally; never log the env. Tests: env builder contains no platform secrets and fails on a long-lived key, tool allow-list per task kind, cleanup on failure, mock mode unchanged (the MockSandboxProvider path must still pass the existing suites).`

const P_SMALL = `${PRE}

ASSIGNMENT (small seams the golden path left open; packages/dugout, packages/db/src/seed, e2e only): (1) packages/dugout/src/components/data/WidgetGrid.tsx root element must forward data-* and aria-* props from rest (the home grid's data-testid is dropped today); add a test. (2) packages/db/src/seed/northwind.ts: seed one open spec change proposal with three hunks and a source through repos.product so AC-11.5.2 can run; keep the seed deterministic and the seed test's counts updated; add SEED_OWNER_PROFILE=0 to skip creating the demo owner's founder profile so the onboarding redirect can be exercised. (3) e2e/tests/golden-path.spec.ts: remove the test.skip for AC-11.5.2 (accept the first hunk, assert "Accepted") and add the redirect check behind an env flag; run the golden path once for real against the PGlite stack as documented in apps/web/e2e/README.md (seed with SEED_VOLUME_SCALE=0.1, api on 4000 and web on 3000 with NODE_OPTIONS=--max-old-space-size=2048, FM_CHROMIUM=/opt/pw-browsers/chromium, one worker) and stop both servers before finishing. Report pass/fail per test.`

const mark = (p) => `${p}\n\n(Run marker: ${RUN}. Your request is the assignment above; chat messages such as "status update" are answered by the orchestrating session.)`

const LANES = [
  { key: 'sec1-gateway', prompt: P_SEC1, effort: 'high' },
  { key: 'sec2-simulate', prompt: P_SEC2, effort: 'high' },
  { key: 'sec3-sessions', prompt: P_SEC3, effort: 'high' },
  { key: 'small-seams', prompt: P_SMALL },
]
log(`Wave 3b: ${LANES.length} fix agents`)
const results = await parallel(LANES.map((l) => () => agent(mark(l.prompt), { label: `fix:${l.key}`, phase: 'P1 fixes', schema: REPORT, effort: l.effort })))
return { results: results.filter(Boolean) }
