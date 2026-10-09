/**
 * Nudge presets that fit who is being nudged (audit-conversation §2 finding 6): "Focus on tests" belongs to an
 * engineer, not to the Influencer engine or a sourcing specialist.
 *
 * A nudge is advice into a running session (`dev.tasks.shout`), never an instruction to act on a hard gate: no preset
 * asks an agent to spend, sign, accept terms or contact anyone. `text` is what reaches the session (≤ 280 characters, the
 * api's limit); `apiPreset` is set for the five original engineering presets, which the api also accepts by name.
 */
import { getTemplateByAgentType } from "./registry";
import type { AgentTemplate } from "./types";

/** The api caps a nudge at 280 characters (`dev.tasks.shout`); the UI should use the same limit. */
export const NUDGE_MAX_LENGTH = 280;

export interface NudgePreset {
  /** snake_case; the five engineering keys match the design system's ShoutPreset union. */
  key: string;
  /** Menu label, sentence case. */
  label: string;
  /** What reaches the session. */
  text: string;
  /** One line under the label in the menu. */
  hint: string;
  /** For the original engineering presets: the label the api's `preset` enum accepts. */
  apiPreset: "Focus on tests" | "Simplify" | "Ask before schema changes" | "Match the design system" | "Hurry up" | null;
}

const preset = (key: string, label: string, hint: string, text = label, apiPreset: NudgePreset["apiPreset"] = null): NudgePreset => ({ key, label, text, hint, apiPreset });

const HURRY_UP = preset("hurry_up", "Hurry up", "Prefer smaller changes and ship sooner.", "Hurry up", "Hurry up");

export const ENGINEERING_NUDGES: readonly NudgePreset[] = Object.freeze([
  preset("focus_on_tests", "Focus on tests", "Make the acceptance tests pass before anything else.", "Focus on tests", "Focus on tests"),
  preset("simplify", "Simplify", "Remove abstraction; the smallest change that works.", "Simplify", "Simplify"),
  preset("ask_before_schema_changes", "Ask before schema changes", "Stop and request a decision before touching migrations.", "Ask before schema changes", "Ask before schema changes"),
  preset("match_design_system", "Match the design system", "Design tokens and design-system components only.", "Match the design system", "Match the design system"),
  HURRY_UP,
]);

export const CHANNEL_NUDGES: readonly NudgePreset[] = Object.freeze([
  preset("focus_best_audience", "Focus on the best audience", "Put effort behind the audience with the lowest cost per customer.", "Focus on the audience with the lowest cost per customer; drop the weakest one."),
  preset("hold_new_spend", "Hold new spend", "Keep running what is live; start nothing that costs more.", "Hold new spend: keep what is live running and start nothing new that costs money until I say so."),
  preset("test_new_angle", "Test a new angle", "One new creative angle against the current best.", "Test one new creative angle against the current best performer."),
  preset("results_first", "Show me results first", "Report what is measured before changing anything.", "Report the measured results before changing anything else."),
  HURRY_UP,
]);

export const SPECIALIST_NUDGES: readonly NudgePreset[] = Object.freeze([
  preset("second_quote", "Get a second quote", "Compare at least two suppliers before recommending one.", "Get a second quote before you recommend a supplier."),
  preset("check_certificates", "Check the certificates", "Confirm every certificate and its expiry date.", "Check every certificate and its expiry date before going further."),
  preset("ask_before_committing", "Ask before committing", "Bring any order, deposit or booking to me first.", "Ask me before anything that would commit the business to an order, a deposit or a booking."),
  HURRY_UP,
]);

export const LEAD_NUDGES: readonly NudgePreset[] = Object.freeze([
  preset("customers_first", "Prioritise customers", "Work that unblocks a customer goes first.", "Put work that unblocks a customer ahead of everything else."),
  preset("keep_it_small", "Keep it small", "Smaller tasks, shorter sessions.", "Keep tasks small and sessions short."),
  preset("ask_before_spending", "Ask before spending", "Bring anything that costs money to me first.", "Ask me before anything that costs money."),
  HURRY_UP,
]);

export const KNOWLEDGE_NUDGES: readonly NudgePreset[] = Object.freeze([
  preset("cite_sources", "Cite your sources", "Every claim names the record or source it relies on.", "Cite the source for every claim."),
  preset("keep_it_short", "Keep it short", "The summary first, details after.", "Keep it short: the summary first, details after."),
  preset("focus_on_customers", "Focus on customers", "What customers need most, not internal polish.", "Focus on what customers need most."),
  HURRY_UP,
]);

const ENGINEERING_TYPES = new Set(["backend_engineer", "frontend_engineer", "data_engineer", "infra_engineer", "qa_engineer", "design_to_code", "integration_agent", "review_agent", "planner", "engineering_lead"]);

function presetsFor(template: AgentTemplate | undefined, agentType: string): readonly NudgePreset[] {
  if (ENGINEERING_TYPES.has(agentType)) return ENGINEERING_NUDGES;
  if (!template) return KNOWLEDGE_NUDGES;
  if (template.family === "channel" || agentType === "distribution_strategist") return CHANNEL_NUDGES;
  if (template.family === "specialist" || agentType === "operations_lead") return SPECIALIST_NUDGES;
  if (template.family === "lead" || template.family === "assistant") return LEAD_NUDGES;
  return KNOWLEDGE_NUDGES;
}

/** The Nudge menu for an agent of this type. Unknown (custom) types get the general set. */
export function nudgePresets(agentType: string): NudgePreset[] {
  return presetsFor(getTemplateByAgentType(agentType), agentType).map((p) => ({ ...p }));
}
