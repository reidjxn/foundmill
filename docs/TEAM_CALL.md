# Team call: build contract

Founder request, Nov 12, 2026. A spoken call inside Foundmill that looks like a video call: every agent on the call has a tile with its portrait and name, and the tile of whoever is speaking lights up. The founder talks to the whole team (a **team call**) or to one agent (a **one-to-one call**, Call on the agent's profile), and the agents discuss the project with the founder and with each other. When the call ends, its action items are filed where they belong: tasks in their departments (development, marketing, finance…), items on the roadmap. Speech is ElevenLabs, through the gateway.

**Words (founder, Nov 12, 2026).** The feature is **Team call** (never "Team talk"). How an agent sounds is its **accent** (never "voice": "voice" already means how an agent writes, `AgentVoice`). The vendor's `voice_id` appears only inside the ElevenLabs connector. Chat at the agent's desk stays **Chat** and is a separate surface; Call is the spoken one.

The shared contract is `packages/shared/src/team-call.ts` (`@foundmill/shared/team-call`, also in the barrel): kinds, statuses, limits, accents (`ACCENT_SLOTS`, `assignAccents`, `accentPresentation`), the view types every API answer uses, `TEAM_CALL_WORDS` and `spokenText`. Code against it; do not redeclare its tuples.

## 1. Rules that shape it

- **The same agent everywhere.** A participant carries `name, role, personaKey, avatarSeed, layer, agentType`, and the web names and pictures it only through the design system's `useAgentPersona()` (`nameFor`, `positionFor`, `labelFor`, `portraitFor`) and `Avatar`, exactly as the profile, the Inbox and the desk do. With anthropomorphic agents on, the tile shows the persona name in the founder's style, the role beside it and the same AI portrait; off, the stored name and the drawn portrait. No surface of Team call computes a name or a face itself.
- **The same accent everywhere.** `assignAccents(allAgentsEverHired, style)` is the only way an agent gets its accent: unique within a business while accents last, stable when a later agent is hired, following the character's presentation in the founder's style. The api computes it for the caller's style on every read; nothing stores it.
- **Names in speech follow the listener.** Agent turns name teammates as `[[ent:<agentId>|StoredName]]` (validated against the call's participants by the entity linker). The api renders a turn for speech with the listener's own display rules (`spokenText(text, id → agentDisplayName(agent, ctx.anthropomorphicAgents, ctx.agentStyle))`). Prompts tell agents never to introduce themselves by name.
- **Nothing is done during a call.** Agents discuss, propose and agree; they never say they have done, sent, booked or filed anything. The house rules apply (prepended to every prompt). Action items are filed only when the call ends, through plans and policies (§5).
- **Solo is complete.** Nothing in Team call assumes a second person. Copy addresses "you"; in a business with several founders the starter is the one speaking.
- **Simulated speech is said so.** In mock mode the call works end to end with the browser's own speech and recognizer (or typing); the call shows `TEAM_CALL_WORDS.simulatedNotice` once. A simulated result is never presented as real.
- **Desktop console.** The call is a business screen (1280 px and wider), like the department tabs.

## 2. Data (`packages/db`, migration `0082_team_calls.sql`)

All three tables are business-scoped with RLS (`fm_tenant_table`), in the export tables, out of the demo roll-forward, with cross-tenant tests.

- `team_calls`: `id`, `business_id` (cascade), `kind` (`team | one_to_one`), `status` (`live | wrapping_up | ended`, default `live`), `topic` (≤ 200, nullable), `agent_ids uuid[]` (1 to 8; exactly 1 for `one_to_one`), `started_by` (uuid, the user; nullable on user delete), `started_at`, `ended_at`, `summary` (text ≤ 4000, nullable), `agent_rounds_since_founder` int default 0, `turn_count` int default 0, `created_at`, `updated_at`. Index `(business_id, started_at desc)`.
- `team_call_turns`: `id`, `business_id`, `call_id` (cascade), `seq` int (unique per call), `speaker` (`founder | agent`), `agent_id` (nullable, set null), `user_id` (nullable), `text` (1 to 2000), `addressed_to` jsonb (`"founder" | "team" | {"agentId": uuid}` or null), `via` (`spoken | typed`, founder turns only), `client_turn_id` (text ≤ 64, nullable; unique per call where not null: a retried send is idempotent), `created_at`. Check: an agent turn has `agent_id`, a founder turn has `user_id`.
- `team_call_actions`: `id`, `business_id`, `call_id` (cascade), `position` int, `action_type` (a `PLAN_ACTION_TYPES` value), `title` (1 to 200), `detail` (≤ 1000, nullable), `department_id` (nullable, set null), `agent_id` (nullable, set null), `status` (`filed | awaiting_go_ahead | founder_step | not_filed`), `target_kind` (`task | roadmap_item | plan`, nullable), `target_id` uuid nullable, `plan_id` (nullable, set null), `plan_action_id` (nullable, set null), `reason` (≤ 500, nullable), `created_at`.
- `plans.origin` gains `team_call` (the check constraint is replaced; `PLAN_ORIGINS` already has it).

RLS: members with Team read see calls (follow how `agent_threads` is gated by section, else plain member read, and say which in DECISIONS); writes go through the api under the member's RLS (owner, admin, member; never viewer or example viewer). Turns and actions are never updated after insert except `team_calls` (status, summary, counters, ended_at).

`repos.teamCalls` (`packages/db/src/repos/team-calls.ts`): `create(db, businessId, { kind, agentIds, topic, startedBy })`, `get(db, businessId, callId)` (NotFoundError), `list(db, businessId, { limit })` (summary rows with counts), `turns(db, businessId, callId, { limit? })` (seq order; `limit` = newest N, still ascending), `appendTurns(db, businessId, callId, turns[])` (assigns `seq` atomically: lock the call row `for update`, refuses a call not `live`, refuses past `maxTurnsPerCall`, idempotent on `client_turn_id` returning the existing turn; updates `turn_count` and `agent_rounds_since_founder`: reset to 0 when a founder turn is appended, +1 per agent-only round, which the caller signals with `{ agentRound: true }`), `claimWrapUp(db, businessId, callId)` (`live → wrapping_up`, one conditional update; false when not live), `finish(db, businessId, callId, { summary, actions[] })` (`wrapping_up → ended`, inserts actions, sets `ended_at`), `reopenAfterFailedWrapUp` (`wrapping_up → live`), `actions(db, businessId, callId)`.

## 3. Speech (`packages/connectors` `elevenlabs`, `packages/models`, `apps/gateway`)

- **Models** (`packages/models/src/routing.ts`, beside `IMAGE_MODELS`): `SPEECH_MODELS = { call_speech: "eleven_flash_v2_5", call_transcription: "scribe_v3" }` (ElevenLabs model docs, Nov 12, 2026: Flash v2.5 ~100 ms median latency, the lower-cost real-time model; Scribe v3 batch transcription).
- **Connector** `elevenlabs` (service-only: added to `SERVICE_ONLY_CONNECTORS` beside `openai_images`; a grant on it resolves to nothing; `/v1/call` and `/mcp` refuse it; Settings › Integrations never lists it). Platform key `ELEVENLABS_API_KEY` on the gateway only (`packages/shared/src/env.ts`, `.env.example`, docs/DEPLOY.md). Header `xi-api-key`. Base `https://api.elevenlabs.io/v1`. Tools:
  - `synthesize_speech` `{ accent: AccentKey, text ≤ 600 }` → `{ mime: "audio/mpeg", base64, characters, model }`. `POST /text-to-speech/{voice_id}?output_format=mp3_44100_64`, body `{ text, model_id: SPEECH_MODELS.call_speech, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 } }`. The accent → `voice_id` map is `elevenlabs/accents.ts` (the 19 replacement voice ids, Nov 12, 2026), overridden key by key by `ELEVENLABS_ACCENT_IDS` (JSON `{ "<accent>": "<voice_id>" }`, parsed once; an unknown accent key in it is ignored with a warning). Cost Estimate: characters × the Flash per-character price (config in the connector, labeled Estimate).
  - `transcribe_speech` `{ mime: TeamCallAudioMime, base64 ≤ 8 MiB decoded }` → `{ text, languageCode, durationSeconds, model }`. `POST /speech-to-text` multipart: `model_id`, `file`, `tag_audio_events=false`, `timestamps_granularity=none`.
  - Mock: deterministic. `synthesize_speech` returns a silent mono 16 kHz WAV (`audio/wav`) whose length is the text's estimated speaking time (150 words a minute, at least 600 ms), with `simulated: true` and the notice; `transcribe_speech` returns `{ text: "", simulated: true }`. Contract tests against fixtures; the key never appears in a URL, log, error or result (copy `openai_images`'s `redactKeys` discipline).
- **Gateway** service routes (`svc: api` only, like `/v1/personas/portrait`), `apps/gateway/src/speech.ts`:
  - `POST /v1/speech/synthesize` `{ businessId, callId, turnId, accent, text }` → `{ mode, mime, base64, simulated, notice?, characters, costMinor }`. Checks in order: accent known (400 `unknown_accent`), text 1 to 600 (400), the business's window on the connector (`rl:<businessId>:elevenlabs`), the business's spoken characters today (`sp:<businessId>:day` Redis INCRBY of the length, UTC day, ceiling `TEAM_CALL_LIMITS.speechCharsPerBusinessPerDay`; 429 `speech_daily_limit` with a plain sentence; given back when the vendor refused outright), then the call. Audits `gateway.speech.synthesized` (business, call, turn, accent, characters, mode; never the text). Books the cost to `usage_ledger` as a tool row (Estimate) when the connector reports one. No key: 503 `speech_unconfigured`.
  - `POST /v1/speech/transcribe` `{ businessId, callId, mime, base64 }` → `{ mode, text, simulated, durationSeconds }`. Same window; audits `gateway.speech.transcribed` (duration, mode; never the words).
  - The api's gateway client (`apps/api/src/services/gateway.ts`) gains `synthesizeSpeech` and `transcribeSpeech`. Where `elevenlabs` runs its mock (`connectorMode(env, "elevenlabs") === "mock"`), the api runs the mock itself and never calls the gateway (the domain-check and portrait pattern).

## 4. The turn director and the wrap-up (`packages/agents`, `packages/models`)

Two routes in `ROUTES`: `teamCallTurn` (Sonnet, effort `low`, `LOW_EFFORT_MAX_TOKENS`: the founder waits on it) and `teamCallWrapUp` (Opus, effort `low`). Output schemas in `packages/models` (exported from the root):

```ts
TeamCallTurnsOutput = z.object({
  turns: z.array(z.object({
    agent_id: z.string(),                 // one of the participants
    to: z.union([z.literal("founder"), z.literal("team"), z.object({ agent_id: z.string() })]),
    text: z.string().min(1).max(600),     // spoken words, plain text, may contain [[ent:<id>|Name]]
  })).min(1).max(4),
  hand_back: z.boolean(),                 // true when the agents now want the founder
});
TeamCallWrapUpOutput = z.object({
  summary: z.string().min(1).max(1200),   // plain text, what was discussed and agreed
  actions: z.array(z.object({
    title: z.string().min(1).max(200),    // founder words
    detail: z.string().max(1000).nullable(),
    agent_id: z.string().nullable(),      // who does it, a participant or another agent of the business
    action: PlanActionSchema,             // { type, params, agent_id } exactly as the plan compiler writes
  })).max(20),
});
```

`packages/agents/src/prompts/team-call.ts` exports:

- `buildTeamCallTurnRequest(input)` → `{ route: "teamCallTurn", system, messages, schema }`. System: the house rules + the Chief of Staff's instructions (`buildSystemPrompt`), then the call rules: you write the next spoken turns of a call between the founder and their team; each turn is one agent speaking in first person, two to four short spoken sentences, no lists, markdown, links or figures not in the facts (figures labeled Estimate or Forecast when spoken: "an estimate of…"); agents build on, question and sometimes disagree with each other by name (`[[ent:id|Name]]`), and only speak to their own role's knowledge; the most relevant agent answers first; in a one-to-one call only that agent speaks; never claim to have done anything, never promise outside actions; when a decision needs the founder, end with a question to them and `hand_back: true`; never introduce yourself by name; an agent-only round (`mode: "continue"`) carries the discussion forward and hands back once there is something to decide. Trusted JSON input: business (name, stage, currency), the founder's display name, participants (id, display name as the starter reads it, role, department, a one-line remit from the template), `kind`, `mode` (`founder_spoke | continue | opening`), the topic, a short brief (goal, roadmap now items, open tasks count, this week's facts; the api builds it from existing reads). The transcript's agent turns are model-written: they go in the user turn inside `<untrusted_content kind="call_transcript">`; founder turns are the founder's own words.
- `finaliseTeamCallTurns(out, { participants, kind, mode })`: drops turns by agents not on the call, keeps one agent for a one-to-one call, cuts each to 600 characters at a sentence end, strips markdown and links, validates mentions against the participants (unknown ones reduced to plain names), and forces `hand_back` true when nothing is left (then one fallback line from the Chief of Staff or the called agent: "Over to you: what would you like to look at first?" style, deterministic).
- `buildTeamCallWrapUpRequest(input)` → `{ route: "teamCallWrapUp", … }`: the house rules + the Chief of Staff's instructions, the plan compiler's action contract (`PLAN_ACTION_PARAMS`, the roadmap for `update_roadmap` ids, the agents); hard-gated requests compile to `request_human_action` only; one action per agreed step; nothing the founder did not agree to; a task's `kind` follows its department's work (code, channel, finance, legal, research, ops, specialist). Transcript inside `<untrusted_content>` except the founder's lines, which are marked as the founder's.
- `finaliseTeamCallWrapUp(out, ctx)`: plain-text summary (figures labeled), at most 20 actions, agent ids only from the business, each `action` parsed with the per-type param schemas the compiler uses (an invalid one is dropped), titles in founder words (`founderTitleProblems` from shared where it applies).
- Mock fixtures (`packages/models/src/mock/`): deterministic, keyed on the input, never canned business facts. Turns: the most relevant participant (by keywords of the founder's words against role and department; the Chief of Staff first in an opening) answers the founder's own words, a second agent builds on it naming the first, `hand_back` alternates by round. Wrap-up: runs the rule engine (`compilePlanRuleBased`) over each founder turn and keeps the actions it finds; the summary lists what the founder raised. Every mock line is labeled as an example on its first line only when the existing mock convention does so.
- Evals (`evals/src/team-call.ts`, live models, skipped without a key): (1) agents address each other by mention and at least one round has two agents; (2) no turn claims an action was taken; (3) a one-to-one call has only the called agent; (4) wrap-up of a fixture transcript files a roadmap item, a development task and a marketing task, and a money step compiles to `set_budget` or `request_human_action`, never an executed spend; (5) nothing in either output names jobs, employment or a missing cofounder (subtext rule).

## 5. API (`apps/api`, router `teamCall`, `services/team-call.ts`)

All `businessProcedure`; reads need Team read, every mutation Team write (an example viewer and a viewer are refused with the existing wording). Model calls carry `modelLimited` rules (`team_call_turn`, `team_call_wrap_up`) and go outside transactions.

- `teamCall.speechModes` → `TeamCallSpeechModes`.
- `teamCall.list({ limit? })` → `TeamCallSummaryView[]`.
- `teamCall.get({ callId })` → `TeamCallView` (participants with accents for the caller's style; turns; actions; `canSpeak`).
- `teamCall.start({ kind, agentIds?, topic? })` → `TeamCallView` with the opening round already in `turns`. Team: `agentIds` default to the founder-visible Chief of Staff and leads (`teamTree`, never background helpers), at most 8, every id an active agent of the business (paused agents may join; released may not). One-to-one: exactly one agent id. Writes the call, runs the opening round (`mode: "opening"`: the Chief of Staff, or the called agent, greets briefly and asks what is on the founder's mind, then at most one more agent), appends it, writes `team_call.started`, audits `team_call.start`.
- `teamCall.say({ callId, text, via, clientTurnId })` → `TeamCallRoundView`: appends the founder turn first (idempotent on `clientTurnId`), runs the director (`mode: "founder_spoke"`), finalises, appends the agent turns.
- `teamCall.continue({ callId })` → `TeamCallRoundView`: an agent-only round; refused with `handBack: true` and no turns (no model call) once `agent_rounds_since_founder` reached the limit.
- `teamCall.speech({ callId, turnId })` → `TeamCallSpeechView`: an agent turn of this call, rendered with `spokenText` for the caller, spoken with the agent's accent (live through the gateway, else the mock in-process).
- `teamCall.transcribe({ callId, mime, base64 })` → `TeamCallTranscriptView` (live through the gateway, else the mock: `{ text: "", simulated: true }`; the client then uses the browser's recognizer).
- `teamCall.end({ callId })` → `TeamCallView`: `claimWrapUp`, then the wrap-up call, then: `ownAgentsOnly`, `evaluatePlan`, `assertPlanSectionAccess`-style filtering (an action in a section the person cannot write is recorded `not_filed` with the wall's sentence, never an error that loses the call). Allowed actions go in one plan (origin `team_call`, `executing`) run with `executePlanActions` and `afterCommit`'s dispatch; asks go in a second plan (`pending_confirmation`) shown in the Inbox like a staged hand-off; `request_human_action` is `founder_step`. Each action row records its plan, plan action, target (a created task's id, a created roadmap item's id, else the plan) and status. Then `finish`, `team_call.ended`, audit `team_call.end`, and one Chief of Staff Inbox note "Notes from your team call" (type update, never holds Continue) with the summary and the actions line. A wrap-up that fails reopens the call (`live`) and answers the error, so nothing said is lost.

Events (`packages/events`, filed under Team in `apps/stream/src/walls.ts`, not narrated): `team_call.started` `{ callId, kind, agentIds, topic? }`, `team_call.ended` `{ callId, kind, turnCount, actionCount, filedCount, awaitingCount, durationSeconds }`. Turns write no event.

## 6. Web (`apps/web`, `packages/dugout`)

Design system (`packages/dugout/src/components/call/`, stories at desktop width, tokens only, Lucide only):

- `CallTile`: 16:9 surface tile; the agent's `Avatar` (portrait from `portraitFor`, else the drawn one) large in the center; a name plate bottom-left (`nameFor` · `positionFor`, the "AI agent" marker); a speaking state (department-color ring with a glow and three animated level bars, stilled under reduced motion); states `speaking | listening | idle | thinking`; a "You" tile variant with initials and a live mic level.
- `CallStage`: the grid (1 to 9 tiles; one-to-one: the agent large and "You" small), keeps tiles in place while speakers change.
- `CallCaptions`: the current line under the stage (speaker label + text, EntityLink-rendered names).
- `CallControls`: bottom bar: mic toggle (with level), "Type instead" text field, "Let the team discuss" switch (team calls), captions toggle, transcript toggle, End (danger; "End call and file actions" / "End call").
- `CallTranscript`: the right rail (turns with speaker labels and times).
- `CallWrapUp`: the ended state: summary, actions grouped by department name (read from the department) with status chips and links to the task, the roadmap item or the plan to confirm, and `teamCallActionsLine`.

Routes: `/b/[bid]/calls` (lobby: Start a team call with the participant picker, defaulting to the Chief of Staff and the leads; past calls with their summary line and actions line) and `/b/[bid]/calls/[callId]` (the call). `routes.calls(bid)`, `routes.call(bid, callId)`. Sidebar: "Team call" (Lucide `Video`) in the Team area's group, reachable from the palette ("Start a team call", "Call <agent>"). The agent profile header: **Chat** (the existing desk; label "Chat with <name>") and **Call** (`Phone`, "Call <name>", `data-testid="header-call"`) which starts a one-to-one call and opens it.

The call's client (`apps/web/components/calls/`):

- Playback: each new agent turn's `teamCall.speech` is fetched as soon as it arrives (the next one prefetched while one plays) and played in order through one `HTMLAudioElement`; the playing turn's agent is `speaking`, its caption shown. Simulated speech uses `speechSynthesis` with a browser voice of the accent's presentation and the accent's `fallback` pitch and rate (else the silent WAV for timing).
- Microphone: `getUserMedia` + `MediaRecorder` (opus webm where supported) with an `AnalyserNode` level; an utterance starts above a threshold and ends after 1.2 s of silence (60 s cap); the founder speaking over an agent stops its playback (barge-in). Live transcription sends the recording to `teamCall.transcribe`; simulated transcription uses `SpeechRecognition` / `webkitSpeechRecognition` when present, else the mic button says to type. The transcript (spoken) or typed text goes to `teamCall.say` with a `clientTurnId`.
- "Let the team discuss": after the agents' turns have played and the founder has been silent `discussAfterSilenceMs`, `teamCall.continue`; stops when the answer hands back.
- Persona: tiles, captions, transcript and wrap-up name and picture agents only through `useAgentPersona()` and `EntityLink`; a unit test proves a tile shows the same persona name, role and portrait URL as the profile header with the preference on, and the stored name with it off.
- Playwright (`apps/web/e2e/team-call.spec.ts`, mock mode): start a team call from the lobby, see the tiles and the opening turn, type a message, see two agents answer and a speaking tile, end the call, see filed actions and the task in its department; start a one-to-one call from an agent profile's Call.

## 7. Done means

Typecheck, lint and tests in every touched package; the cross-tenant tests for the three tables; contract tests for the connector; gateway route tests; api service tests (start, say, continue limit, speech in mock, end files tasks and roadmap items and stages a budget); stories for every new component; the eval; the Playwright spec; `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs` and `node scripts/plain-language.mjs` clean on the new text; docs/ARCHITECTURE.md (§4 data, §8 connector, §9 gateway routes, §13 API, §14 web), docs/DESIGN.md (the call screen), docs/PROGRESS.md and docs/DECISIONS.md updated.
