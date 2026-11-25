/**
 * The one contract for a playbook (BUILD §11.13, AC-11.13.4): a standing rule the founder writes in plain words, compiled
 * into a trigger, steps, approvals and stop conditions. The rule engine and the plan compiler's prompt emit it, the
 * `create_playbook` plan action and the playbooks api validate it, the orchestrator's `playbook` workflow reads it, and
 * ingest matches `trigger` against events. Nothing else defines a playbook's shape (audit AC-07).
 *
 * - `trigger`: an event type, optionally narrowed by `where` (payload fields that must equal a value) and `condition`
 *   (the small expression apps/ingest evaluates: `requestsMeeting`, `amount.amountMinor >= 5000`); or a `schedule`
 *   (founder, Nov 25, 2026: "every Monday, do X"), at most once a day, which the orchestrator's sweep starts.
 * - `steps`: each is one plan action (`{ action: { type, params, agent_id } }`) run through the typed handlers, so policy,
 *   approvals and hard gates apply exactly as they do for a decision.
 * - `approvals`: steps that wait for the founder, `first_run` (until the playbook has run once) or `every_run`.
 * - `stop`: when the playbook stops on its own.
 */
import { z } from "zod";
import { boundedRecord } from "./bounded-record";
import { instantOfWallTime, wallParts } from "./booking";
import { EVENT_TYPES, PLAN_ACTION_TYPES } from "./constants";
import { isValidTimeZone } from "./time-zone";

/**
 * Most payload fields one trigger's `where` names, and most params one step carries: counted before zod reads a key
 * (`boundedRecord`, GHSA-mrhx-c7xc-m3w5), since the playbooks api takes a flow the founder edited.
 */
export const PLAYBOOK_WHERE_MAX_KEYS = 50;
export const PLAYBOOK_PARAMS_MAX_KEYS = 100;

/** Plan actions a step may run (a playbook never creates playbooks, and a reply is not an action). */
export const PLAYBOOK_STEP_ACTIONS = PLAN_ACTION_TYPES.filter((t) => t !== "create_playbook" && t !== "reply_only");

const Scalar = z.union([z.string().max(200), z.number(), z.boolean()]);

/**
 * A recurring time (founder, Nov 25, 2026): every day, every week on a weekday (0 Sunday … 6 Saturday) or every month on
 * a day (1–28, so every month has it), at `time` (24-hour "HH:MM") in the project's time zone. Once a day is the most
 * often a playbook may run, so nothing more frequent can be written.
 */
export const PLAYBOOK_SCHEDULE_EVERY = ["day", "week", "month"] as const;
export const PlaybookSchedule = z
  .object({
    every: z.enum(PLAYBOOK_SCHEDULE_EVERY),
    weekday: z.number().int().min(0).max(6).optional(),
    day_of_month: z.number().int().min(1).max(28).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time is HH:MM, 24-hour"),
  })
  .superRefine((s, ctx) => {
    if (s.every === "week" && s.weekday === undefined) ctx.addIssue({ code: "custom", message: "a weekly playbook names its weekday", path: ["weekday"] });
    if (s.every === "month" && s.day_of_month === undefined) ctx.addIssue({ code: "custom", message: "a monthly playbook names its day of the month", path: ["day_of_month"] });
  });
export type PlaybookSchedule = z.infer<typeof PlaybookSchedule>;

/** Words that ask for a playbook more often than once a day ("every hour", "twice a day"). */
export const PLAYBOOK_TOO_OFTEN = /\b(?:hourly|every\s+(?:\d+\s+|few\s+|couple\s+of\s+)?(?:minutes?|hours?|seconds?)|(?:twice|three\s+times|\d+\s+times)\s+(?:a|per|each)\s+day|every\s+(?:morning\s+and\s+(?:evening|night)))\b/i;
/** The kind answer when it does. */
export const PLAYBOOK_TOO_OFTEN_ANSWER = "A playbook runs at most once a day, so the team has time to work and you have time to read what it did. Pick a time each day, a day each week or a day each month, for example: every Monday at 9 AM, draft the weekly update.";

export const PlaybookTrigger = z
  .object({
    event: z.enum(EVENT_TYPES).optional(),
    where: boundedRecord(PLAYBOOK_WHERE_MAX_KEYS, z.record(z.string().min(1).max(80), Scalar)).optional(),
    condition: z.string().trim().max(300).optional(),
    schedule: PlaybookSchedule.optional(),
  })
  .refine((t) => (t.event === undefined) !== (t.schedule === undefined), { message: "a trigger is either an event or a schedule" });
export type PlaybookTrigger = z.infer<typeof PlaybookTrigger>;

export const PlaybookStep = z.object({
  action: z.object({
    type: z.enum(PLAYBOOK_STEP_ACTIONS as [string, ...string[]]),
    params: boundedRecord(PLAYBOOK_PARAMS_MAX_KEYS, z.record(z.string(), z.unknown())).default({}),
    agent_id: z.string().uuid().nullable().optional(),
  }),
  /** The step in the founder's words (the flow preview shows it). */
  label: z.string().trim().max(160).optional(),
});
export type PlaybookStep = z.infer<typeof PlaybookStep>;

export const PLAYBOOK_APPROVAL_SCOPES = ["first_run", "every_run"] as const;
export const PlaybookApproval = z.object({
  /** Index into `steps` (0-based) of the step that waits for the founder. */
  step: z.number().int().min(0).max(11),
  scope: z.enum(PLAYBOOK_APPROVAL_SCOPES).default("every_run"),
  note: z.string().trim().max(200).optional(),
});
export type PlaybookApproval = z.infer<typeof PlaybookApproval>;

export const PlaybookStop = z.object({
  max_runs: z.number().int().positive().max(10_000).optional(),
  until: z.string().datetime().optional(),
  event: z.enum(EVENT_TYPES).optional(),
});
export type PlaybookStop = z.infer<typeof PlaybookStop>;

export const MAX_PLAYBOOK_STEPS = 12;

export const CompiledPlaybook = z
  .object({
    trigger: PlaybookTrigger,
    steps: z.array(PlaybookStep).min(1).max(MAX_PLAYBOOK_STEPS),
    approvals: z.array(PlaybookApproval).max(MAX_PLAYBOOK_STEPS).default([]),
    stop: PlaybookStop.default({}),
  })
  .superRefine((p, ctx) => {
    for (const [i, a] of p.approvals.entries()) {
      if (a.step >= p.steps.length) ctx.addIssue({ code: "custom", message: `approval ${i + 1} names step ${a.step + 1}, which does not exist`, path: ["approvals", i, "step"] });
    }
  });
export type CompiledPlaybook = z.infer<typeof CompiledPlaybook>;

/** The params of the `create_playbook` plan action. */
export const CreatePlaybookParams = z.object({
  source_text: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(120).optional(),
  trigger: PlaybookTrigger,
  steps: z.array(PlaybookStep).min(1).max(MAX_PLAYBOOK_STEPS),
  approvals: z.array(PlaybookApproval).max(MAX_PLAYBOOK_STEPS).default([]),
  stop: PlaybookStop.default({}),
});
export type CreatePlaybookParams = z.infer<typeof CreatePlaybookParams>;

/**
 * The time a schedule last came due at or before `now`, when that was within `windowMs` (the sweep's catch-up window);
 * else null. The wall time is read in `timeZone` (UTC when unknown or not a zone). A time a daylight-saving change skips
 * does not come due that day.
 */
export function dueSlot(schedule: PlaybookSchedule, now: Date, timeZone: string | null | undefined, windowMs: number): Date | null {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const [hh, mm] = schedule.time.split(":").map(Number) as [number, number];
  const today = wallParts(now.getTime(), zone).day;
  // A window under a day only ever reaches today or yesterday in the zone.
  for (const day of [today, new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)]) {
    const date = new Date(`${day}T00:00:00.000Z`);
    if (schedule.every === "week" && date.getUTCDay() !== schedule.weekday) continue;
    if (schedule.every === "month" && date.getUTCDate() !== schedule.day_of_month) continue;
    const at = instantOfWallTime(day, hh * 60 + mm, zone);
    if (at && at.getTime() <= now.getTime() && now.getTime() - at.getTime() < windowMs) return at;
  }
  return null;
}

// The flow in plain words lives in ./playbook-words (no Zod: the browser imports it).
export * from "./playbook-words";

/**
 * A stored `compiled` value as the contract, or null when it is not one. Rows written before the contract kept each step
 * as `{ type, params }` rather than `{ action: { type, params } }`; those are read as steps too.
 */
export function readCompiledPlaybook(raw: unknown): CompiledPlaybook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const steps = Array.isArray(r.steps) ? r.steps.map((s) => (s && typeof s === "object" && !("action" in s) && "type" in s ? { action: { type: (s as { type: unknown }).type, params: (s as { params?: unknown }).params ?? {} } } : s)) : r.steps;
  const parsed = CompiledPlaybook.safeParse({ ...r, steps });
  return parsed.success ? parsed.data : null;
}
