/**
 * Each founder area opens on one plain sentence (docs/DESIGN.md §9 "Opening line", founder areas 2026-11-09). The
 * words are pure functions of the facts the area's screens already load (`finance.overview` with `runwayState`,
 * `legal.incorporate.status` and `legal.compliance.list`, `goal.current` and the roadmap, the channel window and the
 * campaigns, the product stage with `dev.prs.list` and `dev.deployments.list`, `team.agents.list` tiers), so a
 * sentence always shows the same number as the tiles under it. No model call, US English, US dates ("Dec 1"), en-US
 * numbers, money in the business's own currency with its narrow symbol (`formatMoney(…, { compact: true })`).
 *
 * A figure that is worked out, not measured, carries its label: the label that closes a sentence moves to the
 * design system's Estimate or Forecast chip (`AreaWords.provenance`); one in the middle of a sentence stays in the
 * words ("on pace (Forecast)"). The Team sentence names the Chief of Staff as `[[ent:<id>|Name]]` markup, which the
 * screen renders through EntityLink so the reader's naming preference applies.
 */
import { AREA_LABELS, AREA_SECTIONS, type AreaKey, type AreaSectionKey } from "./areas";
import { formatCount } from "./copy";
import type { ProductStage } from "./constants";
import { FILINGS_DUE_SOON_DAYS, filingWindow, type FilingWindow } from "./filings";
import { daysBetweenDays, goalDateWords } from "./goals";
import { formatMoney } from "./money";

/** The label a figure carries when it is worked out (Estimate) or projected (Forecast). */
export type AreaProvenance = "estimate" | "forecast";

/** One area sentence: the words, and the label of its closing figure (shown as a chip after the words). */
export interface AreaWords {
  text: string;
  provenance: AreaProvenance | null;
}

/** Why there is no runway figure (`runwayState` in @foundmill/widgets/shared/runway; null when there is one). */
export type AreaRunwayState = "positive" | "no_bank" | "short_history" | "negative";

/** The Product line counts what went live in this many days. */
export const PRODUCT_LINE_DAYS = 7;

const LABEL_AT_END = /\s*\((Estimate|Forecast)\)\.$/;

/** The words with a closing "(Estimate)." or "(Forecast)." moved to the chip; any other label stays in the words. */
export function withProvenance(text: string): AreaWords {
  const m = LABEL_AT_END.exec(text);
  if (!m) return { text, provenance: null };
  return { text: `${text.slice(0, m.index)}.`, provenance: m[1] === "Forecast" ? "forecast" : "estimate" };
}

/** The words as one string, the chip's label back in parentheses (for a title, a test, a screen reader). */
export function areaWordsText(words: AreaWords): string {
  if (!words.provenance) return words.text;
  return `${words.text.replace(/\.$/, "")} (${words.provenance === "forecast" ? "Forecast" : "Estimate"}).`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : many}`;
const money = (minor: number, currency: string): string => formatMoney({ amountMinor: Math.abs(Math.round(minor)), currency }, { compact: true });
/** "get the first 10 paying customers" from "Get the first 10 paying customers" (an acronym keeps its capitals). */
const lowerFirst = (s: string): string => (s.length > 1 && s[1] === s[1]!.toLowerCase() ? s[0]!.toLowerCase() + s.slice(1) : s);
const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const noFullStop = (s: string): string => s.trim().replace(/[.\s]+$/, "");

// ---------------------------------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------------------------------

/** The `finance.overview` figures the Money line reads (the same the Overview's tiles show). */
export interface MoneyAreaFacts {
  currency: string;
  cashMinor: number;
  /** Connected bank accounts (zero: no bank). */
  accounts: number;
  /** Spending more than comes in, per month (net burn); zero or below when cash grows. */
  netBurnMinor: number;
  /** Everything that goes out, per month (gross burn). */
  grossBurnMinor: number;
  /** The runway tile's months; null when words stand in for it. */
  runwayMonths: number | null;
  runwayState: AreaRunwayState | null;
}

/** "about 1.4 months", "about 1 month", "less than a month": the months the runway tile shows. */
function monthsOfCash(months: number): string {
  if (months < 1) return "less than a month";
  const n = Math.round(months * 10) / 10;
  return `about ${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} month${n === 1 ? "" : "s"}`;
}

/**
 * The Money sentence:
 * - "You have £25K and spend about £18K a month, so you have about 1.4 months of cash." [Estimate]
 * - with income: "You have £25K and spend about £18K a month more than comes in, so …" [Estimate]
 * - "You have £25K and earn more than you spend, so cash is not running out." [Estimate]
 * - "Connect your bank and this line shows your cash and how long it lasts." (no bank)
 */
export function moneyAreaWords(f: MoneyAreaFacts): AreaWords {
  const state = f.accounts <= 0 ? "no_bank" : f.runwayState;
  if (state === "no_bank") return { text: "Connect your bank and this line shows your cash and how long it lasts.", provenance: null };
  if (state === "negative") return withProvenance(`Your bank balance is ${money(f.cashMinor, f.currency)} below zero, so there is no cash left to spend (Estimate).`);
  const cash = `You have ${money(f.cashMinor, f.currency)}`;
  if (state === "positive" || (state === null && f.netBurnMinor <= 0)) return withProvenance(`${cash} and earn more than you spend, so cash is not running out (Estimate).`);
  if (state === "short_history" || f.runwayMonths === null) return { text: `${cash}; how long it lasts shows once there are three months of bank history.`, provenance: null };
  const income = f.grossBurnMinor > f.netBurnMinor;
  const spend = `spend about ${money(f.netBurnMinor, f.currency)} a month${income ? " more than comes in" : ""}`;
  return withProvenance(`${cash} and ${spend}, so you have ${monthsOfCash(f.runwayMonths)} of cash (Estimate).`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Company (the section inside Money)
// ---------------------------------------------------------------------------------------------------------------------

export interface CompanyAreaFacts {
  /** The legal entity's registered name; null without one. */
  legalName: string | null;
  /** The entity's status ("planned", "forming", "active", "dissolved"); null without an entity. */
  status: string | null;
  /**
   * Every filing and compliance date, as the Compliance calendar lists them; `window` is the deadline's place in the
   * shared due-soon window (`deadlineWindow`, which keeps a filing's stored due/overdue status), else its date decides.
   */
  deadlines: readonly { dueOn: string | null; open: boolean; window?: FilingWindow }[];
  /** The business's day ("2026-11-09"). */
  today: string;
}

/**
 * The Company line under the Money sentence, counting the same "due soon" window as Company › Compliance's "Due within
 * 30 days" tile (`FILINGS_DUE_SOON_DAYS`, `filingWindow`), so the line and the tile are one fact:
 * - "Northwind Ltd: 2 filings are due in the next 30 days, the first on Dec 1."
 * - "Northwind Ltd: nothing is due in the next 30 days; the next filing is Jan 20." (or "…, and no later filing is on the calendar.")
 * - "Northwind Ltd: 1 filing is overdue, and 2 more are due in the next 30 days."
 * - "Your company is not incorporated yet." / "Your company is being incorporated."
 */
export function companyAreaWords(f: CompanyAreaFacts): AreaWords {
  if (!f.legalName || !f.status || f.status === "planned") return { text: "Your company is not incorporated yet.", provenance: null };
  if (f.status === "forming") return { text: "Your company is being incorporated.", provenance: null };
  const name = f.legalName.trim();
  if (f.status === "dissolved") return { text: `${name} is dissolved.`, provenance: null };
  const open = f.deadlines
    .filter((d): d is { dueOn: string; open: boolean; window?: FilingWindow } => d.open && typeof d.dueOn === "string")
    .map((d) => ({ day: d.dueOn.slice(0, 10), window: d.window ?? filingWindow(daysBetweenDays(f.today, d.dueOn.slice(0, 10))) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const overdue = open.filter((d) => d.window === "overdue").length;
  const due = open.filter((d) => d.window === "due").map((d) => d.day);
  const later = open.filter((d) => d.window === "upcoming").map((d) => d.day);
  const window = `in the next ${formatCount(FILINGS_DUE_SOON_DAYS)} days`;
  if (overdue > 0) {
    const first = `${name}: ${plural(overdue, "filing")} ${overdue === 1 ? "is" : "are"} overdue`;
    return { text: due.length ? `${first}, and ${formatCount(due.length)} more ${due.length === 1 ? "is" : "are"} due ${window}.` : `${first}.`, provenance: null };
  }
  if (!due.length) {
    if (!later[0]) return { text: `${name}: nothing is due ${window}, and no later filing is on the calendar.`, provenance: null };
    return { text: `${name}: nothing is due ${window}; the next filing is ${goalDateWords(later[0], f.today)}.`, provenance: null };
  }
  const on = goalDateWords(due[0]!, f.today);
  if (due.length === 1) return { text: `${name}: 1 filing is due ${window}, on ${on}.`, provenance: null };
  return { text: `${name}: ${plural(due.length, "filing")} are due ${window}, the first on ${on}.`, provenance: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanAreaFacts {
  /** The active goal: its sentence and its pace line (`goal.current`, `goalSentence` and `goalPaceSentence`). */
  goal: { sentence: string; pace: string | null } | null;
  /** A goal the Chief of Staff proposed that waits for the founder's answer. */
  proposedGoal: { sentence: string } | null;
  /** The goal is not readable here (a walled section): its part is left out. */
  goalUnknown?: boolean;
  /** The roadmap's items (`product.roadmap.list`); null when the roadmap is not readable here. */
  roadmap: readonly { horizon: string; targetEnd: string | null; done: boolean }[] | null;
  today: string;
}

/**
 * The Plan sentence: "Your goal: get the first 10 paying customers by Dec 19. 4 of 10 so far, 38 days left: on pace
 * (Forecast). 3 things are in Now; the next is due Dec 4." [Estimate]
 */
export function planAreaWords(f: PlanAreaFacts): AreaWords {
  const parts: string[] = [];
  // Nothing is said about a goal this person may not read.
  if (f.goal && !f.goalUnknown) {
    parts.push(`Your goal: ${lowerFirst(noFullStop(f.goal.sentence))}.`);
    if (f.goal.pace?.trim()) parts.push(f.goal.pace.trim());
  } else if (f.proposedGoal && !f.goalUnknown) parts.push(`A goal waits for your answer: ${lowerFirst(noFullStop(f.proposedGoal.sentence))}.`);
  else if (!f.goalUnknown) parts.push("No goal is set yet.");
  if (f.roadmap) {
    const now = f.roadmap.filter((i) => i.horizon === "now");
    const open = now.filter((i) => !i.done);
    if (!now.length) parts.push("Nothing is in Now on the roadmap yet.");
    else if (!open.length) parts.push(`${plural(now.length, "thing")} in Now ${now.length === 1 ? "is" : "are"} done.`);
    else {
      const head = `${plural(open.length, "thing")} ${open.length === 1 ? "is" : "are"} in Now`;
      const next = open.map((i) => i.targetEnd?.slice(0, 10)).filter((d): d is string => !!d).sort()[0];
      if (!next) parts.push(`${head}.`);
      else if (next < f.today) parts.push(`${head}; the next was due ${goalDateWords(next, f.today)}.`);
      else parts.push(`${head}${open.length === 1 ? ", due" : "; the next is due"} ${goalDateWords(next, f.today)} (Estimate).`);
    }
  }
  return withProvenance(parts.join(" ") || "Nothing is planned yet.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------------

export interface CustomersAreaFacts {
  /** Whether selling has started (`business.get`'s `distributionStartedAt`); null while unknown. */
  selling: boolean | null;
  /** The channel window (`CHANNEL_WINDOW_DAYS`). */
  days: number;
  leads: number;
  customers: number;
  /** The channel most of them came from, by its display name; null when none stands out. */
  topChannel: string | null;
  /** Campaigns live now; null when the campaigns are not readable here. */
  liveCampaigns: number | null;
}

/**
 * The Customers sentence: "In the last 35 days: 42 new leads and 6 new paying customers, most from Lead generation. 2
 * campaigns are live." Before selling starts: "Selling has not started yet."
 */
export function customersAreaWords(f: CustomersAreaFacts): AreaWords {
  if (f.selling === false) return { text: "Selling has not started yet.", provenance: null };
  const window = `In the last ${formatCount(f.days)} days:`;
  const leads = f.leads > 0 ? plural(f.leads, "new lead") : "no new leads";
  const customers = f.customers > 0 ? plural(f.customers, "new paying customer") : "no new paying customers";
  const from = f.topChannel ? `, most from ${f.topChannel}` : "";
  let first: string;
  if (f.customers > 0) first = `${window} ${leads} and ${customers}${from}.`;
  else if (f.leads > 0) first = `${window} ${leads}${from}, and no new paying customers yet.`;
  else first = `${window} no new leads or paying customers yet.`;
  const campaigns = f.liveCampaigns === null ? "" : f.liveCampaigns === 0 ? " No campaign is live." : ` ${plural(f.liveCampaigns, "campaign")} ${f.liveCampaigns === 1 ? "is" : "are"} live.`;
  return { text: `${first}${campaigns}`, provenance: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------------------------------------------------

export interface ProductAreaFacts {
  stage: ProductStage | null;
  /** Changes that went live in the window (`dev.prs.list` merged); null when not readable here. */
  liveInWindow: number | null;
  /** Changes waiting for the founder's go-ahead (`dev.prs.list` open); null when not readable here. */
  waiting: number | null;
  /** The day the live product last changed (`dev.deployments.list`, production), when known. */
  lastLiveOn: string | null;
  today: string;
  /** The window counted (default `PRODUCT_LINE_DAYS`). */
  days?: number;
}

/**
 * The Product sentence: "3 changes went live in the last 7 days and 2 wait for your go-ahead." Before sign-off: "Your
 * specification and roadmap wait for your sign-off."
 */
export function productAreaWords(f: ProductAreaFacts): AreaWords {
  if (f.stage === "drafting") return { text: "Your specification and roadmap are being drafted.", provenance: null };
  if (f.stage === "awaiting_signoff") return { text: "Your specification and roadmap wait for your sign-off.", provenance: null };
  if (f.liveInWindow === null) return { text: "The team builds from your signed-off specification and roadmap.", provenance: null };
  const window = `in the last ${formatCount(f.days ?? PRODUCT_LINE_DAYS)} days`;
  const live = f.liveInWindow > 0 ? `${plural(f.liveInWindow, "change")} went live ${window}` : `Nothing went live ${window}`;
  const waiting = f.waiting === null ? "" : f.waiting > 0 ? ` and ${formatCount(f.waiting)} ${f.waiting === 1 ? "waits" : "wait"} for your go-ahead` : " and nothing waits for your go-ahead";
  const last = f.liveInWindow === 0 && f.lastLiveOn ? ` Your live product last changed on ${goalDateWords(f.lastLiveOn.slice(0, 10), f.today)}.` : "";
  return { text: `${live}${waiting}.${last}`, provenance: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------------------------------------------------

export interface TeamAreaFacts {
  /**
   * The Chief of Staff: its id, the name the reader sees, and whether that is a name of its own ("Ines Park", a
   * persona) rather than the role ("Chief of Staff").
   */
  chief: { id: string; name: string; named: boolean } | null;
  leads: number;
  specialists: number;
  /** Agents that are down or failing. */
  needYou: number;
}

/** `[[ent:<id>|Name]]` with the characters the markup reserves taken out of the name. */
export function entityMention(id: string, name: string): string {
  return `[[ent:${id}|${name.replace(/[[\]|]/g, "").trim() || "Agent"}]]`;
}

/**
 * The Team sentence: "[[Ines Park]], your Chief of Staff, runs 6 leads and 23 specialists; 2 are down or failing." With
 * the agent named by its role: "Your [[Chief of Staff]] runs …".
 */
export function teamAreaWords(f: TeamAreaFacts): AreaWords {
  const crew = [f.leads > 0 ? plural(f.leads, "lead") : null, f.specialists > 0 ? plural(f.specialists, "specialist") : null].filter(Boolean).join(" and ");
  const tail = f.needYou > 0 ? `; ${formatCount(f.needYou)} ${f.needYou === 1 ? "is" : "are"} down or failing.` : ".";
  if (!f.chief) {
    if (!crew) return { text: "No agents are hired yet.", provenance: null };
    return { text: `${capitalize(crew)} work for you${tail}`, provenance: null };
  }
  const who = entityMention(f.chief.id, f.chief.name);
  const does = crew ? `runs ${crew}` : "runs the team on its own so far";
  return { text: f.chief.named ? `${who}, your Chief of Staff, ${does}${tail}` : `Your ${who} ${does}${tail}`, provenance: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The kind line
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What kind of area a department's tab sits in, for a department whose name is not the area's own: "Formulation Lab is
 * part of Product.", "Legal is part of Money, in its Company section." Null when the names agree (Team in Team).
 */
export function areaKindWords(f: { departmentName: string; area: AreaKey; section?: AreaSectionKey | null }): string | null {
  const name = f.departmentName.trim();
  const area = AREA_LABELS[f.area];
  if (!name || name.toLowerCase() === area.toLowerCase()) return null;
  const section = f.section ? AREA_SECTIONS[f.section].label : null;
  return section && section.toLowerCase() !== name.toLowerCase() ? `${name} is part of ${area}, in its ${section} section.` : `${name} is part of ${area}.`;
}
