/**
 * Pure helpers for the agent profile (BUILD §11.10, DESIGN §9 "Agent profile"): the tab list, skill rows and the
 * blend formula (AC-11.10.3), the position map derived from the template catalogue, traits, the development chart
 * series from training runs, instruction versions, training-flow state (draft → run → results → watch), model options
 * and the autonomy/negotiation forms. Everything here is deterministic and unit-tested; the screens only render.
 */
import type { AgentStatus, DeptColourToken, ModelKey, SkillGroup } from "@foundmill/shared";
import type { AgentInstructions, DateFormatPrefs, InstructionVersion, InstructionViolation, ModelOption, PositionRole, SkillRow, Trait, TrainingSkillResult, TrainingSessionMark, SkillHistorySeries, InstructionSection } from "@foundmill/dugout";
import { MODEL_LABELS, positionLevelFor } from "@foundmill/dugout";
import { usSpelling } from "@foundmill/shared/us-spelling";
import type { RouterOutputs } from "@/lib/trpc";
import { formatMonthYear, MODEL_COST_CURRENCY } from "@/lib/format";

export type AgentProfile = RouterOutputs["agent"]["profile"]["get"];
export type AgentRow = AgentProfile["agent"];
export type AgentSkillRecord = AgentProfile["skills"][number];
export type AgentVersionRecord = AgentProfile["versions"][number];
export type TrainingRunRecord = AgentProfile["trainingRuns"][number];
export type SessionRecord = AgentProfile["sessions"][number];
export type ModelCompare = RouterOutputs["agent"]["model"]["compare"];
export type ModelSetResult = RouterOutputs["agent"]["model"]["set"];
export type TrainingResultsRecord = RouterOutputs["agent"]["training"]["results"];
export type CatalogueTemplate = RouterOutputs["team"]["agents"]["catalogue"][number];

export type Iso = Date | string | null | undefined;

export { AGENT_TABS, AGENT_TAB_IDS, isAgentTab, type AgentTab } from "./tabs";

export const TRAINING_SUB_TABS = [
  { id: "instructions", label: "Instructions" },
  { id: "focus", label: "Focus" },
  { id: "model", label: "Model" },
  { id: "tools", label: "Tools" },
] as const;
export type TrainingSubTab = (typeof TRAINING_SUB_TABS)[number]["id"];

/** Half-life of the live-outcome blend (BUILD §11.10: `w = n / (n + 20)`). */
export const BLEND_HALF_LIFE = 20;

export function toIso(d: Iso): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function toMillis(d: Iso): number {
  const iso = toIso(d);
  return iso ? Date.parse(iso) : 0;
}

const ACRONYMS: Record<string, string> = { api: "API", seo: "SEO", ui: "UI", ux: "UX", sql: "SQL", rfq: "RFQ", qa: "QA", crm: "CRM", pr: "PR", ads: "Ads", a11y: "Accessibility" };

/**
 * `api_design` → "API design"; `knowing_when_to_ask` → "Knowing when to ask". Keys keep their British spelling, the words
 * read US English (`prioritisation` → "Prioritization", `categoriser` → "Categorizer"), and a `holiday` key is the
 * founder's away mode, which reads "Vacation" (`holiday.read_authority` → "Vacation read authority").
 */
export function humaniseKey(key: string): string {
  const words = key.split(/[_\-\s]+/).filter(Boolean);
  const text = words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (Object.hasOwn(ACRONYMS, lower)) return ACRONYMS[lower]; // own keys only: "constructor" is a word, not a member
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
  return usSpelling(text).replace(/\b([Hh])olidays?\b/g, (m, h: string) => `${h === "H" ? "V" : "v"}acation${m.endsWith("s") ? "s" : ""}`);
}

export function clampRating(v: number): number {
  return Math.max(1, Math.min(20, Math.round(v)));
}

/** AC-11.10.3: `skill = w * proven + (1 - w) * tested`, `w = n / (n + 20)`; without live outcomes the tested rating stands. */
export function blendDisplayed(tested: number | null, proven: number | null, nLive: number): number {
  if (tested === null && proven === null) return 1;
  if (proven === null || nLive <= 0) return clampRating(tested ?? 1);
  if (tested === null) return clampRating(proven);
  const w = nLive / (nLive + BLEND_HALF_LIFE);
  return clampRating(w * proven + (1 - w) * tested);
}

export function asNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The most recent promoted run with per-skill results: its deltas are the ▲/▼ arrows on the SkillGrid. */
export function latestPromotedRun(runs: readonly TrainingRunRecord[]): TrainingRunRecord | null {
  return runs.filter((r) => r.decision === "promoted" && r.results && Object.keys(r.results).length > 0).sort((a, b) => toMillis(b.endedAt ?? b.createdAt) - toMillis(a.endedAt ?? a.createdAt))[0] ?? null;
}

/**
 * The SkillGrid rows. A skill the business added (custom, from the library or a file) reads under its own name; one
 * with no tested rating yet (added and not yet scored by a training run) is marked "Untested", its value the baseline.
 */
export function toSkillRows(skills: readonly AgentSkillRecord[], runs: readonly TrainingRunRecord[] = []): SkillRow[] {
  const promoted = latestPromotedRun(runs);
  return skills.map((s) => {
    const tested = asNumber(s.tested);
    const proven = asNumber(s.proven);
    const value = s.displayed > 0 ? s.displayed : blendDisplayed(tested, proven, s.nLive);
    const r = promoted?.results?.[s.skillKey];
    return {
      id: s.skillKey,
      name: ("name" in s && s.name) || humaniseKey(s.skillKey),
      ...(tested === null && proven === null ? { note: "Untested" } : {}),
      group: s.group,
      value,
      delta: r ? Math.round(r.new - r.old) : undefined,
      tested: tested === null ? undefined : Math.round(tested),
      proven: proven === null ? undefined : Math.round(proven),
      tasks: s.nLive,
      potential: s.potential,
    };
  });
}

export function meanRating(rows: readonly { value: number }[]): number | null {
  if (!rows.length) return null;
  return Math.round((rows.reduce((s, r) => s + r.value, 0) / rows.length) * 10) / 10;
}

/** 1–20 mean → 0–5 stars in halves. */
export function starsFor(rating: number | null): number | undefined {
  if (rating === null) return undefined;
  return Math.max(0.5, Math.min(5, Math.round((rating / 4) * 2) / 2));
}

export interface PositionFit extends PositionRole {
  rating: number;
  templateKey: string;
  coverage: number;
}

/**
 * Position map (DESIGN §9): every template of the same family is a role the agent could play. Fit = mean of the
 * agent's displayed ratings over the template's skills (missing skills count as 5, "untested"), weighted by how much of
 * the template's craft the agent covers. The agent's own template is always listed and marked current.
 */
export function positionFits(agent: Pick<AgentRow, "agentType" | "layer">, skills: readonly SkillRow[], catalogue: readonly CatalogueTemplate[], max = 8): PositionFit[] {
  const byKey = new Map(skills.map((s) => [s.id, s.value]));
  const own = catalogue.find((t) => t.key === agent.agentType);
  const family = own?.family;
  const candidates = catalogue.filter((t) => (family ? t.family === family : t.layer === agent.layer));
  const fits: PositionFit[] = candidates.map((t) => {
    const keys = t.skills.length ? t.skills : [...byKey.keys()];
    const covered = keys.filter((k) => byKey.has(k));
    const coverage = keys.length ? covered.length / keys.length : 0;
    const mean = keys.length ? keys.reduce((s, k) => s + (byKey.get(k) ?? 5), 0) / keys.length : 1;
    const rating = clampRating(mean * (0.6 + 0.4 * coverage));
    return { id: t.key, templateKey: t.key, label: t.role || t.name, rating, level: positionLevelFor(rating), coverage: Math.round(coverage * 100) / 100 };
  });
  const sorted = fits.sort((a, b) => (a.templateKey === agent.agentType ? -1 : b.templateKey === agent.agentType ? 1 : b.rating - a.rating));
  return sorted.slice(0, max);
}

export function traitsFor(traits: readonly string[], instructions?: AgentInstructions | null): Trait[] {
  const lines = instructions ? [...instructions.rules, ...instructions.playbook, ...instructions.goals] : [];
  return traits.map((label, i) => {
    const words = label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const derivedFrom = lines.find((l) => words.some((w) => l.toLowerCase().includes(w)));
    const tone: Trait["tone"] = /asks|never|checks|tests/i.test(label) ? "good" : /spends|skips|rushes/i.test(label) ? "warn" : "neutral";
    return { id: `${i}-${label}`, label, derivedFrom, tone };
  });
}

/** Skill history: each finished run with results is a point (`new`) at its end; the current displayed value closes the line. */
export function developmentSeries(skills: readonly SkillRow[], runs: readonly TrainingRunRecord[], now: Date = new Date(), maxSeries = 5): SkillHistorySeries[] {
  const finished = runs.filter((r) => r.results && Object.keys(r.results).length > 0 && (r.endedAt ?? r.createdAt)).sort((a, b) => toMillis(a.endedAt ?? a.createdAt) - toMillis(b.endedAt ?? b.createdAt));
  const chosen = skills
    .slice()
    .sort((a, b) => (a.group === "craft" ? -1 : 1) - (b.group === "craft" ? -1 : 1) || b.value - a.value)
    .slice(0, maxSeries);
  return chosen.map((s) => {
    const points: SkillHistorySeries["points"] = [];
    for (const r of finished) {
      const res = r.results?.[s.id];
      const at = toIso(r.endedAt ?? r.createdAt);
      if (!res || !at) continue;
      if (points.length === 0) points.push({ at: toIso(r.startedAt ?? r.createdAt) ?? at, value: clampRating(res.old) });
      // A canceled run never applied, like a discarded one: a retest withdrawn by a later model change keeps its results.
      points.push({ at, value: clampRating(r.decision === "promoted" || (r.decision === null && r.status !== "cancelled") ? res.new : res.old) });
    }
    points.push({ at: now.toISOString(), value: s.value });
    return { skillId: s.id, name: s.name, points };
  });
}

export function trainingSessionMarks(runs: readonly TrainingRunRecord[]): TrainingSessionMark[] {
  return runs
    .filter((r) => r.decision !== null && (r.endedAt ?? r.createdAt))
    .map((r) => ({ at: toIso(r.endedAt ?? r.createdAt)!, label: `Training run${r.toVersionId ? "" : ""} · ${r.status}`, promoted: r.decision === "promoted" }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Stored `instructions` jsonb → the editor's shape; unknown example shapes become empty pairs. */
export function parseInstructions(raw: unknown): AgentInstructions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const examples = Array.isArray(o.examples)
    ? o.examples.map((e) => {
        const ex = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
        return { input: str(ex.input), output: str(ex.output) };
      })
    : [];
  return { role: str(o.role), goals: list(o.goals), rules: list(o.rules), playbook: list(o.playbook), tone: str(o.tone), examples };
}

export function instructionVersions(versions: readonly AgentVersionRecord[], viewer?: { userId: string | null; email: string | null }): InstructionVersion[] {
  return versions
    .slice()
    .sort((a, b) => b.version - a.version)
    .map((v) => ({
      version: v.version,
      createdAt: toIso(v.createdAt) ?? new Date(0).toISOString(),
      author: v.createdByKind === "user" ? (viewer && v.createdBy === viewer.userId ? "You" : "Founder") : v.createdByKind === "agent" ? "Coach" : "System",
      state: v.state,
      instructions: parseInstructions(v.instructions),
    }));
}

export function currentVersion(profile: Pick<AgentProfile, "agent" | "versions">): AgentVersionRecord | null {
  return profile.versions.find((v) => v.id === profile.agent.currentVersionId) ?? profile.versions.find((v) => v.state === "live") ?? null;
}

/**
 * A model change's retest copy (agent.model.set): the live version copied by the system onto the new model. The
 * system's only other versions are an agent's first (version 1, set up with the business or a clone).
 */
export function isRetestVersion(v: Pick<AgentVersionRecord, "createdByKind" | "version">): boolean {
  return v.createdByKind === "system" && v.version > 1;
}

/** A run that retests a model change: it scores a retest copy, or (the old shape, never started) the live version itself. */
export function isRetestRun(run: Pick<TrainingRunRecord, "fromVersionId" | "toVersionId">, versions: readonly AgentVersionRecord[]): boolean {
  if (run.toVersionId && run.fromVersionId === run.toVersionId) return true;
  const candidate = versions.find((v) => v.id === run.toVersionId);
  return !!candidate && isRetestVersion(candidate);
}

/** The newest draft the founder or the Coach wrote: the editing base. A retest copy never is, so it cannot replace a draft in progress. */
export function latestDraft(versions: readonly AgentVersionRecord[]): AgentVersionRecord | null {
  return versions.filter((v) => v.state === "draft" && !isRetestVersion(v)).sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Map the API's club-rule violations (offending line + reason) onto the editor's section/index flags (AC-11.10.4). */
export function violationsToEditor(violations: readonly { line: string; reason: string }[], instructions: AgentInstructions): InstructionViolation[] {
  const out: InstructionViolation[] = [];
  const norm = (s: string) => s.trim().toLowerCase();
  for (const v of violations) {
    const needle = norm(v.line.replace(/^[a-z]+:\s*/i, ""));
    const lists: [InstructionSection, string[]][] = [
      ["rules", instructions.rules],
      ["playbook", instructions.playbook],
      ["goals", instructions.goals],
    ];
    let placed = false;
    for (const [section, items] of lists) {
      const index = items.findIndex((it) => norm(it) === needle || (needle.length > 8 && norm(it).includes(needle)));
      if (index >= 0) {
        out.push({ section, index, reason: v.reason });
        placed = true;
        break;
      }
    }
    if (placed) continue;
    const exIndex = instructions.examples.findIndex((e) => norm(e.output) === needle || norm(e.input) === needle);
    if (exIndex >= 0) out.push({ section: "examples", index: exIndex, reason: v.reason });
    else if (norm(instructions.role) === needle) out.push({ section: "role", reason: v.reason });
    else if (norm(instructions.tone) === needle) out.push({ section: "tone", reason: v.reason });
    else out.push({ section: "rules", index: 0, reason: v.reason });
  }
  return out;
}

export const ACTIVE_RUN_STATUSES = ["queued", "running", "grading"] as const;
export type TrainingPhase = "idle" | "active" | "awaiting" | "watch" | "failed";

export interface TrainingFlow {
  phase: TrainingPhase;
  /** Queued/running/grading run. */
  active: TrainingRunRecord | null;
  /** Finished, undecided run with results. */
  awaiting: TrainingRunRecord | null;
  /** Promoted run inside its 7-day watch window. */
  watch: { run: TrainingRunRecord; until: string; daysLeft: number } | null;
  failed: TrainingRunRecord | null;
}

/**
 * Where the agent's training stands. The seven-day watch belongs to the version a promotion made live: given the
 * agent's live version (`liveVersionId`), a promoted run whose version is no longer live (rolled back since) has no
 * watch, so no banner offers a rollback the agent has already had.
 */
export function trainingFlow(runs: readonly TrainingRunRecord[], now: Date = new Date(), liveVersionId?: string | null): TrainingFlow {
  const byRecency = runs.slice().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  const active = byRecency.find((r) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status)) ?? null;
  const awaiting = byRecency.find((r) => r.decision === null && (r.status === "awaiting_decision" || r.status === "done")) ?? null;
  const promoted = byRecency.find((r) => r.decision === "promoted" && r.watchUntil && toMillis(r.watchUntil) > now.getTime() && (liveVersionId === undefined || r.toVersionId === liveVersionId)) ?? null;
  const watch = promoted ? { run: promoted, until: toIso(promoted.watchUntil)!, daysLeft: Math.max(0, Math.ceil((toMillis(promoted.watchUntil) - now.getTime()) / 86_400_000)) } : null;
  const failed = byRecency[0]?.status === "failed" ? byRecency[0] : null;
  const phase: TrainingPhase = active ? "active" : awaiting ? "awaiting" : failed ? "failed" : watch ? "watch" : "idle";
  return { phase, active, awaiting, watch, failed };
}

export const RUN_PHASE_LABEL: Record<string, string> = { queued: "Queued", running: "Running tests", grading: "Grading", awaiting_decision: "Awaiting your decision", done: "Done", failed: "Failed", cancelled: "Canceled" };

/** A run still queued after this long has most likely lost its worker; the tab says so next to Cancel. */
export const STALLED_RUN_MINUTES = 10;
export function runStalled(run: Pick<TrainingRunRecord, "status" | "createdAt">, now: Date = new Date()): boolean {
  return run.status === "queued" && now.getTime() - toMillis(run.createdAt) > STALLED_RUN_MINUTES * 60_000;
}

/** Progress of an active run from its status and elapsed time against the estimate (Estimate; never token-based). */
export function runProgress(run: Pick<TrainingRunRecord, "status" | "startedAt" | "createdAt">, estimateMinutes: number, now: Date = new Date()): number {
  if (run.status === "queued") return 0.05;
  if (run.status === "grading") return 0.85;
  if (run.status === "awaiting_decision" || run.status === "done") return 1;
  const started = toMillis(run.startedAt ?? run.createdAt);
  if (!started) return 0.1;
  const frac = (now.getTime() - started) / Math.max(1, estimateMinutes * 60_000);
  return Math.max(0.1, Math.min(0.8, 0.1 + frac * 0.7));
}

/**
 * A run's results as the Results panel shows them: under the skills' names (a library, file or custom skill reads as
 * the founder named it), with the test count for the hover. A skill the run found no tests for (`tests` 0) is marked
 * `noTests`: it reads "No tests yet" and keeps its rating when the run is promoted.
 */
export function toTrainingResults(results: TrainingResultsRecord, skills: readonly AgentSkillRecord[]): TrainingSkillResult[] {
  const byKey = new Map(skills.map((s) => [s.skillKey, s]));
  return results.deltas.map((d) => {
    const s = byKey.get(d.skillKey);
    const noTests = d.tests === 0;
    const count = results.publicTestCounts[d.skillKey];
    return {
      id: d.skillKey,
      name: (s && "name" in s && s.name) || humaniseKey(d.skillKey),
      group: (s?.group ?? "craft") as SkillGroup,
      before: clampRating(d.old),
      after: clampRating(d.new),
      ...(noTests ? { noTests: true } : {}),
      tests: !noTests && count !== undefined ? { run: count, passed: Math.round((count * clampRating(d.new)) / 20) } : undefined,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Focus and Coach proposals (BUILD §11.10 Training › Focus)
// ---------------------------------------------------------------------------------------------------------------------

export const FOCUS_STORAGE_PREFIX = "fm:focus:";

export function readFocus(agentId: string): string[] {
  try {
    const raw = window.localStorage.getItem(FOCUS_STORAGE_PREFIX + agentId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}
export function writeFocus(agentId: string, ids: readonly string[]): void {
  try {
    window.localStorage.setItem(FOCUS_STORAGE_PREFIX + agentId, JSON.stringify(ids.slice(0, 3)));
  } catch {
    /* private mode */
  }
}

export interface CoachProposal {
  id: string;
  skillId: string;
  skillName: string;
  section: "rules" | "playbook" | "examples";
  text: string;
  /** Expected gain in rating points (Estimate: 40 % of the gap to potential, at least 1 when there is a gap). */
  expectedGain: number;
}

const PROPOSAL_TEMPLATES: Record<string, { section: CoachProposal["section"]; text: string }[]> = {
  testing: [{ section: "playbook", text: "Write the failing test before the implementation and run the full suite before opening a pull request." }],
  debugging: [{ section: "playbook", text: "Reproduce the bug with a minimal failing case and record the root cause in the pull request description." }],
  speed: [{ section: "rules", text: "Time-box exploration to 15 minutes; after that, ask or ship the simplest safe version." }],
  reliability: [{ section: "rules", text: "Never report a task done until acceptance tests pass in a clean sandbox." }],
  cost_efficiency: [{ section: "rules", text: "Reuse cached context and avoid re-reading files you already summarized in this session." }],
  communication: [{ section: "playbook", text: "End every session with a three-line note: what changed, what is risky, what you need from the founder." }],
  knowing_when_to_ask: [{ section: "rules", text: "Ask before any action that spends money, contacts a third party or changes a schema." }],
  risk_awareness: [{ section: "rules", text: "List the two most likely ways the change could break production before starting." }],
  scope_control: [{ section: "rules", text: "Do only what the task asks; log unrelated improvements as follow-ups instead of doing them." }],
  prioritisation: [{ section: "playbook", text: "Order work by customer impact first, then by risk, then by effort." }],
  planning: [{ section: "playbook", text: "Write a numbered plan with acceptance criteria before touching code." }],
  deliverability: [{ section: "rules", text: "Check the suppression list and the sender's warm-up status before every send." }],
  copywriting: [{ section: "examples", text: "Subject lines under 45 characters; one call to action per email." }],
};

export function coachProposals(focus: readonly string[], skills: readonly SkillRow[]): CoachProposal[] {
  const out: CoachProposal[] = [];
  for (const id of focus) {
    const skill = skills.find((s) => s.id === id);
    if (!skill) continue;
    const gap = Math.max(0, (skill.potential ?? skill.value) - skill.value);
    const expectedGain = gap > 0 ? Math.max(1, Math.round(gap * 0.4)) : 0;
    const templates = PROPOSAL_TEMPLATES[id] ?? [{ section: "playbook" as const, text: `Add a step that exercises ${humaniseKey(id).toLowerCase()} on every task and records the outcome in the session note.` }];
    templates.forEach((t, i) => out.push({ id: `${id}-${i}`, skillId: id, skillName: skill.name, section: t.section, text: t.text, expectedGain }));
  }
  return out;
}

export function applyProposal(instructions: AgentInstructions, proposal: CoachProposal): AgentInstructions {
  if (proposal.section === "examples") return { ...instructions, examples: [...instructions.examples, { input: `Task touching ${proposal.skillName.toLowerCase()}`, output: proposal.text }] };
  const list = instructions[proposal.section];
  if (list.includes(proposal.text)) return instructions;
  return { ...instructions, [proposal.section]: [...list, proposal.text] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Model (BUILD §11.10 "Model selection")
// ---------------------------------------------------------------------------------------------------------------------

export const MODEL_DESCRIPTIONS: Record<ModelKey, string> = {
  opus: "Deepest judgment; the default for the Chief of Staff and leads.",
  sonnet: "Fast and capable; the default for workers.",
  haiku: "Cheapest; classification, linking and other utility work.",
};
const MODEL_RANK: Record<ModelKey, number> = { opus: 3, sonnet: 2, haiku: 1 };

export function isChiefOfStaff(agent: Pick<AgentRow, "agentType" | "layer">): boolean {
  return agent.agentType === "chief_of_staff" || agent.layer === "assistant";
}
/** Routes `packages/models` locks to Opus (BUILD §10.1: the Inbox Composer and the plan compiler). */
export function isComposerRoute(route: string): boolean {
  return route === "inboxComposer" || route === "planCompiler";
}

export function agentTypeNoun(agent: Pick<AgentRow, "agentType" | "role" | "layer">): string {
  if (agent.agentType) return humaniseKey(agent.agentType).toLowerCase();
  return agent.role?.toLowerCase() || agent.layer;
}

export function modelOptions(compare: ModelCompare, currency: string): ModelOption[] {
  const current = compare.options.find((o) => o.modelKey === compare.current);
  const base = current?.predictedWageMinor ?? 0;
  return compare.options.map((o) => ({
    key: o.modelKey,
    label: MODEL_LABELS[o.modelKey],
    description: MODEL_DESCRIPTIONS[o.modelKey],
    skillDelta: o.predictedSkillDelta ?? null,
    wageDelta: { amountMinor: o.predictedWageMinor - base, currency: compare.currency ?? currency },
    lockedReason: o.allowed ? undefined : (o.warning ?? "Locked for this agent's route."),
    warning: o.allowed && o.warning ? o.warning : undefined,
  }));
}

/** Warnings shown before the scope dialog: Chief of Staff downgrade, Composer lock (BUILD §11.10 exceptions). */
export function modelChangeWarnings(agent: Pick<AgentRow, "agentType" | "layer" | "modelKey">, route: string, candidate: ModelKey): string[] {
  const out: string[] = [];
  if (isComposerRoute(route)) out.push("The Inbox Composer is locked to Opus; this model cannot change.");
  if (isChiefOfStaff(agent) && MODEL_RANK[candidate] < MODEL_RANK[agent.modelKey]) out.push(`Downgrading the Chief of Staff to ${MODEL_LABELS[candidate]} weakens cycle planning and every decision it makes for you. Expect lower Judgment ratings.`);
  return out;
}

export function describeModelSet(result: ModelSetResult, modelKey: ModelKey): string {
  const parts = [`Model set to ${MODEL_LABELS[modelKey]} for ${result.updated.length} ${result.updated.length === 1 ? "agent" : "agents"}`];
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped (${[...new Set(result.skipped.map((s) => s.reason))].join("; ")})`);
  // While the team is stopped the retests wait for Resume agents (they spend credits); the model changes at once.
  if (result.retests.length) parts.push(`${result.retests.length} ${result.retests.length === 1 ? "retest" : "retests"} queued${result.retestsWaitForResume ? ` (${result.retests.length === 1 ? "starts" : "start"} when the agents resume)` : ""}`);
  // Retests of a model the agents no longer run, still in flight or awaiting a decision, were canceled (agent.model.set).
  if (result.superseded.length) parts.push(`${result.superseded.length} earlier ${result.superseded.length === 1 ? "retest" : "retests"} canceled`);
  if (result.warnings.length) parts.push(result.warnings.join("; "));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------------------------------
// Autonomy and negotiation (BUILD §9.2, §9.6)
// ---------------------------------------------------------------------------------------------------------------------

export type AutonomyMode = "inherit" | "lower" | "higher";
export interface AutonomyForm {
  mode: AutonomyMode;
  spendCapMinor: number | null;
  approvalThresholdMinor: number | null;
}
export interface NegotiationForm {
  enabled: boolean;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  walkAwayMinor: number | null;
  maxConcessionPct: number | null;
  topics: string[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function autonomyFromAgent(raw: unknown): AutonomyForm {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = o.mode === "lower" || o.mode === "higher" ? o.mode : "inherit";
  return { mode, spendCapMinor: num(o.spendCapMinor), approvalThresholdMinor: num(o.approvalThresholdMinor) };
}

export function negotiationFromAgent(raw: unknown): NegotiationForm {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    priceMinMinor: num(o.priceMinMinor),
    priceMaxMinor: num(o.priceMaxMinor),
    walkAwayMinor: num(o.walkAwayMinor),
    maxConcessionPct: num(o.maxConcessionPct),
    topics: Array.isArray(o.topics) ? o.topics.filter((t): t is string => typeof t === "string") : [],
  };
}

export const AUTONOMY_MODE_COPY: Record<AutonomyMode, { label: string; description: string }> = {
  inherit: { label: "Follow the business mode", description: "Acts and asks exactly as the business mode says." },
  lower: { label: "Ask more often", description: "One notch more cautious than the business mode: every external action and spend becomes a decision for you." },
  higher: { label: "Act more freely", description: "One notch more autonomous than the business mode, within the caps below. Hard gates still apply." },
};

/**
 * What the Autonomy tab edits. Money and the percentage stay the text the founder typed ("250", "1,250.50", "25k")
 * while they type; they become minor units only when read for validation and save (`readAutonomyDraft`). Rewriting
 * the field from minor units on every keystroke turned "25" into "2.01" (audit WEB-03).
 */
export interface AutonomyDraft {
  mode: AutonomyMode;
  spendCap: string;
  approvalThreshold: string;
}
export interface NegotiationDraft {
  enabled: boolean;
  priceMin: string;
  priceMax: string;
  walkAway: string;
  maxConcession: string;
  topics: string[];
}

export function autonomyDraft(form: AutonomyForm): AutonomyDraft {
  return { mode: form.mode, spendCap: formatMajor(form.spendCapMinor), approvalThreshold: formatMajor(form.approvalThresholdMinor) };
}
export function negotiationDraft(form: NegotiationForm): NegotiationDraft {
  return { enabled: form.enabled, priceMin: formatMajor(form.priceMinMinor), priceMax: formatMajor(form.priceMaxMinor), walkAway: formatMajor(form.walkAwayMinor), maxConcession: form.maxConcessionPct === null ? "" : String(form.maxConcessionPct), topics: form.topics };
}
/** The draft in minor units. Text that is not an amount reads as NaN, which validation names instead of saving a guess. */
export function readAutonomyDraft(draft: AutonomyDraft): AutonomyForm {
  return { mode: draft.mode, spendCapMinor: parseMajor(draft.spendCap), approvalThresholdMinor: parseMajor(draft.approvalThreshold) };
}
export function readNegotiationDraft(draft: NegotiationDraft): NegotiationForm {
  return { enabled: draft.enabled, priceMinMinor: parseMajor(draft.priceMin), priceMaxMinor: parseMajor(draft.priceMax), walkAwayMinor: parseMajor(draft.walkAway), maxConcessionPct: parsePercent(draft.maxConcession), topics: draft.topics };
}

const AMOUNT_HINT = "as an amount, like 250 or 12.50";

/** Mirrors the API's rules: negotiation needs a walk-away and at least one price limit; caps must be non-negative. */
export function validateNegotiation(form: NegotiationForm): string | null {
  // Unreadable text is refused even with negotiation off: the limits are saved either way.
  if (Number.isNaN(form.priceMinMinor)) return `Enter the price floor ${AMOUNT_HINT}.`;
  if (Number.isNaN(form.priceMaxMinor)) return `Enter the price ceiling ${AMOUNT_HINT}.`;
  if (Number.isNaN(form.walkAwayMinor)) return `Enter the walk-away amount ${AMOUNT_HINT}.`;
  if (form.maxConcessionPct !== null && !(form.maxConcessionPct >= 0 && form.maxConcessionPct <= 100)) return "Max concession is a percentage between 0 and 100.";
  if ([form.priceMinMinor, form.priceMaxMinor, form.walkAwayMinor].some((v) => v !== null && v < 0)) return "Negotiation limits cannot be negative.";
  if (!form.enabled) return null;
  if (form.walkAwayMinor === null) return "Set a walk-away amount before enabling negotiation.";
  if (form.priceMinMinor === null && form.priceMaxMinor === null) return "Set a price floor or a price ceiling before enabling negotiation.";
  if (form.priceMinMinor !== null && form.priceMaxMinor !== null && form.priceMinMinor > form.priceMaxMinor) return "The price floor is above the ceiling.";
  return null;
}
export function validateAutonomy(form: AutonomyForm): string | null {
  if (Number.isNaN(form.spendCapMinor)) return `Enter the spend cap ${AMOUNT_HINT}.`;
  if (Number.isNaN(form.approvalThresholdMinor)) return `Enter the approval threshold ${AMOUNT_HINT}.`;
  if (form.spendCapMinor !== null && form.spendCapMinor < 0) return "The spend cap cannot be negative.";
  if (form.approvalThresholdMinor !== null && form.approvalThresholdMinor < 0) return "The approval threshold cannot be negative.";
  // A zero cap is the default "no spending of its own" (every spend asks), not a conflict with the threshold.
  if (form.spendCapMinor !== null && form.spendCapMinor > 0 && form.approvalThresholdMinor !== null && form.approvalThresholdMinor > form.spendCapMinor) return "The approval threshold is above the spend cap, so it would never trigger.";
  return null;
}

export function autonomyToInput(form: AutonomyForm): { mode: AutonomyMode; spendCapMinor?: number; approvalThresholdMinor?: number } {
  return { mode: form.mode, ...(form.spendCapMinor !== null ? { spendCapMinor: form.spendCapMinor } : {}), ...(form.approvalThresholdMinor !== null ? { approvalThresholdMinor: form.approvalThresholdMinor } : {}) };
}
export function negotiationToInput(form: NegotiationForm): { enabled: boolean; priceMinMinor?: number; priceMaxMinor?: number; walkAwayMinor?: number; maxConcessionPct?: number; topics: string[] } {
  return {
    enabled: form.enabled,
    ...(form.priceMinMinor !== null ? { priceMinMinor: form.priceMinMinor } : {}),
    ...(form.priceMaxMinor !== null ? { priceMaxMinor: form.priceMaxMinor } : {}),
    ...(form.walkAwayMinor !== null ? { walkAwayMinor: form.walkAwayMinor } : {}),
    ...(form.maxConcessionPct !== null ? { maxConcessionPct: form.maxConcessionPct } : {}),
    topics: form.topics,
  };
}

/**
 * A typed amount in minor units: "12.50" → 1250, "1,250" → 125000 (the comma groups thousands, US English), "25k" →
 * 2500000 (the shorthand MoneyInput expands at rest), blank → null. Anything else, a fraction of a cent included, is
 * NaN: the form says so instead of saving a different number.
 */
export function parseMajor(text: string): number | null {
  const t = text.trim().replace(/[\s,'_$£€¥]/g, "");
  if (!t) return null;
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))([kmb])?$/i.exec(t);
  if (!m) return Number.NaN;
  const [, sign, int = "0", fracA, fracB, unit] = m;
  // Shift the decimal point on the digits themselves (cents, plus the shorthand's thousands), so no float rounding.
  const shift = 2 + (unit ? { k: 3, m: 6, b: 9 }[unit.toLowerCase() as "k" | "m" | "b"] : 0);
  const frac = (fracA ?? fracB ?? "").padEnd(shift, "0");
  if (/[^0]/.test(frac.slice(shift))) return Number.NaN;
  const minor = Number(`${int}${frac.slice(0, shift)}`);
  if (!Number.isSafeInteger(minor)) return Number.NaN;
  return sign === "-" && minor !== 0 ? -minor : minor;
}
/** A stored amount as the text its field starts from: 25000 → "250", 1250 → "12.50", null → "". */
export function formatMajor(minor: number | null): string {
  if (minor === null || !Number.isFinite(minor)) return "";
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}
/** "15" or "12.5%" → the number; blank → null; anything else → NaN. */
export function parsePercent(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!t) return null;
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tools (BUILD §11.10 Training › Tools, "Tools and permissions")
// ---------------------------------------------------------------------------------------------------------------------

export interface ToolGrant {
  connectorKey: string;
  tools: string[];
}

export function parseToolGrants(raw: unknown): ToolGrant[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolGrant[] = [];
  for (const g of raw) {
    if (typeof g === "string") out.push({ connectorKey: g, tools: [] });
    else if (g && typeof g === "object") {
      const o = g as Record<string, unknown>;
      if (typeof o.connectorKey === "string") out.push({ connectorKey: o.connectorKey, tools: Array.isArray(o.tools) ? o.tools.filter((t): t is string => typeof t === "string") : [] });
    }
  }
  return out;
}

export function toggleToolGrant(grants: readonly ToolGrant[], connectorKey: string, tool: string): ToolGrant[] {
  const existing = grants.find((g) => g.connectorKey === connectorKey);
  if (!existing) return [...grants, { connectorKey, tools: [tool] }];
  const tools = existing.tools.includes(tool) ? existing.tools.filter((t) => t !== tool) : [...existing.tools, tool];
  const next = grants.map((g) => (g.connectorKey === connectorKey ? { ...g, tools } : g));
  return next.filter((g) => g.tools.length > 0);
}

export function grantsEqual(a: readonly ToolGrant[], b: readonly ToolGrant[]): boolean {
  const key = (gs: readonly ToolGrant[]) =>
    gs
      .map((g) => `${g.connectorKey}:${g.tools.slice().sort().join(",")}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

/**
 * True when `next` grants a tool `live` does not (`connector:*` covers every tool of its connector). Giving an agent new
 * tools is an owner's or admin's call (the api refuses anyone else, SEC-7); removing tools is anyone's with Team write.
 */
export function grantsWiden(live: readonly ToolGrant[], next: readonly ToolGrant[]): boolean {
  const has = new Set(live.flatMap((g) => g.tools.map((t) => `${g.connectorKey}:${t}`)));
  return next.some((g) => g.tools.some((t) => !has.has(`${g.connectorKey}:${t}`) && !has.has(`${g.connectorKey}:*`)));
}

export function grantedTools(grants: readonly ToolGrant[]): number {
  return grants.reduce((s, g) => s + g.tools.length, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessions (Logs tab)
// ---------------------------------------------------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  model: ModelKey;
  tokens: number;
  costMinor: number;
  currency: string;
  outcome: string;
  taskId: string | null;
  /** The task's title, when the session worked on one that still exists. */
  taskTitle: string | null;
  live: boolean;
  recordingRef: string | null;
}

export function sessionRows(sessions: readonly SessionRecord[], now: Date = new Date()): SessionRow[] {
  return sessions
    .map((s) => {
      const startedAt = toIso(s.startedAt) ?? now.toISOString();
      const endedAt = toIso(s.endedAt);
      return {
        id: s.id,
        startedAt,
        endedAt,
        durationMs: Math.max(0, (endedAt ? Date.parse(endedAt) : now.getTime()) - Date.parse(startedAt)),
        model: s.modelKey,
        tokens: Number(s.tokensIn ?? 0) + Number(s.tokensOut ?? 0),
        costMinor: Number(s.costMinor ?? 0),
        currency: MODEL_COST_CURRENCY, // model costs are always dollars, whatever currency the business keeps its books in
        outcome: s.outcome ?? (endedAt ? "ended" : "running"),
        taskId: s.taskId ?? null,
        taskTitle: s.task?.title ?? null,
        live: !endedAt,
        recordingRef: s.recordingRef ?? null,
      };
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** "completed" → "Completed", "partially_accepted" → "Partially accepted": an outcome or state as a word. */
export function outcomeWord(outcome: string): string {
  const w = outcome.replace(/_/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "Ended";
}

export const OUTCOME_TONE: Record<string, "good" | "warn" | "bad" | "info" | "neutral"> = { success: "good", succeeded: "good", done: "good", partial: "warn", failure: "bad", failed: "bad", stopped: "warn", running: "info", ended: "neutral" };

// ---------------------------------------------------------------------------------------------------------------------
// Header facts and status
// ---------------------------------------------------------------------------------------------------------------------

export function departmentColour(profile: Pick<AgentProfile, "departments">): DeptColourToken {
  return profile.departments[0]?.colourToken ?? "dept-1";
}

export function statusWord(status: AgentStatus): string {
  return ({ healthy: "Healthy", degraded: "Degraded", failing: "Failing", injured: "Down", paused: "Paused", idle: "Idle" } as Record<AgentStatus, string>)[status];
}

// ---------------------------------------------------------------------------------------------------------------------
// Founder copy from instruction text (the instructions are written to the model; the profile speaks to the founder)
// ---------------------------------------------------------------------------------------------------------------------

/** Ids the instructions name that read as plain words on the profile. */
const PLAIN_IDS: Record<string, string> = {
  request_human_action: "a task for you",
  reply_only: "a clarifying question",
  "cycle.completed": "a cycle summary",
  "plans.compile": "plan compiling",
  "inbox.decide": "your decision",
};

/** "The" → "You", "the" → "you": the replacement keeps the sentence's capital. */
const sameCase = (original: string, word: string): string => (original[0] === original[0]!.toUpperCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word);

const YOU_FORMS: Readonly<Record<string, string>> = { has: "have", is: "are", was: "were", does: "do", goes: "go" };
/** A third-person verb in the form "you" takes ("gets" → "get", "pushes" → "push", "applies" → "apply"); anything else stays. */
function youVerb(word: string): string {
  const w = word.toLowerCase();
  if (Object.hasOwn(YOU_FORMS, w)) return YOU_FORMS[w]!;
  if (!/^[a-z]{2,}s$/.test(w) || /(?:ss|us|is)$/.test(w)) return word;
  if (/[^aeiou]ies$/.test(w)) return `${word.slice(0, -3)}y`;
  if (/(?:sh|ch|x|z|ss)es$/.test(w)) return word.slice(0, -2);
  return word.slice(0, -1);
}

/**
 * Instruction prose → founder prose: build references and ids out ("(BUILD §2.2)", `request_human_action` → "a task
 * for you", other snake_case or dotted ids → words), and the model's jargon in plain words ("agent ids" → "agents").
 */
export function founderPlain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    // Build-plan references are for the team that builds the product, never the founder.
    .replace(/\s*\(BUILD\s*§\s*[\d.]+\)/g, "")
    .replace(/\(BUILD\s*§\s*[\d.]+\s*[:;,]\s*/g, "(")
    .replace(/\s*(?:—|–|-)\s*BUILD\s*§\s*[\d.]+\s*\)/g, ")")
    .replace(/\s*(?:—|–|-)\s*BUILD\s*§\s*[\d.]+\s*[:;,]?\s*/g, "; ")
    .replace(/\s*BUILD\s*§\s*[\d.]+\s*[:;,]?/g, "")
    .replace(/\b[a-z][a-z0-9]*(?:[_.][a-z0-9]+)+\b/g, (id) => PLAIN_IDS[id] ?? id.replace(/[_.]+/g, " "))
    .replace(/\bagent ids\b/gi, "agents")
    .replace(/\bevidence ids\b/gi, "evidence")
    .replace(/\brecord ids?\b/gi, (m) => (m.toLowerCase().endsWith("s") ? "source records" : "source record"))
    .replace(/\bthe Inbox Composer\b/g, "the Inbox")
    .replace(/\btyped actions\b/g, "concrete actions")
    .replace(/\btyped Plans\b/g, "plans")
    .replace(/(?<=[a-z,] )Plan(s?)\b/g, "plan$1")
    .replace(/\bper hunk\b/g, "change by change")
    // The profile speaks to the founder: "the founder" is "you".
    .replace(/\b(?:a|every|each) founder reply\b/gi, (m) => `${m.split(" ")[0]} reply from you`)
    .replace(/\bfounder replies\b/gi, "replies from you")
    .replace(/\b(the) founder's\b/gi, (_m, the: string) => sameCase(the, "your"))
    // A noun after "founder" is the founder's own: "from the founder profile" → "from your profile".
    .replace(/\b(the) founder (profile|tasks?|identity|account)\b/gi, (_m, the: string, noun: string) => `${sameCase(the, "your")} ${noun}`)
    // The verb agrees with "you": "The founder gets" → "You get", "books and signs" → "book and sign".
    .replace(/\b(the) founder((?: (?:only|also|then|still|never|always|first))?) ([a-z]+)\b(?:((?: [a-z]+){0,2} and )([a-z]+)\b)?/gi, (_m, the: string, adverb: string, verb: string, between: string | undefined, second: string | undefined) => {
      const v = youVerb(verb);
      const coordinated = between !== undefined && second !== undefined && v !== verb ? `${between}${youVerb(second)}` : `${between ?? ""}${second ?? ""}`;
      return `${sameCase(the, "you")}${adverb} ${v}${coordinated}`;
    })
    .replace(/\b(the) founder\b/gi, (_m, the: string) => sameCase(the, "you"))
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Subordinating openers: the step's verb follows the first comma ("After leads report, collect…"). */
const CLAUSE_OPENERS = new Set(["after", "when", "if", "once", "before", "while", "until", "as", "whenever"]);
/** Prepositional openers: the verb follows the phrase ("For each department write…"). */
const PHRASE_OPENERS = new Set(["for", "every", "each", "with", "within", "during", "on", "at", "in", "per"]);
/** Verbs the playbooks open their steps with, to find where the agent's "I" goes after a leading phrase. */
const STEP_VERBS = new Set(["write", "hand", "load", "score", "collect", "close", "compile", "publish", "notify", "review", "brief", "read", "attach", "draft", "send", "keep", "check", "run", "plan", "track", "update", "reply", "ask", "flag", "propose", "move", "create", "open", "start", "stop", "prepare", "report", "make", "set", "use", "pick", "rank", "test", "merge", "ship", "measure", "verify", "summarise", "tag", "turn", "log", "watch", "find", "map", "split", "design", "build", "fix", "schedule", "assign", "estimate", "post", "share", "record", "queue", "escalate", "decide", "choose", "list", "mark", "file", "price", "cost", "order", "pay", "invoice", "reconcile", "forecast", "categorise", "monitor"]);
/** Words that follow a comma without being a verb ("…, the Planner…"). */
const NOT_VERBS = new Set(["the", "a", "an", "and", "or", "but", "then", "it", "its", "this", "that", "these", "those", "every", "each", "all", "no", "any", "one", "two", "three", "if", "when", "so", "with", "within", "without", "not", "only", "also", "i", "you", "we", "they"]);

/**
 * A playbook step in the agent's own voice: "Load the brief…" → "I load the brief…"; "After leads report, collect…" →
 * "After leads report, I collect…"; "Never …" → "I never …". Steps it cannot place a subject in stay as they are.
 */
export function firstPerson(step: string): string {
  const s = founderPlain(step);
  const m = /^([A-Z][a-z]+)\b(.*)$/s.exec(s);
  if (!m) return s;
  const first = m[1]!.toLowerCase();
  if (first === "never" || first === "always") return `I ${first}${m[2]}`;
  if (CLAUSE_OPENERS.has(first)) {
    const comma = /,\s+([a-z]+)\b/.exec(s);
    if (comma && !NOT_VERBS.has(comma[1]!)) return `${s.slice(0, comma.index)}, I ${s.slice(comma.index + 2)}`;
    return s;
  }
  if (PHRASE_OPENERS.has(first)) {
    const words = s.split(" ");
    const at = words.findIndex((w, i) => i > 0 && STEP_VERBS.has(w.toLowerCase()));
    return at > 0 ? [...words.slice(0, at), "I", ...words.slice(at)].join(" ") : s;
  }
  return `I ${first}${m[2]}`;
}

/** The first-person description up to its structured tail ("Inputs: … Outputs: … Tools: … Never does: …"). */
export function plainDescription(description: string): string {
  const head = description.split(/\s(?:Inputs|Outputs|Tools|Never does)\s*:/)[0] ?? description;
  return founderPlain(head);
}

/** Lines of "What I do": the first-person description, goals and the playbook in the agent's voice, the never-does list. */
export function whatIDo(profile: Pick<AgentProfile, "agent" | "neverDoes" | "current">): { description: string; inputs: string[]; outputs: string[]; neverDoes: string[] } {
  const instructions = profile.current ? parseInstructions(profile.current.instructions) : null;
  const raw = profile.agent.descriptionMd?.trim() || instructions?.role || "";
  return {
    description: plainDescription(raw),
    inputs: (instructions?.goals ?? []).map(founderPlain),
    outputs: (instructions?.playbook ?? []).map(firstPerson),
    neverDoes: profile.neverDoes.map(founderPlain),
  };
}

/** The header's chips, each said once (a Chief of Staff's role and layer are the same words). */
export function profileChips(agent: Pick<AgentRow, "role" | "agentType" | "layer">, departments: readonly { name: string; colourToken: DeptColourToken }[]): { label: string; tone?: DeptColourToken }[] {
  const out: { label: string; tone?: DeptColourToken }[] = [];
  const seen = new Set<string>();
  const add = (label: string, tone?: DeptColourToken) => {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(tone ? { label, tone } : { label });
  };
  add(agent.role || humaniseKey(agent.agentType));
  add(agent.layer === "assistant" ? "Chief of Staff" : humaniseKey(agent.layer));
  for (const d of departments) add(d.name, d.colourToken);
  return out;
}

/**
 * The month the viewer is in, as a period (YYYY-MM), from their own clock and time zone: the profile asks for this
 * month's wage, so it never shows next month's empty figure before the viewer's month has ended (billing months are
 * UTC calendar months).
 */
export function localPeriod(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** An agent of the team as the line-manager picker needs it (`team.agents.list` rows). */
export interface LineManagerCandidate {
  id: string;
  name: string;
  role?: string | null;
  lineManagerId?: string | null;
  archivedAt?: string | Date | null;
}

/**
 * The agents `agentId` may report to: still on the team, not itself, and not one that reports to it at any depth (the
 * hierarchy stays a tree), by name.
 */
export function lineManagerOptions(agentId: string, agents: readonly LineManagerCandidate[]): { value: string; label: string }[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const reportsTo = (candidate: LineManagerCandidate): boolean => {
    const seen = new Set<string>();
    for (let up = candidate.lineManagerId ?? null; up && !seen.has(up); up = byId.get(up)?.lineManagerId ?? null) {
      if (up === agentId) return true;
      seen.add(up);
    }
    return false;
  };
  return agents
    .filter((a) => a.id !== agentId && !a.archivedAt && !reportsTo(a))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ value: a.id, label: a.role ? `${a.name} · ${a.role}` : a.name }));
}

/** Who an agent reports to when it has no agent line manager: the business's founder ("You" for the founder). */
export function ownerManagerLabel(profile: Pick<AgentProfile, "reportsToOwner">): string {
  return profile.reportsToOwner?.isViewer ? "You" : "Founder";
}

/** "2026-10" → "Wage this month" in October 2026, else "Wage in September 2026" ("Wage in 2026-09" for ISO `prefs`). */
export function wageLabel(period: string, now: Date = new Date(), prefs?: DateFormatPrefs | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return "Wage";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (y === now.getFullYear() && mo === now.getMonth()) return "Wage this month";
  return `Wage in ${formatMonthYear(new Date(Date.UTC(y, mo, 1)), { long: true }, prefs)}`;
}

/** A connector tool for the founder: "search_files" → "Search files", description without build references, hard gates flagged. */
export function toolDisplay(tool: { name: string; title?: string; description?: string }): { label: string; description: string; hardGate: boolean } {
  const rawDescription = tool.description ?? "";
  const hardGate = /\bHARD GATE\b/i.test(rawDescription);
  const description = founderPlain(rawDescription.replace(/^\s*HARD GATE\s*(?:\([^)]*\))?\s*:\s*/i, ""));
  const label = tool.title?.trim() || humaniseKey(tool.name.replace(/\./g, "_"));
  return { label, description: description.charAt(0).toUpperCase() + description.slice(1), hardGate };
}
