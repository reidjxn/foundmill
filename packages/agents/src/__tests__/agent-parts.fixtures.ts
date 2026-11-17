/**
 * An agent's own prompt parts (WP-06 T1) for the builder tests: an edited rule and one added skill, and the check each
 * builder passes. With `agent` the first system block starts with the house rules and carries the skill after the
 * instructions; without it the block is what the template alone renders.
 */
import { APP_NAME } from "@foundmill/config";
import { expect } from "vitest";
import { CLUB_RULES_HEADER, INSTRUCTIONS_HEADER, SKILLS_HEADER, buildSystemPrompt, type AgentPromptParts } from "../club-rules";
import type { AgentTemplate } from "../types";

export const AGENT_RULE = "Quote one customer's own words before any claim.";
export const AGENT_SKILL_LINE = "Lead with the problem the customer named, in their words.";

export function agentParts(template: Pick<AgentTemplate, "instructions" | "description">): AgentPromptParts {
  return {
    instructions: { ...template.instructions, rules: [...template.instructions.rules, AGENT_RULE] },
    description: template.description,
    skills: [{ name: "Customer words", source: "library", instructionsMd: AGENT_SKILL_LINE }],
  };
}

/**
 * `withAgent` follows the agent; `without` is exactly what the template renders (today's output), or starts with it when
 * the builder appends its task to the same block (`exact: false`).
 */
export function expectFollowsAgent(withAgent: string, without: string, template: Pick<AgentTemplate, "instructions" | "description">, businessName: string, exact = true): void {
  expect(withAgent.startsWith(CLUB_RULES_HEADER)).toBe(true);
  const instructionsAt = withAgent.indexOf(INSTRUCTIONS_HEADER);
  expect(instructionsAt).toBeGreaterThan(0);
  expect(withAgent.indexOf(AGENT_RULE)).toBeGreaterThan(instructionsAt);
  expect(withAgent.indexOf(SKILLS_HEADER)).toBeGreaterThan(instructionsAt);
  expect(withAgent.indexOf(AGENT_SKILL_LINE)).toBeGreaterThan(withAgent.indexOf(SKILLS_HEADER));
  const today = buildSystemPrompt({ businessName, appName: APP_NAME, template });
  if (exact) expect(without).toBe(today);
  else expect(without.startsWith(`${today}\n\n`)).toBe(true);
  expect(without).not.toContain(AGENT_SKILL_LINE);
  expect(without).not.toContain(AGENT_RULE);
}
