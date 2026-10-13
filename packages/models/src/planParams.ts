/**
 * Plan action params both sides agree on (BUILD §12.3; audit VRB-X1, verify-api-services-x1). The plan compilers (the
 * live `planCompiler` route and the rule engine) write them; apps/api and the orchestrator read them through these
 * schemas, so a renamed key fails a test rather than turning a founder's instruction into a no-op reported as done.
 * `PLAN_ACTION_PARAMS` is the per-action param list the live compiler is given with its input.
 */
import { MODEL_KEYS, ROADMAP_HORIZONS, type PlanActionType, type RoadmapHorizon } from "@foundmill/shared";
import { z } from "zod";

/** Every action's params, by name, as the plan compiler must write them. */
export const PLAN_ACTION_PARAMS: Record<PlanActionType, Record<string, string>> = {
  create_task: { kind: "code | research | channel | specialist | legal | finance | ops", title: "short task title", goal: "what done looks like", channel: "channel key when it is channel work (optional)", budget_minor: "integer minor units (optional)", currency: "ISO 4217 (optional)" },
  enable_channel: { channel: "channel key" },
  disable_channel: { channel: "channel key", reason: "why (optional)" },
  set_budget: { amount_minor: "integer minor units", currency: "ISO 4217", channel: "channel key, or", scope: "department | business", department: "department name or slug (scope department)", period: "one_off | daily | weekly | monthly | quarterly | yearly" },
  approve_spend: { amount_minor: "integer minor units", currency: "ISO 4217", approval_id: "an open approval's id (optional)" },
  update_spec: { change: "the change as the founder put it", spec_block_id: "block to change (optional)" },
  update_roadmap: {
    roadmap_item_id: "the id of the item to change, from `roadmap` (required unless create is true)",
    change: "the founder's words for the change",
    horizon: "now | next | later (optional)",
    target_start: "YYYY-MM-DD (optional)",
    target_end: "YYYY-MM-DD (optional)",
    title: "new title, or the title of a new item (optional)",
    create: "true to add a new item instead of changing one (optional)",
  },
  send_message: { recipient: "who", intent: "what to say", requires_disclosure: "true" },
  schedule_meeting: { with: "who", topic: "what about", timeframe: "when (optional)" },
  hire_agent: { role: "the role to hire", brief: "why" },
  train_agent: { agent_id: "agent id from `agents`", focus: "skill to train (optional)" },
  set_agent_model: { model_key: "opus | sonnet | haiku", apply_scope: "agent | type | all", agent_id: "agent id from `agents` (required for agent and type)" },
  create_playbook: { trigger: "when it runs", steps: "what it does, in order" },
  request_human_action: { request: "what the founder must do personally", instructions: "how" },
  reply_only: { question: "one clarifying question" },
};

// --- update_roadmap ---------------------------------------------------------------------------------------------------

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optional = <T extends z.ZodType>(t: T) => t.nullish().catch(null);

export const UpdateRoadmapParams = z
  .object({
    roadmap_item_id: optional(z.string()),
    /** The founder's words naming the item when no id is known. */
    item: optional(z.string()),
    change: optional(z.string()),
    create: optional(z.boolean()),
    title: optional(z.string().trim().min(1).max(200)),
    description: optional(z.string()),
    horizon: optional(z.enum(ROADMAP_HORIZONS)),
    target_start: optional(IsoDate),
    target_end: optional(IsoDate),
    confidence: optional(z.number().int().min(1).max(5)),
  })
  .loose();
export type UpdateRoadmapParams = z.infer<typeof UpdateRoadmapParams>;


export interface RoadmapItemRef {
  id: string;
  title: string;
  horizon: RoadmapHorizon;
  targetStart: string | null;
  targetEnd: string | null;
}

/** The fields an update changes; each one present differs from nothing in particular (compare with the item yourself). */
export interface RoadmapPatch {
  title?: string;
  descriptionMd?: string;
  horizon?: RoadmapHorizon;
  targetStart?: string | null;
  targetEnd?: string | null;
  confidence?: number;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "our", "its", "this", "that", "with", "from", "into", "onto", "item", "items", "roadmap", "milestone", "milestones", "release", "launch", "date", "sprint", "timeline",
  "update", "move", "push", "pull", "bump", "delay", "reschedule", "back", "forward", "bring", "later", "next", "now", "quarter", "year", "month", "week", "out", "until", "please", "can", "you",
]);

const tokens = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

/**
 * The roadmap item an instruction names: the one whose title shares the most words with it. Null when no title shares
 * a word, or two titles share as many (the action then fails and says so, rather than changing the wrong item).
 */
export function matchRoadmapItem<T extends { id: string; title: string }>(text: string, items: readonly T[]): T | null {
  const words = new Set(tokens(text));
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const item of items) {
    const score = [...new Set(tokens(item.title))].filter((w) => words.has(w)).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) tie = true;
  }
  return bestScore > 0 && !tie ? best : null;
}

/** The item an `update_roadmap` action targets: its id when that is one of the items, else the one its words name. */
export function resolveRoadmapItem<T extends { id: string; title: string }>(params: UpdateRoadmapParams, items: readonly T[]): T | null {
  const byId = params.roadmap_item_id ? items.find((i) => i.id === params.roadmap_item_id) : undefined;
  if (byId) return byId;
  return matchRoadmapItem([params.item, params.change, params.title].filter(Boolean).join(" "), items);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** First and last day of the calendar quarter `offset` quarters from `today`'s (UTC). */
export function quarterBounds(today: Date, offset = 0, fixed?: { quarter: number; year: number }): { start: string; end: string; offset: number } {
  const nowIndex = today.getUTCFullYear() * 4 + Math.floor(today.getUTCMonth() / 3);
  const index = fixed ? fixed.year * 4 + (fixed.quarter - 1) : nowIndex + offset;
  const year = Math.floor(index / 4);
  const q = index % 4;
  return { start: iso(new Date(Date.UTC(year, q * 3, 1))), end: iso(new Date(Date.UTC(year, q * 3 + 3, 0))), offset: index - nowIndex };
}

const HORIZON_ORDER: readonly RoadmapHorizon[] = ["now", "next", "later"];
const horizonForOffset = (offset: number): RoadmapHorizon => (offset <= 0 ? "now" : offset === 1 ? "next" : "later");

/**
 * The field-level patch an `update_roadmap` action asks for: its typed fields first; otherwise what its words say (a
 * quarter such as "next quarter" or "Q1 2027" sets the dates and the horizon, "backlog" or "later" a horizon, "push
 * back" one horizon later and "bring forward" one earlier). Empty when it names nothing the roadmap can take.
 */
export function roadmapPatchFrom(params: UpdateRoadmapParams, current: Pick<RoadmapItemRef, "horizon">, today: Date): RoadmapPatch {
  const patch: RoadmapPatch = {};
  if (params.title && !params.create) patch.title = params.title;
  if (params.description) patch.descriptionMd = params.description;
  if (params.confidence) patch.confidence = params.confidence;
  if (params.horizon) patch.horizon = params.horizon;
  if (params.target_start) patch.targetStart = params.target_start;
  if (params.target_end) patch.targetEnd = params.target_end;
  if (patch.horizon || patch.targetStart || patch.targetEnd) return patch;

  const text = (params.change ?? "").toLowerCase();
  if (!text) return patch;
  const explicitQuarter = /\bq([1-4])(?:\s*(?:of\s+)?(\d{4}))?\b/.exec(text);
  const quarter = /\bnext\s+quarter\b/.test(text)
    ? quarterBounds(today, 1)
    : /\bthis\s+quarter\b/.test(text)
      ? quarterBounds(today, 0)
      : explicitQuarter
        ? (() => {
            const q = Number(explicitQuarter[1]);
            const thisYear = today.getUTCFullYear();
            const year = explicitQuarter[2] ? Number(explicitQuarter[2]) : quarterBounds(today, 0, { quarter: q, year: thisYear }).offset < 0 ? thisYear + 1 : thisYear;
            return quarterBounds(today, 0, { quarter: q, year });
          })()
        : null;
  if (quarter && quarter.offset >= 0) {
    patch.targetStart = quarter.start;
    patch.targetEnd = quarter.end;
    patch.horizon = horizonForOffset(quarter.offset);
    return patch;
  }
  const named = /\b(?:to|into|in|under)\s+(now|next|later)\b/.exec(text)?.[1] as RoadmapHorizon | undefined;
  if (named) patch.horizon = named;
  else if (/\b(?:backlog|someday|next\s+year|deprioriti[sz]e)\b/.test(text)) patch.horizon = "later";
  else if (/\b(?:asap|right\s+away|immediately|top\s+priority)\b|(?<!de)prioriti[sz]e\b/.test(text)) patch.horizon = "now";
  else {
    const earlier = /\b(?:bring|pull|move)\b[^.;,]*\b(?:forward|in|up|earlier)\b|\bexpedite\b/.test(text);
    const later = /\b(?:push(?:ed)?|delay(?:ed)?|postpone[sd]?|slip|defer(?:red)?)\b/.test(text);
    const step = earlier ? -1 : later ? 1 : 0;
    const at = HORIZON_ORDER.indexOf(current.horizon);
    const to = HORIZON_ORDER[Math.max(0, Math.min(HORIZON_ORDER.length - 1, at + step))];
    if (step !== 0 && to) patch.horizon = to;
  }
  return patch;
}

// --- set_agent_model --------------------------------------------------------------------------------------------------

/**
 * `set_agent_model` params. `apply_scope` is the name (one agent, every agent of its type, or every agent); `scope` is
 * accepted from plans written before the names were shared and read as the same thing.
 */
export const SetAgentModelParams = z
  .object({
    model_key: z.enum(MODEL_KEYS),
    agent_id: z.string().nullish(),
    apply_scope: z.enum(["agent", "type", "all"]).nullish(),
    scope: z.enum(["agent", "type", "all"]).nullish().catch(null),
  })
  .loose()
  .transform((p) => ({ model_key: p.model_key, agent_id: p.agent_id ?? null, apply_scope: p.apply_scope ?? p.scope ?? "agent" }));
export type SetAgentModelParams = z.output<typeof SetAgentModelParams>;
