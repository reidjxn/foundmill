/**
 * The founder's side of an approval (audit FR-01 / O-02): every approval opened for a gated call becomes one decision
 * Inbox item that names the agent, the task, the call and its amount, and offers Approve and Reject. It blocks Continue
 * until it is answered; `inbox.decide` (and `team.approvals.resolve`) resolve the approval through it and send the
 * decision to whatever waits on it. The approval's `approval.requested` event is marked narrated with the item, so the
 * composer never writes a second, vaguer note about it.
 *
 * Callers write `inbox.item_created` through the outbox themselves (the event schemas live in @foundmill/events).
 */
import { formatMoney, type Section } from "@foundmill/shared";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { Approval, InboxItem } from "./schema";

/**
 * Option ids of an approval's decision item; `inbox.decide` maps them to the approval's outcome. Distinct from any
 * composer option id, so a choice on an approval item is recognized from its id alone (no plan compiler, no model call).
 */
export const APPROVAL_OPTIONS = { approve: "approve_request", reject: "reject_request" } as const;
export type ApprovalOptionId = (typeof APPROVAL_OPTIONS)[keyof typeof APPROVAL_OPTIONS];

export const isApprovalOption = (option: string | null | undefined): option is ApprovalOptionId => option === APPROVAL_OPTIONS.approve || option === APPROVAL_OPTIONS.reject;

export const approvalOutcomeOf = (option: string | null | undefined): "approved" | "rejected" | null => (option === APPROVAL_OPTIONS.approve ? "approved" : option === APPROVAL_OPTIONS.reject ? "rejected" : null);

const BRANDS: Record<string, string> = {
  github: "GitHub",
  sendgrid: "SendGrid",
  opencorporates: "OpenCorporates",
  e2b: "E2B",
  ecb_rates: "ECB rates",
  cloudflare_dns: "Cloudflare DNS",
  dropbox_sign: "Dropbox Sign",
  google_drive: "Google Drive",
};

/** Calls the platform runs inside the business itself (campaign launches, budgets, channels): no outside service. */
const PLATFORM_CONNECTOR = "platform";

/** "GitHub", "Google Calendar" from a connector key, when the caller has no display name. */
export function connectorLabel(key: string | null | undefined): string {
  if (!key) return "a tool";
  return BRANDS[key] ?? key.split("_").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

/** "run migration" from `run_migration`. */
export const toolWords = (tool: string | null | undefined): string => (tool ? tool.replace(/[_.]+/g, " ").trim() : "an action");

/**
 * "GitHub › run migration": the call an approval is about, as the founder reads it. A platform call is named after the
 * business it runs in ("LP.GP › launch campaign"), never after the platform, which read as if the agent worked for it.
 */
export const approvalAction = (approval: Pick<Approval, "connectorKey" | "tool">, connectorName?: string | null, businessName?: string | null): string => {
  const where = approval.connectorKey === PLATFORM_CONNECTOR ? businessName?.trim() || "Your business" : connectorName?.trim() || connectorLabel(approval.connectorKey);
  return `${where} › ${toolWords(approval.tool)}`;
};

/** Connectors whose calls belong to a section (BUILD §11.9): deciding one needs write on it. Others need Inbox write only. */
const CONNECTOR_SECTIONS: Record<string, Section> = {
  stripe: "finance",
  tink: "finance",
  plaid: "finance",
  ecb_rates: "finance",
  github: "development",
  e2b: "development",
  cloudflare_dns: "development",
  sendgrid: "distribution",
  shopify: "distribution",
  gmail: "crm",
  google_calendar: "crm",
  dropbox_sign: "legal",
  opencorporates: "legal",
  bolagsverket: "legal",
  companies_house: "legal",
};

/** Platform tools (plan actions, channel launches) and the section their screen lives in. */
const PLATFORM_TOOL_SECTIONS: Record<string, Section> = {
  launch_campaign: "distribution",
  enable_channel: "distribution",
  disable_channel: "distribution",
  set_budget: "finance",
  approve_spend: "finance",
  train_agent: "team",
  hire_agent: "team",
  set_agent_model: "team",
  create_playbook: "team",
  update_spec: "product",
  update_roadmap: "product",
  send_message: "crm",
  schedule_meeting: "crm",
};

/**
 * The section an approval's call changes, or null when Inbox write is enough: a member answers an approval only with
 * write on that section (the screen that would make the same change asks the same), owners and admins always can.
 */
export function approvalSection(approval: Pick<Approval, "connectorKey" | "tool">): Section | null {
  if (!approval.connectorKey) return null;
  if (approval.connectorKey === "platform") return (approval.tool && PLATFORM_TOOL_SECTIONS[approval.tool]) || null;
  return CONNECTOR_SECTIONS[approval.connectorKey] ?? null;
}

export interface ApprovalItemDetails {
  /** The agent who asked (the item is from it); the Chief of Staff when the approval names no agent. */
  agentId: string;
  agentName: string;
  taskTitle?: string | null;
  /** The connector's display name ("GitHub"); derived from the key when omitted. */
  connectorName?: string | null;
  /** The business's name, which names a platform call ("LP.GP › launch campaign"); read from the business when omitted. */
  businessName?: string | null;
  /** What the call would do, in one line (the arguments as the agent sent them, already shortened). */
  argsSummary?: string | null;
  /** The `approval.requested` event(s) this item narrates. */
  sourceEventIds?: readonly string[];
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Longest text of a call's arguments that travels with the note and the reading pane. */
const ARGS_TEXT_MAX = 1_000;
/** A value longer than this is shortened: a push carries every changed file as base64 (up to 10 MB). */
const ARG_VALUE_MAX = 160;

/**
 * What the call would send, in one line: the summary the session recorded, else the arguments themselves, with long
 * values (file contents) shortened to their start and length so the keys, paths and branch names stay readable.
 */
export function approvalArgsText(approval: Pick<Approval, "args">, argsSummary?: string | null): string {
  const given = (argsSummary ?? "").trim();
  if (given) return clip(given, ARGS_TEXT_MAX);
  const args = (approval.args ?? {}) as Record<string, unknown>;
  if (typeof args.summary === "string" && Object.keys(args).length === 1) return clip(args.summary.trim(), ARGS_TEXT_MAX);
  if (Object.keys(args).length === 0) return "";
  const text = JSON.stringify(args, (_key, value: unknown) => (typeof value === "string" && value.length > ARG_VALUE_MAX ? `${value.slice(0, 100)}... (${value.length} characters)` : value));
  return clip(text, ARGS_TEXT_MAX);
}

/** The amount an approval's call would commit, formatted in its own currency ("£120.00"), or null when it spends nothing. */
export function approvalAmount(approval: Pick<Approval, "amountMinor" | "currency">): string | null {
  return approval.amountMinor && approval.amountMinor > 0 && approval.currency ? formatMoney({ amountMinor: approval.amountMinor, currency: approval.currency }) : null;
}

/** The Inbox item for one approval: a blocking decision from the agent who asked. */
export function approvalItem(approval: Pick<Approval, "connectorKey" | "tool" | "reasons" | "amountMinor" | "currency" | "args">, details: ApprovalItemDetails) {
  const action = approvalAction(approval, details.connectorName, details.businessName);
  const amount = approvalAmount(approval);
  const what = approvalArgsText(approval, details.argsSummary);
  const reasons = approval.reasons.map((r) => r.trim()).filter(Boolean);
  const task = details.taskTitle?.trim() || null;
  const body = [
    `**${details.agentName}** wants to run **${action}**${task ? ` for the task “${task}”` : ""}${amount ? `, committing **${amount}**` : ""}. The call waits for your answer.`,
    what ? `What it would send: \`${clip(what.replace(/`/g, "'"), 400)}\`` : "",
    reasons.length ? `Why it asks: ${reasons.map((r) => clip(r.replace(/\.$/, ""), 200)).join("; ")}.` : "",
    `Approve and it runs once, exactly as asked. Reject and nothing runs${task ? "; the task stays blocked until you start it again" : ""}.`,
  ].filter(Boolean);
  return {
    type: "decision" as const,
    from_agent_id: details.agentId,
    subject: clip(`${details.agentName} asks to run ${action}`, 80),
    body_md: body.join("\n\n"),
    status_strip: [],
    exhibit: { kind: "none" as const, spec_ref: null },
    decision: {
      options: [
        { id: APPROVAL_OPTIONS.approve, label: "Approve", recommended: true, consequence: `${details.agentName} runs ${action} once${amount ? ` (${amount})` : ""} and carries on.`, cost_minor: 0, reversible: false },
        { id: APPROVAL_OPTIONS.reject, label: "Reject", recommended: false, consequence: task ? `Nothing runs; “${clip(task, 60)}” stays blocked until you start it again.` : "Nothing runs.", cost_minor: 0, reversible: true },
      ],
      free_text: false,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [...(details.sourceEventIds ?? [])],
    entity_ids: [],
  };
}

/** The title of an approval's task, when it has one in this business. */
export async function approvalTaskTitle(db: Executor, businessId: string, approval: Pick<Approval, "taskId">): Promise<string | null> {
  if (!approval.taskId) return null;
  const task = await repos.tasks.get(db, businessId, approval.taskId).catch(() => null);
  return task?.title ?? null;
}

/**
 * Opens the decision item for `approval` and links it, once: an approval that already has its item returns that item
 * (`created: false`). The narrated `approval.requested` events are marked so the composer leaves them alone.
 */
export async function openApprovalItem(db: Executor, businessId: string, approval: Approval, details: ApprovalItemDetails): Promise<{ item: InboxItem; created: boolean }> {
  if (approval.inboxItemId) return { item: await repos.inbox.get(db, businessId, approval.inboxItemId), created: false };
  return db.transaction(async (tx) => {
    const taskTitle = details.taskTitle !== undefined ? details.taskTitle : await approvalTaskTitle(tx, businessId, approval);
    const businessName = details.businessName ?? (approval.connectorKey === PLATFORM_CONNECTOR ? (await repos.businesses.get(tx, businessId)).name : null);
    const item = await repos.inbox.createItem(tx, businessId, approvalItem(approval, { ...details, taskTitle, businessName }));
    await repos.approvals.linkInboxItem(tx, businessId, approval.id, item.id);
    if (details.sourceEventIds?.length) await repos.events.markNarrated(tx, businessId, details.sourceEventIds);
    return { item, created: true };
  });
}

/**
 * The approval's item no longer asks anything (it was decided outside the Inbox, or expired): it stops blocking
 * Continue. A decision by the founder or the Chief of Staff is recorded on the item as theirs; anything else (an
 * expiry, a recorded hold that resolved by itself) archives it. Null when there was nothing open to close.
 */
export async function closeApprovalItem(db: Executor, businessId: string, approval: Pick<Approval, "inboxItemId" | "outcome" | "byKind" | "byId">): Promise<InboxItem | null> {
  if (!approval.inboxItemId) return null;
  const item = await repos.inbox.get(db, businessId, approval.inboxItemId);
  if (item.state === "answered" || item.state === "archived") return null;
  const decidedBy = approval.byKind === "user" || approval.byKind === "chief_of_staff" ? approval.byKind : null;
  if (decidedBy && (approval.outcome === "approved" || approval.outcome === "rejected")) {
    const decided = await repos.inbox.decide(db, businessId, item.id, { chosenOption: approval.outcome === "approved" ? APPROVAL_OPTIONS.approve : APPROVAL_OPTIONS.reject, decidedByKind: decidedBy, decidedBy: approval.byId ?? null });
    return decided.item;
  }
  // Settled some other way (expired, resolved by a plan): the question is gone, so the note closes without an answer.
  return repos.inbox.archive(db, businessId, item.id, { force: true });
}
