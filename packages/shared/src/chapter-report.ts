/**
 * The chapter report's page (WP-14 T8; the founder's brief of Nov 17, 2026, A13): what we set out to do, what we did,
 * the best moment, what we learned, what's next. A template over facts read from records (apps/composer
 * chapter-report.ts loads them), with no model call, so it cannot invent. Every item names the agent or the customer it
 * is about as an entity link (`[[ent:<uuid>|Name]]`); a section with nothing on record says so, and a chapter with
 * little in it is called quiet.
 *
 * Pure, no Zod: the composer writes the note from it and the evals gate it.
 */
import { countOf } from "./copy";
import { safeText } from "./morning-brief";

/** At most this many items in a section; the rest stay in the product. */
export const CHAPTER_REPORT_SECTION_MAX = 5;
/** Fewer items than this in the whole chapter and the report says it was a quiet one. */
export const CHAPTER_REPORT_THIN = 3;

export interface ReportEntity {
  id: string;
  name: string;
}

export interface ChapterReportFacts {
  /** "Q3 2026". */
  label: string;
  /** The chapter's stored title, when it has one. */
  title: string | null;
  /** The goals in force during the chapter, newest first, each with the agent that proposed it. */
  goals: { sentence: string; proposedBy: ReportEntity; achieved: boolean }[];
  /** The work finished in the chapter, by the agent that did it, most first. */
  work: { agent: ReportEntity; done: number; longest: { title: string; minutes: number } | null }[];
  /** Customers won in the chapter (first payments from a named customer), oldest first. */
  customers: { customer: ReportEntity; day: string }[];
  /** Reports agents saved in the chapter, newest first. */
  reports: { agent: ReportEntity; title: string }[];
  /** The work in hand or waiting when the chapter closed, each with its agent. */
  next: { agent: ReportEntity; title: string; running: boolean }[];
  /** The goal in force now, for What's next. */
  activeGoal: { sentence: string; proposedBy: ReportEntity } | null;
}

/** `[[ent:<uuid>|Name]]`, with the name kept from breaking the markup. */
export const entityLink = (e: ReportEntity): string => `[[ent:${e.id}|${e.name.replace(/[\]|[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "Unnamed"}]]`;

const quoted = (text: string): string => `“${safeText(text, 140).replace(/[.!?]+$/, "")}”`;
const NOTHING = "Nothing on record for this chapter.";

export const chapterReportSubject = (label: string): string => `Your chapter report: ${label}`;
export const chapterReportKey = (quarter: string): string => `chapter-report:${quarter}`;

/** How many items the chapter has on record: what makes it a quiet one. */
export function chapterReportItemCount(f: ChapterReportFacts): number {
  return f.goals.length + f.work.length + f.customers.length + f.reports.length;
}

/** The best moment, from the record: the first customer won, else a goal reached, else the longest piece of work. */
export function bestMoment(f: ChapterReportFacts): string | null {
  const first = f.customers[0];
  if (first) return `${entityLink(first.customer)} became a customer on ${first.day}.`;
  const reached = f.goals.find((g) => g.achieved);
  if (reached) return `The goal ${entityLink(reached.proposedBy)} proposed was reached: ${quoted(reached.sentence)}.`;
  const long = f.work.filter((w) => w.longest).sort((a, b) => b.longest!.minutes - a.longest!.minutes)[0];
  if (long?.longest) return `${entityLink(long.agent)} finished ${quoted(long.longest.title)}, the longest piece of work of the chapter (${countOf(long.longest.minutes, "minute")}).`;
  return null;
}

/** The page: five sections, each a list of record-backed items or the line that says there are none. */
export function chapterReportBody(f: ChapterReportFacts): string {
  const max = CHAPTER_REPORT_SECTION_MAX;
  const list = (items: string[], total: number): string[] => (items.length ? [...items.map((i) => `- ${i}`), ...(total > items.length ? [`- And ${total - items.length} more in the product.`] : [])] : [NOTHING]);
  const thin = chapterReportItemCount(f) < CHAPTER_REPORT_THIN;
  const intro = thin
    ? `${f.label} was a quiet chapter. There is little on record, so this report is short, and nothing in it is filled in.`
    : `Here is ${f.label}${f.title ? `, “${safeText(f.title, 80)}”` : ""}, from your project's records.`;
  const best = bestMoment(f);
  return [
    intro,
    "",
    "## What we set out to do",
    ...list(f.goals.slice(0, max).map((g) => `${quoted(g.sentence)}, the goal ${entityLink(g.proposedBy)} proposed and you approved.`), f.goals.length),
    "",
    "## What we did",
    ...list(
      [
        ...f.customers.slice(0, max).map((c) => `${entityLink(c.customer)} became a customer on ${c.day}.`),
        ...f.work.slice(0, max).map((w) => `${entityLink(w.agent)} finished ${countOf(w.done, "piece", "pieces")} of work.`),
      ],
      Math.min(f.customers.length, max) + Math.min(f.work.length, max) + Math.max(0, f.customers.length - max) + Math.max(0, f.work.length - max),
    ),
    "",
    "## The best moment",
    best ?? "No single moment stands out on the record for this chapter.",
    "",
    "## What we learned",
    ...list(f.reports.slice(0, max).map((r) => `${entityLink(r.agent)} reported ${quoted(r.title)}. The full report is on its task.`), f.reports.length),
    "",
    "## What's next",
    ...(f.activeGoal || f.next.length
      ? [
          ...(f.activeGoal ? [`- The goal ${entityLink(f.activeGoal.proposedBy)} proposed: ${quoted(f.activeGoal.sentence)}.`] : []),
          ...f.next.slice(0, max).map((n) => `- ${entityLink(n.agent)} ${n.running ? "is working on" : "has next"} ${quoted(n.title)}.`),
        ]
      : ["Nothing is queued yet. Press Continue on Today when you want the team to plan the next steps."]),
  ].join("\n");
}
