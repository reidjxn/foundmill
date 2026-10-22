/**
 * Glitchwick's Live sessions: the orbit's four Development agents on the playtester. Each tile plays its own task's
 * recording and then picks up its next one (tile k: tasks k and k + 4). Model routing ends at pull request #318, the
 * merge the hero deck asks the founder about, and posting replays on reviews needs a GitHub app permission the founder
 * has not granted; both sessions wait for the founder and are parked. The others merge their own pull requests (#321 to
 * #324) or, for Sprite's playtests, file bugs and results. Sandboxes for checks run on on-demand GPUs (moving nightly
 * runs to spot GPUs is still the founder's open decision).
 */
import type { MockSessionAgent, MockTaskScript } from "@foundmill/dugout";
import { fileChange, sessionScript } from "./shared";

const REPO = "https://github.com/foundmill-demo/glitchwick/pull";
const STATIC_CHECKS = "$ pnpm tsc --noEmit && pnpm eslint src";
const openPr = (n: number) => ["$ gh pr create --fill --base main", `${REPO}/${n}`];

/** The orbit's own Development agents, so the tiles show the same portraits as the team. */
const AGENTS: readonly MockSessionAgent[] = [
  { name: "Rune", seed: "rune", role: "Play loop engineer", dept: "dept-2", model: "sonnet", kind: "code" },
  { name: "Vex", seed: "vex", role: "Crash sorting", dept: "dept-2", model: "sonnet", kind: "code" },
  { name: "Sprite", seed: "sprite", role: "Card-game playtester", dept: "dept-2", model: "sonnet", kind: "code" },
  { name: "Bolt", seed: "bolt", role: "Lead developer", dept: "dept-2", model: "sonnet", kind: "code" },
];

/**
 * The play loop change behind #318: routine screens on the small model, a save-and-reload probe after autosaves. The
 * terminal follows it end to end: a WebGL build launched headless in a sandbox, played turn by turn with the new probe,
 * a crash reproduced and filed with a replay, then the 120-bug eval (cost per run misses its budget once, shops move to
 * the small model, and every threshold passes).
 */
const MODEL_ROUTING: MockTaskScript = {
  title: "Route routine levels to a smaller model",
  goal: "Play menus, maps, shops and cleared levels on the small model, and spend the savings on save-and-reload probes.",
  plan: ["Read the 120-bug eval", "Route routine screens to the small model", "Add a reload probe after autosaves", "Play deckhold headless, seed 7731", "Run the 120-bug eval", "Open the pull request"],
  readPath: "evals/bugs/known-bugs.json",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium --gpu on-demand", "sbx-41c9 ready · headless Chromium · WebGL 2", "deckhold 0.4 (Godot 4.3 web) · first frame 3.1s"],
    unit: ["$ gw play deckhold --seed 7731 --turns 40 --record", "turn 11 · Ember Shield, Riptide · enemy 4/31 hp", "turn 12 · Tidecaller triggers · autosave · reload probe", "crash: Invalid get index 'charges' (on base: 'Nil')", "repro 3/3 · filed #57 · replay glitchwick.dev/r/7731"],
    check: ["$ pnpm evals run bugs --cases 120", "Running 120 known bugs across 14 games in 12 sandboxes", "  ✓  recall 97/120 (80.8%), threshold 75%", "  ✓  false reports 3, limit 5", "  ✘  cost per run $0.14, over the $0.12 budget"],
    fix: ['$ git commit -am "feat(play): small model for shops"', "[agent/task-1 3a9d0c4] feat(play): small model for shops", " 2 files changed, 9 insertions(+), 2 deletions(-)", STATIC_CHECKS, "$ pnpm evals run bugs --cases 120", "  ✓  recall 80.8% · false reports 3 · $0.11 a run", "  3 of 3 met · main was 58.3% recall, $0.18 a run"],
    ship: openPr(318),
  },
  file: fileChange("src/playtest/play-loop.ts", "@@ -1,6 +1,18 @@", [
    ' import { models } from "@/lib/models";',
    '+import { probeSave } from "@/playtest/probes";',
    ' import type { GameState, RunContext, Turn } from "@/playtest/types";',
    " ",
    "-export async function nextTurn(state: GameState): Promise<Turn> {",
    "-  return models.large.decide(state);",
    "+/** Screens the small model plays as well as the large one, measured on the 120-bug eval. */",
    '+const ROUTINE = new Set(["menu", "map", "cleared_level"]);',
    "+",
    "+export async function nextTurn(state: GameState, run: RunContext): Promise<Turn> {",
    "+  const routine = ROUTINE.has(state.screen) && !state.firstVisit;",
    "+  const turn = await (routine ? models.small : models.large).decide(state);",
    '+  run.cost.add(routine ? "small" : "large", turn.usage);',
    "+  // Saves are where these games break: after every autosave, quit and reload once.",
    "+  if (turn.autosaved) {",
    "+    const probe = await probeSave(run.sandbox, turn.saveSlot);",
    "+    if (probe.crashed) await run.fileBug({ ...probe.bug, replay: run.replay.last(20) });",
    "+  }",
    "+  return turn;",
    " }",
  ]),
  notes: [
    "Reading the 120-bug eval before touching the play loop.",
    "Menus, maps and cleared levels go to the small model; new levels and every save stay on the large one.",
    "A probe quits and reloads after every autosave: saves are where these games break.",
    "Cost per run missed its budget: shop screens still go to the large model. Routing them too.",
    "Review: one finding, a build's signed download link in the run log, now redacted.",
  ],
  unitCommand: "gw play deckhold --seed 7731 --repro 3",
  unitPassed: 3,
  acceptanceCommand: "pnpm evals run bugs",
  failingCheck: "cost per run within $0.12",
  pullRequest: 318,
  // The hero deck's first decision: shipping routing to every studio is the founder's.
  gate: { connectorKey: "github", tool: "merge_pull_request", argsSummary: "#318 model routing → every studio", note: "Waiting for your decision: ship #318 to every studio.", at: "end" },
  preview: {
    address: "glitchwick.dev/evals/bugs/run-2291",
    title: "120-bug eval · model routing",
    rows: [
      { label: "Recall", value: "80.8% (main 58.3%)", tone: "good" },
      { label: "False reports", value: "3 (limit 5)", tone: "good" },
      { label: "Cost per run", value: "$0.11 (budget $0.12)", tone: "good" },
      { label: "On the small model", value: "menus, maps, shops" },
    ],
    footer: "14 games in 12 sandboxes · pull request #318",
  },
};

const UNITY_PARSER: MockTaskScript = {
  title: "Unity WebGL crash log parser",
  goal: "Turn a Unity WebGL crash log into a bug with its stack, its build and the replay that caused it.",
  plan: ["Read held-out Unity WebGL crash logs", "Parse the stack from the browser console", "Map wasm frames to C# with the symbols file", "Group crashes by their top frame", "Run the crash eval", "Open the pull request"],
  readPath: "src/crashes/godot/parse.ts",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium", "sbx-52e1 ready · headless Chromium · WebGL 2", "lanternfall 1.2 (Unity 6 WebGL) · first frame 6.4s"],
    unit: ["$ pnpm vitest run src/crashes/unity", " ✓ src/crashes/unity/parse.test.ts (12 tests) 264ms", " ✓ src/crashes/unity/symbols.test.ts (5 tests) 380ms", "      Tests  17 passed (17)"],
    check: ["$ pnpm evals run crashes --logs 80 --held-out", "Running 80 Unity WebGL crash logs (held out)", "  ✓  stack parsed 80/80", "  ✓  grouped with its duplicates 74/80", "  ✘  C# frame named 54/80 (68%), threshold 90%", "  1 threshold missed"],
    fix: ['$ git commit -am "fix(crashes): load symbols for IL2CPP builds"', "[agent/task-2 8e2f6b1] fix(crashes): load symbols for IL2CPP builds", " 3 files changed, 58 insertions(+), 7 deletions(-)", STATIC_CHECKS, "$ pnpm evals run crashes --logs 80 --held-out", "  all thresholds met (stack 100%, C# frame 95%)"],
    ship: openPr(321),
  },
  file: fileChange("src/crashes/unity/parse.ts", "@@ -0,0 +1,13 @@", [
    '+import { symbolsFor } from "@/crashes/unity/symbols";',
    "+",
    "+/** A Unity WebGL crash from the browser console: wasm frames mapped back to C# where the build has symbols. */",
    "+export async function parseUnityCrash(log: ConsoleLog, build: Build): Promise<Crash> {",
    "+  const frames = log.lines.filter((l) => l.includes(\"wasm-function\")).map(parseWasmFrame);",
    "+  const symbols = await symbolsFor(build);",
    "+  const named = frames.map((f) => ({ ...f, csharp: symbols?.lookup(f.index) ?? null }));",
    "+  return {",
    "+    message: log.lines.find((l) => l.startsWith(\"Uncaught\")) ?? \"Unknown crash\",",
    "+    topFrame: named.find((f) => f.csharp)?.csharp ?? named[0]?.name ?? null,",
    "+    frames: named,",
    "+  };",
    "+}",
  ], true),
  notes: [
    "Reading 80 held-out crash logs, none of them from Vex's training set.",
    "The parser reads the browser console, so studios change nothing in their build.",
    "Crashes with the same top frame group into one bug with a count.",
    "C# frames were missing for IL2CPP builds: the symbols file was never loaded. Loading it.",
    "Review: symbol files are deleted with the build, 30 days after the run.",
  ],
  unitCommand: "pnpm vitest run src/crashes/unity",
  unitPassed: 17,
  acceptanceCommand: "pnpm evals run crashes",
  failingCheck: "C# frame named for 90% of crashes",
  pullRequest: 321,
  nudge: {
    text: "Put the replay first on the bug card",
    reply: "Moving the replay above the stack trace before the next build.",
    file: fileChange("src/report/bug-card.css", "@@ -1,6 +1,11 @@", [
      " .bug-card {",
      "   display: flex;",
      "   flex-direction: column;",
      "-  padding: 13px;",
      "+  padding: var(--space-3);",
      " }",
      "+",
      "+.bug-card__replay {",
      "+  order: -1;",
      "+  border-radius: var(--radius-md);",
      "+}",
    ]),
  },
  preview: {
    address: "github.com/lanternfall/lanternfall/issues/212",
    title: "Crash: NullReferenceException in Lantern.Refuel()",
    rows: [
      { label: "Replay", value: "20 s before the crash", tone: "bad" },
      { label: "Build", value: "lanternfall 1.2 · Unity 6 WebGL" },
      { label: "Reproduced", value: "3 of 3 runs" },
      { label: "Top frame", value: "Lantern.Refuel(), line 88" },
      { label: "Same crash in nightly runs", value: "4" },
    ],
    footer: "Filed by Glitchwick: the replay first, then the stack.",
  },
};

const CARD_GAME_TRAINING: MockTaskScript = {
  title: "Card-game playtests: 40 known bugs",
  goal: "Find the 40 known bugs in three card games, as a new player would, each with its replay.",
  plan: ["Learn each game's rules from its tutorial", "Play three seeds, 60 turns each", "File each bug with its replay", "Score recall against the 40 known bugs", "Write up what was missed", "Hand the results to Harbor"],
  readPath: "training/card-games/README.md",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium --count 3", "sbx-61a0, sbx-61a1, sbx-61a2 ready · WebGL 2", "deckhold 0.4 · mirecards 2.0 · tallowtrick 0.9"],
    unit: ["$ gw play --all --seeds 3 --turns 60 --record", "deckhold · seed 104 · turn 38 · discard loop", "mirecards · seed 7 · turn 22 · mana not refunded", "tallowtrick · seed 51 · turn 60 · no crash", "filed 29 bugs · 29 replays attached"],
    check: ["$ gw score training/card-games --known 40", "Scoring 29 reports against 40 known bugs", "  ✓  false reports 1, limit 3", "  ✓  every report has a replay 29/29", "  ✘  recall 28/40 (70%), target 80%", "  1 target missed"],
    fix: ["$ gw play --all --seeds 3 --turns 60 --probe shuffle", "deckhold · seed 104 · turn 41 · shuffle drops a card", "filed 6 more bugs · 6 replays attached", "$ gw score training/card-games --known 40", "  ✓  recall 34/40 (85%) · false reports 1"],
    ship: ["$ gw training report sprite --to harbor", "Sent: Sprite · card games · recall 85%, 1 false report"],
  },
  file: fileChange("training/card-games/play-plan.md", "@@ -0,0 +1,10 @@", [
    "+# Card games: play plan",
    "+",
    "+| Game | Engine | Seeds | Turns |",
    "+| --- | --- | --- | ---: |",
    "+| deckhold 0.4 | Godot 4.3 web | 104, 7731, 9 | 60 |",
    "+| mirecards 2.0 | HTML5 | 7, 18, 233 | 60 |",
    "+| tallowtrick 0.9 | Unity 6 WebGL | 51, 52, 640 | 60 |",
    "+",
    "+Probe after every save, discard and shuffle. File each bug with the 20 seconds before it.",
  ], true),
  notes: [
    "Learning each game's rules from its tutorial, as a new player would.",
    "Three seeds per game, 60 turns each, recorded from the first frame.",
    "Every report carries the 20 seconds before the bug.",
    "Recall is short of 80%: nothing checked the deck after a shuffle. Adding a probe there.",
    "Review: Harbor checked that none of the 40 come from the 120-bug eval.",
  ],
  unitCommand: "gw play --all --seeds 3",
  unitPassed: 3,
  acceptanceCommand: "gw score training/card-games",
  failingCheck: "recall of 80% of the 40 known bugs",
  doneNote: "Done. Results sent to Harbor: 34 of the 40 known bugs found.",
  preview: {
    address: "glitchwick.dev/training/sprite/card-games",
    title: "Training · card games · Sprite",
    rows: [
      { label: "Known bugs found", value: "34 of 40", tone: "good" },
      { label: "False reports", value: "1 (limit 3)", tone: "good" },
      { label: "Missed: animation-only bugs", value: "6", tone: "warn" },
      { label: "Games", value: "deckhold, mirecards, tallowtrick" },
    ],
    footer: "Training set: real bugs studios filed, never the 120-bug eval's.",
  },
};

const REVIEW_REPLAYS: MockTaskScript = {
  title: "Post replays on pull request reviews",
  goal: "Put the replay of a failing run in the pull request review, so the studio sees the bug before reading the log.",
  plan: ["Read the pull request check", "Render the replay as a review comment", "Ask for the pull requests permission", "Run the 120-bug eval", "Open the pull request"],
  readPath: "src/check/run.ts",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium", "sbx-77d3 ready · headless Chromium · WebGL 2", "$ gw fixtures open-pr --repo check-fixtures --bug save-crash", "opened check-fixtures#12 · deckhold 0.4 · seed 7731"],
    unit: ["$ pnpm vitest run src/check/review", " ✓ src/check/review/comment.test.ts (6 tests) 174ms", " ✓ src/check/review/clip.test.ts (3 tests) 921ms", "      Tests  9 passed (9)"],
    check: ["$ pnpm playwright test e2e/review-comment.spec.ts", "Running 3 tests using 1 worker", "  ✓  1 renders the replay as a 20-second clip", "  ✓  2 links the clip to the failing seed", "  ✘  3 posts the comment on the review (403)", "  2 passed, 1 failed (11.2s)"],
    fix: ['$ git commit -am "feat(check): replay clips on reviews"', "[agent/task-4 d17a9e5] feat(check): replay clips on reviews", " 4 files changed, 131 insertions(+), 3 deletions(-)", STATIC_CHECKS, "$ pnpm playwright test e2e/review-comment.spec.ts", "  3 passed (10.4s)"],
    ship: openPr(325),
  },
  file: fileChange("src/check/review/comment.ts", "@@ -0,0 +1,11 @@", [
    '+import { github } from "@/gateway/github";',
    "+",
    "+/** The failing run's replay, first in the review, with the seed to rerun it. */",
    "+export async function postReplay(pr: PullRequestRef, run: FailedRun) {",
    "+  const clip = await run.replay.clip({ seconds: 20 });",
    "+  return github.reviews.comment(pr, {",
    "+    body: `![Replay](${clip.url})\\n\\nRerun: \\`gw play ${run.game} --seed ${run.seed}\\``,",
    "+    event: \"COMMENT\",",
    "+  });",
    "+}",
  ], true),
  notes: [
    "Reading the pull request check before adding to it.",
    "The replay renders as a 20-second clip in the review, above the stack trace.",
    "The clip links to its seed, so the studio can rerun the failing run in one click.",
    "Posting on reviews needs the pull requests permission, which the app does not have. Asking you.",
    "Review: the clip expires with the run, after 30 days.",
  ],
  unitCommand: "pnpm vitest run src/check/review",
  unitPassed: 9,
  acceptanceCommand: "pnpm playwright test",
  failingCheck: "posts the comment on the review",
  pullRequest: 325,
  // Verity trimmed the app to read code and write issues and checks; a new permission is the founder's to grant.
  gate: { connectorKey: "github", tool: "request_app_permission", argsSummary: "pull requests: write, to post replays on reviews", note: "Waiting for your decision: a new GitHub app permission." },
};

const RESUME_FROM_SAVE: MockTaskScript = {
  title: "Resume an interrupted run from its last save",
  goal: "When a sandbox is interrupted mid-run, start a new one from the game's last save instead of from the title screen.",
  plan: ["Read how runs end when a sandbox stops", "Snapshot the save after every autosave", "Restore the save in a fresh sandbox", "Keep the replay continuous across the gap", "Run the interruption eval", "Open the pull request"],
  readPath: "src/playtest/run.ts",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium --gpu on-demand", "sbx-83b0 ready · headless Chromium · WebGL 2", "tidewright 0.9 (Godot 4.3 web) · first frame 2.8s"],
    unit: ["$ pnpm vitest run src/playtest/resume", " ✓ src/playtest/resume/snapshot.test.ts (7 tests) 233ms", " ✓ src/playtest/resume/restore.test.ts (5 tests) 1.2s", "      Tests  12 passed (12)"],
    check: ["$ pnpm evals run interruptions --runs 30", "Interrupting 30 runs at random turns", "  ✓  resumed from the last save 30/30", "  ✓  no bug filed twice 30/30", "  ✘  replay continuous across the gap 22/30", "  1 threshold missed (continuity 100%)"],
    fix: ['$ git commit -am "fix(replay): stitch frames across a resume"', "[agent/task-5 6c0b2f8] fix(replay): stitch frames across a resume", " 2 files changed, 47 insertions(+), 11 deletions(-)", STATIC_CHECKS, "$ pnpm evals run interruptions --runs 30", "  all thresholds met (resumed 100%, continuity 100%)"],
    ship: openPr(323),
  },
  file: fileChange("src/playtest/resume/restore.ts", "@@ -0,0 +1,10 @@", [
    '+import { sandboxes } from "@/sandbox";',
    "+",
    "+/** A run interrupted mid-game starts again from its last save, in a fresh sandbox. */",
    "+export async function resumeRun(run: InterruptedRun) {",
    "+  const sandbox = await sandboxes.up({ image: run.image });",
    "+  await sandbox.game.loadSave(run.lastSave);",
    "+  run.replay.markGap(run.interruptedAt);",
    "+  return run.continueIn(sandbox);",
    "+}",
  ], true),
  notes: [
    "Reading how a run ends today when its sandbox stops.",
    "The save is snapshotted after every autosave, so nothing before it is played twice.",
    "A resumed run picks up its seed and turn count where it stopped.",
    "Eight replays showed a jump at the resume. Stitching the frames across the gap.",
    "Review: snapshots are deleted with the run, after 30 days.",
  ],
  unitCommand: "pnpm vitest run src/playtest/resume",
  unitPassed: 12,
  acceptanceCommand: "pnpm evals run interruptions",
  failingCheck: "replay continuous across a resume",
  pullRequest: 323,
  preview: {
    address: "glitchwick.dev/r/9184",
    title: "Replay · tidewright 0.9 · seed 9184",
    rows: [
      { label: "Turns 1 to 26", value: "sbx-83b0" },
      { label: "Interrupted at turn 27", value: "resumed in 41 s", tone: "warn" },
      { label: "Turns 27 to 60", value: "sbx-83b4" },
      { label: "Replay continuous", value: "Yes", tone: "good" },
    ],
    footer: "Resumed from the autosave at turn 26. Nothing was played twice.",
  },
};

const MERGE_DUPLICATES: MockTaskScript = {
  title: "Merge duplicate bugs across nightly runs",
  goal: "File a crash once, however many nightly runs hit it, and count how often it happens.",
  plan: ["Read a week of nightly bug reports", "Fingerprint crashes by top frame and screen", "Merge new reports into the open bug", "Count how often each bug happens", "Run the duplicate eval", "Open the pull request"],
  readPath: "src/report/file-bug.ts",
  terminal: {
    setup: ["$ pnpm install --frozen-lockfile", "Lockfile is up to date, resolution step is skipped", "$ gw reports export --nights 7", "Exported 1,284 reports from 7 nights, 212 builds"],
    unit: ["$ pnpm vitest run src/report/dedupe", " ✓ src/report/dedupe/fingerprint.test.ts (10 tests) 141ms", " ✓ src/report/dedupe/merge.test.ts (6 tests) 203ms", "      Tests  16 passed (16)"],
    check: ["$ pnpm evals run duplicates --reports 1284", "Grouping 1,284 reports into bugs", "  ✓  duplicates merged 1,016/1,050", "  ✘  distinct bugs merged by mistake 9 (limit 2)", "  ✓  every bug keeps its first replay", "  1 threshold missed"],
    fix: ['$ git commit -am "fix(dedupe): include the screen in the fingerprint"', "[agent/task-6 0a4c7d2] fix(dedupe): include the screen in the fingerprint", " 2 files changed, 23 insertions(+), 4 deletions(-)", STATIC_CHECKS, "$ pnpm evals run duplicates --reports 1284", "  all thresholds met (merged 97%, wrong merges 1)"],
    ship: openPr(322),
  },
  file: fileChange("src/report/dedupe/fingerprint.ts", "@@ -2,6 +2,9 @@", [
    " export function fingerprint(report: BugReport): string {",
    "-  return hash([report.game, report.topFrame]);",
    "+  // The same top frame on two different screens is two bugs.",
    "+  return hash([report.game, report.topFrame, report.screen, report.buildMajor]);",
    " }",
  ]),
  notes: [
    "Reading a week of nightly reports before merging any.",
    "Reports with the same fingerprint merge into the open bug and add to its count.",
    "Each merged bug keeps the first replay and links the rest.",
    "Nine distinct bugs were merged by mistake: the fingerprint ignored the screen. Adding it.",
    "Review: a merged bug reopens if the studio closed it and it happens again.",
  ],
  unitCommand: "pnpm vitest run src/report/dedupe",
  unitPassed: 16,
  acceptanceCommand: "pnpm evals run duplicates",
  failingCheck: "no more than 2 wrong merges",
  pullRequest: 322,
  preview: {
    address: "glitchwick.dev/studios/hollow-pine/bugs",
    title: "Bugs this week · Hollow Pine Games",
    rows: [
      { label: "Map stops scrolling after a resize", value: "seen 14 times", tone: "bad" },
      { label: "Shop button under the map", value: "seen 6 times", tone: "warn" },
      { label: "Save slot shows the wrong date", value: "seen 3 times", tone: "warn" },
      { label: "Reports merged into these", value: "20" },
    ],
    footer: "One bug per problem; each keeps its first replay.",
  },
};

const NIGHTLY_CARD_GAMES: MockTaskScript = {
  title: "Nightly playtests: card games, 9 studios",
  goal: "Play last night's builds of nine studios' card games and file what breaks, each with its replay.",
  plan: ["Read last night's builds and their changelogs", "Play each changed game, two seeds", "Probe after every save and shuffle", "File each bug with its replay", "Check every report before it is filed", "Post the morning summary"],
  readPath: "nightly/card-games/builds.json",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium --count 9", "9 sandboxes ready · WebGL 2", "9 builds changed overnight · 6 Godot, 3 HTML5"],
    unit: ["$ gw play --nightly card-games --seeds 2 --probe save,shuffle", "mirecards 2.1 · seed 7 · turn 19 · shuffle drops a card", "tidewright 0.9 · seed 9184 · turn 31 · save loads", "hexwinder 0.6 · seed 12 · turn 44 · softlock in shop", "6 games clean · 3 bugs found"],
    check: ["$ gw verify reports --nightly card-games", "Checking 3 reports before they are filed", "  ✓  each bug reproduced 2 of 2", "  ✓  each report has its replay", "  ✘  hexwinder softlock repeats an open bug", "  1 check failed (no duplicates)"],
    fix: ["$ gw reports merge hexwinder#88 --into hexwinder#81", "merged · hexwinder#81 seen 4 times", "$ gw verify reports --nightly card-games", "  ✓  2 new bugs, 1 merged, every replay attached"],
    ship: ["$ gw nightly summary card-games --post", "Posted: 9 games, 2 new bugs filed, 1 known bug seen again"],
  },
  file: fileChange("nightly/card-games/summary.md", "@@ -0,0 +1,8 @@", [
    "+# Card games, last night",
    "+",
    "+- 9 builds played, 2 seeds each",
    "+- mirecards 2.1: a shuffle drops a card (new, replay attached)",
    "+- hexwinder 0.6: shop softlock seen again (merged into #81)",
    "+- tidewright 0.9: saves load cleanly after relic triggers",
    "+- 6 games clean",
  ], true),
  notes: [
    "Reading last night's builds and what each studio changed.",
    "Two seeds per changed game, probing after every save and shuffle.",
    "Tidewright's saves load cleanly since Kettlebird's fix.",
    "The hexwinder softlock is a bug already open. Merging the report instead of filing it again.",
    "Review: every filed bug reproduced twice before it reached a studio.",
  ],
  unitCommand: "gw play --nightly card-games",
  unitPassed: 9,
  acceptanceCommand: "gw verify reports",
  failingCheck: "no duplicate reports",
  doneNote: "Done. 2 new bugs filed to 2 studios, each with its replay.",
  preview: {
    address: "glitchwick.dev/nightly/card-games",
    title: "Nightly playtests · card games",
    rows: [
      { label: "Builds played", value: "9" },
      { label: "mirecards 2.1: shuffle drops a card", value: "New", tone: "bad" },
      { label: "hexwinder 0.6: shop softlock", value: "Seen again", tone: "warn" },
      { label: "tidewright 0.9: saves after relics", value: "Clean", tone: "good" },
    ],
    footer: "Every bug reproduced twice before it was filed.",
  },
};

const RERUN_FAILING_SEED: MockTaskScript = {
  title: "Pull request check reruns the failing seed",
  goal: "When a pull request's check finds a bug, rerun its seed on the next push to show whether the fix worked.",
  plan: ["Read the pull request check", "Store the failing seed with the check run", "Rerun that seed first on the next push", "Mark the bug fixed when the seed passes", "Run the check against fixtures", "Open the pull request"],
  readPath: "src/check/run.ts",
  terminal: {
    setup: ["$ gw sandbox up --image webgl-chromium --gpu on-demand", "sbx-90f2 ready · headless Chromium · WebGL 2", "$ gw fixtures open-pr --repo check-fixtures --bug save-crash", "opened check-fixtures#13 · deckhold 0.4 · seed 7731"],
    unit: ["$ pnpm vitest run src/check/rerun", " ✓ src/check/rerun/seed.test.ts (8 tests) 166ms", "      Tests  8 passed (8)"],
    check: ["$ pnpm playwright test e2e/check-rerun.spec.ts", "Running 3 tests using 1 worker", "  ✓  1 keeps the failing seed with the check run", "  ✓  2 reruns that seed first on the next push", "  ✘  3 marks the bug fixed when the seed passes", "  2 passed, 1 failed (14.8s)"],
    fix: ['$ git commit -am "fix(check): close the bug when its seed passes"', "[agent/task-8 f3e81b9] fix(check): close the bug when its seed passes", " 2 files changed, 29 insertions(+), 6 deletions(-)", STATIC_CHECKS, "$ pnpm playwright test e2e/check-rerun.spec.ts", "  3 passed (13.9s)"],
    ship: openPr(324),
  },
  file: fileChange("src/check/rerun/seed.ts", "@@ -0,0 +1,10 @@", [
    "+/** The failing seed of the last check run on this pull request, played first on the next push. */",
    "+export async function seedsToRerun(pr: PullRequestRef): Promise<number[]> {",
    "+  const last = await checkRuns.lastFor(pr);",
    "+  return last?.failures.map((f) => f.seed) ?? [];",
    "+}",
    "+",
    "+export async function markFixed(bug: BugRef, run: CheckRun) {",
    '+  if (run.passedSeed(bug.seed)) await bugs.close(bug, { reason: "seed passes on this push" });',
    "+}",
  ], true),
  notes: [
    "Reading the pull request check before changing it.",
    "The failing seed is stored with the check run, so the next push plays it first.",
    "A studio sees in the check whether its fix worked before the full run ends.",
    "The bug stayed open after its seed passed: the check never looked it up. Closing it there.",
    "Review: only bugs the check itself filed are closed automatically.",
  ],
  unitCommand: "pnpm vitest run src/check/rerun",
  unitPassed: 8,
  acceptanceCommand: "pnpm playwright test",
  failingCheck: "marks the bug fixed when the seed passes",
  pullRequest: 324,
  preview: {
    address: "github.com/glitchwick/check-fixtures/pull/13/checks",
    title: "Glitchwick playtest · check-fixtures#13",
    rows: [
      { label: "Seed 7731 (failed last push)", value: "Passes", tone: "good" },
      { label: "Save crash from seed 7731", value: "Closed", tone: "good" },
      { label: "Full playtest, 40 turns", value: "Passes", tone: "good" },
      { label: "Time to first result", value: "48 s" },
    ],
    footer: "The failing seed runs first, so the answer comes before the full run ends.",
  },
};

/** Tile k plays task k, then task k + 4: Rune, Vex, Sprite and Bolt each have two. */
export const GLITCHWICK_SESSIONS = sessionScript({
  agents: AGENTS,
  taskScripts: [MODEL_ROUTING, UNITY_PARSER, CARD_GAME_TRAINING, REVIEW_REPLAYS, RESUME_FROM_SAVE, MERGE_DUPLICATES, NIGHTLY_CARD_GAMES, RERUN_FAILING_SEED],
  currency: "USD",
  failure: "Error: deckhold-0.4 did not reach its first frame in 60 s (WebGL context lost)",
});
