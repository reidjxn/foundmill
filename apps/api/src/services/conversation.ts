/**
 * Founder ↔ agent conversations (audit-conversation §4): the agent's desk.
 *
 * get     thread + messages + persona (presence, current task, voice) + deterministic starters. No model call.
 * send    the founder's text or a pressed quick reply →
 *           choose_option on an Inbox decision → the existing decide path (`decideInboxItem`) + a short acknowledgement;
 *           "Review the plan" on a hand-off → the hand-off is staged (below) + a short acknowledgement;
 *           anything else → the `conversation` route (house rules first) → `finaliseAgentReply` (mentions, hard gates,
 *           2–4 quick replies) → both messages, `conversation.message_posted` × 2 and the audit entry in ONE transaction.
 *         The model is called before the transaction opens, so no connection waits on it; a failed call writes nothing.
 * handOff an agent message's hand-off → `compilePlan` + `evaluatePlan` → the plan.preview shape, and the plan is staged
 *         as `pending_confirmation`. Nothing executes here: the founder runs it with the existing `plan.confirm` (or
 *         answers an Inbox decision with `inbox.decide`).
 * inboxReply  Inbox free text: a question goes to the conversation (it never uses up the decision); an instruction goes
 *         to `decideInboxItem` as before.
 *
 * A conversation never moves money, signs, accepts terms, files, deletes or changes security settings: the only way work
 * leaves it is a hand-off, and hard-gated work compiles to `request_human_action` (a founder task).
 */
import { APP_NAME } from "@foundmill/config";
import {
  AgentInstructions,
  DEFAULT_VOICE,
  TAKE_A_BREAK_ID,
  ackLine,
  agentPresence,
  buildConversationRequest,
  conversationStarters,
  finaliseAgentReply,
  finaliseOptionsFor,
  getTemplate,
  conceptConversationInput,
  getTemplateByAgentType,
  isConversationalText,
  nudgePresets,
  presenceLabel,
  quickReply,
  thinkingLine,
  type AgentVoice,
  type ConceptCardInput,
  type ConversationRequestInput,
  type ConversationSubjectInput,
  type ConversationTaskInput,
  type MentionGuard,
  type NudgePreset,
  type StarterSubject,
} from "@foundmill/agents";
import { repos, type Agent, type AgentMessage, type AgentThread, type DbTx, type InboxItem, type PlanWithActions, type Task } from "@foundmill/db";
import { buildManifest, stripInvalidMentions, stripMarkup, validateMarkup, type ManifestEntityInput } from "@foundmill/entity-linker";
import { type AgentReplyOutput, type ModelClient, type PlanAction, type QuickReply } from "@foundmill/models";
import {
  CONVERSATION_SUBJECT_KINDS,
  NotFoundError,
  ValidationError,
  formatMoney,
  type AgentPresence,
  type AgentReaction,
  type AgentStatus,
  type ConversationAuthorKind,
  type ConversationSubjectKind,
  type DeptColourToken,
  type EntityKind,
} from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audit, effectivePermission, emit, hasSectionAccess, Id, type BusinessContext, type Section } from "../trpc";
import { decideInboxItem, planContextFor, type DecideItemResult } from "./decide";
import { idsOfItem, inboxWalls, isWalled, loadRedactionSource, mentionIds, noteMask, redactInboxItem, redactPlan, redactText, redactValue } from "./inbox-redaction";
import { assertPlanSectionAccess, compilePlan, evaluatePlan, requiresConfirmation, type ActionEvaluation } from "./plans";
import { RateLimitedError, SlidingWindowLimiter, type WindowLimit } from "./rate-limit";

// ---------------------------------------------------------------------------------------------------------------------
// Limits: every send can be a model call (a reply, a plan compile), so sends are bounded per person and per business.
// Process-local like the logo limits (see rate-limit.ts for the replica caveat).
// ---------------------------------------------------------------------------------------------------------------------

export const conversationLimiter = new SlidingWindowLimiter();
const MINUTE = 60_000;
export const CONVERSATION_LIMITS = {
  /** A person pressing quick replies as fast as replies arrive stays well inside this; a script or a stuck key does not. */
  burst: { limit: 20, windowMs: MINUTE },
  user: { limit: 240, windowMs: 60 * MINUTE },
  business: { limit: 1200, windowMs: 24 * 60 * MINUTE },
} as const satisfies Record<string, WindowLimit>;

/** Spends one send from every limit that applies (no business for a concept's Ask), or throws TOO_MANY_REQUESTS. */
export function takeConversationAllowance(scope: { userId: string; businessId?: string | null }): void {
  const entries = [
    { key: `conversation:burst:${scope.userId}`, rule: CONVERSATION_LIMITS.burst },
    { key: `conversation:user:${scope.userId}`, rule: CONVERSATION_LIMITS.user },
    ...(scope.businessId ? [{ key: `conversation:business:${scope.businessId}`, rule: CONVERSATION_LIMITS.business }] : []),
  ];
  const r = conversationLimiter.takeAll(entries);
  if (!r.ok) throw new RateLimitedError("Conversation", r.retryAfterMs);
}

// ---------------------------------------------------------------------------------------------------------------------
// Inputs and component-facing types
// ---------------------------------------------------------------------------------------------------------------------

export const ConversationSubject = z.object({ kind: z.enum(CONVERSATION_SUBJECT_KINDS), id: Id });
export type ConversationSubject = z.infer<typeof ConversationSubject>;

export const SendInput = z
  .object({
    subject: ConversationSubject,
    /** What the founder typed (optional: every message can be a quick reply instead). */
    text: z.string().trim().min(1).max(2000).optional(),
    /** A quick reply from the latest agent message, or a starter. */
    quickReplyId: z.string().regex(/^[a-z0-9_-]{1,24}$/).optional(),
    /**
     * The option the pressed chip names on the founder's screen (`option_id`, null for a chip that names none). Chip ids
     * repeat across messages ("go_with"), so a tab showing an older message could otherwise decide whichever option the
     * newest message's chip of that id names: a chip that no longer names this option is refused as stale. Optional for
     * older clients.
     */
    optionId: z.string().max(40).nullable().optional(),
  })
  .refine((v) => (v.text ? 1 : 0) + (v.quickReplyId ? 1 : 0) === 1, { message: "Send either text or a quick reply", path: ["text"] });
export type SendInput = z.infer<typeof SendInput>;

/** Inbox items are the Inbox's; the agent and its tasks are the Team's (section permissions, BUILD §11.9). */
export const sectionForSubject = (kind: ConversationSubjectKind): Section => (kind === "inbox_item" ? "inbox" : "team");

export function assertSubjectAccess(ctx: Pick<BusinessContext, "membership">, kind: ConversationSubjectKind, level: "read" | "write"): void {
  const section = sectionForSubject(kind);
  const have = effectivePermission(ctx.membership, section);
  if (!(have === "write" || (level === "read" && have === "read"))) throw new TRPCError({ code: "FORBIDDEN", message: `You do not have ${level} access to ${section}` });
}

export interface ConversationCurrentTask {
  id: string;
  title: string;
  status: string;
  phase: string | null;
  /** 0–1. */
  progress: number;
  eta: Date | null;
}

/** Everything the desk header needs: portrait, live status ring, presence line, current work and voice. */
export interface ConversationPersona {
  id: string;
  name: string;
  role: string;
  avatarSeed: string;
  layer: string;
  /** The first department's colour (the bubble tint and the portrait ring); null for agents outside a department. */
  colourToken: DeptColourToken | null;
  status: AgentStatus;
  presence: AgentPresence;
  /** "In a session · Carton artwork proof round 2", "Available", "Away · paused", "Down". */
  presenceLabel: string;
  currentTask: ConversationCurrentTask | null;
  voice: AgentVoice;
  /** The typing line to show while a reply is in flight; names what the agent is looking at. */
  thinkingLine: string;
  /** Nudge presets that fit this agent (Live sessions menu). */
  nudges: NudgePreset[];
  /** Always true: the header shows a small "AI agent" marker (house rule 3). */
  isAgent: true;
}

export interface ConversationSubjectView {
  kind: ConversationSubjectKind;
  id: string;
  title: string;
  /** Inbox items: the item type (`decision`, `update`, ...). */
  itemType: string | null;
  /** Inbox decisions: already answered (no choose_option offered). */
  answered: boolean;
  /** Inbox decisions: the options, for "Go with: …". */
  options: Array<{ id: string; label: string; recommended: boolean }>;
}

export interface ConversationMessageView {
  id: string;
  threadId: string;
  author: ConversationAuthorKind;
  /** Markdown with `[[ent:<id>|Name]]` (validated against the manifest); render through EntityText. */
  bubbles: string[];
  at: Date;
  reaction: AgentReaction;
  /** Agent messages: the 2–4 quick replies offered. Founder messages: []. */
  quickReplies: QuickReply[];
  /** Founder messages: the chip pressed. Agent messages: the chip the founder pressed in reply to it, if any. */
  chosenQuickReplyId: string | null;
  handOff: { instruction: string; gated: boolean } | null;
  planId: string | null;
  /** Stored messages have been accepted by the server ("Seen"). */
  state: "seen";
}

export interface ConversationView {
  subject: ConversationSubjectView;
  thread: AgentThread | null;
  messages: ConversationMessageView[];
  persona: ConversationPersona;
  /** Shown on an empty desk; deterministic, no model call. */
  starters: QuickReply[];
  /** The chips to show now: the latest agent message's quick replies, or the starters. */
  quickReplies: QuickReply[];
}

/** The plan.preview shape plus the staged plan (pending confirmation; run it with `plan.confirm`). */
export interface HandOffPreview {
  messageId: string;
  instruction: string;
  summary: string;
  source: "model" | "rules" | "stored";
  evaluations: ActionEvaluation[];
  /** Policy says "ask" for at least one action. The staged plan always waits for the founder's confirmation. */
  requiresConfirmation: boolean;
  hardGates: number;
  planId: string;
  plan: PlanWithActions;
  /** The Inbox item the conversation is about, when it is one (the founder may answer it with `inbox.decide` instead). */
  inboxItemId: string | null;
}

export interface SendResult {
  thread: AgentThread;
  /** The founder's message, then the agent's reply. */
  messages: ConversationMessageView[];
  /** The chips to show now (the reply's quick replies). */
  quickReplies: QuickReply[];
  /** Set when a choose_option quick reply decided the Inbox item (show ConfirmPlanDialog when it requires confirmation). */
  decision: DecideItemResult | null;
  /** Set when "Review the plan" staged a hand-off (show ConfirmPlanDialog; confirm with `plan.confirm`). */
  handOff: HandOffPreview | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Subject, persona and context
// ---------------------------------------------------------------------------------------------------------------------

interface ItemOption {
  id: string;
  label: string;
  recommended?: boolean;
  consequence?: string;
  cost_minor?: number;
  reversible?: boolean;
}

interface Resolved {
  subject: ConversationSubjectView;
  agent: Agent;
  item: InboxItem | null;
  task: Task | null;
  currentTask: Task | null;
  nextTask: Task | null;
  options: ItemOption[];
  starters: QuickReply[];
}

const humanise = (s: string) => s.replace(/[._-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const progressOf = (t: Task) => Math.max(0, Math.min(1, Number(t.progress) || 0));
const ACTIVE_STATUSES = ["running", "paused", "blocked", "review"] as const;

function itemOptions(item: InboxItem): ItemOption[] {
  const raw = (item.decision as { options?: unknown } | null)?.options;
  return Array.isArray(raw) ? raw.filter((o): o is ItemOption => typeof o === "object" && o !== null && typeof (o as ItemOption).id === "string" && typeof (o as ItemOption).label === "string") : [];
}

const isAnswered = (item: InboxItem) => item.state === "answered" || item.state === "archived";

async function resolve(tx: DbTx, ctx: BusinessContext, subject: ConversationSubject): Promise<Resolved> {
  const businessId = ctx.businessId;
  const fallbackAgent = async () => {
    const chief = await repos.agents.chiefOfStaff(tx, businessId);
    if (!chief) throw new ValidationError("This business has no Chief of Staff to talk to");
    return chief;
  };
  let item: InboxItem | null = null;
  let task: Task | null = null;
  let agent: Agent;
  let view: ConversationSubjectView;
  if (subject.kind === "inbox_item") {
    item = await repos.inbox.get(tx, businessId, subject.id);
    agent = item.fromAgentId ? await repos.agents.get(tx, businessId, item.fromAgentId) : await fallbackAgent();
    view = { kind: "inbox_item", id: item.id, title: item.subject, itemType: item.type, answered: isAnswered(item), options: itemOptions(item).map((o) => ({ id: o.id, label: o.label, recommended: o.recommended === true })) };
  } else if (subject.kind === "task") {
    task = await repos.tasks.get(tx, businessId, subject.id);
    agent = task.assigneeAgentId ? await repos.agents.get(tx, businessId, task.assigneeAgentId) : await fallbackAgent();
    view = { kind: "task", id: task.id, title: task.title, itemType: null, answered: false, options: [] };
  } else {
    agent = await repos.agents.get(tx, businessId, subject.id);
    view = { kind: "agent", id: agent.id, title: agent.name, itemType: null, answered: false, options: [] };
  }
  const [active, queued] = await Promise.all([
    repos.tasks.list(tx, businessId, { assigneeAgentId: agent.id, status: [...ACTIVE_STATUSES], limit: 10 }),
    repos.tasks.list(tx, businessId, { assigneeAgentId: agent.id, status: ["ready", "planned"], limit: 5 }),
  ]);
  const running = active.items.find((t) => t.status === "running") ?? active.items[0] ?? null;
  const currentTask = subject.kind === "task" && task ? task : running;
  const nextTask = queued.items.find((t) => t.id !== currentTask?.id) ?? null;
  const options = item ? itemOptions(item) : [];
  const starterSubject: StarterSubject =
    subject.kind === "inbox_item" && item
      ? { kind: "inbox_item", itemType: item.type, answered: isAnswered(item), options: options.map((o) => ({ id: o.id, label: o.label, recommended: o.recommended === true })) }
      : { kind: subject.kind === "task" ? "task" : "agent", currentTask: currentTask ? { id: currentTask.id, title: currentTask.title, status: currentTask.status } : null };
  return { subject: view, agent, item, task, currentTask, nextTask, options, starters: conversationStarters(starterSubject) };
}

function voiceOf(agent: Agent): AgentVoice {
  return getTemplateByAgentType(agent.agentType)?.voice ?? DEFAULT_VOICE;
}

async function personaOf(tx: DbTx, ctx: BusinessContext, r: Resolved, seed: string): Promise<ConversationPersona> {
  const departments = r.agent.departmentIds.length ? await repos.departments.list(tx, ctx.businessId) : [];
  const dept = departments.find((d) => d.id === r.agent.departmentIds[0]) ?? null;
  const running = r.currentTask && r.currentTask.status === "running" ? r.currentTask : null;
  const presence = agentPresence(r.agent.status, r.currentTask);
  const voice = voiceOf(r.agent);
  // A compound note title ("Decided: Decision needed: next step") reads badly after "Checking"; the agent's own typing
  // line stands in, as it does for a title that is a question.
  const title = r.subject.kind === "inbox_item" ? r.subject.title : null;
  const lookingAt = title !== null ? (title.includes(": ") ? null : title) : (r.currentTask?.title ?? null);
  return {
    id: r.agent.id,
    name: r.agent.name,
    role: r.agent.role || getTemplateByAgentType(r.agent.agentType)?.role || "Agent",
    avatarSeed: r.agent.avatarSeed || r.agent.id,
    layer: r.agent.layer,
    colourToken: (dept?.colourToken as DeptColourToken | undefined) ?? null,
    status: r.agent.status,
    presence,
    presenceLabel: presenceLabel(presence, running ?? r.currentTask),
    currentTask: r.currentTask ? { id: r.currentTask.id, title: r.currentTask.title, status: r.currentTask.status, phase: r.currentTask.phase ?? null, progress: progressOf(r.currentTask), eta: r.currentTask.eta ?? null } : null,
    voice,
    thinkingLine: thinkingLine(voice, { lookingAt, seed }),
    nudges: nudgePresets(r.agent.agentType),
    isAgent: true,
  };
}

/** The agent's live instructions (current version), else its template's, else a minimal honest default. */
async function instructionsOf(tx: DbTx, ctx: BusinessContext, agent: Agent): Promise<{ instructions: AgentInstructions; description?: string }> {
  if (agent.currentVersionId) {
    const version = await repos.agents.getVersion(tx, ctx.businessId, agent.currentVersionId).catch(() => null);
    const parsed = version ? AgentInstructions.safeParse(version.instructions) : null;
    if (parsed?.success) return { instructions: parsed.data, description: agent.descriptionMd || undefined };
  }
  const template = getTemplateByAgentType(agent.agentType);
  if (template) return { instructions: template.instructions, description: template.description };
  return {
    instructions: { role: agent.role || agent.name, goals: ["Help the founder with your area of the business."], rules: ["Say what you know from the records and say when you don't know."], playbook: ["Answer briefly, then offer the likely next step."], tone: "Plain and specific.", examples: [] },
    description: agent.descriptionMd || undefined,
  };
}

/**
 * Manifest of the business (CRM entities + agents) and the entity-linker guard bound to it. The CRM half only for a
 * person who may read the CRM (audit RUI-02): otherwise the agent knows no customer names to say to them.
 */
export async function manifestFor(tx: DbTx, ctx: Pick<BusinessContext, "businessId" | "membership">): Promise<{ entries: ManifestEntityInput[]; guard: MentionGuard }> {
  const [crm, agents] = await Promise.all([hasSectionAccess(ctx.membership, "crm", "read") ? repos.entities.manifest(tx, ctx.businessId, { limit: 300 }) : Promise.resolve([]), repos.agents.list(tx, ctx.businessId, { limit: 200 })]);
  const entries: ManifestEntityInput[] = [
    ...crm.map((e) => ({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, aliases: e.aliases })),
    ...agents.items.map((a) => ({ id: a.id, kind: "agent" as const, name: a.name, aliases: [], role: a.role })),
  ];
  const manifest = buildManifest(entries, { strictKinds: false });
  return {
    entries,
    guard: {
      isValid: (text) => validateMarkup(text, manifest).valid,
      strip: (text) => stripInvalidMentions(text, manifest),
      entityIds: (text) => validateMarkup(text, manifest).entityIds,
    },
  };
}

function promptSubject(r: Resolved, currency: string): ConversationSubjectInput {
  if (r.item) {
    const strip = Array.isArray(r.item.statusStrip) ? (r.item.statusStrip as Array<Record<string, unknown>>) : [];
    return {
      kind: "inbox_item",
      id: r.item.id,
      title: r.item.subject,
      itemType: r.item.type,
      answered: isAnswered(r.item),
      options: r.options.map((o) => ({
        id: o.id,
        label: o.label,
        recommended: o.recommended === true,
        consequence: o.consequence ?? "",
        cost: typeof o.cost_minor === "number" && o.cost_minor > 0 ? formatMoney({ amountMinor: o.cost_minor, currency: r.item!.currency || currency }) : null,
        reversible: typeof o.reversible === "boolean" ? o.reversible : null,
      })),
      facts: strip.flatMap((m) => (typeof m.metric === "string" && (typeof m.value === "string" || typeof m.value === "number") ? [{ label: humanise(m.metric), value: String(m.value) }] : [])),
      untrusted: { body_md: r.item.bodyMd },
    };
  }
  if (r.task) {
    return {
      kind: "task",
      id: r.task.id,
      title: r.task.title,
      facts: [
        { label: "Status", value: r.task.status },
        ...(r.task.phase ? [{ label: "Phase", value: r.task.phase }] : []),
        { label: "Progress", value: `${Math.round(progressOf(r.task) * 100)}%` },
      ],
      untrusted: r.task.goalMd ? { goal_md: r.task.goalMd } : undefined,
    };
  }
  return { kind: "agent", id: r.agent.id, title: r.agent.name };
}

const taskInput = (t: Task | null): ConversationTaskInput | null => (t ? { id: t.id, title: t.title, status: t.status, phase: t.phase ?? null, progress: progressOf(t), eta: t.eta ? t.eta.toISOString().slice(0, 10) : null } : null);

// ---------------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------------

const asQuickReplies = (v: unknown): QuickReply[] => (Array.isArray(v) ? (v as QuickReply[]) : []);

export function toMessageViews(rows: readonly AgentMessage[]): ConversationMessageView[] {
  return rows.map((m, i) => {
    const quickReplies = asQuickReplies(m.quickReplies);
    const next = rows[i + 1];
    const chosen = m.authorKind === "founder" ? m.chosenQuickReplyId : next && next.authorKind === "founder" && next.chosenQuickReplyId && quickReplies.some((q) => q.id === next.chosenQuickReplyId) ? next.chosenQuickReplyId : null;
    return {
      id: m.id,
      threadId: m.threadId,
      author: m.authorKind,
      bubbles: m.bubbles,
      at: m.createdAt,
      reaction: m.reaction,
      quickReplies,
      chosenQuickReplyId: chosen ?? null,
      handOff: m.handOff ? { instruction: m.handOff.instruction, gated: m.handOff.gated === true } : null,
      planId: m.planId,
      state: "seen",
    };
  });
}

function activeQuickReplies(messages: readonly ConversationMessageView[], starters: QuickReply[]): QuickReply[] {
  const last = messages[messages.length - 1];
  return last && last.author === "agent" && last.quickReplies.length >= 2 ? last.quickReplies : starters;
}

/**
 * Once the Inbox item is decided (here, from the DecisionBar or another tab), the latest agent message no longer offers
 * "Go with: …": its other chips stay and the answered item's starters fill it back to two (never more than four).
 */
export function withoutStaleOptions(messages: ConversationMessageView[], answered: boolean, starters: readonly QuickReply[]): ConversationMessageView[] {
  const last = messages[messages.length - 1];
  if (!answered || !last || last.author !== "agent" || !last.quickReplies.some((q) => q.kind === "choose_option")) return messages;
  const kept = last.quickReplies.filter((q) => q.kind !== "choose_option");
  const labels = new Set(kept.map((q) => q.label.toLowerCase()));
  for (const s of starters) {
    if (kept.length >= 2) break;
    if (s.kind === "choose_option" || labels.has(s.label.toLowerCase()) || kept.some((q) => q.id === s.id)) continue;
    kept.push(s);
    labels.add(s.label.toLowerCase());
  }
  return [...messages.slice(0, -1), { ...last, quickReplies: kept.slice(0, 4) }];
}

// ---------------------------------------------------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------------------------------------------------

export async function getConversation(ctx: BusinessContext, subject: ConversationSubject): Promise<ConversationView> {
  return ctx.rls(async (tx) => {
    const resolved = await resolve(tx, ctx, subject);
    const thread = await repos.conversations.findThread(tx, ctx.businessId, { agentId: resolved.agent.id, subjectKind: subject.kind, subjectId: resolved.subject.id });
    const rows = thread ? await repos.conversations.listMessages(tx, ctx.businessId, thread.id, { limit: 50 }) : [];
    const seen = await seenAtDesk(tx, ctx, resolved, withoutStaleOptions(toMessageViews(rows), resolved.subject.answered, resolved.starters));
    const persona = await personaOf(tx, ctx, seen.r, thread?.id ?? seen.r.subject.id);
    return { subject: seen.r.subject, thread, messages: seen.messages, persona, starters: seen.r.starters, quickReplies: activeQuickReplies(seen.messages, seen.r.starters) };
  });
}

/**
 * The desk as a person walled from Finance or the CRM may read it (audit RUI-02): the note's title, options and figures,
 * and every message (a thread is shared, so a reply written for the owner may name a customer or quote cash) come
 * masked the way inbox.get masks a note. `r.item` becomes the masked note, so a prompt built from it carries nothing the
 * person could not read.
 */
async function seenAtDesk(tx: DbTx, ctx: BusinessContext, r: Resolved, messages: ConversationMessageView[]): Promise<{ r: Resolved; messages: ConversationMessageView[] }> {
  const walls = inboxWalls(ctx.membership);
  if (!isWalled(walls)) return { r, messages };
  const ids = [...(r.item ? idsOfItem(r.item) : []), ...messages.flatMap((m) => mentionIds(JSON.stringify([m.bubbles, m.quickReplies, m.handOff])))];
  const source = await loadRedactionSource(tx, ctx.businessId, walls, ids);
  const mask = r.item ? noteMask(r.item) : {};
  const item = r.item ? redactInboxItem(r.item, source) : null;
  const shown: Resolved = {
    ...r,
    item,
    subject: { ...r.subject, title: item ? item.subject : r.subject.title, options: r.subject.options.map((o) => ({ ...o, label: redactText(o.label, source, mask) })) },
    options: item ? itemOptions(item) : r.options,
    starters: redactValue(r.starters, source, mask),
  };
  return {
    r: shown,
    messages: messages.map((m) => ({ ...m, bubbles: m.bubbles.map((b) => redactText(b, source, mask)), quickReplies: redactValue(m.quickReplies, source, mask), handOff: m.handOff ? { ...m.handOff, instruction: redactText(m.handOff.instruction, source, mask) } : null })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------------------------------------------------

interface Prepared {
  r: Resolved;
  thread: AgentThread | null;
  history: AgentMessage[];
  latestAgent: AgentMessage | null;
  chip: QuickReply | null;
  founderText: string;
}

async function prepare(tx: DbTx, ctx: BusinessContext, input: SendInput): Promise<Prepared> {
  const r = await resolve(tx, ctx, input.subject);
  const thread = await repos.conversations.findThread(tx, ctx.businessId, { agentId: r.agent.id, subjectKind: input.subject.kind, subjectId: r.subject.id });
  const history = thread ? await repos.conversations.listMessages(tx, ctx.businessId, thread.id, { limit: 12 }) : [];
  const latestAgent = thread ? await repos.conversations.latestAgentMessage(tx, ctx.businessId, thread.id) : null;
  let chip: QuickReply | null = null;
  if (input.quickReplyId) {
    chip = asQuickReplies(latestAgent?.quickReplies).find((q) => q.id === input.quickReplyId) ?? r.starters.find((q) => q.id === input.quickReplyId) ?? null;
    if (!chip) throw new ValidationError("That quick reply is no longer available", { quickReplyId: input.quickReplyId });
    // The chip of this id now names another option than the one on the founder's screen (another tab moved on).
    if (input.optionId !== undefined && (chip.option_id ?? null) !== input.optionId) throw new ValidationError("That quick reply is no longer available", { quickReplyId: chip.id, route: "stale" });
    if (chip.kind === "write") throw new ValidationError("Write your message", { quickReplyId: chip.id });
    // A chip offered before the item was decided (the DecisionBar, another tab): nothing is left to choose.
    if (chip.kind === "choose_option" && r.subject.answered) throw new ValidationError("This one is already decided, so there is nothing left to choose", { quickReplyId: chip.id, route: "stale" });
  }
  return { r, thread, history, latestAgent, chip, founderText: chip ? chip.say : (input.text ?? "") };
}

const preview = (text: string) => stripMarkup(text).replace(/\s+/g, " ").trim().slice(0, 140);

interface WriteReplyInput {
  r: Resolved;
  subject: ConversationSubject;
  founderText: string;
  chip: QuickReply | null;
  reply: AgentReplyOutput;
  entityIds: string[];
  handOffGated: boolean;
  planId?: string | null;
  meta: Record<string, unknown>;
}

/** Founder message + agent message + two events (marked narrated: a chat is never an Inbox note) + audit, in one transaction. */
async function writeExchange(ctx: BusinessContext, w: WriteReplyInput): Promise<{ thread: AgentThread; messages: ConversationMessageView[] }> {
  return ctx.rls(async (tx) => {
    const thread = await repos.conversations.ensureThread(tx, ctx.businessId, { agentId: w.r.agent.id, subjectKind: w.subject.kind, subjectId: w.r.subject.id });
    const at = new Date();
    const founder = await repos.conversations.appendMessage(tx, ctx.businessId, { threadId: thread.id, authorKind: "founder", authorUserId: ctx.userId, bubbles: [w.founderText], chosenQuickReplyId: w.chip?.id ?? null }, { at });
    const agent = await repos.conversations.appendMessage(
      tx,
      ctx.businessId,
      {
        threadId: thread.id,
        authorKind: "agent",
        agentId: w.r.agent.id,
        bubbles: w.reply.bubbles,
        reaction: w.reply.reaction,
        quickReplies: w.reply.quick_replies,
        handOff: w.reply.hand_off ? { instruction: w.reply.hand_off.instruction, gated: w.handOffGated } : null,
        refersTo: w.reply.refers_to,
        entityIds: w.entityIds.slice(0, 50),
        planId: w.planId ?? null,
        meta: w.meta,
      },
      { at: new Date(at.getTime() + 1) },
    );
    const base = { threadId: thread.id, agentId: w.r.agent.id, subjectKind: w.subject.kind, subjectId: w.r.subject.id };
    const eventIds = [
      await emit(tx, ctx, { type: "conversation.message_posted", payload: { ...base, messageId: founder.id, author: "founder", preview: preview(w.founderText), quickReplyIds: [], chosenQuickReplyId: w.chip?.id ?? null, handOff: false } }),
      await emit(tx, ctx, {
        type: "conversation.message_posted",
        actor: { kind: "agent", id: w.r.agent.id },
        entityIds: w.entityIds,
        payload: { ...base, messageId: agent.id, author: "agent", preview: preview(w.reply.bubbles.join(" ")), quickReplyIds: w.reply.quick_replies.map((q) => q.id), chosenQuickReplyId: null, handOff: w.reply.hand_off !== null },
      }),
    ];
    await repos.events.markNarrated(tx, ctx.businessId, eventIds);
    await audit(tx, ctx, { action: "agent.conversation.send", target: { kind: "agent_thread", id: thread.id }, details: { subjectKind: w.subject.kind, subjectId: w.r.subject.id, agentId: w.r.agent.id, quickReplyId: w.chip?.id ?? null, handOff: w.reply.hand_off !== null, planId: w.planId ?? null } });
    const fresh = await repos.conversations.getThread(tx, ctx.businessId, thread.id);
    return { thread: fresh, messages: toMessageViews([founder, agent]) };
  });
}

/** A deterministic reply (no model call) in the agent's voice. */
function scriptedReply(bubbles: string[], quickReplies: QuickReply[], reaction: AgentReaction = "noted"): AgentReplyOutput {
  return { bubbles, reaction, quick_replies: quickReplies, hand_off: null, refers_to: [] };
}

export async function sendConversationMessage(ctx: BusinessContext, input: SendInput): Promise<SendResult> {
  const p = await ctx.rls((tx) => prepare(tx, ctx, input));
  // Checked after the chip (a stale or write chip costs nothing), before any model call or decision.
  takeConversationAllowance({ userId: ctx.userId, businessId: ctx.businessId });
  const { r, chip } = p;
  const voice = voiceOf(r.agent);
  const seed = `${p.thread?.id ?? r.subject.id}:${p.history.length}`;

  // 1. "Go with: …" on an open Inbox decision → the existing decide path.
  if (chip?.kind === "choose_option" && input.subject.kind === "inbox_item" && chip.option_id) {
    const decision = await decideInboxItem(ctx, { itemId: r.subject.id, chosenOption: chip.option_id });
    const option = r.options.find((o) => o.id === chip.option_id);
    const next = decision.requiresConfirmation ? "It's outside policy, so nothing runs until you confirm the plan." : decision.followUp ? "The plan is under way; the follow-up is in the Inbox." : "The plan is under way.";
    // The first sentence of the voice's acknowledgement ("Noted."), then what was chosen.
    const fullAck = ackLine(voice, seed);
    const ack = fullAck.match(/^.*?[.!](?=\s|$)/)?.[0] ?? fullAck;
    const reply = scriptedReply([`${ack} Going with ${option?.label ?? "that option"}.`, next], [quickReply("thanks", "Thanks", "Thanks.", "acknowledge"), quickReply("what_happens_next", "What happens next?", "What happens next?", "ask")], "pleased");
    const written = await writeExchange(ctx, { r, subject: input.subject, founderText: p.founderText, chip, reply, entityIds: [], handOffGated: false, planId: decision.plan.id, meta: { source: "decide", requiresConfirmation: decision.requiresConfirmation } });
    return { ...written, quickReplies: reply.quick_replies, decision, handOff: null };
  }

  // 2. "Review the plan" on a message that carries a hand-off → stage it (nothing runs until plan.confirm).
  if (chip?.kind === "hand_off" && p.latestAgent?.handOff && asQuickReplies(p.latestAgent.quickReplies).some((q) => q.id === chip.id) && chip.id !== TAKE_A_BREAK_ID) {
    const staged = await stageHandOff(ctx, p.latestAgent.id, { allowanceTaken: true });
    const reply = scriptedReply(
      ["Here's what would happen.", staged.hardGates > 0 ? "Part of it is yours to do; I've listed exactly what. Nothing runs until you confirm." : "Nothing runs until you confirm it."],
      [quickReply("thanks", "Thanks", "Thanks.", "acknowledge"), quickReply("change_it", "Change it", "I want to change the plan.", "write"), quickReply("not_now", "Not now", "Not now.", "decline")],
    );
    const written = await writeExchange(ctx, { r, subject: input.subject, founderText: p.founderText, chip, reply, entityIds: [], handOffGated: false, meta: { source: "hand_off", planId: staged.planId } });
    return { ...written, quickReplies: reply.quick_replies, decision: null, handOff: staged };
  }

  // 3. Everything else → the conversation route, then the server-side checks.
  const ctxData = await ctx.rls(async (tx) => {
    // The prompt carries only what this person may read: the masked note and thread, and no CRM names without CRM read.
    const seen = await seenAtDesk(tx, ctx, r, toMessageViews(p.history));
    const [ins, manifest, persona] = await Promise.all([instructionsOf(tx, ctx, r.agent), manifestFor(tx, ctx), personaOf(tx, ctx, seen.r, seed)]);
    return { ins, manifest, persona, seen };
  });
  const requestInput: ConversationRequestInput = {
    businessName: ctx.business.name,
    appName: APP_NAME,
    agent: { id: r.agent.id, name: r.agent.name, role: ctxData.persona.role, instructions: ctxData.ins.instructions, description: ctxData.ins.description, voice },
    glossary: Object.fromEntries(Object.entries(ctx.business.glossary ?? {}).filter(([from]) => from !== "currency")),
    currentWork: { task: taskInput(r.currentTask), nextTask: taskInput(r.nextTask), status: r.agent.status, presence: ctxData.persona.presence },
    subject: promptSubject(ctxData.seen.r, "EUR"),
    thread: ctxData.seen.messages.map((m) => ({ author: m.author, text: m.bubbles.join("\n") })),
    manifest: ctxData.manifest.entries.map((e) => ({ id: e.id, kind: e.kind, name: e.name, aliases: e.aliases ?? [] })),
    founderMessage: { text: p.founderText, quickReply: chip ? { id: chip.id, kind: chip.kind, option_id: chip.option_id } : null },
  };
  const request = buildConversationRequest(requestInput);
  const result = await ctx.models.complete({ ...request, attribution: { businessId: ctx.businessId, agentId: r.agent.id, inboxItemId: r.item?.id, kind: "conversation" }, scope: `conversation:${r.agent.id}` });
  // Open decision options (ids + labels), quoted vs trusted text: the same checks the conversation evals measure.
  const fin = finaliseAgentReply(result.json, { ...finaliseOptionsFor(requestInput), guard: ctxData.manifest.guard, fallbackQuickReplies: r.starters });
  const written = await writeExchange(ctx, {
    r,
    subject: input.subject,
    founderText: p.founderText,
    chip,
    reply: fin.reply,
    entityIds: fin.entityIds,
    handOffGated: fin.handOffGates.length > 0,
    meta: { source: "model", route: result.route, model: result.model, mode: result.mode, durationMs: result.durationMs, costMinor: result.cost.costMinorInt, costLabel: "Estimate", repairs: fin.repairs.slice(0, 10) },
  });
  return { ...written, quickReplies: fin.reply.quick_replies, decision: null, handOff: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// handOff
// ---------------------------------------------------------------------------------------------------------------------

const toPlanAction = (a: PlanWithActions["actions"][number]): PlanAction => ({ type: a.type, params: (a.params ?? {}) as Record<string, unknown>, agent_id: a.agentId });

/** Another request staged this hand-off first (thrown inside the transaction so this request's plan rolls back). */
class HandOffRaced extends Error {
  constructor() {
    super("hand-off staged by another request");
    this.name = "HandOffRaced";
  }
}

/**
 * Compile an agent message's hand-off into a plan, check it against policy and stage it as `pending_confirmation`
 * (idempotent: a message staged before returns its plan). The founder runs it with `plan.confirm`.
 */
export async function stageHandOff(ctx: BusinessContext, messageId: string, opts: { allowanceTaken?: boolean } = {}): Promise<HandOffPreview> {
  return handOffAsSeen(ctx, await stageHandOffPlan(ctx, messageId, opts));
}

/** The staged hand-off as the person may read it (summary, plan and evaluations masked behind their walls). */
async function handOffAsSeen(ctx: BusinessContext, preview: HandOffPreview): Promise<HandOffPreview> {
  const walls = inboxWalls(ctx.membership);
  if (!isWalled(walls)) return preview;
  const ids = [...mentionIds(preview.summary), ...mentionIds(preview.instruction), ...mentionIds(JSON.stringify(preview.plan.actions.map((a) => a.params)))];
  const source = await ctx.rls((tx) => loadRedactionSource(tx, ctx.businessId, walls, ids));
  return {
    ...preview,
    instruction: redactText(preview.instruction, source),
    summary: redactText(preview.summary, source),
    plan: redactPlan(preview.plan, source),
    evaluations: preview.evaluations.map((e) => ({ ...e, action: { ...e.action, params: redactValue(e.action.params, source) } })),
  };
}

async function stageHandOffPlan(ctx: BusinessContext, messageId: string, opts: { allowanceTaken?: boolean }): Promise<HandOffPreview> {
  const { message, thread } = await ctx.rls(async (tx) => {
    const m = await repos.conversations.getMessage(tx, ctx.businessId, messageId);
    return { message: m, thread: await repos.conversations.getThread(tx, ctx.businessId, m.threadId) };
  });
  assertSubjectAccess(ctx, thread.subjectKind, "write");
  if (message.authorKind !== "agent" || !message.handOff) throw new ValidationError("This message has nothing to hand off", { messageId });
  const instruction = message.handOff.instruction;
  const inboxItemId = thread.subjectKind === "inbox_item" ? thread.subjectId : null;
  const planCtx = await planContextFor(ctx);

  const stored = async (planId: string | null): Promise<HandOffPreview | null> => {
    if (!planId) return null;
    const plan = await ctx.rls((tx) => repos.plans.get(tx, ctx.businessId, planId)).catch((err: unknown) => (err instanceof NotFoundError ? null : Promise.reject(err)));
    if (!plan) return null;
    const evaluations = evaluatePlan(plan.actions.map(toPlanAction), planCtx);
    return { messageId, instruction, summary: plan.summaryMd, source: "stored", evaluations, requiresConfirmation: requiresConfirmation(evaluations), hardGates: evaluations.filter((e) => e.hardGate).length, planId: plan.id, plan, inboxItemId };
  };
  const already = await stored(message.planId);
  if (already) return already;

  // Compiling is a model call: it counts against the send limits (unless the send that asked for it already did).
  if (!opts.allowanceTaken) takeConversationAllowance({ userId: ctx.userId, businessId: ctx.businessId });
  const compiled = await compilePlan(ctx.models, instruction, planCtx);
  const evaluations = evaluatePlan(compiled.actions, planCtx);
  // Nobody stages work in a section they cannot write to (audit RUI-01); `plan.confirm` checks the confirmer again.
  assertPlanSectionAccess(ctx.membership, evaluations.map((e) => ({ type: e.action.type, params: e.action.params, denied: e.outcome === "deny" })));
  const plan = await ctx
    .rls(async (tx) => {
      // Not linked to the Inbox item: a staged hand-off is not the item's decision (that stays with the founder).
      const created = await repos.plans.create(tx, ctx.businessId, {
        origin: "free_text",
        summaryMd: compiled.summary,
        inboxItemId: null,
        status: "pending_confirmation",
        actions: evaluations.map((e) => ({ type: e.action.type, params: e.action.params, agentId: e.action.agent_id, policyOutcome: e.outcome })),
      });
      // A double press: the first request's plan stands, this one rolls back (never two plans awaiting confirmation).
      if (!(await repos.conversations.claimMessagePlan(tx, ctx.businessId, messageId, created.id))) throw new HandOffRaced();
      await audit(tx, ctx, { action: "agent.conversation.handOff", target: { kind: "plan", id: created.id }, details: { messageId, threadId: thread.id, subjectKind: thread.subjectKind, actionTypes: created.actions.map((a) => a.type), hardGates: evaluations.filter((e) => e.hardGate).length } });
      return created;
    })
    .catch(async (err: unknown) => {
      if (!(err instanceof HandOffRaced)) throw err;
      const winner = await stored((await ctx.rls((tx) => repos.conversations.getMessage(tx, ctx.businessId, messageId))).planId);
      if (!winner) throw new ValidationError("This hand-off is being staged; try again", { messageId });
      return winner;
    });
  if ("messageId" in plan) return plan;
  return { messageId, instruction, summary: compiled.summary, source: compiled.source, evaluations, requiresConfirmation: requiresConfirmation(evaluations), hardGates: evaluations.filter((e) => e.hardGate).length, planId: plan.id, plan, inboxItemId };
}

// ---------------------------------------------------------------------------------------------------------------------
// Inbox free text: question → conversation, instruction → decision (audit-conversation P0)
// ---------------------------------------------------------------------------------------------------------------------

export type InboxReplyResult = ({ route: "conversation" } & SendResult) | { route: "decision"; decision: DecideItemResult };

/**
 * Only an instruction decides the item. Questions, greetings, thanks and "not now" go to the conversation and leave the
 * item open: none of them names what should happen, so the plan compiler could only turn them into `reply_only` and the
 * decision would be used up with nothing done (audit-conversation P0). The agent's reply offers "Go with: …" chips, so
 * "OK, go ahead" is one press away from a real decision.
 */
export async function replyToInboxItem(ctx: BusinessContext, input: { itemId: string; text: string }): Promise<InboxReplyResult> {
  if (isConversationalText(input.text)) {
    const sent = await sendConversationMessage(ctx, { subject: { kind: "inbox_item", id: input.itemId }, text: input.text });
    return { route: "conversation", ...sent };
  }
  return { route: "decision", decision: await decideInboxItem(ctx, { itemId: input.itemId, freeText: input.text }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ideation: a concept card's Research agent (no business yet, nothing stored here; idea.ask keeps `meta.qa`)
// ---------------------------------------------------------------------------------------------------------------------

/** `idea_versions` fields of a concept card (title, pitch, attributes key → { value 1–20, evidence }). */
export type ConceptInput = ConceptCardInput;

export interface ConceptReply {
  bubbles: string[];
  quickReplies: QuickReply[];
  reaction: AgentReaction;
  persona: { name: string; role: string; avatarSeed: string; voice: AgentVoice; thinkingLine: string; isAgent: true };
  /** The bubbles joined as Markdown, for callers that still store a single answer (`meta.qa[].answer`). */
  answerMd: string;
}

/** Starters for the Ask dialog (no model call). */
export const conceptStarters = (): QuickReply[] => conversationStarters({ kind: "concept" });

/** The Research agent behind a concept card's Ask (no model call): who answers, in what voice, looking at what. */
export function conceptPersona(conceptTitle: string): ConceptReply["persona"] {
  const researcher = getTemplate("researcher");
  return { name: "Research agent", role: researcher.role, avatarSeed: "research-agent", voice: researcher.voice, thinkingLine: thinkingLine(researcher.voice, { lookingAt: conceptTitle }), isAgent: true };
}

/**
 * One reply from the Research agent about a concept card, for `idea.ask` (audit-conversation §4 "Ask on a concept").
 * Same route, house rules and checks as the desk; the mock answers from the card's attributes, never "Mock …".
 */
export async function replyAboutConcept(models: ModelClient, input: { concept: ConceptInput; question?: string; quickReplyId?: string; history?: ReadonlyArray<{ question: string; answer: string }>; userId?: string }): Promise<ConceptReply> {
  const starters = conceptStarters();
  const chip = input.quickReplyId ? (starters.find((q) => q.id === input.quickReplyId) ?? null) : null;
  if (input.quickReplyId && !chip) throw new ValidationError("That quick reply is no longer available", { quickReplyId: input.quickReplyId });
  const text = chip?.say ?? input.question?.trim() ?? "";
  if (!text) throw new ValidationError("Ask a question or pick a quick reply");
  // The same per-person send limits as the desk (Ideation has no business yet).
  if (input.userId) takeConversationAllowance({ userId: input.userId });
  // Title, pitch and evidence travel as untrusted data; the house rules name a neutral principal, never the concept.
  const requestInput = conceptConversationInput({ appName: APP_NAME, concept: input.concept, text, quickReply: chip, history: input.history });
  const request = buildConversationRequest(requestInput);
  const result = await models.complete({ ...request, attribution: { kind: "ideation_ask" }, scope: input.userId ? `ideation:${input.userId}` : undefined });
  const fin = finaliseAgentReply(result.json, { ...finaliseOptionsFor(requestInput), guard: { isValid: (t) => !t.includes("[[ent:"), strip: (t) => stripMarkup(t) }, fallbackQuickReplies: starters });
  return {
    bubbles: fin.reply.bubbles,
    quickReplies: fin.reply.quick_replies,
    reaction: fin.reply.reaction,
    persona: conceptPersona(input.concept.title),
    answerMd: fin.reply.bubbles.join("\n\n"),
  };
}
