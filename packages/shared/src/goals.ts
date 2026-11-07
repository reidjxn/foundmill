/**
 * The business's goal (founder, 2026-11-07: "Your goal"): one number the team aims every round of work at, proposed by
 * the Chief of Staff and approved by the founder in one tap. Everything a founder reads about a goal is written here, from
 * a small typed shape (`GoalShape`), never by a model: the model route (`goalProposal`) only picks the kind, the target
 * and the date, so dates are always US ("Dec 19"), money keeps the business's own symbol and no jargon gets in.
 *
 * - `defaultGoalFor` is the first proposal's rule: the first 10 paying customers in six weeks, or the next round number
 *   above 1.5 times the customers the business has.
 * - `parseGoalWords` reads the founder's "Change it" words deterministically ("20 customers by Jan 31"): the mock model
 *   and the fallback when the model does not answer.
 * - `goalPaceSentence` is the progress line, labeled Forecast where it projects.
 */
import { formatMoney, majorToMinor, minorToMajor } from "./money";

export const GOAL_METRIC_KINDS = ["paying_customers", "signups", "revenue_month", "custom"] as const;
export type GoalMetricKind = (typeof GOAL_METRIC_KINDS)[number];

/** proposed → active (approved) → achieved, or replaced (a newer goal took its place, or the founder asked for a change). */
export const GOAL_STATUSES = ["proposed", "active", "achieved", "replaced"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** The stored sentence's limit (0072 check). */
export const GOAL_SENTENCE_MAX = 140;
/** The founder's words with a change request (0072 check). */
export const GOAL_CHANGE_MAX = 2000;
/** Six weeks: the first proposal's horizon, and a missed goal's new date. */
export const GOAL_DEFAULT_DAYS = 42;
/** The first goal of a business with no paying customer yet. */
export const GOAL_FIRST_CUSTOMERS = 10;
/** A date the parser or the model may set: at most two years ahead. */
export const GOAL_MAX_DAYS = 730;

/** What a goal aims at, in the form the words are written from. `target` is a count, or minor units for revenue_month. */
export interface GoalShape {
  kind: GoalMetricKind;
  /** Null for a custom goal (there is no number to track). */
  target: number | null;
  /** The business's currency for revenue_month; null otherwise. */
  currency: string | null;
  /** "2026-12-19". */
  dueOn: string;
  /** A custom goal's own words ("Launch the booking page"); null for the measured kinds. */
  text?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const isDayKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(dayMs(s)) && isoOf(dayMs(s)) === s;

/** "2026-12-19" plus `n` days. */
export function addDaysToDay(day: string, n: number): string {
  return isoOf(dayMs(day) + n * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetweenDays(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** The last day of `month` (1–12) of `year`. */
function lastDayOf(year: number, month: number): string {
  return isoOf(Date.UTC(year, month, 0));
}

/**
 * "Dec 19" when the year is implied (the date falls within ten months of today, either side), else "Dec 19, 2027" (US
 * dates everywhere a user can read, founder 2026-10-10).
 */
export function goalDateWords(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const ahead = daysBetweenDays(today, day);
  const short = `${MONTHS[m - 1]} ${d}`;
  return Math.abs(ahead) < 300 ? short : `${short}, ${y}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------------------------------

const ROUND_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5] as const;

/** The next round number strictly above `x` (…, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, …). */
export function nextRoundAbove(x: number): number {
  if (!Number.isFinite(x) || x < 1) return 1;
  let scale = 10 ** Math.floor(Math.log10(x));
  for (;;) {
    for (const step of ROUND_STEPS) {
      const v = Math.round(step * scale);
      if (v > x && Number.isInteger(v)) return v;
    }
    scale *= 10;
  }
}

/** "10" or "1,250" (en-US grouping). */
const count = (n: number): string => Math.round(n).toLocaleString("en-US");

/** "£5,000" in the business's own currency (whole units when the amount is whole). */
function moneyWords(minor: number, currency: string): string {
  const whole = Number.isInteger(minorToMajor(minor, currency));
  const text = formatMoney({ amountMinor: minor, currency });
  return whole ? text.replace(/\.0+$/, "") : text;
}

/** The value of a goal's kind as a founder reads it: "7", "£1,200". */
export function goalValueWords(kind: GoalMetricKind, value: number, currency: string | null): string {
  return kind === "revenue_month" ? moneyWords(value, currency ?? "USD") : count(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// The default proposal
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The first goal's deterministic rule (founder, 2026-11-07): with no paying customer yet, the first 10 in six weeks;
 * otherwise the next round number above 1.5 times the customers the business has (never below 10), in six weeks.
 */
export function defaultGoalFor(input: { payingCustomers: number; today: string }): GoalShape {
  const current = Math.max(0, Math.floor(input.payingCustomers));
  const target = current === 0 ? GOAL_FIRST_CUSTOMERS : Math.max(GOAL_FIRST_CUSTOMERS, nextRoundAbove(current * 1.5));
  return { kind: "paying_customers", target: target > current ? target : nextRoundAbove(current), currency: null, dueOn: addDaysToDay(input.today, GOAL_DEFAULT_DAYS), text: null };
}

/** The goal after one was reached: the same kind, the next round number above 1.5 times where it stands, in six weeks. */
export function nextGoalAfter(reached: Pick<GoalShape, "kind" | "currency">, input: { current: number; today: string }): GoalShape {
  if (reached.kind === "custom") return defaultGoalFor({ payingCustomers: 0, today: input.today });
  const dueOn = addDaysToDay(input.today, GOAL_DEFAULT_DAYS);
  if (reached.kind === "revenue_month") {
    const currency = reached.currency ?? "USD";
    const major = Math.max(1, minorToMajor(input.current, currency));
    return { kind: "revenue_month", target: majorToMinor(nextRoundAbove(major * 1.5), currency), currency, dueOn, text: null };
  }
  return { kind: reached.kind, target: Math.max(GOAL_FIRST_CUSTOMERS, nextRoundAbove(Math.max(1, input.current) * 1.5)), currency: null, dueOn, text: null };
}

/** A missed goal's proposal (founder, 2026-11-07): the same aim with a new date six weeks out. */
export function retryGoalAfterMiss(missed: GoalShape, today: string): GoalShape {
  return { ...missed, dueOn: addDaysToDay(today, GOAL_DEFAULT_DAYS) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string): string => (s && !/^[A-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** What the goal measures, as a noun phrase: "10 paying customers", "50 signups", "£5,000 of revenue in a month". */
export function goalMeasureWords(shape: Pick<GoalShape, "kind" | "target" | "currency" | "text">): string {
  const n = shape.target ?? 0;
  switch (shape.kind) {
    case "paying_customers":
      return `${count(n)} paying customer${n === 1 ? "" : "s"}`;
    case "signups":
      return `${count(n)} signup${n === 1 ? "" : "s"}`;
    case "revenue_month":
      return `${moneyWords(n, shape.currency ?? "USD")} of revenue in a month`;
    case "custom":
      return customWords(shape.text ?? "");
  }
}

/** A custom goal's words without a trailing date or full stop, capitalized ("Launch the booking page"). */
function customWords(text: string): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  return capitalize(t || "Reach the goal we agreed");
}

/**
 * The goal as one sentence, the stored `sentence` (at most 140 characters): "Get the first 10 paying customers by Dec 19"
 * when the business starts from none, "Reach 30 paying customers by Jan 31", "Reach £5,000 of revenue in a month by Mar 31",
 * or a custom goal's words with its date.
 */
export function goalSentence(shape: GoalShape, input: { today: string; startValue?: number | null }): string {
  const by = `by ${goalDateWords(shape.dueOn, input.today)}`;
  if (shape.kind === "custom") return clip(`${customWords(shape.text ?? "")} ${by}`, GOAL_SENTENCE_MAX);
  const fromNone = (input.startValue ?? 0) === 0 && shape.kind !== "revenue_month";
  return clip(`${fromNone ? "Get the first" : "Reach"} ${goalMeasureWords(shape)} ${by}`, GOAL_SENTENCE_MAX);
}

/** The short form for a subject: "get 10 paying customers by Dec 19". */
function goalPhrase(shape: GoalShape, today: string): string {
  const by = `by ${goalDateWords(shape.dueOn, today)}`;
  if (shape.kind === "custom") return `${lowerFirst(customWords(shape.text ?? ""))} ${by}`;
  return `${shape.kind === "revenue_month" ? "reach" : "get"} ${goalMeasureWords(shape)} ${by}`;
}

/** Why a proposal is written: the first one, a revision of the founder's words, the next after one was reached, a new date after a miss. */
export const GOAL_PROPOSAL_REASONS = ["first", "revised", "next", "missed"] as const;
export type GoalProposalReason = (typeof GOAL_PROPOSAL_REASONS)[number];

const SUBJECT_LEAD: Record<GoalProposalReason, string> = { first: "Your first goal", revised: "Your revised goal", next: "Your next goal", missed: "A new date for your goal" };

/** The proposal note's subject (at most 80 characters): "Your first goal: get 10 paying customers by Dec 19". */
export function goalProposalSubject(shape: GoalShape, reason: GoalProposalReason, today: string): string {
  return clip(`${SUBJECT_LEAD[reason]}: ${goalPhrase(shape, today)}`, 80);
}

/** The proposal note's body, in the Chief of Staff's voice. `previous` is the goal it follows (missed or reached). */
export function goalProposalBody(input: { reason: GoalProposalReason; sentence: string; changeWords?: string | null; previous?: { sentence: string; dueOn: string; current: number | null; target: number | null; kind: GoalMetricKind; currency: string | null } | null; today: string }): string {
  const ask = "Approve it, or tell me what to change.";
  const goal = `**${input.sentence}.**`;
  switch (input.reason) {
    case "first":
      return `${goal}\n\nI suggest we aim for this next, so every round of work moves one thing. ${ask}`;
    case "revised": {
      const words = input.changeWords ? clip(input.changeWords.replace(/\s+/g, " ").trim(), 160) : null;
      return `${goal}\n\n${words ? `You asked: “${words}”. ` : ""}I rewrote the goal to match. ${ask}`;
    }
    case "next": {
      const done = input.previous ? `We reached the last goal: ${lowerFirst(input.previous.sentence)}. ` : "We reached the last goal. ";
      return `${goal}\n\n${done}I suggest this next, so the team keeps aiming at one number. ${ask}`;
    }
    case "missed": {
      const p = input.previous;
      const when = p ? goalDateWords(p.dueOn, input.today) : null;
      const where = p && p.kind !== "custom" && p.current !== null && p.target !== null ? ` at ${goalValueWords(p.kind, p.current, p.currency)} of ${goalValueWords(p.kind, p.target, p.currency)}` : "";
      const passed = when ? `${when} passed${where}. ` : "The date passed. ";
      return `${goal}\n\n${passed}I suggest the same aim with a new date. The current goal stays until you approve this one. ${ask}`;
    }
  }
}

/** The proposal note's two options (fixed, so every goal note decides the same way; `decideGoalItem` keys on the ids). */
export const GOAL_OPTION_IDS = { approve: "approve", change: "change" } as const;

export function goalOptions(shape: Pick<GoalShape, "kind">, reason: GoalProposalReason) {
  const because =
    shape.kind === "paying_customers" && reason === "first"
      ? "Recommended because the first customers tell us what to build next."
      : reason === "missed"
        ? "Recommended because a goal with a date ahead keeps every round of work pointed the same way."
        : "Recommended because one clear number keeps every round of work pointed the same way.";
  return [
    { id: GOAL_OPTION_IDS.approve, label: "Approve this goal", recommended: true, consequence: "The team aims every round of work at it, and I report progress against it.", because, cost_minor: 0, reversible: true },
    { id: GOAL_OPTION_IDS.change, label: "Change it", recommended: false, consequence: "Tell me what to change, for example ‘20 customers by Jan 31’, and I write a revised goal for you to approve.", cost_minor: 0, reversible: true },
  ];
}

/** What "Change it" with nothing the parser or the model could read answers. */
export const GOAL_SAY_A_NUMBER = "Say a number or a date, for example ‘20 customers by Jan 31’.";

/** The milestone-style note when a goal is reached: "Goal reached: 10 paying customers". */
export function goalReachedSubject(shape: Pick<GoalShape, "kind" | "target" | "currency" | "text">): string {
  return clip(`Goal reached: ${shape.kind === "custom" ? lowerFirst(goalMeasureWords(shape)) : goalMeasureWords(shape)}`, 80);
}

export function goalReachedBody(input: { sentence: string; reachedOn: string; dueOn: string; today: string }): string {
  return `${endWith(goalReachedSentence(input))} The goal was: ${lowerFirst(input.sentence)}. I propose the next one in a separate note.`;
}

const endWith = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

/** "Reached on Dec 2, 13 days early." / "Reached on Dec 19, on the day." / "Reached on Dec 21, 2 days late." */
export function goalReachedSentence(input: { reachedOn: string; dueOn: string; today: string }): string {
  const early = daysBetweenDays(input.reachedOn, input.dueOn);
  const on = `Reached on ${goalDateWords(input.reachedOn, input.today)}`;
  if (early > 0) return `${on}, ${early} day${early === 1 ? "" : "s"} early.`;
  if (early === 0) return `${on}, on the day.`;
  return `${on}, ${-early} day${early === -1 ? "" : "s"} late.`;
}

/**
 * The progress line (founder, 2026-11-07):
 * - on pace: "4 of 10 so far, 38 days left: on pace (Forecast)."
 * - behind: "4 of 10 so far, 38 days left: at this pace about 6 by Dec 15 (Forecast)."
 * - overdue: "Dec 15 passed at 7 of 10."
 * - reached: "Reached on Dec 2, 13 days early."
 * - custom: "No number to track yet."
 * The pace projects from the value when the goal was approved (`startValue`, `startedOn`) to today.
 */
export function goalPaceSentence(input: { kind: GoalMetricKind; current: number | null; target: number | null; startValue: number | null; startedOn: string | null; dueOn: string; today: string; currency: string | null; achievedOn?: string | null }): string {
  if (input.achievedOn) return goalReachedSentence({ reachedOn: input.achievedOn, dueOn: input.dueOn, today: input.today });
  if (input.kind === "custom" || input.current === null || input.target === null) return "No number to track yet.";
  const v = (n: number) => goalValueWords(input.kind, n, input.currency);
  const left = daysBetweenDays(input.today, input.dueOn);
  if (left < 0) return `${goalDateWords(input.dueOn, input.today)} passed at ${v(input.current)} of ${v(input.target)}.`;
  const so = `${v(input.current)} of ${v(input.target)} so far, ${left} day${left === 1 ? "" : "s"} left`;
  if (input.current >= input.target) return `${so}: reached.`;
  // revenue_month is this month's figure: the pace is the month's own (the share of the month gone).
  let projected: number;
  if (input.kind === "revenue_month") {
    const [y, m, d] = input.today.split("-").map(Number) as [number, number, number];
    const monthDays = Number(lastDayOf(y, m).slice(8));
    projected = (input.current / Math.max(1, d)) * monthDays;
  } else {
    const start = input.startValue ?? 0;
    const began = input.startedOn ?? input.today;
    const elapsed = Math.max(1, daysBetweenDays(began, input.today));
    const total = Math.max(1, daysBetweenDays(began, input.dueOn));
    projected = start + ((input.current - start) / elapsed) * total;
  }
  if (projected >= input.target) return `${so}: on pace (Forecast).`;
  const about = input.kind === "revenue_month" ? moneyWords(Math.round(projected), input.currency ?? "USD") : count(Math.floor(projected));
  return `${so}: at this pace about ${about} by ${goalDateWords(input.dueOn, input.today)} (Forecast).`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading the founder's words
// ---------------------------------------------------------------------------------------------------------------------

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (word: string): number => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(word.slice(0, 3).toLowerCase()) + 1;
const SMALL: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = (s: string): number => (s in SMALL ? SMALL[s]! : Number(s.replace(/,/g, "")));

/** The next occurrence of month/day on or after today (this year, else next year), or with the year given. */
function upcoming(month: number, day: number | null, year: number | null, today: string): string | null {
  const ty = Number(today.slice(0, 4));
  const make = (y: number) => {
    const d = day ?? Number(lastDayOf(y, month).slice(8));
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return isDayKey(iso) ? iso : null;
  };
  if (year) return make(year);
  const thisYear = make(ty);
  if (thisYear && thisYear >= today) return thisYear;
  return make(ty + 1);
}

/** The date in the founder's words, and the text with it removed (so its digits are not read as the target). */
function readDate(text: string, today: string): { dueOn: string | null; rest: string } {
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => string | null): { dueOn: string | null; rest: string } | null => {
    const m = text.match(re);
    if (!m) return null;
    const dueOn = fn(m);
    return dueOn ? { dueOn, rest: text.replace(m[0], " ") } : null;
  };
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  return (
    take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => (isDayKey(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null)) ??
    take(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"), (m) => upcoming(monthIndex(m[1]!), Number(m[2]), m[3] ? Number(m[3]) : null, today)) ??
    take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`, "i"), (m) => upcoming(monthIndex(m[2]!), Number(m[1]), m[3] ? Number(m[3]) : null, today)) ??
    take(new RegExp(`\\b(?:by|in|before|until|end\\s+of|for)\\s+(?:the\\s+)?(?:end\\s+of\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?\\b`, "i"), (m) => upcoming(monthIndex(m[1]!), null, m[2] ? Number(m[2]) : null, today)) ??
    take(/\b(?:in|within)\s+(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month)s?\b/i, (m) => {
      const n = num(m[1]!.toLowerCase());
      const unit = m[2]!.toLowerCase();
      if (unit === "month") return isoOf(Date.UTC(ty, tm - 1 + n, Number(today.slice(8))));
      return addDaysToDay(today, unit === "week" ? n * 7 : n);
    }) ??
    take(/\b(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?(month|year)\b/i, (m) => (m[1]!.toLowerCase() === "month" ? lastDayOf(ty, tm) : `${ty}-12-31`)) ??
    take(/\bnext\s+month\b/i, () => lastDayOf(tm === 12 ? ty + 1 : ty, tm === 12 ? 1 : tm + 1)) ?? { dueOn: null, rest: text }
  );
}

const CUSTOMER_WORDS = /^(?:paying\s+)?(?:customers?|clients?|buyers?|sales|orders|paying\s+users?|subscriptions?)$/i;
const SIGNUP_WORDS = /^(?:signups?|sign-ups?|sign\s+ups|users|members|subscribers|accounts|registrations)$/i;

/** The number in the founder's words and what it counts, when it says (money, customers, signups). */
function readTarget(text: string, currency: string): { kind: GoalMetricKind | null; target: number } | null {
  const money = text.match(/([£$€¥])\s?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?\b/i) ?? text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?\s*(gbp|usd|eur|pounds?|dollars?|euros?)\b/i);
  if (money) {
    const symbolFirst = /[£$€¥]/.test(money[1]!);
    const amount = Number((symbolFirst ? money[2]! : money[1]!).replace(/,/g, "")) * ((symbolFirst ? money[3] : money[2]) ? 1000 : 1);
    if (Number.isFinite(amount) && amount > 0) return { kind: "revenue_month", target: majorToMinor(amount, currency) };
  }
  const counted = text.match(/\b(\d[\d,]*)\s*(k)?\s+(?:more\s+|new\s+)?((?:paying\s+)?[a-z-]+(?:\s+ups?)?)/i);
  if (counted) {
    const n = Number(counted[1]!.replace(/,/g, "")) * (counted[2] ? 1000 : 1);
    const noun = counted[3]!.trim();
    const first = noun.split(/\s+/).slice(0, noun.toLowerCase().startsWith("paying") ? 2 : noun.toLowerCase().startsWith("sign") ? 2 : 1).join(" ");
    if (n > 0 && CUSTOMER_WORDS.test(first)) return { kind: "paying_customers", target: n };
    if (n > 0 && (SIGNUP_WORDS.test(first) || SIGNUP_WORDS.test(noun.split(/\s+/)[0]!))) return { kind: "signups", target: n };
  }
  const bare = text.match(/\b(\d[\d,]*)\s*(k)?\b/i);
  if (bare) {
    const n = Number(bare[1]!.replace(/,/g, "")) * (bare[2] ? 1000 : 1);
    if (Number.isFinite(n) && n > 0) return { kind: null, target: n };
  }
  return null;
}

/**
 * The goal the founder's "Change it" words describe, from the proposal they change (`base`): a number changes the target
 * (and the kind, when the words say what it counts: "20 customers", "50 signups", "£5,000 a month"), a date changes the
 * due date ("by Jan 31", "end of January", "in 8 weeks"). Null when the words change neither, or only to what `base`
 * already says: then nothing is replaced and the founder is asked for a number or a date (`GOAL_SAY_A_NUMBER`).
 */
export function parseGoalWords(words: string, input: { base: GoalShape; today: string; currency: string }): GoalShape | null {
  const text = ` ${words.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()} `;
  if (!text.trim()) return null;
  const { dueOn, rest } = readDate(text, input.today);
  const target = readTarget(rest, input.currency);
  if (!dueOn && !target) return null;
  const base = input.base;
  const kind: GoalMetricKind = target?.kind ?? (base.kind === "custom" && target ? "paying_customers" : base.kind);
  let value = target ? target.target : base.target;
  // A bare number on a revenue goal is money in the business's currency ("make it 8000").
  if (target && target.kind === null && kind === "revenue_month") value = majorToMinor(target.target, input.currency);
  const next: GoalShape = {
    kind,
    target: kind === "custom" ? null : value,
    currency: kind === "revenue_month" ? input.currency : null,
    dueOn: dueOn && validGoalDay(dueOn, input.today) ? dueOn : base.dueOn,
    text: kind === "custom" ? (base.text ?? null) : null,
  };
  const same = next.kind === base.kind && next.target === base.target && next.dueOn === base.dueOn && (next.currency ?? null) === (base.currency ?? null);
  return same ? null : next;
}

/** A due date a goal may have: after today and at most two years ahead. */
export function validGoalDay(day: unknown, today: string): day is string {
  if (!isDayKey(day)) return false;
  const ahead = daysBetweenDays(today, day);
  return ahead >= 1 && ahead <= GOAL_MAX_DAYS;
}

/** Whether a stored target fits its kind: a positive whole count, positive minor units, or none for custom. */
export function validGoalTarget(kind: GoalMetricKind, target: number | null): boolean {
  if (kind === "custom") return target === null;
  return typeof target === "number" && Number.isSafeInteger(target) && target > 0 && target <= 1_000_000_000_000;
}

/** What the `goalProposal` model route answers (packages/models `GoalProposalOutput`), as plain fields. */
export interface GoalAnswer {
  changed: boolean;
  kind: GoalMetricKind;
  /** A count, or whole units of the business's currency for revenue_month; null for custom. */
  target: number | null;
  due_on: string;
  custom_words: string | null;
}

/**
 * The revised goal a model answer describes, checked: a date after today and within two years, a whole positive target
 * for its kind, a custom goal's words plain and short. Null when the answer says no change, breaks a rule, or is the
 * same as `base` (the api then tries `parseGoalWords`, and failing that asks the founder for a number or a date).
 */
export function goalFromAnswer(answer: GoalAnswer, input: { base: GoalShape; today: string; currency: string }): GoalShape | null {
  if (!answer.changed || !(GOAL_METRIC_KINDS as readonly string[]).includes(answer.kind)) return null;
  if (!validGoalDay(answer.due_on, input.today)) return null;
  const kind = answer.kind;
  const target = kind === "custom" ? null : answer.target === null ? null : kind === "revenue_month" ? majorToMinor(answer.target, input.currency) : Math.round(answer.target);
  if (!validGoalTarget(kind, target)) return null;
  const text = kind === "custom" ? (answer.custom_words ?? "").replace(/\s+/g, " ").trim().slice(0, 120) : null;
  if (kind === "custom" && (!text || /\d{4}-\d{2}-\d{2}|[<>{}[\]]|https?:/i.test(text))) return null;
  const next: GoalShape = { kind, target, currency: kind === "revenue_month" ? input.currency : null, dueOn: answer.due_on, text };
  const b = input.base;
  if (next.kind === b.kind && next.target === b.target && next.dueOn === b.dueOn && (kind !== "custom" || next.text === (b.text ?? null))) return null;
  return next;
}
