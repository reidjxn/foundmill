/** Blueprint types for skill tests. A blueprint × a scenario = one SkillTest (see ../generate.ts). */
import { type DeterministicCheck } from "../../types";

export interface Blueprint {
  /** Title with `{field}` scenario placeholders. */
  title: string;
  /** The task prompt handed to the agent under test, with `{field}` placeholders. Written as the lead or founder would. */
  prompt: string;
  /** Rubric criteria the grader scores 0–1 each; placeholders allowed. */
  rubric: string[];
  /** Deterministic checks run before grading. */
  checks?: DeterministicCheck[];
  /** Mock tools available in the sandbox for this task (never real email or spend). */
  mockTools?: string[];
  /** Named fixtures mounted in the sandbox; values are stable fixture refs. */
  fixtures?: Record<string, string>;
}

export type BlueprintSet = Record<string, Blueprint[]>;

export function bp(title: string, prompt: string, rubric: string[], extra: Omit<Blueprint, "title" | "prompt" | "rubric"> = {}): Blueprint {
  return { title, prompt, rubric, ...extra };
}

export const CHECK = {
  json: (schemaRef: string): DeterministicCheck => ({ kind: "json_schema_valid", params: { schemaRef } }),
  testsPass: (): DeterministicCheck => ({ kind: "tests_pass", params: {} }),
  policy: (): DeterministicCheck => ({ kind: "policy_respected", params: {} }),
  links: (): DeterministicCheck => ({ kind: "entity_links_valid", params: {} }),
  words: (min: number, max: number): DeterministicCheck => ({ kind: "word_count", params: { min, max } }),
  all: (...terms: string[]): DeterministicCheck => ({ kind: "contains_all", params: { terms } }),
  none: (...terms: string[]): DeterministicCheck => ({ kind: "contains_none", params: { terms } }),
  noTools: (): DeterministicCheck => ({ kind: "no_tool_calls", params: {} }),
  cites: (): DeterministicCheck => ({ kind: "cites_source_ids", params: {} }),
};

/** Mock tool bundles. */
export const TOOLS = {
  sandbox: ["sandbox.shell", "sandbox.read_file", "sandbox.write_file", "sandbox.run_tests"],
  board: ["platform.tasks.list", "platform.tasks.block", "platform.tasks.complete", "platform.messages.request", "platform.inbox.request_human_action"],
  crm: ["platform.crm.entities.search", "platform.crm.entities.create", "platform.crm.interactions.append"],
  web: ["web.search", "web.fetch", "quarantine.read_untrusted"],
  email: ["sendgrid.mock.send", "platform.suppression.check", "platform.consent.check"],
  docs: ["platform.documents.read", "platform.documents.write"],
  finance: ["platform.finance.transactions", "platform.finance.metrics", "ecb_rates.mock.latest"],
  spec: ["platform.spec.read", "platform.spec.propose", "platform.roadmap.read"],
  none: [] as string[],
};
