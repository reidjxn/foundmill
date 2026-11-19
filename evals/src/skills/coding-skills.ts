/**
 * Coding agents start with Ponytail and Caveman (WP-06 T13). The same small coding task runs twice on a coding role:
 * without the two skills and with their bodies loaded. Each run records the output tokens and whether the change is
 * accepted. Default-on holds only if the tokens fall and acceptance does not.
 *
 * - Offline (`coding-skills.test.ts`, no model): the two requests differ only by the two skill bodies, and the checks
 *   refuse a change that is wrong, too wide or a hand-back squeezed into fragments.
 * - Live (`coding-skills.eval.test.ts`, skipped without a key): the totals over the cases, printed with the verdict.
 */
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { buildSystemPrompt, getLibrarySkill, getTemplate, type AgentSkillPrompt } from "@foundmill/agents";
import type { ModelClient } from "@foundmill/models";

const BUSINESS = "Northwind Skincare";
const TEMPLATE = "backend_engineer";

export const CodingOutput = z.object({
  working_notes: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  handback: z.string(),
});
export type CodingOutput = z.infer<typeof CodingOutput>;

export interface CodingCase {
  id: string;
  title: string;
  goal: string;
  code: string;
  /** The only files the change may touch. */
  allowed: readonly string[];
  /** What the changed code file must contain. */
  accept: RegExp;
}

export const CODING_CASES: CodingCase[] = [
  {
    id: "skills.coding.empty_email",
    title: "The waitlist form accepts an empty email",
    goal: "Refuse an empty or blank email and answer with the message 'Enter your email address'.",
    code: "// src/waitlist.ts\nexport async function joinWaitlist(input: { email: string }) {\n  await db.insert(waitlist).values({ email: input.email });\n  return { ok: true as const };\n}",
    allowed: ["src/waitlist.ts", "src/waitlist.test.ts"],
    accept: /trim\(\)[\s\S]*Enter your email address|Enter your email address[\s\S]*trim\(\)/,
  },
  {
    id: "skills.coding.plan_label",
    title: "Show the plan name on the billing page",
    goal: "The billing page loads the account but shows no plan name. Show it. The project already has `planLabel(tier)` in src/plans.ts.",
    code: "// src/billing-page.ts\nexport function billingPage(account: { tier: string; email: string }) {\n  return `<h1>Billing</h1><p>${account.email}</p>`;\n}\n// src/plans.ts\nexport const planLabel = (tier: string) => (tier === \"free\" ? \"Try\" : tier);",
    allowed: ["src/billing-page.ts", "src/billing-page.test.ts"],
    accept: /planLabel\(account\.tier\)/,
  },
  {
    id: "skills.coding.late_booking",
    title: "Stop bookings less than 2 hours before a lesson",
    goal: "A booking that starts in under 2 hours must be refused with the message 'Lessons need 2 hours notice'.",
    code: "// src/booking.ts\nexport function book(slot: { startsAt: Date }, now = new Date()) {\n  return { ok: true as const, startsAt: slot.startsAt };\n}",
    allowed: ["src/booking.ts", "src/booking.test.ts"],
    accept: /Lessons need 2 hours notice/,
  },
];

const PONYTAIL = "library_ponytail";
const CAVEMAN = "library_caveman";

function skillPrompts(withSkills: boolean): AgentSkillPrompt[] {
  if (!withSkills) return [];
  return [PONYTAIL, CAVEMAN].map((key) => {
    const s = getLibrarySkill(key.replace("library_", ""))!;
    return { key, name: s.name, source: "library" as const, whenToUse: s.whenToUse, instructionsMd: s.instructionsMd };
  });
}

/** The request for one arm. The two arms differ only by the Skills section. */
export function codingRequest(c: CodingCase, withSkills: boolean) {
  const template = getTemplate(TEMPLATE);
  const system = buildSystemPrompt({ businessName: BUSINESS, appName: APP_NAME, template, skills: skillPrompts(withSkills), skillsCanRead: false });
  const user = [
    `# Task: ${c.title}`,
    c.goal,
    "```ts\n" + c.code + "\n```",
    'Return JSON {"working_notes": "what you would write to yourself while working", "files": [{"path": "...", "content": "the whole file"}], "handback": "what you tell your lead and the founder when you are done"}. Change only files the task needs, and add a test.',
  ].join("\n\n");
  return { template, system, user };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Founder-facing text stays in full sentences: not squeezed into fragments (Caveman's working turns only). */
export function handbackIsPlain(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return false;
  const articles = (text.match(/\b(the|a|an)\b/gi) ?? []).length;
  return words(text) / sentences.length >= 6 && articles >= sentences.length / 2;
}

/** What is wrong with a change (empty when it is accepted). */
export function checkCodingOutput(c: CodingCase, out: CodingOutput | null): string[] {
  if (!out) return ["no valid answer"];
  const problems: string[] = [];
  for (const f of out.files) if (!c.allowed.includes(f.path)) problems.push(`touches ${f.path}`);
  const code = out.files.find((f) => f.path === c.allowed[0]);
  if (!code || !c.accept.test(code.content)) problems.push(`${c.allowed[0]} does not do what the task asked`);
  if (!out.files.some((f) => /\.test\./.test(f.path))) problems.push("no test");
  if (!handbackIsPlain(out.handback)) problems.push("the hand-back is not in plain full sentences");
  return problems;
}

export interface ArmResult { caseId: string; withSkills: boolean; outputTokens: number; accepted: boolean; problems: string[]; costMinor: number }

export async function runCodingArm(client: ModelClient, c: CodingCase, withSkills: boolean): Promise<ArmResult> {
  const { template, system, user } = codingRequest(c, withSkills);
  try {
    const r = await client.complete({ route: template.route, system, messages: [{ role: "user", content: user }], schema: CodingOutput, scope: `eval:${c.id}` });
    const problems = checkCodingOutput(c, r.json);
    return { caseId: c.id, withSkills, outputTokens: r.usage.outputTokens, accepted: problems.length === 0, problems, costMinor: r.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, withSkills, outputTokens: 0, accepted: false, problems: [err instanceof Error ? err.message : String(err)], costMinor: 0 };
  }
}

/** Default-on ships only if tokens fall and acceptance does not. */
export function verdict(results: readonly ArmResult[]) {
  const sum = (w: boolean) => results.filter((r) => r.withSkills === w).reduce((n, r) => n + r.outputTokens, 0);
  const acc = (w: boolean) => results.filter((r) => r.withSkills === w && r.accepted).length;
  const tokensWithout = sum(false), tokensWith = sum(true), acceptedWithout = acc(false), acceptedWith = acc(true);
  return { tokensWithout, tokensWith, acceptedWithout, acceptedWith, ship: tokensWith < tokensWithout && acceptedWith >= acceptedWithout };
}
