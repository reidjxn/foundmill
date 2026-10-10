/**
 * "Here is what will happen" (BUILD §11.3): one line per plan action with its policy outcome and cost, and the total.
 * Its own module (re-exported by ./logic) because the agent desk, which every business page mounts, needs only these
 * and must not pull the whole Inbox logic into each page's first load.
 */
import type { Money } from "@foundmill/shared";

export interface EvaluationLike {
  action: { type: string; params?: Record<string, unknown> | null };
  outcome: string;
  hardGate?: boolean;
  reasons?: string[];
}

export function describeAction(type: string, p: Record<string, unknown> | null | undefined): string {
  const s = (k: string) => (p && typeof p[k] === "string" ? (p[k] as string) : "");
  switch (type) {
    case "create_task":
      return `Create task: ${s("title") || s("goal") || "new task"}`;
    case "enable_channel":
      return `Enable channel ${s("channel").replace(/_/g, " ")}`;
    case "disable_channel":
      return `Disable channel ${s("channel").replace(/_/g, " ")}`;
    case "set_budget":
      return `Set budget for ${s("channel").replace(/_/g, " ") || s("department") || "the business"}`;
    case "approve_spend":
      return `Approve spend${s("purpose") ? `: ${s("purpose")}` : ""}`;
    case "send_message":
      return `Send a message${s("to") ? ` to ${s("to")}` : ""}`;
    case "schedule_meeting":
      return "Schedule a meeting";
    case "hire_agent":
      return `Hire an agent${s("template") || s("templateKey") ? ` (${s("template") || s("templateKey")})` : ""}`;
    case "train_agent":
      return "Train an agent";
    case "set_agent_model":
      return `Change an agent's model${s("model") || s("modelKey") ? ` to ${s("model") || s("modelKey")}` : ""}`;
    case "update_spec":
      return "Update the specification";
    case "update_roadmap":
      return "Update the roadmap";
    case "create_playbook":
      return "Create a playbook";
    case "request_human_action":
      return `Founder action: ${s("request") || s("original_text") || "needs you"}`;
    case "reply_only":
      return `Reply: ${s("question") || s("text") || "a question back to you"}`;
    default:
      return type.replace(/_/g, " ");
  }
}

export function actionCost(p: Record<string, unknown> | null | undefined, currency: string): Money | null {
  const v = p?.amount_minor ?? p?.amountMinor ?? p?.cost_minor;
  if (typeof v !== "number" || v <= 0) return null;
  const c = typeof p?.currency === "string" ? (p.currency as string) : currency;
  return { amountMinor: v, currency: c };
}

export interface ConfirmationLine {
  label: string;
  outcome: "allow" | "ask" | "deny" | string;
  hardGate: boolean;
  cost: Money | null;
  reasons: string[];
}

/** The lines of "Here is what will happen" (BUILD §11.3): every action with its policy outcome and cost. */
export function confirmationLines(evaluations: readonly EvaluationLike[], currency: string): ConfirmationLine[] {
  return evaluations.map((e) => ({ label: describeAction(e.action.type, e.action.params ?? null), outcome: e.outcome, hardGate: e.hardGate === true || e.action.type === "request_human_action", cost: actionCost(e.action.params ?? null, currency), reasons: e.reasons ?? [] }));
}

export function totalCost(lines: readonly ConfirmationLine[], currency: string): Money | null {
  const sum = lines.reduce((acc, l) => acc + (l.cost?.amountMinor ?? 0), 0);
  return sum > 0 ? { amountMinor: sum, currency } : null;
}
