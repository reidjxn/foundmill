/**
 * The founder's side of an approval (audit FR-01 / O-02): every approval opened for a gated call becomes one decision
 * Inbox item that names the agent, the task, the call and its amount, and offers Approve and Reject. It blocks Continue
 * until it is answered; `inbox.decide` (and `team.approvals.resolve`) resolve the approval through it and send the
 * decision to whatever waits on it. The approval's `approval.requested` event is marked narrated with the item, so the
 * composer never writes a second, vaguer note about it.
 *
 * Callers write `inbox.item_created` through the outbox themselves (the event schemas live in @foundmill/events).
 */
import { agentMention, formatMoney, founderWords, type Section } from "@foundmill/shared";
import { approvalWhatExactly, channelWords, type ApprovalWhat } from "./approval-content";
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
  /**
   * A GitHub call: whether a repository is connected to the business (first-time founder report, Nov 8, 2026: never ask
   * for a GitHub action with nothing to run it on; ask to connect first). Read from the integrations when omitted.
   */
  githubConnected?: boolean | null;
  /** What exactly the call would run, when the caller already built it (`approvalWhatExactly` from the arguments otherwise). */
  what?: ApprovalWhat;
}

/** The connectors a call needs connected before it can run anywhere; the others run on the platform or need no account. */
const NEEDS_CONNECTION = new Set(["github"]);

/** A connected integration row: present, not archived, and not disconnected (a mock installation counts: it runs somewhere). */
export const integrationConnected = (row: { archivedAt: Date | null; status: string } | null): boolean => row !== null && row.archivedAt === null && row.status !== "disconnected";

/** Calls batched into one decision when several open at once (one answer covers all; each keeps its own row). */
export const BATCHED_TOOLS: Readonly<Record<string, { connectorKey: string }>> = { launch_campaign: { connectorKey: PLATFORM_CONNECTOR } };
export const isBatchedApproval = (approval: Pick<Approval, "connectorKey" | "tool">): boolean => approval.tool !== null && BATCHED_TOOLS[approval.tool]?.connectorKey === approval.connectorKey;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** One of an approval note's two options (the decision's own shape, typed here so the variants share it). */
interface ApprovalOption {
  id: ApprovalOptionId;
  label: string;
  recommended: boolean;
  consequence: string;
  cost_minor: number;
  reversible: boolean;
}

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
  // The subject and the option lines are plain text with the stored name (the web names the agent under each reader's
  // preference with `withAgentNames`); the body names it as markup, which EntityLink renders the same way. Stored text
  // never carries a display choice (docs/DECISIONS.md, One name everywhere).
  const who = details.agentName.trim() || "The team";
  const whoMd = agentMention({ id: details.agentId, name: details.agentName }) || who;
  const what = details.what ?? approvalWhatExactly(approval);
  const base = { type: "decision" as const, from_agent_id: details.agentId, status_strip: [], exhibit: { kind: "none" as const, spec_ref: null }, source_event_ids: [...(details.sourceEventIds ?? [])], entity_ids: [] };
  const decide = (options: ApprovalOption[]) => ({ options, free_text: false as const, expires_at: null });
  // No GitHub connected (first-time founder report, Nov 8, 2026): there is nowhere for the call to run, so the question is
  // not "OK?" but "connect GitHub first"; Approve stays possible and says the call waits for the connection.
  if (approval.connectorKey && NEEDS_CONNECTION.has(approval.connectorKey) && details.githubConnected === false) {
    const service = connectorLabel(approval.connectorKey);
    const business = details.businessName?.trim() || "the business";
    return {
      ...base,
      subject: clip(`${who} needs ${service} connected: ${toolWords(approval.tool)}`, 80),
      body_md: `${whoMd} wants to ${toolWords(approval.tool)} on ${service}${task ? ` for “${task}”` : ""}, but no ${service} repository is connected to ${business} yet, so it has nowhere to run. Connect one first.`,
      decision: decide([
        { id: APPROVAL_OPTIONS.reject, label: `Connect ${service} first`, recommended: true, consequence: `Nothing runs. Connect ${service} in Settings › Integrations; ${who} asks again when it next works on the task.`, cost_minor: 0, reversible: true },
        { id: APPROVAL_OPTIONS.approve, label: "Approve anyway", recommended: false, consequence: `Nothing can run until ${service} is connected; the approval waits for that.`, cost_minor: 0, reversible: false },
      ]),
      blocks_continue: true,
    };
  }
  // Nothing says what would run: the founder cannot decide it, so the note asks them to send it back for the details.
  if (what.empty && !isReleaseApproval(approval)) {
    return {
      ...base,
      subject: clip(`${who} asks without saying what: ${action}`, 80),
      body_md: `${whoMd} wants to ${toolWords(approval.tool)}${approval.connectorKey && approval.connectorKey !== PLATFORM_CONNECTOR ? ` on ${connectorLabel(approval.connectorKey)}` : ""}${task ? ` for “${task}”` : ""}${amount ? `, spending **${amount}**` : ""}, but did not say exactly what it would run. Ask for the details before deciding.`,
      decision: decide([
        { id: APPROVAL_OPTIONS.reject, label: "Ask for the details", recommended: true, consequence: `Nothing runs; ${who} is told to describe exactly what it would run and ask again.`, cost_minor: 0, reversible: true },
        { id: APPROVAL_OPTIONS.approve, label: "Approve anyway", recommended: false, consequence: `${who} runs ${action} once${amount ? ` (${amount})` : ""}, unseen, and carries on.`, cost_minor: 0, reversible: false },
      ]),
      blocks_continue: true,
    };
  }
  if (isReleaseApproval(approval)) {
    const tests = details.tests === undefined ? null : details.tests;
    const tested = tests && tests.total > 0 ? (tests.passing === tests.total ? "It passed every quality check." : "It passed most of its quality checks.") : tests === null && details.tests !== undefined ? "No automatic check covers this change." : "";
    const body = `${whoMd} finished${task ? ` “${task}”` : " a change"}. ${tested} OK to put it live?`.replace(/\s+/g, " ");
    return {
      type: "decision" as const,
      from_agent_id: details.agentId,
      subject: clip(`${who}'s change is ready to go live`, 80),
      body_md: body,
      status_strip: [],
      exhibit: { kind: "none" as const, spec_ref: null },
      decision: {
        options: [
          { id: APPROVAL_OPTIONS.approve, label: "Put it live", recommended: true, consequence: `It goes live once the final quality checks pass; if one fails, ${who} fixes it and asks again.`, cost_minor: 0, reversible: false },
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
  const body = `${whoMd} wants to ${toolWords(approval.tool)}${approval.connectorKey && approval.connectorKey !== PLATFORM_CONNECTOR ? ` on ${connectorLabel(approval.connectorKey)}` : ""}${task ? ` for “${task}”` : ""}${amount ? `, spending **${amount}**` : ""}. OK?`;
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

/**
 * The next step after the founder said no to a change going live without saying why (WP-05 T16, A4-13): one question,
 * "What should happen to this change?", answered with the founder's words (the change goes back to its agent) or Drop
 * (the task is put away and the work that waited on it goes ahead). Recognized by `decision.key`, which carries the
 * approval it follows (`release.follow_up:<approvalId>`; the stored decision keeps no other field), and through it the
 * task. Never holds Continue, as the release itself does not.
 */
export const RELEASE_FOLLOW_UP = { key: "release.follow_up", subject: "What should happen to this change?", options: { rework: "release_rework", drop: "release_drop" }, reworkLabel: "Tell the team what to change", dropLabel: "Drop this change" } as const;

export function releaseFollowUpItem(details: { agentId: string; agentName: string; taskTitle: string; approvalId: string }) {
  const who = details.agentName.trim() || "The team";
  const whoMd = agentMention({ id: details.agentId, name: details.agentName }) || who;
  return {
    type: "decision" as const,
    from_agent_id: details.agentId,
    subject: RELEASE_FOLLOW_UP.subject,
    body_md: `You did not put ${whoMd}'s change for “${clip(details.taskTitle, 120)}” live. ${RELEASE_FOLLOW_UP.subject}`,
    status_strip: [],
    exhibit: { kind: "none" as const, spec_ref: null },
    decision: {
      options: [
        { id: RELEASE_FOLLOW_UP.options.rework, label: RELEASE_FOLLOW_UP.reworkLabel, recommended: true, consequence: `Write what should change; ${who} reworks it and asks you again.`, cost_minor: 0, reversible: true },
        { id: RELEASE_FOLLOW_UP.options.drop, label: RELEASE_FOLLOW_UP.dropLabel, recommended: false, consequence: "Nothing goes live and the task is put away; the work that waited on it goes ahead without it.", cost_minor: 0, reversible: false },
      ],
      free_text: true,
      expires_at: null,
      key: `${RELEASE_FOLLOW_UP.key}:${details.approvalId}`,
    },
    blocks_continue: false,
    source_event_ids: [],
    entity_ids: [],
  };
}

/** The approval a release follow-up is about, or null for any other decision. */
export function releaseFollowUpOf(decision: unknown): { approvalId: string } | null {
  const key = decision && typeof decision === "object" ? (decision as { key?: unknown }).key : null;
  const prefix = `${RELEASE_FOLLOW_UP.key}:`;
  return typeof key === "string" && key.startsWith(prefix) && key.length > prefix.length ? { approvalId: key.slice(prefix.length) } : null;
}

/**
 * The instruction a change carries back to its agent when the founder said no with words: the founder's words first, as
 * the instruction, then what the next session must do. The agent reads all of it (`## Why this task is back`).
 */
export function founderReworkDetail(words: string, branch: string): string {
  const said = words.trim().replace(/\s+/g, " ").slice(0, 1200);
  return `The founder's instruction: “${said}”. The founder did not put this change live and asked for this first. Bring your working copy (${branch}) up to date with the newest version of the product, make the change the founder asked for, keep every check passing, and finish; it is offered to go live again when the checks pass.`.slice(0, 2000);
}

/** One line per batched request: "Paid advertising (£600.00)". */
export function batchLine(approval: Pick<Approval, "args" | "amountMinor" | "currency">): string {
  const args = (approval.args ?? {}) as Record<string, unknown>;
  const key = typeof args.channelKey === "string" ? args.channelKey : typeof args.channel_key === "string" ? args.channel_key : "";
  const amount = approvalAmount(approval);
  return `${key ? channelWords(key) : "A channel"}${amount ? ` (${amount})` : ""}`;
}

/**
 * The one decision several same-kind requests share (first-time founder report, Nov 8, 2026: five "wants to launch
 * campaign. OK?" notes in a row became one "5 channels want to launch their first campaign"): the subject counts them,
 * the body lists each with its budget, the reading pane shows each campaign's copy, and one answer covers all of them.
 */
export function batchApprovalItem(batch: readonly Pick<Approval, "connectorKey" | "tool" | "args" | "amountMinor" | "currency">[], details: Pick<ApprovalItemDetails, "agentId" | "agentName" | "sourceEventIds">) {
  const n = batch.length;
  const who = details.agentName.trim() || "The team";
  const whoMd = agentMention({ id: details.agentId, name: details.agentName }) || who;
  const lines = batch.map(batchLine);
  const total = batch.reduce((s, a) => s + (a.amountMinor ?? 0), 0);
  const currency = batch.find((a) => a.currency)?.currency ?? null;
  const spend = total > 0 && currency ? formatMoney({ amountMinor: total, currency }) : null;
  return {
    type: "decision" as const,
    from_agent_id: details.agentId,
    subject: clip(`${n} channels want to launch a campaign`, 80),
    body_md: `${n} channels are ready to launch their campaign: ${lines.join(", ")}${spend ? `, **${spend}** in all` : ""}. ${whoMd} asks for one yes for all of them; each campaign's copy and budget is below. OK?`,
    status_strip: [],
    exhibit: { kind: "none" as const, spec_ref: null },
    decision: {
      options: [
        { id: APPROVAL_OPTIONS.approve, label: "Approve all", recommended: true, consequence: `Each of the ${n} channels launches its campaign once${spend ? ` (${spend} in all)` : ""} and carries on.`, cost_minor: 0, reversible: false },
        { id: APPROVAL_OPTIONS.reject, label: "Reject all", recommended: false, consequence: "Nothing launches; the channels wait for you.", cost_minor: 0, reversible: true },
      ],
      free_text: false,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [...(details.sourceEventIds ?? [])],
    entity_ids: [],
  };
}

/**
 * The open batch item a same-kind request joins, if there is one: another approval of the same call, still unanswered,
 * whose Inbox note is still open. Null when the request opens a note of its own.
 */
export async function openBatchFor(db: Executor, businessId: string, approval: Pick<Approval, "id" | "connectorKey" | "tool">): Promise<{ item: InboxItem; approvals: Approval[] } | null> {
  if (!isBatchedApproval(approval)) return null;
  const pending = await repos.approvals.pending(db, businessId, 200);
  const sibling = pending.find((a) => a.id !== approval.id && a.tool === approval.tool && a.connectorKey === approval.connectorKey && a.inboxItemId !== null);
  if (!sibling?.inboxItemId) return null;
  const item = await repos.inbox.get(db, businessId, sibling.inboxItemId);
  if (item.state !== "unread" && item.state !== "read") return null;
  return { item, approvals: await repos.approvals.listForInboxItem(db, businessId, item.id) };
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
export async function openApprovalItem(db: Executor, businessId: string, approval: Approval, details: ApprovalItemDetails): Promise<{ item: InboxItem; created: boolean; joined?: boolean }> {
  if (approval.inboxItemId) return { item: await repos.inbox.get(db, businessId, approval.inboxItemId), created: false };
  return db.transaction(async (tx) => {
    // A same-kind request already waiting: this one joins its note (first-time founder report, Nov 8, 2026), which is
    // rewritten to count them all; one answer covers every approval linked to it.
    const batch = await openBatchFor(tx, businessId, approval);
    if (batch) {
      await repos.approvals.linkInboxItem(tx, businessId, approval.id, batch.item.id);
      const all = [...batch.approvals, approval];
      const item = await repos.inbox.revise(tx, businessId, batch.item.id, batchApprovalItem(all, { agentId: batch.item.fromAgentId ?? details.agentId, agentName: details.agentName, sourceEventIds: details.sourceEventIds }));
      if (details.sourceEventIds?.length) await repos.events.markNarrated(tx, businessId, details.sourceEventIds);
      return { item, created: false, joined: true };
    }
    const taskTitle = details.taskTitle !== undefined ? details.taskTitle : await approvalTaskTitle(tx, businessId, approval);
    const businessName = details.businessName ?? (approval.connectorKey === PLATFORM_CONNECTOR || (approval.connectorKey && NEEDS_CONNECTION.has(approval.connectorKey)) ? (await repos.businesses.get(tx, businessId)).name : null);
    const tests = details.tests !== undefined ? details.tests : isReleaseApproval(approval) ? await approvalTaskTests(tx, businessId, approval) : undefined;
    const githubConnected = details.githubConnected !== undefined ? details.githubConnected : approval.connectorKey && NEEDS_CONNECTION.has(approval.connectorKey) ? integrationConnected(await repos.integrations.getByKey(tx, businessId, approval.connectorKey)) : null;
    const item = await repos.inbox.createItem(tx, businessId, approvalItem(approval, { ...details, taskTitle, businessName, githubConnected, ...(tests !== undefined ? { tests } : {}) }));
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
