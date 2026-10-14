/**
 * A playbook in plain words (BUILD §11.13): the "When … / then … / you approve …" lines of the flow preview. Pure and
 * Zod-free, so the browser imports it ("@foundmill/shared/playbook-words") without the schemas in ./playbook.
 */
import type { EventType } from "./constants";

export interface FlowLike {
  trigger: { event: EventType; where?: Record<string, string | number | boolean>; condition?: string };
  steps: { action: { type: string }; label?: string }[];
  approvals?: { step: number; scope: "first_run" | "every_run" }[];
  stop?: { max_runs?: number; until?: string; event?: EventType };
}

/** Words for an event in "When …" ("a lead replies"); other events read as their type with spaces. */
const EVENT_PHRASES: Partial<Record<EventType, string>> = {
  "lead.replied": "a lead replies",
  "lead.created": "a lead is created",
  "signup.created": "someone signs up",
  "payment.received": "a payment arrives",
  "customer.converted": "a customer is won",
  "runway.threshold_crossed": "runway crosses a threshold",
  "task.completed": "a task is completed",
  "task.blocked": "a task is blocked",
  "pr.merged": "a pull request is merged",
  "deploy.succeeded": "a deploy succeeds",
  "campaign.launched": "a campaign launches",
  "credential.expiring": "a credential is about to expire",
  "filing.due": "a filing is due",
  "contract.signed": "a contract is signed",
  "connection.requested": "a connection is requested",
  "message.received": "a message arrives",
};

const ACTION_VERBS: Record<string, string> = {
  create_task: "Assign a task",
  enable_channel: "Turn on a channel",
  disable_channel: "Turn off a channel",
  set_budget: "Set a budget",
  approve_spend: "Approve a spend",
  update_spec: "Update the specification",
  update_roadmap: "Update the roadmap",
  send_message: "Send a message",
  schedule_meeting: "Schedule a meeting",
  hire_agent: "Hire an agent",
  train_agent: "Train an agent",
  set_agent_model: "Change an agent's model",
  request_human_action: "Ask you to act",
};

/** The flow in plain words, for the preview and the confirmation. */
export function describePlaybook(p: FlowLike): { when: string; steps: { text: string; approval: string | null }[]; stop: string | null } {
  const event = p.trigger.event;
  const where = Object.entries(p.trigger.where ?? {}).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()} is ${String(v).replace(/_/g, " ")}`);
  const extra = [...where, ...(p.trigger.condition ? [p.trigger.condition] : [])];
  const when = `When ${EVENT_PHRASES[event] ?? event.replace(/[._]/g, " ")}${extra.length > 0 ? ` (${extra.join(", ")})` : ""}`;
  const approvals = p.approvals ?? [];
  const steps = p.steps.map((s, i) => {
    const a = approvals.find((x) => x.step === i);
    return { text: s.label?.trim() || ACTION_VERBS[s.action.type] || s.action.type.replace(/_/g, " "), approval: a ? (a.scope === "first_run" ? "You approve the first run" : "You approve every run") : null };
  });
  const stop = p.stop?.max_runs ? `Stops after ${p.stop.max_runs} run${p.stop.max_runs === 1 ? "" : "s"}` : p.stop?.until ? "Stops on the date you set" : p.stop?.event ? `Stops when ${EVENT_PHRASES[p.stop.event] ?? p.stop.event.replace(/[._]/g, " ")}` : null;
  return { when, steps, stop };
}

