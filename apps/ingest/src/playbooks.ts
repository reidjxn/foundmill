/**
 * Which founder playbooks an ingested event triggers (BUILD §11.13 "Playbooks", AC-11.13.4). A compiled playbook's
 * trigger is `{ event: "<event type>", where?: { field: value }, condition?: "<expression>" }` (cron triggers are Temporal
 * Schedules, not events). The event type must match exactly; `where` compares payload fields for equality; `condition`
 * is the small expression language the plan compiler writes: clauses joined by `&&`, each `field`, `!field`,
 * `field == value`, `field != value` or a numeric comparison (`<`, `<=`, `>`, `>=`), fields being payload paths
 * (`amount.amountMinor`). Anything the evaluator cannot read (`||`, parentheses, functions) or a field the payload lacks
 * makes the trigger not match: a playbook acts only when its condition is known to hold.
 */

export interface PlaybookTriggerEvent {
  type: string;
  payload: Record<string, unknown>;
}

type Scalar = string | number | boolean | null;

const fieldOf = (payload: Record<string, unknown>, path: string): unknown => {
  let cur: unknown = payload;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in (cur as Record<string, unknown>))) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

function literal(raw: string): Scalar {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const COMPARISON = /^([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/;

/** One clause of a condition; undefined when it cannot be evaluated (which fails the whole condition). */
function clause(text: string, payload: Record<string, unknown>): boolean | undefined {
  const c = text.trim();
  if (!c) return undefined;
  if (c.startsWith("!")) {
    const field = c.slice(1).trim();
    if (!FIELD.test(field)) return undefined;
    const v = fieldOf(payload, field);
    return v === undefined ? undefined : !v;
  }
  if (FIELD.test(c)) {
    const v = fieldOf(payload, c);
    return v === undefined ? undefined : Boolean(v);
  }
  const m = COMPARISON.exec(c);
  if (!m || !FIELD.test(m[1]!)) return undefined;
  const actual = fieldOf(payload, m[1]!);
  if (actual === undefined) return undefined;
  const expected = literal(m[3]!);
  switch (m[2]) {
    case "==":
      return actual === expected || (typeof actual === "string" && typeof expected === "string" && actual.toLowerCase() === expected.toLowerCase());
    case "!=":
      return !(actual === expected || (typeof actual === "string" && typeof expected === "string" && actual.toLowerCase() === expected.toLowerCase()));
    default: {
      if (typeof actual !== "number" || typeof expected !== "number") return undefined;
      if (m[2] === "<") return actual < expected;
      if (m[2] === "<=") return actual <= expected;
      if (m[2] === ">") return actual > expected;
      return actual >= expected;
    }
  }
}

/** Evaluates a trigger `condition`; false when any clause is false or cannot be evaluated. */
export function conditionHolds(condition: string, payload: Record<string, unknown>): boolean {
  if (/\|\||[()]/.test(condition)) return false;
  return condition.split("&&").every((c) => clause(c, payload) === true);
}

/** Whether a compiled playbook trigger fires for this event. */
export function playbookTriggerMatches(trigger: Record<string, unknown> | null | undefined, event: PlaybookTriggerEvent): boolean {
  if (!trigger || typeof trigger.event !== "string" || trigger.event !== event.type) return false;
  const where = trigger.where;
  if (where !== undefined && where !== null) {
    if (typeof where !== "object" || Array.isArray(where)) return false;
    for (const [field, expected] of Object.entries(where as Record<string, unknown>)) {
      const actual = fieldOf(event.payload, field);
      if (actual === undefined || actual !== expected) return false;
    }
  }
  const condition = trigger.condition;
  if (condition !== undefined && condition !== null && condition !== "") {
    if (typeof condition !== "string" || !conditionHolds(condition, event.payload)) return false;
  }
  return true;
}
