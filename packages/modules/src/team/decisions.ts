/**
 * The decision types of the responsibilities matrix in words (BUILD §11.9). Pure data, no React: Team › Responsibilities
 * and Settings › Departments (a department's approvals) both read it, the latter as `@foundmill/modules/team/decisions`.
 */
import type { DecisionType } from "@foundmill/shared/constants";

export const DECISION_LABELS: Record<DecisionType, string> = {
  spend_above_threshold: "Spend above threshold",
  publish_content: "Publish content",
  merge_to_main: "Merge to main",
  sign_contracts: "Sign contracts",
  message_customers: "Message customers",
  hire_agents: "Hire agents",
  change_models: "Change models",
};

export const DECISION_DESCRIPTIONS: Record<DecisionType, string> = {
  spend_above_threshold: "Any purchase or budget above the business's approval threshold.",
  publish_content: "Posts, pages, newsletters and ads going live under the business's name.",
  merge_to_main: "Code changes going into the main copy of the product's code.",
  sign_contracts: "Signatures and accepted terms. A hard gate: an agent can never hold this.",
  message_customers: "Outbound messages to customers and leads.",
  hire_agents: "Adding agents to the team and setting the most each may cost a month.",
  change_models: "Moving an agent to a different model.",
};

/** Decision types an agent may never handle (BUILD §2.2 hard gates; the API rejects it too). */
export const AGENT_GATED_DECISIONS: readonly DecisionType[] = ["sign_contracts"];
