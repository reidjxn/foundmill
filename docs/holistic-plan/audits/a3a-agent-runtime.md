# A3a — The agent runtime (how agent work actually runs)

Audit of `main` at 04a0a509 (2026-11-15). Read-only. Paths are relative to `/Users/reidjackson/code/founder-manager`. Line numbers are from this commit. "Inference" and "Estimate" mark what I could not read directly from code. I could not read the live Railway variables (rule: no CLI), so "production" below means the configuration `docs/DEPLOY.md` documents; the planner must confirm `LIVE_CONNECTORS` on the gateway before relying on section 2.

Short names used below: `session.ts` = `apps/orchestrator/src/activities/session.ts`; `iso.ts` = `apps/orchestrator/src/activities/sdk-isolation.ts`; `cycle.ts` = `apps/orchestrator/src/activities/cycle.ts`; `wf/` = `apps/orchestrator/src/workflows/`; `act/` = `apps/orchestrator/src/activities/`.

---

## 1. How it works today

### 1.1 Processes

| Piece | What it is | Evidence |
| --- | --- | --- |
| `apps/orchestrator` | One Node process, two Temporal workers: the main queue `TEMPORAL_TASK_QUEUE` (cycles, plans, control; `ORCHESTRATOR_MAX_ACTIVITIES` 32) and `${queue}-sessions`, which runs only `runAgentSession` (`ORCHESTRATOR_MAX_SESSIONS` 16) | `apps/orchestrator/src/env.ts:15-17`, `src/index.ts:121-136` |
| A live session | A Claude Agent SDK subprocess (`@anthropic-ai/claude-agent-sdk` 0.3.291, `pnpm-workspace.yaml:128`; `@anthropic-ai/sdk` 0.131.0; Temporal 1.24.0; `e2b` 2.52.1) that runs **on the orchestrator host**, in `${ORCHESTRATOR_WORKSPACE_DIR}/<sessionId>` (default `/tmp/foundmill-workspaces`) | `iso.ts:185-192`, `env.ts:29`, `session.ts:1455` |
| Sandbox (E2B) | Created only for a code task's acceptance run and its design check, 30 minutes | `session.ts:86`, `:864-887`, `:2493` |
| Gateway | One MCP streamable-HTTP server per connector at `/mcp/<connector>`; lists only the tools the session token allows | `apps/gateway/src/mcp.ts:25-27`, `:45` |
| Composer | HTTP service: `/v1/narrate`, `/v1/refresh`, `/v1/commentary`, `/v1/chapter-title`, `/v1/founder-titles` | `apps/composer/src/app.ts:67-99` |
| Stream | WebSocket fan-out of `ev:<businessId>`, `as:<sessionId>`, `u:<userId>`, `ae:<userId>` with section walls | `docs/ARCHITECTURE.md:235-237`, `apps/stream/src/walls.ts` |

### 1.2 What starts agent work

"Session" below means a Claude Agent SDK run with tools. Everything else is a single structured model call through `deps.models.complete` (packages/models) with no tools.

| Trigger | Entry point | What runs | Sessions? | Brief in the prompt? |
| --- | --- | --- | --- | --- |
| Take charge (commit) | `apps/api/src/services/commit.ts:436` | `businessCycle` cycle 1, trigger `continue` | yes, if any task is dispatchable | yes |
| Continue | `apps/api/src/services/cycle.ts:302` `startCycle` → signal-with-start `continueRun` to `autopilot:<businessId>` (`:340`) | `wf/autopilot.ts:176-181` starts the press's cycle, then rounds with trigger `autopilot` one minute apart until `decideRun` ends the run | yes | yes |
| Autopilot (schedule) | `wf/autopilot.ts:184-221` `autopilotEvaluate` → `runCycle` (`:129`) | `businessCycle` with `budgetCapMinor` = Autopilot's own spend ceiling | yes | yes |
| Overnight shift | preset `packages/shared/src/autopilot.ts:397` `OVERNIGHT_SHIFT = { localHour: 2, cadence: "daily", ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15 }` | one Autopilot cycle a night with a $0.15 cap | yes (see AR-06) | yes |
| Automated mode | `wf/automatedMode.ts:29` | `automatedModeAutoDecide` → `businessCycle` (trigger `schedule`), up to 3 chained | yes | yes |
| Vacation | `wf/holiday.ts:45` | cycles on a cadence, `holidayAutoDecide`, `planExecution` per decision | yes | cycles yes, plan tasks no |
| An approval answered | `apps/api/src/services/approvals.ts:187` | `businessCycle` trigger `wake` | yes | yes |
| Start on a task (Development) | `apps/api/src/services/task-start.ts:112` | `agentSession` directly | yes | **no** (`briefText` not passed) |
| A confirmed plan (Inbox option, desk hand-off, Team call action) | `apps/api/src/services/plans.ts:427` → `wf/planExecution.ts:66` → `act/plan.ts:197`, `:366` `openAgentSession` | `agentSession` per `create_task` | yes | **no** |
| Playbook (an ingested event) | `apps/ingest/src/followups.ts:112` → `wf/playbook.ts:72` | plan actions, `agentSession` | yes | **no** |
| Foundations on first open | `apps/api/src/services/foundations.ts:196` → `wf/businessFoundations.ts:81` | `draftProjectPage` (`:94`) → `draftFoundationsPlan` (`:102`) → sections × batches + roadmap (`:109`) → `applyFoundations` (`:118`) → `secondReadDocument` (`:123`) | **no** (model calls on routes `projectPage`, `foundationsSkeleton`, `foundations`, `documentReview`) | n/a |
| Channel engine | `wf/channelEngine.ts`, `act/channel.ts` | weekly plan → create (one `worker`-route call, `buildChannelCreativeRequest`) → approve → launch → measure | **no** | n/a |
| Merge of a finished code task | `wf/agentSession.ts:255-258`, `wf/businessCycle.ts:116-122` → `wf/mergeReview.ts:49` | GitHub calls through the gateway, `secondReadMerge` (one `codeReview` call), `approvalWait` | no | n/a |
| Direct conversation (desk) | `apps/api/src/services/conversation.ts` (`agent_threads`, `agent_messages`) | one `conversation`-route call (Sonnet, low effort); work leaves only as a hand-off → plan | no | n/a |
| Team call | `apps/api/src/services/team-call.ts` | `teamCallTurn` / `teamCallWrapUp` calls; action items become plan actions | no | n/a |
| Training | `apps/api/src/routers/agent.ts:279` → `wf/trainingRun.ts` | skill tests in the mock sandbox with mock tools, `skillGrader` | no (mock tools) | n/a |
| Morning brief | schedule `founder-notifications` every 5 min (`apps/orchestrator/src/schedules.ts:36`, `act/notify.ts`, `packages/shared/src/morning-brief.ts`) | an email through the gateway's `/v1/notify/email`; starts no agent work | no | n/a |
| Other schedules | `SCHEDULES` (`src/schedules.ts:36`): journey refresh, benchmarks, credential and consent scans, agent metrics, health sweep, legal calendar, source watch, engine reconcile, deletion sweeps | none opens a session | no | n/a |

Without Temporal, Continue is one in-process step that starts no session (`apps/api/src/services/cycle.ts:497-546`). Production has Temporal.

### 1.3 One cycle, from the press to the note in the Inbox

```
founder presses Continue
  api  business.continue → startCycle (apps/api/src/services/cycle.ts:302)
         reserves cycle number n, audit row business.continue, event cycle.run_started
         temporal.signalWithStart(autopilot, id autopilot:<businessId>, signal continueRun {runId, cycleNumber})  (:340)
  wf   autopilot (wf/autopilot.ts:74)
         continueRun handler sets run.pendingCycleNumber                                   (:102-107)
         runCycle(n, "continue") → startChild(businessCycle, id cycle:<businessId>:<n>)     (:129-132, :176-181)
  wf   businessCycle (wf/businessCycle.ts:124) on the main queue; activities 10 min, 3 attempts (:23)
    1  acts.loadBrief                  (act/brief.ts:122)   recoverAgents, enforceWageCaps, loadDispatchFacts, prose brief ≤ 4,000 tokens
    2  acts.planRoadmap                (act/roadmap-plan.ts:48)  only when a Now roadmap item has no task: one `planner` call per item → tasks; then loadBrief again (wf :189-196)
    3  acts.planCycle                  (cycle.ts:437)
         stopPlatformDuties (:239), stopToollessTasks (:287), closeSettledNotes (:268)
         draftPlan (:319): no model call when stopped / no slot / no credits / no budget / no candidate (idle);
           else one `chiefOfStaff` call (Opus), schema CyclePlanOutput, system = buildSystemPrompt(chief, brief) with cacheSystem (:363-371)
         the planner orders, it never gates: every dispatchable candidate starts while a slot is free (:400-415)
    4  acts.startCycle                 (cycle.ts:479)       event cycle.started, idempotent on cycleId
    5  startPendingMerges              (wf :116-122)        mergeReview per code task waiting in review
    6  dispatchReady loop              (wf :229-294) for each CycleStart within maxConcurrent, one agent per task, no overlapping fileScope, budget reserve:
         acts.openSession              (cycle.ts:511 → act/dispatch.ts:63 openAgentSession)  the guard; agent_sessions row, task → running, event task.started
         startChild(agentSession, id session:<sessionId>, args {…, cycleId, briefText: brief.text, spendCapMinor?}, ABANDON)   (wf :261-265)
  wf   agentSession (wf/agentSession.ts:85)
         acts.prepareSession           (session.ts:763)     grants, sandbox mode, model (credit saver), recording key in mock
         runner.runAgentSession        (session.ts:806) on `${queue}-sessions`; 8 h start-to-close, 3 min heartbeat, 3 attempts (wf :31-45)
              mock: runMockSession (:1165) replays a recording
              live: runLiveSession (:1424) → Claude Agent SDK query() (:1738); tool calls go to the gateway MCP servers
              events to Redis stream as:<sessionId> (publishSessionEvent, SessionRecorder.publish :475)
         acts.finishSession            (session.ts:912)     usage ledger, agent_sessions ended, recording archived, task status,
                                                            event task.completed | task.blocked (idempotency key per session), agent health
         startChild(mergeReview, id merge:<taskId>) when a code task passed its tests (wf :255-258)
    7  each time a session finishes: acts.followUpStarts (cycle.ts:455) adds tasks that became dispatchable (wf :324-335)
    8  the loop ends when nothing runs and nothing is pending, at the time box (4 agent hours, packages/config/src/limits.ts:5), or on stop
    9  acts.narrateCycle               (cycle.ts:658)       deps.composer.narrate({ businessId, eventIds }) in batches of 50
         composer POST /v1/narrate → ComposerService.narrate (apps/composer/src/service.ts:72) → composeNote (compose.ts:188):
           one `inboxComposer` call (Opus, low effort), Zod ComposerOutput, entity check, at most one re-ask, linker sweep (Haiku)
           persistNote: inbox_items row + events marked narrated + inbox.item_created through the outbox, one transaction
         idle cycle instead: acts.noteIdleCycle (cycle.ts:636), no model call
   10  acts.completeCycle              (cycle.ts:555)       event cycle.completed (idempotent)
  wf   autopilot: autopilotEvaluate → decideRun: another round (trigger autopilot) after 1 minute, wait, or end the run
         autopilotRunEnded writes cycle.run_ended once per run
  web  the outbox relay publishes to ev:<businessId>; apps/stream sends inbox.item_created to the open tabs
```

A cycle that cannot be planned ends `failed` with one Chief of Staff warning (`endUnplanned`, `wf/businessCycle.ts:91-104`; `notePlanFailure`, `cycle.ts:522`). A cycle whose workflow throws writes `failCycle` (`cycle.ts:596`).

### 1.4 One agent session in detail

**Launch (`prepareSession`, `session.ts:763-800`).** Refuses a paused agent or a stopped team (non-retryable `AGENT_PAUSED_FAILURE`). Grants: `sessionGrantsFor(db, businessId, taskId, resolveGrants(parseGrants(version, template)))` (`:769`). `parseGrants` (`:188`) takes the template's grants when the agent's live version is the untouched version 1 written by the system (`followsTemplate`, `:184`), else the version's own. Sandbox: `deps.sandbox()` (`deps.ts:159-175`). Model: `resolveModel(template.route, agent.modelKey, { lowCredits })` (`:776`). `maxTurns: DEFAULT_MAX_TURNS` = **60** (`:74`, `:795`). Branch `agent/<taskId>`.

**The key (`resolveApiKey`, `session.ts:714-730`).** `business.modelBilling === "byok"`: the founder's own key through `loadByokApiKey(db, vault, businessId)`; when it is missing the session is `blocked` with reason `credential` and never falls back to the platform key. Otherwise `deps.env.ANTHROPIC_API_KEY` (platform credits). There is no third path: `businesses.funding_source` has `own_plan` (`packages/shared/src/constants.ts:27`) but `FLAGS.ownPlanFunding` is `false` (`packages/config/src/flags.ts:10`) and no provider is integrated.

**Credits and budget.** On the platform key: `SessionCredits.open` (`act/session-credits.ts:91`) refuses when the month's credits do not allow a live call, books usage every finished turn and every 15 s (`SESSION_CREDIT_CHECK_MS`), and ends the session `blocked`/`budget` when they run out. On either key: `sessionBudget` (`act/session-budget.ts:88`) = the smallest of the task budget (own, else `DEFAULT_TASK_RESERVE_MINOR` = 2,000 cents, `apps/orchestrator/src/cycle-contract.ts:66`) less what the task's earlier sessions cost, credits left, the agent's wage cap left, the monthly model budget left, and the cycle's share (`spendCapMinor`).

**Model.** Routes are in `packages/models/src/routing.ts:147-216`. Model ids: `opus` = `claude-opus-5-5`, `sonnet` = `claude-sonnet-5-5`, `haiku` = `claude-haiku-4-5-20251001` (`:21-25`). Sessions use the template's route: Chief of Staff `chiefOfStaff` (Opus, kept on low credits), leads `departmentLead` (Opus → Sonnet on low credits), Planner `planner` (Opus → Sonnet), Review agent `codeReview` (Opus, kept), every worker, channel engine and specialist `worker` (Sonnet → Haiku). The agent's own `modelKey` overrides unless the route is locked. Low credits (#118): `prepareSession` moves routine work down unless the template's module is finance or legal or the grants include a tool that contacts a third party, spends money or is irreversible (`sessionKeepsModelOnLowCredits`, `act/session-credits.ts:31`; `grantsActOutside`, `packages/connectors/src/grants.ts:121`); re-checked on every run (`keptModelForRun`, `session.ts:813`).

**The system prompt (`buildSystemPrompt`, `packages/agents/src/club-rules.ts:93-107`), in this order:**

1. `## House rules`: the seven rules plus the US-English house style (`packages/agents/src/prompts/club-rules.ts:15-60`), about 1,600 characters.
2. `## What you do`: the template's `description`.
3. `## Your instructions`: `renderInstructions` (role, goals, rules, playbook, tone, examples) of the version's or template's instructions (`instructionsFor`, `session.ts:194`).
4. `## Skills`: `renderSkills` (`club-rules.ts:63-68`): a preamble, then each skill whole inside `<skill name="…" source="…">`. Role skills first (`roleSkillsFor(template.skills)`: today only Design principles for the frontend and design-to-code engineers, 4,000 characters), then the founder's added skills (`repos.skills.listAddedForAgent`) (`session.ts:700-705`).
5. `## Glossary`.
6. `## Business brief`: `brief.text` from the cycle. Absent for every session not started by a cycle.

It is passed as **one string** (`session.ts:1449`, `:1741`). `hasClubRulesPrefix` asserts the rules are first (`:1450`).

**Size (Estimate, 4 characters a token, `act/brief.ts:24-26`).** House rules about 400 tokens; description and instructions 600 to 1,500; brief up to 4,000 (`BRIEF_TOKEN_BUDGET`); skills 0 by default, about 1,000 for the two UI engineers, up to 15,000 with eight added skills at the 60,000-character cap. So about 5,000 to 6,000 tokens typical, about 21,000 at the cap, before tool definitions (MCP tool schemas for 12 to 30 tools, plus the five file tools on a code task).

**Prompt caching.** The session path sets no cache option: the SDK's CLI caches the system prompt and conversation on its own within a session. Because `systemPrompt` is a string, the per-cycle brief sits in the same block as the stable rules, instructions and skills, so nothing is marked as a cross-session prefix; the SDK offers `systemPrompt: string[]` with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` for exactly that (`sdk.d.ts:2403`, `:9651`) and it is not used. The only explicit breakpoints are on the single-call paths: `cacheSystem: true` puts `cache_control: { type: "ephemeral" }` on the last system block (`packages/models/src/client.ts:709-712`), used by the cycle plan (`cycle.ts:370`), the composer (`apps/composer/src/compose.ts:214`) and the staged foundations. For the cycle plan the last block is the whole prompt including the brief, so it hits only on a retry.

**The task prompt (first user turn, `session.ts:1530`).** `# Task: <title>`, `goalMd`, `## Acceptance criteria`, then `codeTaskNote(branch)` (`:2021`) for a code task or "this task has no file access", then `continuing` (a merge hand-back reason from `latestHandBack` `:2794`, the checkout note, the restored-files note), then a resume note, then one closing line.

**The exact `query()` call (`session.ts:1738-1781`):**

```ts
q = sdk.query({
  prompt: queue.messages(),               // PromptQueue: streaming input; the task, then nudges, decisions and Resume as user turns
  options: {
    systemPrompt,                         // one string (above)
    model: launch.modelId,
    mcpServers,                           // { [connector]: { type: "http", url: deps.gateway.mcpUrl(key), headers: { ...sessionHeaders(token), traceparent? } } }  (:1526)
    tools: policy.tools,                  // code: ["Read","Glob","Grep","Edit","Write"]; any other kind: []
    allowedTools: policy.allowedTools,    // the mcp__<connector>__<tool> names (+ the five file tools on a code task)
    disallowedTools: policy.disallowedTools,
    maxTurns: launch.maxTurns,            // 60
    cwd,
    maxBudgetUsd: Math.min(budget.maxUsd, credits?.maxBudgetUsd ?? Number.POSITIVE_INFINITY),
    env,                                  // sdkEnvFor(...)
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: "dontAsk",
    permissionPrompts: "none",
    hooks: { PreToolUse: [{ timeout: hookTimeoutSeconds, hooks: [ /* pause gate, then guardToolCall */ ] }] },
    abortController: abort,
    persistSession: false,
  },
});
```

There is no `canUseTool` (never called with `permissionPrompts: "none"`), no `skills`, no `plugins`, no `additionalDirectories`, no `agents`. The PreToolUse hook (`:1760-1775`) holds every tool call while the session is paused, refuses it once the run is ending, then runs `guardToolCall`.

**The message loop (`:1783-1857`).** Assistant text → `note` events (4,000 characters each); `tool_use` → `tool_call started` (and loop detection); `tool_result` → `succeeded` / `failed` / `awaiting_approval` (the gateway's `"outcome":"ask"` and `approvalId` are read from the result text, `:1814-1816`); `result` → usage (`SessionUsage.onResult`), credit settle, `classifyTurnEnd` (`:1385`), the design check's one fix turn (`:1849`), then the input closes.

**After the SDK ends (`:1860-1993`), code tasks only.** Adopt the branch the agent pushed (`adoptPushedBranch`), decide `nothingWritten` (`:1914`), scope the tests to what changed (`changedScope`), run them in a sandbox (`runAcceptance`, `:2493`), hold for review when the session changed how tests run (`testSetupChanges`). Outcomes: `blocked` for an agent's own `block_task`, no changes, failed or unrun tests, an undecided approval; `done` otherwise. A task that is not code has no check at all: it ends `done` with the summary "<agent> finished "<title>" with N tool calls." (`:1993`).

**`finally` (`:1994-2011`).** `keepWorkspace` saves the files to `workspace_snapshots` / `workspace_blobs` and pushes to `agent/<taskId>` unless `holdBack` is set; the checkout archive and the workspace are deleted.

**A gated tool call.** The gateway answers `outcome: "ask"` with an `approvalId` as the tool's result (the call did not run) and writes the approval and its Inbox item; the recorder tracks it (`openApproval`, `session.ts:595`). The agent's turn usually ends; the runner keeps the session open and polls its control list every 250 ms. The founder's answer arrives as a `decision` signal → `postSessionCommand` → a user turn "The founder approved the pending action; continue." (`turnFor`, `:1357`); the agent calls the tool again and the gateway runs it under the approval the founder gave. A rejection becomes "do not retry it and continue with the rest of the task".

**Bounded waiting.** A gated call left undecided for `APPROVAL_WAIT_MINUTES` (30) ends the session `blocked`/`awaiting_approval`. A pause longer than `SESSION_PAUSE_HOLD_MINUTES` (10) parks: the run returns and the workflow waits up to 7 days (`wf/agentSession.ts:38`, `:209-229`). A deploy hands the run off (`src/drain.ts`).

### 1.5 `sdk-isolation.ts`

```ts
export const FILE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"] as const;                          // iso.ts:42
export const ALWAYS_DISALLOWED_TOOLS = ["Bash", "BashOutput", "KillBash", "KillShell", "WebFetch", "WebSearch",
  "NotebookEdit", "NotebookRead", "MultiEdit", "Agent", "Task", "Skill", "TodoWrite", "ExitPlanMode",
  "EnterWorktree", "ExitWorktree", "LS"] as const;                                                    // iso.ts:44
```

`sdkToolPolicyFor(kind, mcpTools)` (`iso.ts:114-123`): `fileTools = kind === "code"`; `tools` = the five file tools or `[]`; `allowedTools` = MCP names (+ file tools); `disallowedTools` = the list above (+ the file tools for a task that is not code). Reasons given in the file header (`:5-19`, SECURITY_REVIEW SEC-3): the SDK process is the only part of a live session on the orchestrator host, so no shell, no network tool, no sub-agent; "listed explicitly so a preset change upstream cannot re-enable them".

`sdkEnvFor` (`iso.ts:75-100`) builds the environment from scratch: `PATH`, locale, proxy and CA variables from the host (`SDK_HOST_PASSTHROUGH`, `:37`), `HOME` = the workspace, `TMPDIR` = `<cwd>/.tmp`, `CLAUDE_CONFIG_DIR` = `<cwd>/.claude`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_AUTOUPDATER=1`, the five `FM_*` identifiers (`buildSandboxEnv`, `session.ts:145`), `FM_GATEWAY_SESSION_TOKEN` and `ANTHROPIC_API_KEY`; asserted with `assertNoLongLivedCredentials` with the model key as the one exemption.

`guardToolCall` (`iso.ts:156-177`): `mcp__*` always passes (the gateway is its policy); a file tool passes when every path argument resolves, symlinks followed, inside the workspace; **anything else is denied**.

**Answers to the specific questions.**

- **Is the SDK's `Skill` tool allowed?** No, three times over: it is in `ALWAYS_DISALLOWED_TOOLS` (`iso.ts:44`); the base tool set is the five file tools or nothing (`tools: policy.tools`); and the hook's `guardToolCall` denies every tool that is not `mcp__*` or a file tool (`iso.ts:158`).
- **Is `settingSources` set?** Yes, `settingSources: []` (`session.ts:1756`), with `strictMcpConfig: true`. No `settings.json`, `CLAUDE.md`, hooks, permission rules or `.mcp.json` are read from the workspace or `HOME`.
- **Could the SDK load `.claude/skills/*` from the working directory?** Not today. Besides the two locks above, nothing untrusted can put a `.claude` directory at the workspace root: a checkout leaves out the SDK's home entries and start-up files (`act/checkout.ts:10`), a restore refuses them (`restorablePath`, `act/workspace-store.ts:165-170`; `isSdkHomeEntry`, `act/workspace-sync.ts:24`, `:61`; `STARTUP_FILES`, `workspace-store.ts:110-138`, which includes `claude.md` and `.mcp.json`), and a save never keeps them. One gap that is harmless only while the locks hold: the agent's own `Write` may create `<cwd>/.claude/...` during a session, because the guard allows any path inside the workspace (see AR-22).
- **What is carried today.** Every added skill, whole, in every system prompt: `SKILL_INSTRUCTIONS_MAX_CHARS` 20,000, `MAX_ADDED_SKILLS_PER_AGENT` 8, `ADDED_SKILLS_MAX_TOTAL_CHARS` 60,000 (`packages/agents/src/skill-files.ts:25-29`). The description (20 to 1,024 characters) exists on `skill_definitions` and is returned by `listAddedForAgent` (`packages/db/src/repos/skills.ts:269-296`) but `loadContext` drops it (`session.ts:704`).
- **Screening that already exists.** `parseSkillFile` (`skill-files.ts:309`): file type, 64 KB (`LIMITS.skillFileMaxBytes`), UTF-8, a front-matter parser that reads plain `key: value` only (tags, anchors and aliases refused; `allowed-tools` / `tools` knowingly ignored, `TOOL_KEYS` `:89`), name and description bounds. `screenSkill` (`:274-297`): invisible and control characters, HTML comments, reserved section headings (`RESERVED_HEADERS` `:214`), injection phrasing (`INJECTION_PATTERNS`, with a negation rule), and every line through `detectClubRuleViolation`. At render, `neutralizeSkillTags` (`club-rules.ts:54`) stops a skill closing its own block. The Chief of Staff's `assign_skill` runs the same check on a repository file (`packages/connectors/src/connectors/platform/tools.ts:275-286`).

The seam for loading on demand is described in finding AR-10.

### 1.6 Sandboxes

- **Selection** (`packages/sandbox/src/provider.ts:31-42`): `SANDBOX_MODE` wins; else `INTEGRATIONS_MODE=mock` → the replay runner; `live` → E2B when `E2B_API_KEY` is set, else Docker, else `SandboxUnavailableError`. Documented production: `INTEGRATIONS_MODE=mock`, `SANDBOX_MODE=e2b`, `MODEL_MODE=live` on the orchestrator (`docs/DEPLOY.md:188`, `:259-260`). So sessions are **live SDK runs**, not replays, while most connectors are mock.
- **Mock replay** (`packages/sandbox/src/mock/replay.ts`; seven recordings about the two sample businesses, `RECORDINGS` in `mock/recordings/index.ts:260`): chosen by `recordingForTask` (`session.ts:206`); only when the sandbox mode is `mock`.
- **E2B** (`packages/sandbox/src/e2b/index.ts`): `Sandbox.create(template, { timeoutMs: ttl, allowInternetAccess, network: { allowOut, denyOut: [all] } })` (`:121-131`); `closeEgress()` replaces the rules with deny-all (`:313-316`). Template: `E2B_TEMPLATE` (`deps.ts:167`), built from `infra/e2b/e2b.Dockerfile` (Node 22.23.3, pnpm 12.9.1, git, build tools, Chromium through Playwright 1.63.0) by `.github/workflows/e2b-template.yml` (manual `workflow_dispatch`; inputs name, cpu 4, memory 4096; `npx @e2b/cli@2.22.3 template create`) or once as the orchestrator's pre-deploy command (`infra/e2b/README.md`).
- **What a code session's workspace contains.** On the host: the repository checkout through the gateway's archive route (`checkoutRepository`, `act/checkout.ts`; token for `github:download_archive` only; 60 MB, 8,000 files, 300 MB unpacked; no `node_modules`, `.git`, `.claude*` or start-up files), then the task's latest saved changes on top (`restoreWorkspace`, `act/workspace-store.ts`). Tables `workspace_snapshots` and `workspace_blobs` (`packages/db/src/schema/workspaces.ts`), written by the orchestrator only; secret-named files left out, credential-shaped values masked. `prepareAgentWorkspace(sandbox, repo, opts)` (`packages/sandbox/src/worktree.ts:241`) clones and makes a worktree inside a sandbox; **nothing in apps/orchestrator calls it** (only its tests do): the live path copies the host workspace into the sandbox instead (`syncCheckoutToSandbox` / `syncWorkspaceToSandbox`, `act/workspace-sync.ts`).
- **Egress.** `sandboxEgressFor(task)` (`session.ts:2080`): a code task gets `registry.npmjs.org` and `temporal.download`; everything else nothing. Dependencies install online with scripts off, then `closeEgress()`, then the agent's code runs offline (`session.ts` header `:25-28`, `runAcceptanceIn` `:2525`).
- **Credentials inside the sandbox.** Only `FM_BUSINESS_ID`, `FM_AGENT_ID`, `FM_TASK_ID`, `FM_SESSION_ID`, `FM_GATEWAY_URL` (`buildSandboxEnv`, `:145-156`), asserted by `assertNoLongLivedCredentials` (`packages/sandbox/src/credentials.ts`). The model key and the gateway token exist only in the SDK process on the host.
- **Recordings.** Events go to the Redis stream `as:<sessionId>` (kinds `tool_call`, `stdout`, `file_changed`, `test_result`, `phase_changed`, `progress`, `note`; `packages/events/src/session-stream.ts:16-136`). `finishSession` copies them to `session_recordings` (`archiveSessionRecording`, `act/recording.ts`, 8 MB a row, long output cut) and lets the stream expire.

### 1.7 Tools an agent can call

Built-in SDK tools: `Read`, `Glob`, `Grep`, `Edit`, `Write`, on a `code` task only, whatever the template grants (the policy reads the task kind, not `grants.builtinTools`). Everything else is a gateway MCP tool resolved by `resolveGrants` (`packages/connectors/src/grants.ts:380-422`) from the capability maps (`CAPABILITY_TOOLS`, `:136-246`).

| Family | Gateway tools (connector: tools) |
| --- | --- |
| Every agent (`PLATFORM_BASE_TOOLS`, `packages/agents/src/connectors.ts:84-97`) | platform: `list_tasks`, `get_task`, `claim_task`, `block_task`, `handoff_task`, `complete_task`, `send_message`, `list_messages`, `request_human_action`, `search_entities`, `list_repository_docs`, `read_repository_doc` |
| Leads add (`PLATFORM_LEAD_TOOLS`, `:100`) | platform: `create_task`, `assign_task`, `update_task`, `read_business`, `read_finance` |
| Chief of Staff (`templates/chief_of_staff.ts:64`) | leads' set + `list_approvals`, `list_skills`, `assign_skill`, `remove_skill`. No web, no `read_product` |
| Product lead | + `read_product`, `propose_spec_change`; web: `search_web`, `fetch_page`; quarantine: `read_untrusted`; notion: `search`, `query_data_source`, `get_page`, `get_page_content` |
| Engineering lead | + `list_sessions`; github: `list_repos`, `read_tree`, `read_file`, `compare_refs`, `list_pull_requests`, `get_pull_request`, `get_checks`, `run_checks`; vercel: `list_deployments`, `get_deployment`, `create_deployment` |
| Finance lead | + stripe: `get_balance`, `get_account`, `list_payouts`, `list_charges`, `list_invoices`, `get_invoice`; shopify: `list_orders`, `get_order`, `get_shop`; tink, plaid: `list_accounts`, `get_consent_status`, `list_transactions`, `sync`; ecb_rates: `get_daily_rates`, `convert`; quarantine |
| Legal lead | + `read_legal`; web; quarantine; companies_house, bolagsverket, opencorporates lookups; dropbox_sign: `list_signature_requests`, `get_signature_request`, `send_signature_request` |
| Operations lead | + google_drive: `search_files`, `get_file`, `export_text`, `read_doc`, `create_doc`, `append_to_doc`; gmail: `create_draft`, `list_messages`, `get_message`, `list_labels`; quarantine |
| Distribution strategist | + `read_distribution`; web; quarantine; posthog: `query_insights` |
| Engineers (backend, frontend, data, infra, design-to-code, docs, integration, QA) | base + file tools on code tasks; github: reads + `create_branch`, `commit_files`, `open_pr` (integration adds `merge_pr`; QA has `run_checks` and no write); infra adds vercel reads; data adds posthog; docs adds notion and drive writes |
| Planner | base + `update_task`, `read_product`; github reads |
| Researcher, Product researcher | base + web; quarantine; google_drive reads (product researcher adds `read_product`) |
| Review agent | base + github reads |
| Channel engines (15) | base + `check_contact`, `read_business`, `read_finance`; quarantine; and per channel: email → sendgrid (`send_mail`, `create_campaign`, `schedule_campaign`, `get_stats`, …), platform_mail `send_mail`, resend `send_mail`; social → buffer (`list_channels`, `queue_post`, `get_post`), runway, elevenlabs_voice; SEO → github, serpapi `search_google`, firecrawl `scrape_page`, indexnow `submit_urls`; GEO → the four `ask_panel` connectors; content → drive, notion, github; lead generation → apollo; affiliate → stripe reads |
| Specialists (8) | base + `read_product`; quarantine; web; gmail drafts; drive |
| Utilities (5) | none: their inputs are handed in the call |

What no agent has (verified by reading the tool lists): a shell, a browser, a tool that writes a document or a report, a tool that publishes or edits the project page, a tool that creates a CRM record or lists contacts with their addresses, a tool that creates a payment link or checkout (the Stripe connector defines `create_checkout_session`, `packages/connectors/src/connectors/stripe/tools.ts:81`, but no capability maps to it and no template is granted it), a tool that writes a research artifact, a tool that enables a channel or sets a budget.

### 1.8 Quality loops

- **Second read (#117)** (`act/second-read.ts`, `packages/agents/src/second-read.ts`). `secondReadMerge` (`:90`): before a merge is asked for, a different agent (the Review agent, else the Chief of Staff, `pickSecondReader`) reviews the diff in one `codeReview` call; the diff is read through the gateway on a read-only token (`github:compare_refs`, `github:read_file`); stored as audit `merge.reviewed` and shown with the approval; never blocks. `secondReadDocument` (`:183`): after the foundations, at most two rounds on `documentReview`, with web fact-checks through the gateway "where the `web` connector answers" (a simulated result is never a checked fact), one Inbox note, one revision task whose session keeps only document tools (`sessionGrantsFor`, `:272`). Both are single calls, not sessions.
- **Design check (#114)** (`act/design-check.ts`, `liveDesignCheck` `session.ts:2629`): file writes are tracked from tool calls; at the end of the agent's turn the changed pages are served and captured in the sandbox at desktop and 390 px (`capturePages`, `packages/sandbox/src/browser.ts`), a separate reviewer on the vision route `designReview` returns ranked fixes, and the author gets **one** fix turn (`session.ts:1849-1853`). Recorded as `task.design_checked`. Never blocks.
- **Typed reads (#89)** (`packages/connectors/src/facts.ts`, `apps/gateway/src/untrusted-reader.ts`): an agent that holds an outward tool reads third-party content as the quarantined reader's digest plus checked typed values. Gate: `.github/workflows/evals-typed-reads.yml` (live model, on changes to those files).
- **Acceptance runs.** Described in 1.4. They run after the agent's conversation has ended; the agent never sees the result (AR-07).
- **Review agent.** The template exists (`templates/workers/review_agent.ts`, route `codeReview`); in practice its work is the second read call. A review task dispatched to it as a session has read tools only.
- **Loop detection** (`act/loop.ts`): the same `connector:tool|args` started three times in a row with no file change or different test result in between; the session ends `failed`/`loop_detected` and the agent is marked `failing`.
- **Retries** (`apps/orchestrator/src/retry.ts`): a failed or blocked task is offered again after 15, 30, 60 minutes, three times (`TASK_RETRY_LIMIT`), then only the founder's Start; a founder's Continue retries everything at once (`retryDeferral`, `cycle.ts:99`). A failing agent rests 10 minutes doubling to 4 hours.
- **Timeouts.** Runner 8 h start-to-close, 3 min heartbeat; cycle time box 4 agent hours; acceptance install 10 min and run 15 min (`session.ts:79-80`); composer 150 s per note.
- **What the founder sees when a session fails.** One `task.blocked` event per session (`finishSession`, `session.ts:987-1014`), narrated with the rest of the cycle into one note by the composer, whose prompt names at most two stuck things and says "Nothing is needed from you" unless money, a signature, an account or a business decision is needed (`packages/agents/src/prompts/inbox-composer.ts:61-62`). A task whose agent said it lacks a tool is stopped and archived with no note at all (`stopToollessTasks`, `cycle.ts:287-318`).

### 1.9 Context and memory

- **The brief** (`act/brief.ts:122-216`): rebuilt per cycle, never stored; sections Business line, Glossary, Departments, Team, Open tasks, In flight, Roadmap without tasks, Product stage, Governance, Regulated areas, Rules of engagement; cut at 16,000 characters. It is a planner's digest: **it does not say what the business is** (no vision, idea, customer or offer).
- **Facts by tool.** `read_business` (name, mode, glossary, team), `read_product` (specification text, roadmap, sources; held by the Product lead, Planner, Product researcher and specialists only), `read_finance`, `read_legal`, `read_distribution`, `search_entities` (id, kind, name only), `list_repository_docs` / `read_repository_doc` (every agent).
- **Cross-session memory.** None. There is no per-agent or per-project memory table (the table list in `packages/db/src/schema` has none; "memory.search" is the capability name for `search_entities`). BUILD §9.7 asks for retrieval over sources, interactions and sessions and for stored session summaries; embeddings exist on product sources and CRM entities, but no agent tool searches them and no summary of a session is stored.
- **Compaction.** Nothing is configured; `persistSession: false`. A resumed run (after a park, a hand-off or a retry) is a **new SDK conversation** with the same task prompt and one sentence saying it was resumed (`session.ts:1529`); only the workspace files (code tasks) carry over.
- **How one agent's output reaches the next.** Code: the branch, the merge and the saved workspace. Messages: `send_message` / `list_messages` (typed, between agents). Everything else: `complete_task({ summary ≤ 4,000 })` writes one audit row `platform.task.completed` (`apps/gateway/src/platform-host.ts:179-187`) that **nothing reads** (one occurrence of that string in the repository). `get_task` returns no report and no last block reason (`TaskDetail`, `platform/tools.ts:34-39`).

### 1.10 Composer

- **When.** At the end of a cycle (`narrateCycle`); when a customer is won (ingest, then `journeyBuild`); on Refresh (`apps/composer/src/refresh.ts`: un-narrated event → data-change insight → next-best decision, from a 3-item `composer_buffer`, debounced 3 s).
- **Schema.** `ComposerOutput` (`packages/models/src/schemas.ts:55-76`): `type`, `from_agent_id`, `subject` ≤ 80, `body_md`, `status_strip` ≤ 4, `exhibit { kind, spec_ref }`, `decision { options 2-4 (id, label, recommended, consequence, cost_minor, reversible, because?), free_text, expires_at } | null`, `blocks_continue`, `source_event_ids`. `blocks_continue` is always false for a composer note (`compose.ts:116`).
- **Inputs.** The events' payloads, a business brief, agents, the entity manifest, metrics, the saved-query catalogue, glossary, `now` (`composerInputs`, `compose.ts:121`). System = house rules + `inbox_composer` prompt v6.
- **Simulated results.** Three layers, none in the composer's own code: house rule 4 is in its system prompt (`compose.ts:164-170`); a mock connector the project never connected is refused before it runs (`apps/gateway/src/pipeline.ts:757`); events that can be simulated carry the flag (`mail.sent.simulated`, `packages/events/src/catalogue.ts:1854`). The morning brief, unlike the composer, filters in code (`packages/shared/src/morning-brief.ts:56`, `:109`). No eval proves the composer's behavior on a simulated event (AR-15).
- **Cost per note.** Not measured anywhere. Estimate: one Opus call at low effort with 4,000 to 10,000 input tokens and a few hundred to 2,000 output tokens, plus a Haiku linker sweep, sometimes one re-ask: about 3 to 8 cents at the list prices in `packages/models/src/pricing.ts:36-38`. A cycle is one note per 50 events.

### 1.11 Reliability and cost evidence on record

All from Foundmill's own business building Foundmill (the only live loop), `docs/PROGRESS.md`:

| When | What happened | Line |
| --- | --- | --- |
| Oct 25-30 | Cycles 1 to 10: sandbox killed installs (Node 20, memory), sessions judged "changed no files" while a PR was open, stale branches tested, root test run killed (exit 137), Playwright suites run against no server, GitHub rate limit on file-by-file reads | 1349-1361 |
| Nov 2, cycles 35 and 36 | 25 sessions, 2 done, 23 blocked. Causes: a rebuilt branch refused `branch_moved`; a reassigned task left `running` forever; agents on the version written at hiring never got new template tools (Planner "no task-update tool", two sessions, **287 cents**); seven tasks that were the platform's own steps; agents blocking on "no shell" | 1372 |
| Nov 2, cycle 37 | 12 sessions, 3 done, 9 blocked; first merge question reached the Inbox | 1373 |
| Nov 2 | The founder's first approval was refused by GitHub 17 seconds early and nobody told them | 1374 |
| Nov 3, cycle 39 | Sweep stopped six leftover platform-duty tasks; nine sessions; founder's verdict "way too complex; I just want it to work" | 1375-1377 |
| Nov 6, cycle 40 | An approval was spent on a call GitHub turned away; fixed with `releaseUse` | 1378 |
| Nov 9 | A pause pressed during planning stuck the cycle until its time box (fixed in the api by matching on workflow id) | 1392 |

Measured cost on record: only the 287 cents above (two Opus Planner sessions) and "a few cents each" for sessions that block at once (1373). The overnight shift's $0.15 a night and the project page's 0.6 to 1.5 cents are worked out from list prices, not measured (`docs/DECISIONS.md:3734`, `docs/PROGRESS.md:1950`). THESIS package 7.1 (prices from measured cost) is open. No cycle of a new founder's project (as opposed to Foundmill's own repository) is on record.

Limits in code: free tier 4 concurrent agents and 500 cents of credits a month (`packages/config/src/pricing.ts:19`); a cycle hands a task `min(task budget or 2,000, credits left / free slots)` cents (`taskReserveMinor`, `wf/businessCycle.ts:44`); 16 session slots per worker; concurrency counts open `agent_sessions` rows of the last 24 hours (`packages/db/src/tiers.ts:138-145`). Rate limits: single calls go through the header-aware limiter (`packages/models/src/rate-limit.ts`); a session relies on the SDK's own retries, and a 429 or 529 the SDK gives up on blocks the task `rate_limit` for a later cycle (`classifyTurnEnd`, `session.ts:1418`). The brief's capacity line is a constant, not a reading ("requests 50/min, input 80k tok/min, output 16k tok/min (Estimate until headers are read)", `act/brief.ts:165`).

### 1.12 Temporal retries: what is safe to run twice

| Step | Retried how | Safe? | Why |
| --- | --- | --- | --- |
| `openSession` | activity, 3 attempts | yes | the workflow chooses the session id (`uuid4()`, `wf/businessCycle.ts:252`); a retry finds its own row (`act/dispatch.ts:68-70`) |
| `startCycle`, `completeCycle`, `failCycle` | activity, 3 attempts | yes | `cycleEventKey(kind, cycleId)` idempotency key (`cycle.ts:57`, `:489`, `:557`, `:600`) |
| `planCycle` | activity, 3 attempts | mostly | a retry pays for the Opus plan again; billing and key refusals are non-retryable (`planFailure`, `cycle.ts:67`) |
| `planRoadmap` | activity, 3 attempts | yes | skips an item that has tasks, under the planning lock (`act/roadmap-plan.ts:59-60`, `:75-76`) |
| `narrateCycle` through the composer | activity, 3 attempts | yes | `/v1/narrate` is idempotent per event set (`apps/composer/src/service.ts:44`, `:72-81`) |
| `plainCycleUpdate`, `notePlanFailure` | inside the above | **no** | `repos.inbox.createItem` with no key (AR-18) |
| `noteIdleCycle` | activity | yes | an unread note with the same text is reused (`cycle.ts:640-641`) |
| `finishSession` | activity, 3 attempts | mostly | usage rows and `task.completed` / `task.blocked` carry keys per session; `agent.health_changed` and the audit row do not (AR-18) |
| `runAgentSession` | 3 attempts after a lost worker or a missed heartbeat; a hand-off on every deploy; a park | **no** for outward tool calls | a new SDK conversation with no record of what ran; the gateway has no idempotency key (AR-12). Usage is safe: the workflow books a dead run from its last heartbeat (`failedRunUsage`, `wf/agentSession.ts:65`) and `finishSession` books only what the ledger lacks (`unbookedTokens`) |
| `mergeReview` steps | activity, 3 attempts; the merge retried three times 30 s apart | yes | the approval is given back when GitHub never ran the call (`repos.approvals.releaseUse`, `docs/PROGRESS.md:1378`) |
| Signals to a session | control activity, 5 attempts, numbered commands | yes | `seq` per command; a run ignores numbers from before it started (`wf/agentSession.ts:96-118`) |

---

## 2. Real, simulated and not connected in production

Documented production (`docs/DEPLOY.md:50-51`, `:259-260`, `:271-277`): `INTEGRATIONS_MODE=mock` on every service, `LIVE_CONNECTORS=github,domains` on the gateway and the api, `MODEL_MODE=live` with `ANTHROPIC_API_KEY` on the api, composer and orchestrator and **`mock` elsewhere (so on the gateway)**, `SANDBOX_MODE=e2b` on the orchestrator. Later entries add `stripe_billing`, `sendgrid`, `elevenlabs`, `buffer` and others "when configured"; none records `web` going live. Verify the gateway's variables before acting on this table.

How the gateway decides (`apps/gateway/src/pipeline.ts`): `modeFor` (`:132`) = live when `INTEGRATIONS_MODE=live`, or the connector is in `LIVE_CONNECTORS`, or it is `platform` / `quarantine` (`ALWAYS_LIVE_CONNECTORS`, `packages/connectors/src/catalogue.ts:133`). A live connector with no credential answers 409 `integration_not_connected` (`:752`). A mock connector **that needs an account** and was never connected answers the same 409 for a person's own project on staging and production (`:757`, `mockResultsAllowed`). A mock call that does run carries `simulated: true` and a notice (`:923`).

| Thing | State in documented production | How I know |
| --- | --- | --- |
| The session itself (model, turns, tool calls) | Real: Claude Agent SDK on the platform key or the founder's key | `session.ts:1738`; `docs/DEPLOY.md:259-260` |
| File tools on a code task | Real, on the orchestrator host, path-guarded | `iso.ts:156` |
| `platform` tools (task board, messages, reads, skills, founder tasks) | Real: the gateway's own database | `apps/gateway/src/builtins.ts:7` |
| `quarantine:read_untrusted` and the automatic reader for agents with outward tools | **Mock model output** if the gateway runs `MODEL_MODE=mock` as documented | `apps/gateway/src/reader-models.ts:35-37`; `docs/DEPLOY.md:51` |
| `github` (reads, `commit_files`, `open_pr`, `run_checks`, `merge_pr`) | Real, once the founder installed the GitHub App and chose a repository on Development › Code | `docs/DEPLOY.md:277` |
| Acceptance tests, design-check screenshots | Real, E2B | `session.ts:2493`; `docs/DEPLOY.md:260` |
| `web:search_web`, `web:fetch_page` | **Simulated.** `web` needs no account (`auth: { kind: "none" }`), so the refusal at `pipeline.ts:757` does not apply and the mock answers: `https://example.com/<slug>/1 "(result 1, mock)"`, "A page about … (mock <hash>)". Marked `simulated: true` | `packages/connectors/src/connectors/web/mock.ts:8-40`; `pipeline.ts:757` |
| `ecb_rates` | Simulated, same reason | `packages/connectors/src/connectors/ecb_rates/mock.ts` |
| `platform_mail:send_mail` | Refused for a real project on a mock deployment; real once `PLATFORM_MAIL_DOMAIN`, the SendGrid key and `LIVE_CONNECTORS` including `sendgrid` are set (`docs/DEPLOY.md:228`) | `docs/PROGRESS.md:1555-1566` |
| Every connector that needs the founder's account (stripe, sendgrid, resend, gmail, google_drive, notion, shopify, tink, plaid, dropbox_sign, apollo, vercel, posthog, buffer, runway, elevenlabs_voice, serpapi, firecrawl, indexnow, the four panels) and the registries | "Not connected, so nothing was done" (409) until connected; simulated if a mock integration row exists; real only when the connector is in `LIVE_CONNECTORS` and the founder connected it with their own key | `pipeline.ts:752-758` |
| SDK `WebSearch`, `WebFetch`, `Bash`, sub-agents, `Skill` | Absent by design | `iso.ts:44` |
| Channel engine "launch" and "measure" | A status change; no metric is invented for a real project (`mockResultsAllowed`); a channel that cannot act stops with a note | `act/channel.ts`, `act/channel-availability.ts` |
| Foundations, project page draft, cycle plan, composer notes, second read, design review, conversations, Team call | Real model calls | routes in `packages/models/src/routing.ts:147-216` |
| Training | Real model against mock tools in the mock sandbox | `act/training.ts:1-20` |

**Is real web research live (THESIS 1.4)?** The code is: `fetch_page` is a guarded fetch (public addresses only, DNS re-checked at connect, 2 MB, 15 s, 3 redirects) and `search_web` runs Anthropic's server-side web search on the platform key with the `worker` model, `max_uses: 1`, returning titles and addresses only (`packages/connectors/src/connectors/web/index.ts:85-124`). The configuration is not, as far as the documents show. Three switches are needed on the gateway, not one: `web` in `LIVE_CONNECTORS`, `ANTHROPIC_API_KEY` (search throws `ConfigError` without it, `:108`), and `MODEL_MODE=live` so the reader's digests are real.

---

## 3. Findings

Severity: P0 stops the target user reaching a real outcome or breaks trust; P1 major friction or risk; P2; P3. Each fix names files, functions, migrations and tests. Migration numbers: the next free one at this commit is 0108.

### P0

**AR-01 (P0). Agents research on invented pages in production, and nothing refuses it.**
Evidence: `apps/gateway/src/pipeline.ts:757` refuses a never-connected mock connector only when `connector.auth.kind !== "none"`; `web` has no auth, so its mock runs (`web/mock.ts:32-40`); documented production keeps `web` mock (`docs/DEPLOY.md:271`) and the gateway's model client mock (`:51`). The researcher, the Product lead, the Legal lead, the Distribution strategist and every specialist hold `web`. `secondReadDocument` fact-checks through the same connector.
Impact: a first-timer's "research my market" task reads `example.com` stubs. House rule 4 tells the agent to say so, but the task still ends `done` (AR-03). THESIS 1.4 is not done.
Fix:
1. Configuration (gateway on Railway): add `web` to `LIVE_CONNECTORS`, set `ANTHROPIC_API_KEY`, set `MODEL_MODE=live`. Add `web` to `LIVE_CONNECTORS` on the api and the orchestrator where they read connector modes (`liveConnectorKeys`, packages/shared). Record in `docs/DEPLOY.md` §5.6 and its status table.
2. Code, so this can never be silently mock again: in `allow()` (`pipeline.ts:757`) refuse a mock connector for a person's own project on staging and production **whatever its auth kind**, unless it is in `ALWAYS_LIVE_CONNECTORS`: drop `connector.auth.kind !== "none" && !loaded.integrationRow` in favor of `(!loaded.integrationRow || connector.auth.kind === "none")`. Message: "Web search is not switched on here yet, so nothing was read."
3. `search_web`: raise `max_uses` and return a short snippet per result so one call is useful; book the search's real cost (today a flat `WEB_SEARCH_COST_MINOR = 2`, `web/tools.ts:27`); run it on the business's own key for a `byok` business (today it always uses the platform key, `web/index.ts:108-109`).
4. Tests: gateway `pipeline` test "a real project on a mock deployment gets `integration_not_connected` from `web`"; connectors `web.test.ts` for snippets. Eval (new, live): `researcher.real_citations` — a session with live `web` cites addresses that resolve; the string "(mock" never appears. Add both to the nightly outcome evals (AR-15).

**AR-02 (P0). Work that is not code leaves nothing behind: the agent's report is written to an audit row nobody reads.**
Evidence: `complete_task({ taskId, summary ≤ 4,000 })` → `completeTask` appends audit `platform.task.completed` and nothing else (`apps/gateway/src/platform-host.ts:179-187`); that action name appears nowhere else in the repository. `finishSession` writes `task.completed` with `summary: result.summary`, which for a live session is the fixed sentence `"<agent> finished "<title>" with N tool calls."` (`session.ts:1993`, `:982`). The composer narrates from event payloads (`apps/composer/src/compose.ts:137`). `get_task` returns no report (`platform/tools.ts:34-39`). No agent holds a tool that writes a document, a research artifact or a page (section 1.7). `research_artifacts` exists but only the api's product-research service writes it.
Impact: research, a competitor scan, a pricing proposal, an outreach draft: the founder is told a task "finished" and cannot read what was found; the next agent cannot build on it. This is why even live web research would not yet be a real outcome.
Fix:
1. Migration 0108 `task_reports` (business-scoped, RLS member read, service write, cross-tenant test in the same change): `id, business_id, task_id, session_id, agent_id, kind ('report'|'document'), title, body_md (≤ 60,000), sources jsonb (url, title), simulated boolean, created_at`. Repo `repos.taskReports` (`save`, `latestForTask`, `listForBusiness`).
2. Platform tools (`packages/connectors/src/connectors/platform/tools.ts`, real in `apps/gateway/src/platform-host.ts`, mock in `platform/mock.ts`): `save_report({ taskId, title, bodyMd, sources[] })` (own task only; entity mentions validated with `@foundmill/entity-linker`), `read_report({ taskId })` (any task of the business; returned inside the untrusted envelope with kind `document`, because a report may quote the web). Capabilities `reports.write`, `reports.read` in `CAPABILITY_TOOLS.platform` (`grants.ts`), added to `PLATFORM_BASE_TOOLS` (`packages/agents/src/connectors.ts:84`).
3. `completeTask` stores its summary as a report when none was saved, and `get_task` returns `lastReport: { id, title, excerpt }` and `lastBlock: { reason, detail }`.
4. `finishSession` (`session.ts:971-986`): put the report's title and first 2,000 characters in `task.completed.summary` and add `reportId` to the event (declare in `packages/events/src/catalogue.ts` with Zod). Composer prompt: quote the report's finding, link to it.
5. Event `task.report_saved`; the Inbox note and the task page show the report (`<EntityLink>` for mentions). Template instructions for researchers, specialists and channel engines: "Save your result with save_report before complete_task; a result that is only in your last message is lost."
6. Tests: gateway platform-host (own task only; cross-business refused), db RLS, grants contract, `session-live.test.ts` (the event carries the report), composer `narrate.test.ts`. Eval: golden `researcher.report_saved`.

**AR-03 (P0). A task that is not code is booked "done" whatever happened in the session.**
Evidence: the honest-outcome checks (`nothingWritten`, acceptance, test-setup review) apply only when `task.kind === "code"` (`session.ts:1914`, `:1973-1992`); any other session returns `outcome: "done"` when the SDK's last turn ends without an API error (`:1993`). Nothing reads `simulated` in a tool result (`grep simulated session.ts` finds only the design check). `finishSession` then sets the task `done` (`:971-980`). The live progress ring never moves for such a task (no `phase_changed`, `progress` or `file_changed` event is published by the live runner), so `task.completed.outcome` is `"partial"` at progress 0 unless the agent called `complete_task` (`:982`, `:1025`).
Impact: with AR-01, a research task on simulated pages ends done; an email task whose `send_mail` was refused "not connected" ends done unless the agent chose to call `block_task`. The founder reads "finished". Breaks R9 ("simulated results never count").
Fix: in `runLiveSession` after the SDK ends, for `task.kind !== "code"`: (a) `SessionRecorder` records `simulatedCalls` and `notConnectedCalls` from tool results (`"simulated":true`, `integration_not_connected`); (b) the session is `done` only when the agent called `complete_task` or `save_report` on its own task (track like `trackBlockTask`, `session.ts:520`); otherwise `blocked`, reason `error`, "ended without a result"; (c) a session whose every outward or research call was simulated or not connected ends `blocked` with new `blockedReason: "not_connected"` (add to `SessionResult.blockedReason`, `act/types.ts`, and to the `task.blocked` schema), and `planCycle`'s sweep treats it like a missing tool. Tests: `session-live.test.ts` three cases. Eval: golden `channel_email_automation.not_connected_is_not_sent` and the missing THESIS 0.3 eval "a simulated `send_mail` is reported as not sent".

**AR-04 (P0). Three of the five week-one outcomes have no agent path at all.** Detail and missing code in section 3.4 below (payment link: no tool; email: no way to find a recipient and off until configured; post: founder's own Buffer key or tap-to-post).

### P1

**AR-05 (P1). Agents do not know what the business is.**
Evidence: the brief is a planning digest with no vision, idea, customer or offer (`act/brief.ts:168-184`); `read_product` is held by four families only (section 1.7); sessions started by Start, a plan or a playbook get no brief at all (`apps/api/src/services/task-start.ts:112`, `act/plan.ts:198`, `:367`: no `briefText`); the roadmap Planner call is given the specification's section **names**, not its text (`act/roadmap-plan.ts:55`, `:66`).
Impact: an engineer, a channel agent or the Chief of Staff works from a task title and goal alone; quality depends on how much the Planner wrote into `goalMd`, and the Planner itself saw little.
Fix: (1) new first section in the brief, "## About <name>", about 300 tokens: the vision statement (`business_foundations.vision`), the idea's one-line summary and who it is for (`ideas`), the stage, the public page address when published; built in `loadBrief` and exported as `aboutBusiness(db, businessId)` so (2) `runAgentSession` builds it when `briefText` is null (`session.ts:806`): call `createBriefActivities(deps).loadBrief` or the lighter `aboutBusiness` + governance lines; (3) `planRoadmap` sends each section's text cut to a budget, not names; (4) grant `spec.read` and `roadmap.read` in `PLATFORM_BASE_TOOLS`. Tests: `billing-brief.test.ts`-style unit for the section; `session-live.test.ts` "a session started by hand carries the About section". Eval: golden tasks assert the output names the customer from the brief.

**AR-06 (P1). The default overnight shift cannot pay for one useful session.**
Evidence: `OVERNIGHT_SHIFT.ownSpendCeilingMinor = 15` (`packages/shared/src/autopilot.ts:397`) becomes the cycle's `budgetCapMinor` (`wf/autopilot.ts:217-222`), each session's `spendCapMinor` = `floor(remaining / free slots)` = 3 to 5 cents on the free tier (`wf/businessCycle.ts:254`), and that is the SDK's `maxBudgetUsd` (`session.ts:1752`). The Chief of Staff's Opus plan is paid outside the cap (`docs/DECISIONS.md:3733`).
Inference: a Sonnet session's first request (system prompt, tool schemas, task) is already about 2 cents at list price, so the session stops at `error_max_budget_usd` after one or two turns and ends `blocked`/`budget`; the night's cycle counts as failed or empty, and after N of them Autopilot pauses itself with a note. Not measured.
Fix: measure first (AR-14), then set the preset from the median cost of a finished session; until then give the night one session with the whole cap rather than slices (`maxConcurrent: 1` for a capped cycle whose cap is under a floor, in `businessCycle`), and do not start a session whose cap is under a floor (`MIN_SESSION_CAP_MINOR`, refuse with reason `budget` and no model call). Tests: `businessCycle.test.ts` "a capped cycle under the floor runs one session".

**AR-07 (P1). Test failures never reach the agent that could fix them.**
Evidence: the acceptance run happens after the SDK input is closed (`inputDone = true; queue.close()`, `session.ts:1855-1856`; `runAcceptance` at `:1955`); a failure returns `blocked` (`:1973-1976`). The next session's prompt carries a hand-back reason only when the latest block is `needs_update` from the merge (`latestHandBack`, `:2794-2804`); an "acceptance tests failed" detail with its output tail is not passed on, and `get_task` does not return it. The design check, by contrast, gets one fix turn (`:1849`).
Impact: every failing test costs a full new session (15, 30, 60 minute waits unless the founder presses Continue) that starts without knowing what failed. This is the largest single driver of the "blocked" counts in section 1.11 that remains.
Fix: run the acceptance tests **before** closing the input and give the author up to two fix turns: move the block at `:1891-1958` into a function `acceptanceAtTurnEnd()` called where `design.atTurnEnd()` is (`:1849`); on failure `send(acceptanceFixTurn(verdict))` with the command, counts and the last 4,000 characters of output; keep the loop detector's rule (same failing result three times). Also add `## Last attempt` to the task prompt from the task's latest `task.blocked` detail for any reason (extend `latestHandBack` into `lastAttemptNote(deps, businessId, taskId)`). Tests: `session-live.test.ts` "a failing run gets a fix turn and passes", "two failures end blocked with the output". Eval: `backend_engineer.fixes_failing_test` (a session with tools, AR-15).

**AR-08 (P1). A resumed or retried run starts with an empty memory.**
Evidence: `persistSession: false` (`session.ts:1779`); a park, a hand-off or a Temporal retry starts `sdk.query` again with the task prompt and one sentence (`:1529`); `providerSessionId` is returned and never used. For a task that is not code nothing carries over.
Impact: after a deploy (every push to `main` redeploys the orchestrator, `docs/DEPLOY.md` status table) or a 10-minute pause, the agent repeats reads and may repeat actions (AR-12).
Fix: keep a running log per session in the recorder ("did: <tool> <args summary> → <outcome>", capped) and write it into the resume prompt as `## What this session already did`; or persist the SDK session to the session workspace and pass `resume: providerSessionId` when the next run is on the same host (not across a deploy). The first is host-independent and enough. Store the log on `agent_sessions` (jsonb column `run_log`, migration) so a retry on another worker reads it. Tests: `session-handoff.test.ts`, `sessionHandoff.test.ts`.

**AR-09 (P1). Reaching 60 turns is a failure that marks the agent as failing.**
Evidence: `DEFAULT_MAX_TURNS = 60` (`session.ts:74`); the SDK's `error_max_turns` is classified `failed` (`classifyTurnEnd`, `:1392-1395`; asserted in `session-live.test.ts:867`); `finishSession` then sets the agent `failing` (`:1043`) and the task `failed`.
Impact: a code agent with no shell reads files one call at a time; 60 round trips is a normal medium task. The work is saved but not pushed (`holdBack`), the agent rests 10 minutes or more, and the retry starts blind (AR-08).
Fix: treat `error_max_turns` as a checkpoint: outcome `blocked`, new reason `turn_limit`, no health penalty, workspace saved, the task offered again at once with the run log (AR-08); raise the limit for `code` tasks (per kind: `MAX_TURNS_BY_KIND`), bounded by `maxBudgetUsd` which already caps spend. Tests: `classifyTurnEnd` cases; `session.test.ts` health unchanged.

**AR-10 (P1 for cost and for the founder's skill library; the seam the review asked for). Skills are carried whole in every prompt.**
Evidence: section 1.5. Up to 60,000 characters (about 15,000 tokens) ride in every request of every session of that agent, and also in desk conversations (`apps/api/src/services/conversation.ts:846`) and training (`act/training.ts:209`).

Two ways to load on demand. Build A first; B only if SDK-native skills are wanted.

*A. A platform tool (recommended: smallest, same for every task kind, audited, works in mock).*
1. `packages/agents/src/club-rules.ts`: `AgentSkillPrompt` gains `description`; new `renderSkillIndex(skills)` writes `## Skills`, the existing preamble plus "Call read_skill with a skill's exact name before you do work it covers", then one line per skill: `- <name> (<source>): <description>`. `BuildSystemPromptInput` gains `skillsMode?: "inline" | "index"` (default inline, so the api and training are unchanged).
2. `packages/connectors/src/connectors/platform/tools.ts`: `read_skill({ name })` → `{ name, source, instructionsMd }`, read-only. Capability `"skills.read": ["read_skill"]` in `CAPABILITY_TOOLS.platform`; add to `PLATFORM_BASE_TOOLS`.
3. `apps/gateway/src/platform-host.ts`: `readSkill(caller, { name })` returns only the **caller's own** skills: `roleSkillsFor(template.skills)` plus `repos.skills.listAddedForAgent(db, caller.businessId, caller.agentId, agent.agentType)`; runs `screenSkill` again at read time (a row stored before a screening rule existed is refused with the reason); answers first-party (not inside the untrusted envelope: it replaces system-prompt text that was already screened), wrapped as `<skill name source>` with `neutralizeSkillTags`.
4. `session.ts` `loadContext` (`:700-705`): keep `description`; in `runLiveSession` choose `index` when the resolved grants include `platform:read_skill` and the added skills total more than a threshold (say 4,000 characters); role skills stay inline. A second-read revision session (`sessionGrantsFor` narrows its tools) and any version without the grant stay inline.
5. Then raise `MAX_ADDED_SKILLS_PER_AGENT` and `ADDED_SKILLS_MAX_TOTAL_CHARS` (`skill-files.ts:27-29`), since they exist only "so the Skills section stays a bounded part of every prompt".
6. Tests: agents `club-rules` (index has no instructions text; a skill cannot close its block), gateway platform-host (agent A cannot read agent B's skill; a now-refused skill is refused), `grants-contract.test.ts`, `session-live.test.ts`. Evals: golden "reads the skill before the covered task"; injection "a skill body that asks for a forbidden action is not followed" (extend `evals/src/injection/suite.ts`).

*B. The SDK's own Skill tool (SDK 0.3.291 supports it: `skills?: string[] | 'all'`, `sdk.d.ts:2275`; `plugins?: SdkPluginConfig[]`, `:2035`, `{ type: 'local', path, skipMcpDiscovery }`, `:5596`).* What has to change, in order:
1. Where the files go. Not under `cwd`: the agent's `Write` can reach anything inside the workspace. Add to `iso.ts` `writeSessionSkills(root, sessionId, skills): Promise<string>` that creates `${ORCHESTRATOR_WORKSPACE_DIR}/.skills/<sessionId>/` (0700; the leading dot cannot collide with a session id, which must match `^[A-Za-z0-9_-]{8,}$`, `iso.ts:186`), writes a plugin manifest and one `skills/<slug>/SKILL.md` per skill with front matter the platform writes itself (`name`, `description` only; never the uploaded file's own front matter, so `allowed-tools` can never reach the CLI), then makes it read-only. Call it in `runLiveSession` after `createSessionWorkspace` (`session.ts:1455`) and before `sdk.query` (`:1738`); remove it in the `finally` beside `removeSessionWorkspace` (`:2006-2010`).
2. `query()` options: `plugins: [{ type: "local", path: skillsDir, skipMcpDiscovery: true }]`, `skills: [<names>]`; keep `settingSources: []` and `strictMcpConfig: true`; add `managedSettings: { disableSkillShellExecution: true }` (`sdk.d.ts:7232`).
3. `iso.ts`: `sdkToolPolicyFor(kind, mcpTools, { skills })` puts `"Skill"` in `tools` and `allowedTools` and leaves it out of `disallowedTools` when the session has skills (today `tools` is `[]` for a task that is not code, so the tool would not exist there); `guardToolCall` allows `Skill` only for a name in the session's list.
4. Limits to accept: a skill is one Markdown file (a task that is not code has no `Read`; a code task's path guard refuses the plugin directory, which is outside `cwd`), and scripts in a skill can never run (no `Bash`; the SDK process is on the orchestrator host, so this must stay until sessions run inside a sandbox).
5. Verify in a spike before building (I could not run the SDK): that plugins load with `settingSources: []`; that the `skills` option works in `permissionMode: "dontAsk"` with a restricted `tools` list; the `Skill` tool's input field name for the guard; that the PreToolUse hook fires for it.
6. Tests: `sdk-isolation.test.ts` (policy with and without skills; guard; directory outside `cwd`; removed in `finally`), `session-live.test.ts` with the fake SDK.

**AR-11 (P1). A session row with no workflow blocks its task for good and holds a slot for a day.**
Evidence: `agent_sessions` rows are ended only by `finishSession` (`session.ts:951`) and the api's own give-back (`task-start.ts:101`). `wf/agentSession.ts:248-252` swallows a `finishSession` that failed three times (`finish = null`); `wf/businessCycle.ts:255-265` opens the row, then `startChild` can throw; a workflow can be terminated or lost with Temporal's database. `openAgentSession` then refuses the task forever (`open_session`, `act/dispatch.ts:75`), the task stays `running` (not in `PLANNABLE_TASK_STATUSES`, `packages/shared/src/constants.ts:257`), and the row counts against concurrency for 24 hours (`packages/db/src/tiers.ts:139-143`). No sweep closes such rows (searched for orphan, stale, lost and reconcile over sessions: only cycles and runs are reconciled, `apps/api/src/services/cycle.ts:426-495`).
Impact: on the free tier four such rows stop all work for a day, and the tasks never start again.
Fix: add to the hourly `agentHealthSweep` (and to `loadBrief`) `reconcileSessions(deps, businessId)`: for each open session older than 10 minutes, describe `session:<id>` through the Temporal client; when it is not running, call a new `closeLostSession` (ends the row `failed`, reason `lost`, books nothing, sets a `running` task back to `ready`, audit `session.reconciled`). Give the orchestrator's deps a `WorkflowClient` handle for `describe`. Tests: `dispatch.test.ts` "a lost session is closed and its task is planned again"; `schedules.test.ts`.

**AR-12 (P1). A retried run can repeat outward actions; the gateway has no idempotency.**
Evidence: `RUNNER_RETRY = { maximumAttempts: 3 }` (`wf/agentSession.ts:45`), hand-offs on every deploy, and the fresh conversation of AR-08; the only guard is the sentence "check what is already done before you repeat any external action" (`session.ts:1529`). `apps/gateway/src/pipeline.ts`, `mcp.ts` and `types.ts` contain no idempotency key. In assisted and augmented mode an outward call asks again (the first approval was used), which limits the damage to a second question; in Automated mode, on vacation, for a delegated approval and for tools that never ask (`create_task`, `send_message`, `request_human_action`, `commit_files`, `open_pr`) the repeat runs. A retry also deletes the workspace of an attempt that may still be alive (`createSessionWorkspace` removes it, `iso.ts:188`).
Fix: per-session dedupe in the gateway for calls whose hints say `contactsThirdParty`, `spendsMoney` or `irreversible`, and for `request_human_action` and `create_task`: key = hash(sessionId, connector, tool, canonical args); a second call within the session returns the first result with `replayed: true` (store on the `tool.call` audit row, look up by key). Tests: gateway `pipeline` "the same send in the same session runs once".

**AR-13 (P1). A task the team has no tool for disappears without a word.**
Evidence: `stopToollessTasks` stops and archives a blocked task whose agent said it lacks a tool, frees its dependents, and writes only an audit row and a log line "(platform gap)" (`cycle.ts:287-318`); the founder is deliberately not told (comment `:279-286`).
Impact: the founder asked for something (or the roadmap needs it), the Plan silently loses it, and later tasks start as if it were done. The decision avoided handing chores to the founder, which is right; saying nothing is not.
Fix: keep the task off the founder's to-do list but say it once, in the cycle's note, in one clause ("One thing the team cannot do yet: <founder title>. It is parked."), and keep it visible on the Plan as "Not possible yet" (a status view over the archive, with the audit detail). Feed `cycle.tool_missing_stopped` rows into a platform report so the gaps are counted. Tests: `dispatch.test.ts`; composer eval for the clause.

**AR-14 (P1). Cost is not measured, and the free allowance is smaller than one cycle's reserves.**
Evidence: no cost per session, cycle or first session is recorded anywhere (section 1.11); free credits are 500 cents; the first cycle hands each of up to four sessions up to 125 cents (`taskReserveMinor`); the plan and the foundations run on Opus. THESIS 4.5 and 7.1.
Fix: a read-only report from `usage_ledger` (median and p90 cost by route, by template family, per session, per cycle, per first day of a project), as a script first and a platform dashboard after; set the reserve, the overnight preset and the free allowance from it. Route first-session work to the lower-cost model where the evals hold. No runtime change until the numbers exist.

**AR-15 (P1). Nothing tests that a session with tools reaches an outcome.**
Evidence: every eval is one prompt and a graded answer (`evals/src/golden/tasks.ts`, 27 tasks); none runs a session with tools; the only live eval in CI is the typed-read injection suite (`.github/workflows/evals-typed-reads.yml`); `docs/GATES.md` "Live smoke" was never run; there is no eval for "a simulated result is reported as not done" (THESIS 0.3 "done when") and none for the composer on a simulated event.
Fix: THESIS 1.8 as written, plus two: a harness `evals/src/sessions/` that runs `runLiveSession` against an in-process gateway with scripted connectors (real `platform`, fixture `web`, a test inbox for `platform_mail`) and asserts on the database afterwards (report saved, event written, nothing marked done on a simulated call); cases: page draft published path, research with real citations, email to a test inbox, a failing test fixed (AR-07), a simulated send reported as not sent. Nightly workflow `.github/workflows/evals-outcomes.yml` on the repository's key with a spend cap.

### P2

**AR-16 (P2). No memory across sessions, and what the founder tells an agent at its desk never reaches its work.** Evidence: section 1.9; `loadContext` (`session.ts:692-706`) reads no `agent_threads` or earlier session. Fix: a small per-agent, per-business notes table (`agent_notes`: `agent_id`, `kind` 'lesson'|'preference'|'fact', `text` ≤ 500, `source` (session, conversation, founder), `created_at`; RLS), written by the session's end (`finishSession` asks nothing of the model: the agent saves notes with a platform tool `remember({ text })`, screened like a skill line) and by the conversation service when the founder states a preference; the newest 10 go into the prompt as `## Notes from earlier work` after the instructions. Evals for injection through notes.

**AR-17 (P2). The system prompt is one block, so the stable part is never a shared cache prefix.** Evidence: section 1.4. Fix: `buildSystemPromptParts(input): { stable: string; dynamic: string }` in `club-rules.ts`; `session.ts:1741` passes `[stable, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, dynamic]` (rules, description, instructions, skills | glossary, brief); `cycle.ts:367` passes `system: [stable, brief]` and `packages/models/src/client.ts:709-712` gains a second breakpoint after the first block. Gain is real only when one agent runs several sessions inside the cache's lifetime; measure with AR-14 before spending time here.

**AR-18 (P2). The cycle note and the plan-failure note can be written twice on an activity retry.** Evidence: `plainCycleUpdate` (`cycle.ts:211-229`) and `notePlanFailure` (`:522-553`) call `repos.inbox.createItem` with no idempotency key inside activities that retry three times; `agent.health_changed` and the `session.finish` audit row in `finishSession` have none either (`session.ts:1049-1060`). Fix: key each on `cycleId` / `sessionId` as `startCycle` does (`cycleEventKey`).

**AR-19 (P2). Sixteen SDK subprocesses share the orchestrator's container, and every project on credits shares one Anthropic key with no shared budget.** Evidence: `ORCHESTRATOR_MAX_SESSIONS` 16 (`env.ts:17`); sessions do not use the header-aware limiter; a rate limit ends the session `blocked` (`session.ts:1418`). Fix: size the service for 16 CLI processes or lower the default; a platform-wide token bucket for session starts on the platform key (Redis), so a burst queues instead of failing; alert on `rate_limit` blocks.

**AR-20 (P2). The Tools tab cannot take file tools away.** Evidence: `sdkToolPolicyFor` decides by task kind alone (`iso.ts:115`); `grants.builtinTools` is computed and unused. A founder (or the Coach) who removes the workspace grants from an agent still gets `Edit` and `Write` on a code task. Fix: `fileTools = kind === "code" && grants.builtinTools.length > 0`, write tools only when `Edit`/`Write` are granted. Test in `sdk-isolation.test.ts`.

### P3

**AR-21 (P3). The gateway session token lives 4 hours, the run 8.** `SESSION_TOKEN_TTL_SECONDS` (`session.ts:75`) against `startToCloseTimeout: "8 hours"` (`wf/agentSession.ts:32`); headers are fixed at `query()` time. A session that waits on approvals and pauses can outlive its token and then fail every tool call. Fix: cap a run at the token's life (park and resume mints a new one).

**AR-22 (P3). The agent can write under `<cwd>/.claude/`.** Harmless while `settingSources` is `[]` and saves skip `.claude*`; must be closed before any change that reads settings or skills from the workspace: in `guardToolCall`, refuse `Edit`/`Write` whose first path segment is an SDK home entry or a start-up file (`isSdkHomeEntry`, `isStartupFile`).

**AR-23 (P3). `prepareAgentWorkspace` and the clone/worktree helpers in `packages/sandbox/src/worktree.ts` are unused by the product** (only tests import them). Either the planned "session inside the sandbox" path or dead code; decide and delete or use.

**AR-24 (P3). The E2B template is Foundmill's own toolchain.** `infra/e2b/e2b.Dockerfile` pins Node 22.23.3 and pnpm 12.9.1; a founder's project installs its own at run time inside a 30-minute sandbox with only `registry.npmjs.org` reachable (`session.ts:2078`): a Python or Go project cannot be tested at all. Fine for now (THESIS 1.7 is last); note it in the plan for platform-owned repositories.

**AR-25 (P3). The live progress ring.** No `phase_changed` or `progress` event in live sessions (see AR-03); a finished task that is not code can read 0% and "partial". Fix with AR-03: set progress 1 on a recorded `complete_task`/`save_report`.

### 3.4 Week one for a solo first-timer: what an agent can do end to end without a technical account

| Outcome | Today | What is missing, exactly |
| --- | --- | --- |
| **A page live** | **Yes, mostly.** `draftProjectPage` (`wf/businessFoundations.ts:94`, `packages/agents/src/foundations-steps.ts` `runProjectPageStep`, route `projectPage`) writes the draft once through `repos.pages.writeTeamDraft`; the founder presses Publish; the page is at `/p/<slug>`. No account needed. | Agents cannot touch the page after the first draft: `writeTeamDraft` writes only when no row exists, and there is no page tool. Add platform tools `read_page` and `propose_page_change({ fields })` (a proposal the founder accepts, like `propose_spec_change`), granted to the Product lead and the content and SEO engines; event `page.change_proposed`; Playwright for the accept flow. THESIS 1.2's `publish_page` tool was not built; keep publishing the founder's press. |
| **Real research** | **No.** Simulated in documented production (AR-01); no place for the result (AR-02); booked done regardless (AR-03). | AR-01, AR-02, AR-03, and the outcome eval (AR-15). |
| **An email sent** | **No, in three steps.** (1) `platform_mail` is off until its domain and SendGrid setup are done (`docs/PROGRESS.md:1564`); a real project on a mock deployment is refused. (2) Only the email channel engine holds `send_mail` (`templates/channels/email_automation.ts:9`), its tasks are `channel` tasks, held until the founder starts distribution (`channelDeferral`, `cycle.ts:189`), and the weekly engine drafts creative with a model call but never sends. (3) No agent can find a recipient: `search_entities` returns id, kind and name; there is no tool that lists the project's followers or contacts with addresses; `check_contact` needs the address. | Configuration for (1). Code: platform tool `list_audience({ segment: "followers" | "customers", limit })` returning entity id, name and address only for people with a recorded consent (`contact_consents`), marked untrusted; capability `audience.read` for the email engine; a task kind or playbook "send the first update to followers" that the Chief of Staff offers after the first confirmed follower (`page.followed`); the approval shows the message and the count. Tests: gateway (consent only, cross-tenant), policy (asks for outside contact), outcome eval to a test inbox. |
| **A post published** | **Only by the founder's tap, or with the founder's own Buffer key.** The social agent's drafts are real (`postDraft` workflow, `packages/agents/src/post-draft.ts`); `buffer:queue_post` needs a Buffer account and API key the founder creates and `buffer` in `LIVE_CONNECTORS` (`docs/DEPLOY.md:213`). | Nothing to build for "without an account" beyond what exists: tap-to-post is the designed answer. For "an agent publishes" there is no path without a third-party account; if wanted, the only account-free surface is Foundmill's own network (a post on the project's page or community), which needs a platform tool `publish_update` on the project page with the founder's approval. |
| **A payment link** | **No.** No agent holds a tool that creates one: `stripe:create_checkout_session` exists (`packages/connectors/src/connectors/stripe/tools.ts:81`) with no capability mapping and no grant; `stripe` needs the founder's restricted key (`rk_live_…`, `:18`), which is a technical account by any reading; `start_connect_onboarding` is a hard gate that tells the founder to open the Stripe dashboard. THESIS 1.6's payment half is open. | (1) Stripe Connect with hosted onboarding owned by the platform (the founder clicks through Stripe's own pages; no key is pasted): api service + gateway route + ingest webhook bound to the business (SEC-10/11 pattern). (2) Stripe tool `create_payment_link({ name, amountMinor, currency })` (hints: none that move money; creating a link spends nothing), capability `payment_links.create`, granted to one agent (Finance lead); policy: asks in assisted mode. (3) Events `payment_link.created`, and `payment.received` already narrates. (4) The page's public view shows the link when the founder accepts. Tests: connectors contract (real and mock), gateway, RLS, ingest webhook binding; outcome eval with Stripe test mode. |

### 3.5 Order of work and what depends on what

1. **Configuration, no code:** the three gateway switches of AR-01 (after checking the live variables), then confirm with one research task that no result says "(mock".
2. **AR-01 code** (refuse account-free mock connectors for real projects) and **AR-03** (honest outcome for tasks that are not code): small, independent, each stops a false "done". AR-25 comes with AR-03.
3. **AR-02** (reports): migration, two platform tools, the event field, the composer line. AR-03's "called `save_report`" rule and AR-13's note depend on it. Section 3.4's page tools follow the same proposal pattern.
4. **AR-05** (About section; a brief for sessions started outside a cycle) and **AR-07** (fix turns on failing tests, `## Last attempt`): the two changes most likely to raise the share of sessions that finish.
5. **AR-11** (lost sessions) and **AR-09** (turn limit as a checkpoint), then **AR-08** (run log) and **AR-12** (gateway dedupe), which share the run log and the session id as key.
6. **AR-15** (session-level outcome evals, nightly): build the harness as soon as AR-02 lands, so items 4 and 5 are measured; **AR-14** (cost report) in parallel, read-only.
7. **AR-06** (overnight preset) once AR-14 has numbers; **AR-10 A** (skills on demand through `read_skill`) any time after item 3, since it uses the same connector files; **AR-10 B** only after the spike.
8. Section 3.4's email audience tool and the payment link are their own packages (they need Stripe Connect and the mail configuration) and each needs the security-reviewer agent.
9. P2 and P3 items as capacity allows; AR-22 must land before anything reads settings or skills from the workspace.

Workflow changes in this list that alter recorded commands and so need `patched()` and a replay fixture: none of items 1 to 4 (they change activities only); AR-11 adds a step to a schedule workflow's activity (no patch); AR-09 changes an activity's result (no patch); a change to when `mergeReview` starts or to `businessCycle`'s dispatch does.

---

## 4. Roadmap items in this area (THESIS_REVIEW §13 and the Nov 13 item list)

| Package | State | Evidence |
| --- | --- | --- |
| 0.3 A mock result can never read as real | **Partial.** Done: `simulated` and `notice` on every mock call (`apps/gateway/src/pipeline.ts:923`), house rule 4 (`packages/agents/src/prompts/club-rules.ts:35`), "not connected" refusal for connectors that need an account (`pipeline.ts:757`), the morning brief's code filter. Open: connectors with no account (`web`, `ecb_rates`) still answer simulated for real projects (AR-01); the session books a simulated-only task done (AR-03); the "done when" eval does not exist (AR-15) | sections 2, 3 |
| 0.4 Stop fabricating channel results | **Done** | `act/channel.ts` `mockResultsAllowed`; `docs/PROGRESS.md:1467` |
| 0.5 Remove grants nothing serves | **Done** | `NOT_YET_SERVED` empty (`packages/connectors/src/grants.ts:289`); `grants-contract.test.ts`; `PLANNED_GRANTS.md` |
| 1.2 Agents write the page | **Partial.** The first draft is a model call in the foundations (done). Not built: the `project_page` task kind, `publish_page`, `documents.write`, `pages.publish`; agents cannot revise the page | `wf/businessFoundations.ts:94`; section 3.4 |
| 1.3 The first session ends on the link | **Done** (outside this area) | `docs/PROGRESS.md:1548-1553` |
| 1.4 Real web research | **Open.** Code ready, configuration not recorded, three switches needed, and a result has nowhere to go | AR-01, AR-02 |
| 1.5 Platform email | **Partial.** `platform_mail:send_mail` built with guards; off until configured; no audience tool; nothing makes the email engine send | section 3.4 |
| 1.6 Waitlist form and payment link | **Half.** Follow form with double opt-in done; payment link open (no tool, no grant, no account-free Stripe) | section 3.4 |
| 1.7 Platform-owned repository and preview | **Open.** Code work still needs the founder's GitHub App installation and repository; nothing writes `deploy.succeeded` | `docs/DEPLOY.md:277`; THESIS_REVIEW §7.4 |
| 1.8 Outcome evals in CI | **Open** | AR-15 |
| 7.1 Prices from measured cost | **Open** | AR-14 |
| Item 6: second read (#117) | **Done** | `act/second-read.ts`; `wf/mergeReview.ts:85-92`; `wf/businessFoundations.ts:123` |
| Item 10: morning brief on real outcomes, "When the team stops" (#112) | **Done** (email and a read-only list; starts no work) | `packages/shared/src/morning-brief.ts`, `loop-stops.ts` |
| Item 11: credit saver (#118) | **Done** | `packages/models/src/routing.ts:116-130`, `:249-281`; `act/session-credits.ts:23-52`; `low-credits.test.ts` |
| Item 12: funding-source seam (#118) | **Seam only**: `businesses.funding_source`, `FLAGS.ownPlanFunding = false`, no provider; the session's key choice knows only `byok` and `credits` | `packages/config/src/flags.ts:10`; `session.ts:714` |
| Item 13: design check (#114) | **Done** | `act/design-check.ts`; `session.ts:2629` |
| Typed reads (#89) | **Done**, with its live eval gate | `.github/workflows/evals-typed-reads.yml` |
| BUILD §9.7 memory: retrieval over sources and sessions, stored summaries | **Open** | AR-16 |

---

## 5. Interfaces a planner must know

**Workflows** (`apps/orchestrator/src/workflows/index.ts`; ids deterministic):

```ts
businessCycle(input: BusinessCycleInput): Promise<BusinessCycleResult>            // id cycle:<businessId>:<n>
  interface BusinessCycleInput { businessId: string; cycleNumber: number; trigger: CycleTrigger; timeBoxAgentHours?: number; maxConcurrent?: number; budgetCapMinor?: number | null }
  type CycleTrigger = "continue" | "holiday" | "schedule" | "wake" | "autopilot"
  interface BusinessCycleResult { cycleId: string; outcome: "completed" | "time_box" | "waiting" | "stopped" | "failed"; tasksDispatched: number; tasksCompleted: number; tasksBlocked: number; inboxItemIds: string[]; costMinor: number }
agentSession(input: AgentSessionWorkflowInput): Promise<AgentSessionOutcome>      // id session:<sessionId>
  interface AgentSessionInput { businessId: string; agentId: string; taskId: string; sessionId: string; cycleId?: string | null; spendCapMinor?: number | null }
  interface AgentSessionWorkflowInput extends AgentSessionInput { briefText?: string | null }
  interface AgentSessionOutcome { result: SessionResult; finish: SessionFinish | null; launch: SessionLaunch | null }
autopilot(input: AutopilotInput): Promise<AutopilotResult>                        // id autopilot:<businessId>
mergeReview(input: MergeInput): Promise<MergeOutcome>                             // id merge:<taskId>
businessFoundations(input: { businessId: string; attempt: number }): Promise<BusinessFoundationsResult>   // id foundations:<businessId>:<attempt>
planExecution, playbook, holiday, automatedMode, channelEngine, trainingRun, approvalWait, postDraft, postDraftMedia, importBusiness, incorporation, journeyBuild, sourceWatch, and the schedule workflows
```

Signals (`wf/signals.ts:53-68`): `decision`, `shout`, `pause`, `resume`, `stop`, `founderSubmit`, `wake`, `autopilotRefresh`, `continueRun`, `continueRunEnd`; query `progress`. Any change to a workflow's commands goes behind `patched("<id>")`; existing ids: `cycle-stop-dispatch`, `cycle-pause-hold`, `cycle-budget-reconcile`, `cycle-plans-roadmap`, `cycle-follow-ups`, `merge-sweep`, `merge-review`, `session-runner-retry`, `autopilot-continue-run`, `autopilot-own-budget`, `merge-second-read`, `foundations-staged`, `foundations-project-page`, and `SESSION_QUEUE_PATCH` in `src/session-contract.ts`. Replay fixtures: `src/__tests__/workflows/fixtures`.

**Session activities** (`createSessionActivities(deps)`, `session.ts:691`):

```ts
prepareSession(input: AgentSessionInput): Promise<SessionLaunch>
runAgentSession(input: AgentSessionInput, launched: SessionLaunch, briefText: string | null = null, runOptions: SessionRunOptions | null = null): Promise<SessionResult>
finishSession(input: AgentSessionInput, launch: SessionLaunch, ran: SessionResult): Promise<SessionFinish>
postSessionCommand(input: { sessionId: string; command: SessionCommand }): Promise<void>

interface SessionLaunch { sandboxMode: "mock" | "docker" | "e2b"; fellBackFrom: string | null; modelKey: ModelKey; modelId: string; lowCredits?: boolean; recordingKey: string | null; allowedTools: string[]; mcpConnectors: string[]; envNames: string[]; modelBilling: "byok" | "credits"; branch: string; maxTurns: number; planSteps: number; acceptanceTests: number }
interface SessionResult { outcome: "done" | "blocked" | "failed" | "stopped"; reason: string | null;
  blockedReason: "awaiting_approval" | "approval_rejected" | "dependency" | "credential" | "budget" | "rate_limit" | "loop_detected" | "error" | "shout" | "stopped" | "needs_update" | null;
  approvalId: string | null; progress: ProgressState; eventsEmitted: number; toolCalls: number; toolFailures: number; tokensIn: number; tokensOut: number; costMinor: number; costMicroMinor?: number; durationMs: number; sandboxMs?: number; prNumber: number | null; summary: string; providerSessionId: string | null; modelKey?: ModelKey | null; parked?: SessionParked | null; review?: string | null }
interface SessionRunOptions { fromSeq: number; resume: { cursor: string | null; progress: ProgressState; reason?: "park" | "handoff" | "retry" } | null }
interface SessionFinish { taskStatus: TaskStatus; eventIds: string[]; healthChanged: boolean; merge?: MergeInput | null }
type SessionCommand = pause | resume | stop{reason} | shout{message, preset?, modelKey?} | decision{approvalId, outcome, note?}   // src/control-bus.ts:17
```

Internal to `session.ts` (not exported; a change edits them in place): `runLiveSession(deps, recorder, ctx: RunnerContext, live: LiveContext): Promise<RunOutcome>` (`:1424`), `LiveContext` (`:1301`), `SessionRecorder` (`:407`), `PromptQueue` (`:1318`). Exported helpers: `classifyTurnEnd(result: SdkTurnResult, apiError, keySource: "byok" | "platform" | "none", budget?): TurnFailure | null`, `parseGrants`, `instructionsFor`, `followsTemplate`, `templateForAgent`, `buildSandboxEnv`, `sandboxEgressFor`, `acceptanceCommandFor`, `codeTaskNote`, `latestHandBack`, `liveDesignCheck`, `SessionUsage`.

**Cycle activities** (`createCycleActivities`, `cycle.ts:209`): `planCycle({ businessId, cycleNumber, trigger, brief, roadmapPlanned? }): Promise<CyclePlan>`, `followUpStarts(input: FollowUpStartsInput): Promise<CycleStart[]>`, `startCycle`, `openSession({ businessId, agentId, taskId, sessionId? })`, `notePlanFailure`, `completeCycle`, `failCycle`, `noteIdleCycle`, `narrateCycle({ businessId, eventIds, summary, fallbackSubject? })`. `loadBrief({ businessId }): Promise<BusinessBrief>` (`act/brief.ts:122`; `BusinessBrief.text` is the prose). `openAgentSession(deps, { businessId, agentId, taskId, sessionId? }): Promise<OpenSessionResult>` with `DispatchRefusal = "agents_stopped" | "agent_paused" | "agent_archived" | "wage_cap" | "model_budget" | "open_session" | "concurrency_limit"` (`act/dispatch.ts:26`, `:63`).

**Isolation** (`iso.ts`): `sdkEnvFor(input: SdkEnvInput): Record<string, string>`, `sdkToolPolicyFor(kind: TaskKind, mcpTools: readonly string[]): SdkToolPolicy` (`{ tools, allowedTools, disallowedTools, fileTools }`), `guardToolCall(toolName, input, { cwd, policy }): Promise<ToolGuardVerdict>`, `hookOutputFor(verdict)`, `createSessionWorkspace(root, sessionId): Promise<string>`, `removeSessionWorkspace(cwd)`, constants `FILE_TOOLS`, `ALWAYS_DISALLOWED_TOOLS`, `SDK_HOST_PASSTHROUGH`.

**Prompt** (`packages/agents/src/club-rules.ts`): `buildSystemPrompt(input: BuildSystemPromptInput): string` with `{ businessName, appName, template: { instructions: AgentInstructions; description?: string }, brief?, glossary?, skills?: readonly AgentSkillPrompt[] }`; `AgentSkillPrompt { name; source: "library" | "upload" | "role"; instructionsMd }`; `renderSkills`, `renderInstructions`, `hasClubRulesPrefix`, `restoredWorkspaceNote`, headers `CLUB_RULES_HEADER`, `INSTRUCTIONS_HEADER`, `SKILLS_HEADER`. Skills: `parseSkillFile(input: SkillFileInput): SkillFileResult`, `screenSkill(input: SkillScreenInput): SkillFileError | null`, `roleSkillsFor(skillKeys)`.

**Grants** (`packages/connectors/src/grants.ts`): `resolveGrants(grants: readonly ToolGrantLike[]): ResolvedGrants` (`{ toolRefs, servers, mcpTools, builtinTools, unresolved }`), `CAPABILITY_TOOLS`, `SDK_BUILTIN_CAPABILITIES`, `SESSION_MANAGED_CAPABILITIES`, `NOT_YET_SERVED`, `SERVICE_ONLY_CONNECTORS`, `ROUTE_ONLY_TOOLS`, `grantsActOutside`, `servedGrants`. A new tool needs: `defineTool` in the connector's `tools.ts`, real and mock handlers, a capability line here, a grant in a template, and it must pass `apps/orchestrator/src/__tests__/grants-contract.test.ts`.

**Sandbox** (`packages/sandbox/src/types.ts`): `SandboxProvider { mode; available(); create(spec: SandboxSpecInput): Promise<Sandbox> }`; `Sandbox { id; provider; spec; workdir; state; start(); exec(cmd, opts?): Promise<ExecResult>; writeFile; readFile; listFiles; snapshot(); closeEgress(); stop() }`; `SandboxSpec { businessId; taskId; sessionId?; agentId?; repo?; egressAllowList: string[] (≤ 64); envShortLived; ttlMinutes (1..1440, default 60); recording? }`; `resolveSandboxProvider(opts): Promise<ResolvedSandboxProvider>` (`provider.ts:75`); `assertNoLongLivedCredentials(env, { allowNames?, allowValues? })`; `capturePages` (`browser.ts`).

**Gateway client** (`apps/orchestrator/src/gateway-client.ts:92`): `mintSessionToken({ businessId, agentId, sessionId, allowedTools, ttlSeconds, untrusted? })`, `call(sessionToken, request, options?)`, `downloadArchive`, `notifyEmail`, `mcpUrl(connector)`, `sessionHeaders(token)`. **Composer client** (`src/composer-client.ts:30`): `narrate`, `commentary`, `chapterTitle`, `founderTitles`.

**Stream.** Session event kinds (`packages/events/src/session-stream.ts:16`): `tool_call` (status `started | succeeded | failed | denied | awaiting_approval`, `connectorKey`, `tool`, `argsSummary`, `resultSummary`, `policyOutcome`, `approvalId`), `stdout`, `file_changed`, `test_result`, `phase_changed`, `progress`, `note` (`source` agent, system, shout). Channels and the wire protocol: `docs/ARCHITECTURE.md:235-237`.

**Models.** `deps.models.complete({ route, schema, system: string[], messages, modelOverride?, cacheSystem?, scope, attribution: { businessId, agentId?, sessionId?, kind }, signal? })`; routes and model ids only in `packages/models/src/routing.ts`; `resolveModel(route, override?, { lowCredits? }): RouteResolution`.

**Environment and flags.** Orchestrator (`src/env.ts`): `SANDBOX_MODE`, `ORCHESTRATOR_MAX_ACTIVITIES` 32, `ORCHESTRATOR_MAX_SESSIONS` 16, `ORCHESTRATOR_MAX_WORKFLOWS` 100, `APPROVAL_WAIT_MINUTES` 30, `SESSION_PAUSE_HOLD_MINUTES` 10, `MOCK_SESSION_SPEED`, `MOCK_SESSION_SCENARIOS`, `ORCHESTRATOR_WORKSPACE_DIR`, `TEMPORAL_RETRY_SECONDS`, `ORCHESTRATOR_SCHEDULES`, `ORCHESTRATOR_PORT`. Shared (`packages/shared/src/env.ts`): `INTEGRATIONS_MODE`, `LIVE_CONNECTORS`, `MODEL_MODE`, `MODEL_FAST_MODE`, `ANTHROPIC_API_KEY`, `E2B_API_KEY`, `E2B_TEMPLATE`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, `GATEWAY_URL`, `COMPOSER_URL`, `COMPOSER_TIMEOUT_MS`, `SESSION_TOKEN_SECRET`, `APP_ENV`, `SHUTDOWN_TIMEOUT_MS`. Constants: `DEFAULT_MAX_TURNS` 60, `SESSION_TOKEN_TTL_SECONDS` 14,400, `SANDBOX_TTL_MINUTES` 30, `DEFAULT_TASK_RESERVE_MINOR` 2,000, `LIMITS.cycleTimeBoxAgentHours` 4, `LIMITS.narrateMaxEvents` 50, `LIMITS.composerDeadlineMs` 150,000, `TASK_RETRY_LIMIT` 3, `LOOP_THRESHOLD` 3. Flags: `FLAGS.ownPlanFunding` false.

---

## 6. Tests and evals covering this area, and the gaps

**Orchestrator unit** (`apps/orchestrator/src/__tests__/`): `session.test.ts`, `session-live.test.ts` (the live runner against a fake SDK), `session-handoff.test.ts`, `session-recording.test.ts`, `session-budget.test.ts`, `sdk-isolation.test.ts`, `low-credits.test.ts`, `credits-events.test.ts`, `business-models.test.ts`, `dispatch.test.ts`, `retry.test.ts`, `retry-deferral.test.ts`, `loop.test.ts`, `progress.test.ts`, `plan.test.ts`, `plan-failure.test.ts`, `roadmap-plan.test.ts`, `cycle-words.test.ts`, `billing-brief.test.ts`, `regulatory-brief.test.ts`, `first-days.test.ts`, `acceptance-toolchain.test.ts`, `checkout.test.ts`, `workspace-store.test.ts`, `workspace-sync.test.ts`, `workspace-push.test.ts`, `workspace-fingerprint.test.ts`, `merge.test.ts`, `second-read.test.ts`, `design-check.test.ts`, `channel-engine.test.ts`, `autopilot.test.ts`, `foundations.test.ts`, `grants-contract.test.ts`, `gateway-token-contract.test.ts`, `gateway-client.test.ts`, `composer-client.test.ts`, `control-bus.test.ts`, `agent-version-source.test.ts`, `orchestration.test.ts`, `schedules.test.ts`, `notify-rules.test.ts`, `notify-sweep.test.ts`.
**Workflow tests** (`__tests__/workflows/`): `businessCycle.test.ts`, `agentSession.test.ts`, `sessionHandoff.test.ts`, `autopilot.test.ts`, `autopilot.replay.test.ts`, `mergeReview.test.ts`, `businessFoundations.test.ts`, `businessFoundations.replay.test.ts`, `holiday.test.ts`, `holiday.replay.test.ts`, `automatedMode.test.ts`, `planExecution.test.ts`, `trainingRun.test.ts`, `approvalWait.test.ts`, `schedules.test.ts`, `sourceWatch.test.ts`, `temporal-rig.test.ts`.
**Sandbox** (`packages/sandbox/src/__tests__/`): `provider`, `e2b`, `docker`, `credentials`, `worktree`, `browser`, `replay-timing`; `mock/recordings.test.ts`.
**Composer** (`apps/composer/src/__tests__/`): `narrate`, `refresh`, `roundups`, `context`, `commentary`, `exhibits`, `founder-titles`, `http`. **Stream**: `walls`, `walls-server`, `authorize`, `auth`, `token-lifetime`, `connection`, `protocol`, `latency`, `account-events`.
**Evals** (`evals/src/`, live only with a key: `MODEL_MODE=live vitest run`; structure tests run in CI on the mock): `golden/tasks.ts` (27 single-prompt tasks by template), `injection/suite.ts`, `injection/typed-reads.ts` (the one suite with a CI workflow), `composer.ts`, `second-read.ts`, `design-review.ts`, `project-page.ts`, `foundations`, `conversation`, `team-call.ts`, `skills/cases.ts`, `source-watcher`, `channel-creative`, `post-draft.ts`, and others outside this area.

**Gaps.**
1. No test or eval runs a real SDK session: `session-live.test.ts` uses a fake `query()`. The options object (`settingSources`, `tools`, `permissionMode`, hooks) is never exercised against the real CLI, so an SDK upgrade can change behavior unseen. Add one smoke test in the nightly workflow: a real session, no tools granted, asserts `Bash`, `WebFetch` and `Skill` are refused.
2. No outcome eval (AR-15); no eval for simulated-is-not-done on the agent or the composer; `docs/GATES.md` live smoke never run.
3. No test for an orphaned session row (AR-11), for `error_max_turns` as anything but failed (AR-09), for a session with no brief (AR-05), for duplicate actions on retry (AR-12).
4. No test that `web` on a mock deployment is refused for a real project (AR-01); the existing gateway test covers account connectors only.
5. No load test of 16 concurrent live sessions on one orchestrator container (AR-19).
6. Cost: no test or report reads the ledger for per-session figures (AR-14).

---

## 7. Anything surprising

1. **Sessions do not run in the sandbox.** The package comment says the orchestrator "runs the agent inside it" (`packages/sandbox/src/types.ts:5-7`); in fact the SDK runs on the orchestrator host and E2B only runs tests and screenshots. That is why there is no shell, and why skills with scripts, a dev server the agent can look at, or any language toolchain are out of reach until that changes.
2. **Production is live sessions over mock connectors.** `SANDBOX_MODE=e2b` makes sessions real while `INTEGRATIONS_MODE=mock` keeps tools mock; the replay recordings THESIS 7.1 describes are not what production runs.
3. **The gateway's own model client is documented as mock** (`docs/DEPLOY.md:51`), so the quarantined reader, the safety layer for untrusted content, answers from the mock model in production. With every outward connector also mock this is invisible; the day `web` or email goes live it is not.
4. **The agent's report is thrown away** (AR-02) while its tool-call count is what the founder's note is built from.
5. **The Review agent, the second reader and the design reviewer are single model calls, not agents with tools.** Only the author is a session.
6. **The Chief of Staff's cycle plan is advisory.** Code starts every dispatchable task while a slot is free whatever the plan says (`cycle.ts:400-415`), after an incident where the planner started nothing. The Opus call buys an order and a summary sentence; a deterministic order would save it on most cycles.
7. **An agent on the version written at hiring follows its template live** (`followsTemplate`, `session.ts:184`), so editing a template changes every such agent's tools and instructions at its next session, with no version row and no training run. Good for fixes; a planner changing templates should know it ships at once.
8. **`get_task` cannot tell an agent why its last attempt failed**, and the brief, the one shared context, never says what the business does.
9. **A Continue run keeps starting cycles one minute apart** until a round does nothing or a daily limit is reached (`wf/autopilot.ts:184-198`). With retries allowed on every `continue` trigger only for the first cycle and doubling waits after, this mostly idles, but each round with a candidate pays for an Opus plan.
10. **`temporal.download` is on the acceptance egress list for every code task** (`session.ts:2078`), a Foundmill-specific need baked into the general path.
11. **Model ids** in `routing.ts` (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`) and the prices in `pricing.ts` were "verified 2026-10-05"; the web search tool type is `web_search_20260209`. Re-verify on any SDK or model change.

### Not verified (limits of this audit)

- The live Railway variables (`LIVE_CONNECTORS`, the gateway's `MODEL_MODE` and `ANTHROPIC_API_KEY`, `E2B_TEMPLATE`, `PLATFORM_MAIL_DOMAIN`). Section 2 follows `docs/DEPLOY.md`, whose status table was last filled in mid-October for most rows.
- Anything that needs the SDK to run: that plugins load with `settingSources: []`, how the `skills` option behaves with a restricted `tools` list, the `Skill` tool's input shape, whether the CLI's own caching marks a custom string prompt as one block (stated from the SDK's type documentation, `sdk.d.ts:2302-2411`).
- Every cost figure marked Estimate or Inference. The usage ledger has the real numbers; no report reads them.
- No test, typecheck or build was run for this audit. Statements about behavior come from reading the code at 04a0a509.
- `apps/gateway` beyond the pipeline's mode and refusal rules, `packages/policy` (Cedar) and the api's Inbox and decision services were read only where a session touches them; they belong to other audits.

