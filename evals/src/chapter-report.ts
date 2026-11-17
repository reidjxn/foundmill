/**
 * `chapter_report.*` (WP-14 T8): the Chief of Staff's page at the end of a chapter says only what is on record. The
 * report is a template with no model call (packages/shared chapter-report.ts), so this eval is a deterministic gate
 * over its text: every item carries an entity link to an agent or a customer named in the facts, no number appears
 * that the facts do not hold, and a chapter with little in it says so and fills nothing in. The thin cases are the
 * point: an empty chapter, and one with a single finished piece of work.
 */
import { ENTITY_MARKUP_RE, chapterReportBody, chapterReportItemCount, CHAPTER_REPORT_THIN, type ChapterReportFacts, type ReportEntity } from "@foundmill/shared";

const CHIEF: ReportEntity = { id: "0c0c0c0c-0000-4000-8000-000000000001", name: "Ines Park" };
const BUILDER: ReportEntity = { id: "0c0c0c0c-0000-4000-8000-000000000002", name: "Rhea Stone" };
const RESEARCHER: ReportEntity = { id: "0c0c0c0c-0000-4000-8000-000000000003", name: "Product Researcher" };
const CUSTOMER: ReportEntity = { id: "0c0c0c0c-0000-4000-8000-000000000004", name: "Harbor Dental" };

export interface ChapterReportCase {
  id: string;
  facts: ChapterReportFacts;
  /** Whether the report must call the chapter quiet. */
  thin: boolean;
}

const EMPTY: ChapterReportFacts = { label: "Q3 2026", title: null, goals: [], work: [], customers: [], reports: [], next: [], activeGoal: null };

export const CHAPTER_REPORT_CASES: readonly ChapterReportCase[] = Object.freeze([
  { id: "chapter_report.empty", thin: true, facts: EMPTY },
  { id: "chapter_report.one_piece_of_work", thin: true, facts: { ...EMPTY, work: [{ agent: BUILDER, done: 1, longest: { title: "Booking form", minutes: 12 } }] } },
  { id: "chapter_report.goal_only", thin: true, facts: { ...EMPTY, goals: [{ sentence: "Get the first 10 paying customers by Dec 19", proposedBy: CHIEF, achieved: false }], activeGoal: { sentence: "Get the first 10 paying customers by Dec 19", proposedBy: CHIEF } } },
  {
    id: "chapter_report.full",
    thin: false,
    facts: {
      label: "Q3 2026",
      title: "First customers won",
      goals: [{ sentence: "Get the first 10 paying customers by Dec 19", proposedBy: CHIEF, achieved: false }],
      work: [
        { agent: BUILDER, done: 7, longest: { title: "Booking form", minutes: 42 } },
        { agent: RESEARCHER, done: 2, longest: null },
      ],
      customers: [{ customer: CUSTOMER, day: "Sep 14" }],
      reports: [{ agent: RESEARCHER, title: "Three suppliers compared" }],
      next: [{ agent: BUILDER, title: "Set up card payments", running: true }],
      activeGoal: { sentence: "Get the first 10 paying customers by Dec 19", proposedBy: CHIEF },
    },
  },
]);

/** Words that claim a result. In a thin chapter none of them may appear unless the facts hold that record. */
const RESULT_WORDS = /\b(customers?|paid|payments?|revenue|sold|sales|signups?|followers?|launched|shipped|grew|growth)\b/i;

const entitiesOf = (f: ChapterReportFacts): Map<string, string> =>
  new Map([...f.goals.map((g) => g.proposedBy), ...f.work.map((w) => w.agent), ...f.customers.map((c) => c.customer), ...f.reports.map((r) => r.agent), ...f.next.map((n) => n.agent), ...(f.activeGoal ? [f.activeGoal.proposedBy] : [])].map((e) => [e.id, e.name]));

/** Every number the facts hold, as the report may write it. */
function numbersOf(f: ChapterReportFacts): Set<string> {
  const text = [f.label, f.title ?? "", ...f.goals.map((g) => g.sentence), ...f.customers.map((c) => c.day), ...f.reports.map((r) => r.title), ...f.next.map((n) => n.title), f.activeGoal?.sentence ?? "", ...f.work.flatMap((w) => [String(w.done), w.longest?.title ?? "", String(w.longest?.minutes ?? "")])].join(" ");
  return new Set(text.match(/\d+/g) ?? []);
}

export interface ChapterReportResult {
  caseId: string;
  body: string;
  problems: string[];
  passed: boolean;
}

/** The gate: what the report says, against what the facts hold. */
export function runChapterReportCase(c: ChapterReportCase): ChapterReportResult {
  const body = chapterReportBody(c.facts);
  const problems: string[] = [];
  const known = entitiesOf(c.facts);
  const link = new RegExp(ENTITY_MARKUP_RE.source, "g");

  for (const heading of ["## What we set out to do", "## What we did", "## The best moment", "## What we learned", "## What's next"]) if (!body.includes(heading)) problems.push(`missing section: ${heading}`);
  for (const line of body.split("\n").filter((l) => l.startsWith("- "))) if (!new RegExp(ENTITY_MARKUP_RE.source).test(line)) problems.push(`item without an entity link: ${line}`);
  for (const m of body.matchAll(link)) if (known.get(m[1]!) !== m[2]) problems.push(`links an entity the facts do not hold: ${m[0]}`);

  // Numbers: the entity ids are not claims; everything else must be in the facts.
  const allowed = numbersOf(c.facts);
  for (const n of body.replace(link, "$2").match(/\d+/g) ?? []) if (!allowed.has(n)) problems.push(`a number the facts do not hold: ${n}`);

  const saysQuiet = /quiet chapter/i.test(body) && /little on record/i.test(body);
  if (c.thin !== chapterReportItemCount(c.facts) < CHAPTER_REPORT_THIN) problems.push("the case's own thin flag disagrees with its facts");
  if (c.thin && !saysQuiet) problems.push("a thin chapter is not called quiet");
  if (!c.thin && saysQuiet) problems.push("a full chapter is called quiet");
  if (c.facts.customers.length === 0) {
    // Goal sentences are the founder's own words and may speak of customers; everything else may not claim a result.
    const ownWords = [...c.facts.goals.map((g) => g.sentence), c.facts.activeGoal?.sentence ?? ""].filter(Boolean);
    const rest = ownWords.reduce((text, s) => text.split(s.replace(/[.!?]+$/, "")).join(""), body);
    const claim = RESULT_WORDS.exec(rest);
    if (claim) problems.push(`claims a result with no record: "${claim[0]}"`);
  }
  if (/\$|€|£|Estimate|Forecast/.test(body)) problems.push("carries money or an estimate; the report holds neither");
  return { caseId: c.id, body, problems, passed: problems.length === 0 };
}
