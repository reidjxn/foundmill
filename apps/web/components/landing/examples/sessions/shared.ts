/**
 * Builds an example business's Live sessions script from its crew and its task recordings. The tiles play each task's
 * own recording (see `MockTaskScript` in the design system); the script's shared fields, which the design system falls
 * back to only for what a task leaves out, are filled from the first task so the script stays valid on its own.
 */
import type { MockSessionAgent, MockSessionScript, MockTaskScript } from "@foundmill/dugout";

/**
 * How the landing page replays the sessions: a tick every half second moves the story clock 4 s (8× real time), so a
 * session of eight to ten minutes plays in about a minute; tiles open 25% to 63% into their first session; a finished
 * session settles for 5 s and one waiting for the founder for 14 s before the agent picks up its next task.
 */
export const LIVE_REPLAY = { intervalMs: 500, speed: 8, prefill: 0.45, settleMs: 5000, waitMs: 14_000 } as const;

export interface ExampleSessions {
  /** One agent per tile, in order. Tile k works on tasks k, k + 4, k + 8, … (with four tiles). */
  agents: readonly MockSessionAgent[];
  /** Every task's recording, in task order. */
  taskScripts: readonly MockTaskScript[];
  currency: string;
  /** The repeated error of a session that loops (only the design system's own mixed grids use it). */
  failure: string;
  /** What the Preview view says before a session has anything to show. */
  previewNote?: string;
}

/**
 * The script the tiles play. Every session opens on its own task's branch (`agent/task-N`, as in the product's worktrees),
 * so its first terminal line is its own and no two tiles ever show the same output.
 */
export function sessionScript({ agents, taskScripts: recorded, currency, failure, previewNote }: ExampleSessions): MockSessionScript {
  const taskScripts = recorded.map((t, i) => ({
    ...t,
    terminal: { ...t.terminal, setup: [`$ git switch -c agent/task-${i + 1}`, `Switched to a new branch 'agent/task-${i + 1}'`, ...t.terminal.setup] },
  }));
  const first = taskScripts[0];
  if (!first) throw new Error("An example's live sessions need at least one task.");
  const t = first.terminal;
  const nudged = taskScripts.find((s) => s.nudge)?.nudge;
  return {
    names: agents.map((a) => a.name),
    agents,
    tasks: taskScripts.map((s) => s.title),
    stdout: [...t.setup, ...t.unit, ...t.check, ...t.fix, ...t.ship],
    readPath: first.readPath ?? first.file.path,
    file: first.file,
    styleFile: nudged ? { path: nudged.file.path, diff: nudged.file.diff } : { path: first.file.path, diff: first.file.diff },
    notes: first.notes,
    unitCommand: first.unitCommand ?? "",
    unitPassed: first.unitPassed ?? 0,
    acceptanceCommand: first.acceptanceCommand ?? "",
    failingCheck: first.failingCheck,
    failure,
    currency,
    ...(nudged ? { nudge: { text: nudged.text, reply: nudged.reply } } : {}),
    taskScripts,
    ...(previewNote ? { previewNote } : {}),
  };
}

/** A file change for the Diff view: the unified diff from its hunk lines, with its added and removed line counts. */
export function fileChange(path: string, hunk: string, lines: readonly string[], created = false): { path: string; diff: string; additions: number; deletions: number } {
  const diff = [`diff --git a/${path} b/${path}`, created ? "--- /dev/null" : `--- a/${path}`, `+++ b/${path}`, hunk, ...lines].join("\n");
  return { path, diff, additions: lines.filter((l) => l.startsWith("+")).length, deletions: lines.filter((l) => l.startsWith("-")).length };
}
