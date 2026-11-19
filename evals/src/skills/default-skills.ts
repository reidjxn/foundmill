/**
 * Default skills per role (WP-06 T6; founder, Nov 16, 2026: D3): an agent hired for a role starts with that role's
 * library skills, and loads the one a task calls for with `read_skill`. Each case hires an agent of one role (on
 * PGlite, through the one hire implementation), reads back the skills it was given, and builds the session-shaped
 * request from them, with no body loaded up front.
 *
 * - Offline (`default-skills.test.ts`, no model): the hire carries exactly the role's defaults, marked as having come
 *   with the role; the request offers `read_skill`, carries the index line of the default the task needs, and none of
 *   the bodies.
 * - Live (`default-skills.eval.test.ts`, skipped without a key): the agent's first action is `read_skill` with the key
 *   of that default, 5 of 6.
 */
import { APP_NAME } from "@foundmill/config";
import { SKILLS_READ_SENTENCE, attachedSkills, buildSystemPrompt, getTemplate, librarySkillKey, selectSkills, skillIndexLine, type AttachedSkill } from "@foundmill/agents";
import { resolveGrants } from "@foundmill/connectors";
import type { ModelClient } from "@foundmill/models";
import { ActionPlanOutput } from "../types";

const BUSINESS = "Northwind Skincare";

export interface DefaultSkillCase {
  id: string;
  templateKey: string;
  task: { title: string; goal: string };
  /** The library key of the default the task needs. */
  expected: string;
}

export const DEFAULT_SKILL_CASES: DefaultSkillCase[] = [
  { id: "skills.default.chief_of_staff.support_desk", templateKey: "chief_of_staff", expected: "support_desk", task: { title: "A customer wants their money back", goal: "A customer wrote that the cream gave them a rash and asked for a refund. Prepare the reply and anything the founder must decide." } },
  { id: "skills.default.lead_generation.cold_email", templateKey: "channel_lead_generation", expected: "cold_email", task: { title: "First email to three shop owners", goal: "Write to three shop owners who have not heard of the project and propose a short call." } },
  { id: "skills.default.product_lead.first_ten_conversations", templateKey: "product_lead", expected: "first_ten_conversations", task: { title: "Talk to the first people", goal: "Find and talk to the first ten people who might want the product, and learn what they need." } },
  { id: "skills.default.finance_lead.first_budget", templateKey: "finance_lead", expected: "first_budget", task: { title: "A first budget", goal: "Set a first budget for the next three months: what money goes out, what may come in, and what is left." } },
  { id: "skills.default.legal_lead.contract_review", templateKey: "legal_lead", expected: "contract_review", task: { title: "Look over the supplier's contract", goal: "The supplier sent their contract. Review it before the founder decides whether to sign." } },
  { id: "skills.default.qa_engineer.web_app_testing", templateKey: "qa_engineer", expected: "web_app_testing", task: { title: "Test the signup page", goal: "Check the new signup page works end to end in the browser before it ships." } },
];

/** A skill as packages/db returns an agent's added skills. */
export interface StoredDefault {
  skillKey: string;
  name: string;
  source: "library" | "upload";
  description: string;
  instructionsMd: string;
}

/** The session-shaped request for a case, from the skills the hired agent carries. No body is loaded up front. */
export function defaultSkillsRequest(c: DefaultSkillCase, stored: readonly StoredDefault[], preloadAlways = false) {
  const template = getTemplate(c.templateKey);
  const toolRefs = resolveGrants(template.tools).toolRefs;
  const canRead = toolRefs.includes("platform:read_skill");
  const attached: AttachedSkill[] = attachedSkills(template.skills, stored);
  const skills = selectSkills({ skills: attached, task: { kind: template.taskKinds[0] ?? "ops", ...c.task }, maxBodies: 0, preloadAlways });
  const system = buildSystemPrompt({ businessName: BUSINESS, appName: APP_NAME, template, skills, skillsCanRead: canRead });
  const user = [
    `# Task: ${c.task.title}`,
    c.task.goal,
    `Tools you hold: ${toolRefs.map((r) => r.replace(":", ".")).join(", ")}.`,
    'Plan your first steps. Return JSON {"actions": [{"tool": "<connector.tool>", "args": {...}, "reason": "..."}], "escalations": ["request_human_action texts"], "notes": "..."}, actions in the order you would take them. Use only tools you hold.',
  ].join("\n\n");
  return { template, toolRefs, attached, system, user };
}

/** What the offline check finds wrong with a case's request (empty when it is right). */
export function checkDefaultSkillsRequest(c: DefaultSkillCase, stored: readonly StoredDefault[]): string[] {
  const { toolRefs, attached, system } = defaultSkillsRequest(c, stored);
  const problems: string[] = [];
  const expected = attached.find((s) => s.key === librarySkillKey(c.expected));
  if (!expected) return [`the hired ${c.templateKey} does not carry ${c.expected}`];
  if (!toolRefs.includes("platform:read_skill")) problems.push("read_skill is not offered");
  if (!system.includes(SKILLS_READ_SENTENCE)) problems.push("the index does not say to call read_skill");
  if (!system.includes(skillIndexLine(expected))) problems.push(`the index has no line for ${expected.key}`);
  for (const s of stored) if (system.includes(s.instructionsMd.slice(0, 300))) problems.push(`the body of ${s.skillKey} is in the prompt`);
  return problems;
}

const isReadSkill = (tool: string) => /(^|[._:])read_skill$/.test(tool);

/** Live: the first action is read_skill with the key of the default the task needs. */
export async function runDefaultSkillsCase(client: ModelClient, c: DefaultSkillCase, stored: readonly StoredDefault[]): Promise<{ caseId: string; passed: boolean; problems: string[]; costMinor: number }> {
  const { template, system, user } = defaultSkillsRequest(c, stored);
  try {
    const r = await client.complete({ route: template.route, system, messages: [{ role: "user", content: user }], schema: ActionPlanOutput, scope: `eval:${c.id}` });
    const first = r.json?.actions[0];
    const key = typeof first?.args.skillKey === "string" ? first.args.skillKey : "";
    const problems: string[] = [];
    if (!first || !isReadSkill(first.tool)) problems.push(`first action is ${first?.tool ?? "none"}, not read_skill`);
    else if (key !== librarySkillKey(c.expected) && key !== c.expected) problems.push(`read_skill was called with ${key}, not ${librarySkillKey(c.expected)}`);
    return { caseId: c.id, passed: problems.length === 0, problems, costMinor: r.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, passed: false, problems: [err instanceof Error ? err.message : String(err)], costMinor: 0 };
  }
}
