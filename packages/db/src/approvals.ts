/**
 * The founder's side of an approval (audit FR-01 / O-02): every approval opened for a gated call becomes one decision
 * Inbox item that names the agent, the task, the call and its amount, and offers Approve and Reject. It blocks Continue
 * until it is answered; `inbox.decide` (and `team.approvals.resolve`) resolve the approval through it and send the
 * decision to whatever waits on it. The approval's `approval.requested` event is marked narrated with the item, so the
 * composer never writes a second, vaguer note about it.
 *
 * Callers write `inbox.item_created` through the outbox themselves (the event schemas live in @foundmill/events).
 */
import { formatMoney, founderWords, type Section } from "@foundmill/shared";
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

/** "run a change to the data layout" from `run_migration`: the tool's words, in the founder's (the shared map, 2026-11-01). */
export const toolWords = (tool: string | null | undefined): string => (tool ? founderWords(tool.replace(/[_.]+/g, " ").trim()) : "an action");

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

/**
 * Why the platform asked, in the founder's words. Policy reasons are the Cedar rules' own sentences ("Assisted mode:
 * irreversible actions need approval"): mode names and "irreversible" mean nothing to a solo founder, so each known kind
 * maps to what they chose; a reason this table does not know is left out of the note (the reading pane's Details keep it).
 */
export function founderReason(reason: string): string | null {
  const r = reason.toLowerCase();
  if (/goes live|go live/.test(r)) return "You chose to be asked before anything goes live.";
  if (/contract/.test(r)) return "You chose to be asked before any contract.";
  if (/threshold|spend|amount/.test(r)) return "This would spend more than you allowed without asking.";
  if (/irreversible|undone/.test(r)) return "You chose to be asked before anything that can't be undone.";
  if (/external|third.part|contact|recipient/.test(r)) return "You chose to be asked before the team contacts anyone outside the business.";
  if (/augmented/.test(r)) return "You chose to be asked before the team acts on its own.";
  return null;
}

/** The distinct founder-worded reasons of an approval, in order; empty when none of them maps. */
export function founderReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons.map(founderReason).filter((r): r is string => r !== null))];
}

/** A release: `merge_pr` on GitHub, which the Inbox words as "goes live" (decision 2026-11-01). */
export const isReleaseApproval = (approval: Pick<Approval, "connectorKey" | "tool">): boolean => approval.connectorKey === "github" && (approval.tool === "merge_pr" || approval.tool === "merge_pull_request");

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
  /** A release: what the platform's own tests found on the change (null: nothing to test), read from the task when omitted. */
  tests?: { passing: number; total: number } | null;
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

/**
 * The Inbox item for one approval: a decision from the agent who asked, written for the founder in two sentences: what
 * happened and the one question. What yes and no do is on the two options (their consequence lines), why the founder is
 * asked is the reading pane's own row, and the call itself and its arguments stay in the pane's Details (ApprovalPanel),
 * for a developer. Until Nov 3, 2026 the note carried four labeled paragraphs (what happened, what is needed, what yes
 * and no do, why asked) and the founder read it as far too much: "I just want it to work."
 *
 * A release ("goes live") never holds Continue: the merge waits for the founder's answer in the background, and the
 * next round of work needs nothing from it. Every other call holds Continue as before, since its session stopped on it.
 */
export function approvalItem(approval: Pick<Approval, "connectorKey" | "tool" | "reasons" | "amountMinor" | "currency" | "args">, details: ApprovalItemDetails) {
  const action = approvalAction(approval, details.connectorName, details.businessName);
  const amount = approvalAmount(approval);
  const task = details.taskTitle?.trim() || null;
  const who = details.agentName.trim() || "The team";
  if (isReleaseApproval(approval)) {
    const tests = details.tests === undefined ? null : details.tests;
    const tested = tests && tests.total > 0 ? (tests.passing === tests.total ? `All ${tests.total} test${tests.total === 1 ? "" : "s"} passed.` : `${tests.passing} of ${tests.total} tests passed.`) : tests === null && details.tests !== undefined ? "There was nothing in it to test." : "";
    const body = `${who} finished${task ? ` “${task}”` : " a change"}. ${tested} OK to put it live?`.replace(/\s+/g, " ");
    return {
      type: "decision" as const,
      from_agent_id: details.agentId,
      subject: clip(`${who}'s change is ready to go live`, 80),
      body_md: body,
      status_strip: [],
      exhibit: { kind: "none" as const, spec_ref: null },
      decision: {
        options: [
          { id: APPROVAL_OPTIONS.approve, label: "Put it live", recommended: true, consequence: `It goes live once the automatic tests pass; if they fail, ${who} fixes it and asks again.`, cost_minor: 0, reversible: false },
          { id: APPROVAL_OPTIONS.reject, label: "Not now", recommended: false, consequence: "Nothing changes; the work waits for you.", cost_minor: 0, reversible: true },
        ],
        free_text: false,
        expires_at: null,
      },
      blocks_continue: false,
      source_event_ids: [...(details.sourceEventIds ?? [])],
      entity_ids: [],
    };
  }
  const body = `${who} wants to ${toolWords(approval.tool)}${approval.connectorKey && approval.connectorKey !== PLATFORM_CONNECTOR ? ` on ${connectorLabel(approval.connectorKey)}` : ""}${task ? ` for “${task}”` : ""}${amount ? `, spending **${amount}**` : ""}. OK?`;
  return {
    type: "decision" as const,
    from_agent_id: details.agentId,
    subject: clip(`${who} needs your OK: ${action}`, 80),
    body_md: body,
    status_strip: [],
    exhibit: { kind: "none" as const, spec_ref: null },
    decision: {
      options: [
        { id: APPROVAL_OPTIONS.approve, label: "Approve", recommended: true, consequence: `${who} runs ${action} once${amount ? ` (${amount})` : ""} and carries on.`, cost_minor: 0, reversible: false },
        { id: APPROVAL_OPTIONS.reject, label: "Reject", recommended: false, consequence: task ? `Nothing runs; “${clip(task, 60)}” waits until you start it again.` : "Nothing runs.", cost_minor: 0, reversible: true },
      ],
      free_text: false,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [...(details.sourceEventIds ?? [])],
    entity_ids: [],
  };
}

/** What the platform's own tests found on a task's latest finished session (its `task.completed`), or null when nothing was there to test. */
export async function approvalTaskTests(db: Executor, businessId: string, approval: Pick<Approval, "taskId">): Promise<{ passing: number; total: number } | null> {
  if (!approval.taskId) return null;
  const completed = await repos.events.list(db, businessId, { type: "task.completed", limit: 200 });
  const latest = completed.items.find((e) => (e.payload as { taskId?: unknown }).taskId === approval.taskId);
  const p = latest?.payload as { acceptanceTests?: unknown; acceptanceTestsPassing?: unknown } | undefined;
  if (!p || typeof p.acceptanceTests !== "number" || p.acceptanceTests <= 0) return null;
  return { passing: typeof p.acceptanceTestsPassing === "number" ? p.acceptanceTestsPassing : 0, total: p.acceptanceTests };
}

/** The title of an approval's task, when it has one in this business. */
export async function approvalTaskTitle(db: Executor, businessId: string, approval: Pick<Approval, "taskId">): Promise<string | null> {
  if (!approval.taskId) return null;
  const task = await repos.tasks.get(db, businessId, approval.taskId).catch(() => null);
  // The founder's title when the Composer has written one (0070); the technical title is for the developer's Details.
  return task?.founderTitle ?? task?.title ?? null;
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
    const tests = details.tests !== undefined ? details.tests : isReleaseApproval(approval) ? await approvalTaskTests(tx, businessId, approval) : undefined;
    const item = await repos.inbox.createItem(tx, businessId, approvalItem(approval, { ...details, taskTitle, businessName, ...(tests !== undefined ? { tests } : {}) }));
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
