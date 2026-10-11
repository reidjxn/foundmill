/**
 * The live replay behind `useLiveMockSessions`: each tile is a lane in which one agent works through its tasks, one
 * recorded session after another, on a story clock that runs faster than real time. A session plays its own task's
 * recording (`MockSessionScript.taskScripts`) through its phases; when it finishes it stays on its done state for a
 * moment, and when it stops for a founder decision it waits, is parked until the founder decides, and the agent picks up
 * its next task. Lanes round through the script's tasks for as long as the replay runs. Pure and deterministic.
 */
import { generateMockSessionEvents, mockRecording, mockSessionSeed, type MockPreview, type MockSessionScript } from "./mock";
import { applySessionEvent, emptySession, type SessionSeed } from "./progress";
import type { AgentSessionEvent, AgentTileSession } from "./types";

export interface ReplayConfig {
  /** Tiles on screen. */
  n: number;
  script: MockSessionScript;
  /** Story time the replay opens at (ms since the epoch). */
  startMs: number;
  /** 0–1: how far into its first session each tile opens (staggered per tile, so the tiles sit in different phases). */
  prefill: number;
  /** Story ms a finished session stays on screen before the agent picks up its next task. */
  settleMs: number;
  /** Story ms a session waiting for the founder stays before the agent parks it. */
  waitMs: number;
  /** Keep going: pick up the next task when a session ends. False: each tile stays on its first session's last frame. */
  loop: boolean;
  /** Seeds every session's timing, tokens and cost. */
  seed: string;
}

export interface ReplayLane {
  lane: number;
  /** How many sessions this lane has finished before this one. */
  round: number;
  taskIndex: number;
  seed: SessionSeed;
  events: AgentSessionEvent[];
  /** Each event's story time (ms), in order. */
  times: number[];
  /** Events applied so far. */
  cursor: number;
  session: AgentTileSession;
  startedAtMs: number;
  durationMs: number;
  /** Story time the agent moves on to its next task (Infinity: the tile stays on this session). */
  endsAtMs: number;
  /** The work's picture (a data: URL), shown once the session's acceptance checks pass. */
  previewUrl: string | null;
}

/** How far into its first session each lane opens, around `prefill`: different phases side by side. */
const PREFILL_OFFSETS = [0, -0.2, 0.18, -0.08, 0.1, -0.14, 0.24, -0.04];

/** Tasks a lane rounds through: the task recordings, else the task titles. */
function taskCount(script: MockSessionScript): number {
  return Math.max(1, script.taskScripts?.length ?? script.tasks.length);
}

/** A session's span in story ms: eight to ten minutes, different per lane and round. */
export function laneDurationMs(lane: number, round: number): number {
  return (480 + ((lane * 53 + round * 29) % 5) * 30) * 1000;
}

/** Lane `lane`'s session `round`, starting at `startedAtMs`: agent `lane` on task `lane + round × n`. */
export function startLane(cfg: ReplayConfig, lane: number, round: number, startedAtMs: number): ReplayLane {
  const { script } = cfg;
  const k = lane + round * cfg.n;
  const taskIndex = k % taskCount(script);
  const own = script.taskScripts?.length ? script.taskScripts[taskIndex % script.taskScripts.length] : undefined;
  const rec = mockRecording(script, taskIndex);
  // A task recording says how its session ends; a shared script mixes outcomes across the grid.
  const outcome = script.taskScripts?.length ? (rec.gate ? "blocked" : "done") : k % 7 === 3 ? "blocked" : k % 11 === 5 ? "failed" : "done";
  const shout = script.taskScripts?.length ? !!own?.nudge : k % 4 === 0;
  const durationMs = laneDurationMs(lane, round);
  const startedAt = new Date(startedAtMs).toISOString();
  const key = `${cfg.seed}:${lane}:${round}`;
  const events = generateMockSessionEvents(key, startedAt, { outcome, shout, durationSec: durationMs / 1000, script, taskIndex });
  const seed: SessionSeed = { ...mockSessionSeed(lane, startedAt, script, taskIndex, key), preview: script.previewNote ? { emptyNote: script.previewNote } : {} };
  let times = events.map((e) => Date.parse(e.at));
  const lastMs = times[times.length - 1] ?? startedAtMs;
  let endsAtMs = Number.POSITIVE_INFINITY;
  if (cfg.loop && outcome === "blocked") {
    // The decision stays with the founder (in the Inbox); the agent parks the session and moves on.
    const parkMs = lastMs + cfg.waitMs;
    events.push({ kind: "note", at: new Date(parkMs).toISOString(), level: "info", source: "system", text: `Parked until you decide. ${seed.agent.name} picks up the next task.` });
    times = [...times, parkMs];
    endsAtMs = parkMs + cfg.settleMs;
  } else if (cfg.loop) {
    endsAtMs = lastMs + cfg.settleMs;
  }
  return {
    lane,
    round,
    taskIndex,
    seed,
    events,
    times,
    cursor: 0,
    session: emptySession(seed),
    startedAtMs,
    durationMs,
    endsAtMs,
    previewUrl: rec.preview ? mockPreviewImage(rec.preview) : null,
  };
}

/** Apply every event up to `nowMs`; past the session's end, start the lane's next session (as often as needed). */
export function advanceLane(cfg: ReplayConfig, lane: ReplayLane, nowMs: number): ReplayLane {
  let l = lane;
  while (nowMs >= l.endsAtMs) l = startLane(cfg, l.lane, l.round + 1, l.endsAtMs);
  let { session, cursor } = l;
  while (cursor < l.events.length && (l.times[cursor] ?? Number.POSITIVE_INFINITY) <= nowMs) {
    session = applySessionEvent(session, l.events[cursor] as AgentSessionEvent);
    cursor++;
  }
  if (l === lane && cursor === lane.cursor) return lane;
  return { ...l, session, cursor };
}

/** Every lane opening mid-session at `cfg.startMs` (or at the start of its first session with no prefill). */
export function initialLanes(cfg: ReplayConfig): ReplayLane[] {
  return Array.from({ length: cfg.n }, (_, lane) => {
    const frac = cfg.prefill > 0 ? Math.min(0.9, Math.max(0.05, Math.min(1, cfg.prefill) + (PREFILL_OFFSETS[lane % PREFILL_OFFSETS.length] ?? 0))) : 0;
    const startedAtMs = cfg.startMs - Math.round(frac * laneDurationMs(lane, 0));
    return advanceLane(cfg, startLane(cfg, lane, 0, startedAtMs), cfg.startMs);
  });
}

/**
 * What the tile shows at `nowMs`: the session so far, with tokens and cost growing as it runs, the work's picture once
 * there is a first change, and no ETA while it waits for the founder (a decision has no estimate).
 */
export function laneSession(lane: ReplayLane, nowMs: number): AgentTileSession {
  const s = lane.session;
  const endMs = s.endedAt ? Date.parse(s.endedAt) : nowMs;
  const f = Math.min(1, Math.max(0, (endMs - lane.startedAtMs) / lane.durationMs));
  const grow = 0.15 + 0.85 * f;
  const baseCost = lane.seed.cost?.amountMinor ?? 0;
  // The picture is the finished work: it arrives with the first green acceptance run, like a screenshot with each run.
  const green = !!s.tests.acceptance && s.tests.acceptance.failed === 0 && s.tests.acceptance.passed > 0;
  return {
    ...s,
    tokens: Math.round((lane.seed.tokens ?? 0) * grow),
    cost: { ...s.cost, amountMinor: Math.round(baseCost * grow) + (s.cost.amountMinor - baseCost) },
    etaAt: s.status === "blocked" || s.status === "paused" ? null : s.etaAt,
    preview: lane.previewUrl && green ? { url: null, screenshotUrl: lane.previewUrl, capturedAt: s.tests.lastAt } : s.preview,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The Preview view's picture: a small page drawn from the task's own data
// ---------------------------------------------------------------------------------------------------------------------

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TONE_FILL = { good: "#1f9d61", warn: "#c27c0e", bad: "#d14343" } as const;

/**
 * A screenshot-like picture of the work (an SVG data: URL): a browser frame with the preview's address, then the page's
 * title, up to six rows and a footer line. It is an image of the business's own page, not product chrome, so it draws in
 * fixed light colors the way a screenshot would.
 */
export function mockPreviewImage(p: MockPreview): string {
  const W = 640;
  const rows = p.rows.slice(0, 6);
  const rowH = 34;
  const top = 108;
  const H = Math.max(300, top + rows.length * rowH + (p.footer ? 64 : 36));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#eef1f5"/>`,
    `<rect width="${W}" height="32" fill="#dde2e9"/>`,
    `<circle cx="16" cy="16" r="5" fill="#c2c9d2"/><circle cx="32" cy="16" r="5" fill="#c2c9d2"/><circle cx="48" cy="16" r="5" fill="#c2c9d2"/>`,
    `<rect x="68" y="7" width="${W - 92}" height="18" rx="9" fill="#ffffff"/>`,
    `<text x="82" y="20" font-size="11" fill="#566170">${xml(p.address)}</text>`,
    `<rect x="20" y="48" width="${W - 40}" height="${H - 68}" rx="10" fill="#ffffff" stroke="#d8dde4"/>`,
    `<text x="44" y="86" font-size="18" font-weight="600" fill="#141a22">${xml(p.title)}</text>`,
  ];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    parts.push(`<line x1="44" y1="${y - 4}" x2="${W - 44}" y2="${y - 4}" stroke="#e7eaef"/>`);
    const labelX = r.tone ? 62 : 44;
    if (r.tone) parts.push(`<circle cx="50" cy="${y + 13}" r="4" fill="${TONE_FILL[r.tone]}"/>`);
    parts.push(`<text x="${labelX}" y="${y + 17}" font-size="13" fill="#27303b">${xml(r.label)}</text>`);
    if (r.value) parts.push(`<text x="${W - 44}" y="${y + 17}" font-size="13" font-weight="600" text-anchor="end" fill="#141a22">${xml(r.value)}</text>`);
  });
  if (p.footer) parts.push(`<text x="44" y="${H - 38}" font-size="12" fill="#68727f">${xml(p.footer)}</text>`);
  parts.push("</svg>");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(parts.join(""))}`;
}
