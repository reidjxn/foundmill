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
 *         Streamed (`hooks.emit`, audit MB-1), each bubble of the model's reply is shown once it is written and checked;
 *         the exchange is still stored only once the whole reply has passed.
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
  bubbleStream,
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
  refusedAgentReply,
  scriptedAgentReply,
  scriptedIntent,
  thinkingLine,
  trimLabel,
  type AgentVoice,
  type ConceptCardInput,
  type ConversationRequest,
  type ConversationRequestInput,
  type ConversationSubjectInput,
  type ConversationTaskInput,
  type ConversationTurnInput,
  type FinalisedReply,
  type MentionGuard,
  type NudgePreset,
  type StarterSubject,
  type StreamedBubble,
} from "@foundmill/agents";
import { repos, sqlState, type Agent, type AgentMessage, type AgentThread, type DbTx, type InboxItem, type PlanWithActions, type Task } from "@foundmill/db";
import { buildManifest, stripInvalidMentions, stripMarkup, validateMarkup, type ManifestEntityInput } from "@foundmill/entity-linker";
import { ModelError, isModelRefusal, streamStructured, type AgentReplyDraft, type AgentReplyOutput, type CompleteRequest, type CompleteResultWithJson, type ModelClient, type PlanAction, type QuickReply } from "@foundmill/models";
import {
  CONVERSATION_SUBJECT_KINDS,
  NotFoundError,
  ValidationError,
  agentDisplayName,
  formatMoney,
  usDate,
  uuid,
  type AgentPresence,
  type AgentReaction,
  type AgentStatus,
  type ConversationAuthorKind,
  type ConversationSubjectKind,
  type DeptColourToken,
  type EntityKind,
  type PlanStatus,
} from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { audit, effectivePermission, hasSectionAccess, Id, internalErrorMessage, toTRPCError, type BusinessContext, type Section } from "../trpc";
import { eventStream } from "./event-stream";
import { writeEventRows } from "./events";
import { decideInboxItem, decidesByText, planContextFor, type DecideItemResult } from "./decide";
import { idsOfItem, inboxWalls, isWalled, loadRedactionSource, mentionIds, noteMask, redactInboxItem, redactPlan, redactText, redactValue, type RedactionSource } from "./inbox-redaction";
import { assertInstructionSectionAccess, assertPlanSectionAccess, compilePlan, evaluatePlan, requiresConfirmation, stagedAction, type ActionEvaluation } from "./plans";
import { takeOrThrow, type RateLimitStore, type WindowLimit } from "./rate-limit";
import { promptSkills } from "./skills";

// ---------------------------------------------------------------------------------------------------------------------
// Limits: every send can be a model call (a reply, a plan compile), so sends are bounded per person and per business.
// The windows live in the api's limit store (`ctx.limits`: Redis across replicas; rate-limit.ts), like the logo limits.
// ---------------------------------------------------------------------------------------------------------------------

const MINUTE = 60_000;
export const CONVERSATION_LIMITS = {
  /** A person pressing quick replies as fast as replies arrive stays well inside this; a script or a stuck key does not. */
  burst: { limit: 20, windowMs: MINUTE },
  user: { limit: 240, windowMs: 60 * MINUTE },
  business: { limit: 1200, windowMs: 24 * 60 * MINUTE },
} as const satisfies Record<string, WindowLimit>;

/** Spends one send from every limit that applies (no business for a concept's Ask), or throws TOO_MANY_REQUESTS. */
export async function takeConversationAllowance(limits: RateLimitStore, scope: { userId: string; businessId?: string | null }): Promise<void> {
  await takeOrThrow(limits, "Conversation", [
    { key: `conversation:burst:${scope.userId}`, rule: CONVERSATION_LIMITS.burst },
    { key: `conversation:user:${scope.userId}`, rule: CONVERSATION_LIMITS.user },
    ...(scope.businessId ? [{ key: `conversation:business:${scope.businessId}`, rule: CONVERSATION_LIMITS.business }] : []),
  ]);
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
    /**
     * An id the client makes up for this message and keeps when it retries. A send whose answer was lost in transit
     * is the same message when it comes again: the exchange already stored is returned and nothing is asked or paid for twice.
     */
    clientMessageId: z.string().trim().min(8).max(100).optional(),
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
  /** The agent's persona (anthropomorphic agents, 0067); null until it has one. */
  personaKey: string | null;
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
  /**
   * The staged plan's status as the desk was read: a hand-off staged on another page or device still waits for
   * `plan.confirm` while it is `pending_confirmation`, so the desk offers "Review the plan" again (audit OL-01).
   */
  planStatus: PlanStatus | null;
  /** Founder messages: the id the client sent with it (so a client can tell its message arrived), else null. */
  clientMessageId: string | null;
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
  const tasksOf = (agentId: string) =>
    Promise.all([
      repos.tasks.list(tx, businessId, { assigneeAgentId: agentId, status: [...ACTIVE_STATUSES], limit: 10 }),
      repos.tasks.list(tx, businessId, { assigneeAgentId: agentId, status: ["ready", "planned"], limit: 5 }),
    ]);
  let item: InboxItem | null = null;
  let task: Task | null = null;
  let agent: Agent;
  let view: ConversationSubjectView;
  let lists: Awaited<ReturnType<typeof tasksOf>> | null = null;
  if (subject.kind === "inbox_item") {
    item = await repos.inbox.get(tx, businessId, subject.id);
    agent = item.fromAgentId ? await repos.agents.get(tx, businessId, item.fromAgentId) : await fallbackAgent();
    view = { kind: "inbox_item", id: item.id, title: item.subject, itemType: item.type, answered: isAnswered(item), options: itemOptions(item).map((o) => ({ id: o.id, label: o.label, recommended: o.recommended === true })) };
  } else if (subject.kind === "task") {
    task = await repos.tasks.get(tx, businessId, subject.id);
    agent = task.assigneeAgentId ? await repos.agents.get(tx, businessId, task.assigneeAgentId) : await fallbackAgent();
    view = { kind: "task", id: task.id, title: task.title, itemType: null, answered: false, options: [] };
  } else {
    // The agent is the subject: its work is read in the same round trip as the agent itself.
    const [found, work] = await Promise.all([repos.agents.get(tx, businessId, subject.id), tasksOf(subject.id)]);
    agent = found;
    lists = work;
    view = { kind: "agent", id: agent.id, title: agent.name, itemType: null, answered: false, options: [] };
  }
  const [active, queued] = lists ?? (await tasksOf(agent.id));
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
    personaKey: r.agent.personaKey ?? null,
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

/** CRM entities every reply's prompt carries beyond the ones the conversation names (the manifest's first, by name). */
export const PROMPT_CRM_ENTITIES = 30;

const MENTIONED_ID_RE = /\[\[ent:([^|\]]+)\|/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The manifest entries a reply's prompt carries (audit MB-1): every agent, every entity the conversation names (a
 * mention, or its name or an alias as a whole word in `texts`: the subject, the thread, the current work and the
 * founder's words) and the first `crmMax` others. A business with hundreds of CRM entities otherwise sent all of them,
 * uncached, with every message. Mentions in the reply are still validated against the whole manifest (`manifestFor`'s
 * guard), so an entity of the business named from outside this list is linked exactly as before.
 */
export function promptManifest(entries: readonly ManifestEntityInput[], texts: readonly string[], crmMax = PROMPT_CRM_ENTITIES): ManifestEntityInput[] {
  const text = texts.join("\n");
  const lower = text.toLowerCase();
  const mentioned = new Set([...text.matchAll(MENTIONED_ID_RE)].map((m) => m[1]));
  const named = (e: ManifestEntityInput) =>
    [e.name, ...(e.aliases ?? [])].some((n) => {
      const word = n.trim().toLowerCase();
      return word.length >= 3 && lower.includes(word) && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(word)}(?:$|[^\\p{L}\\p{N}])`, "u").test(lower);
    });
  let others = 0;
  return entries.filter((e) => e.kind === "agent" || mentioned.has(e.id) || named(e) || others++ < crmMax);
}

/**
 * `currency` is the business's own: an option's cost is business money, priced in it as the Inbox shows it, and an
 * Estimate. Never the note's `inbox_items.currency`, which is the currency of what writing the note cost (audit CML-12).
 */
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
        cost: typeof o.cost_minor === "number" && o.cost_minor > 0 ? `${formatMoney({ amountMinor: o.cost_minor, currency })} (Estimate)` : null,
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

/** The expected date as the agent should quote it: a US date ("Oct 11"; "Jan 4, 2027" in another year), never ISO. */
export const etaWords = (eta: Date, now = new Date()): string => usDate(eta, { year: eta.getUTCFullYear() !== now.getUTCFullYear() });
const taskInput = (t: Task | null): ConversationTaskInput | null => (t ? { id: t.id, title: t.title, status: t.status, phase: t.phase ?? null, progress: progressOf(t), eta: t.eta ? etaWords(t.eta) : null } : null);

// ---------------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------------

const asQuickReplies = (v: unknown): QuickReply[] => (Array.isArray(v) ? (v as QuickReply[]) : []);

export function toMessageViews(rows: readonly AgentMessage[], planStatuses: ReadonlyMap<string, PlanStatus> = new Map()): ConversationMessageView[] {
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
      planStatus: m.planId ? (planStatuses.get(m.planId) ?? null) : null,
      clientMessageId: m.clientMessageId ?? null,
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
    const planStatuses = await repos.plans.statusesById(tx, ctx.businessId, rows.flatMap((m) => (m.planId && m.handOff ? [m.planId] : [])));
    const seen = await seenAtDesk(tx, ctx, resolved, withoutStaleOptions(toMessageViews(rows, planStatuses), resolved.subject.answered, resolved.starters));
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
async function seenAtDesk(tx: DbTx, ctx: BusinessContext, r: Resolved, messages: ConversationMessageView[], chips: QuickReply[] = []): Promise<{ r: Resolved; messages: ConversationMessageView[]; chips: QuickReply[] }> {
  const walls = inboxWalls(ctx.membership);
  if (!isWalled(walls)) return { r, messages, chips };
  const ids = [...(r.item ? idsOfItem(r.item) : []), ...messages.flatMap((m) => mentionIds(JSON.stringify([m.bubbles, m.quickReplies, m.handOff]))), ...mentionIds(JSON.stringify(chips))];
  const source = await loadRedactionSource(tx, ctx.businessId, walls, ids);
  const mask = r.item ? noteMask(r.item) : {};
  const item = r.item ? redactInboxItem(r.item, source) : null;
  const options = item ? itemOptions(item) : r.options;
  // A "Go with: …" chip quotes its option cut to fit ("Go with: Send Wren Ga…"), past where a name can be matched: it is
  // written again from the masked option, as finaliseAgentReply writes it.
  const maskChips = (qs: unknown): QuickReply[] =>
    asQuickReplies(redactValue(qs, source, mask)).map((q) => {
      const option = q.kind === "choose_option" ? options.find((o) => o.id === q.option_id) : undefined;
      return option ? quickReply(q.id, `Go with: ${trimLabel(option.label, 26)}`, `Go with ${option.label}.`, "choose_option", { option_id: option.id, recommended: q.recommended }) : q;
    });
  const shown: Resolved = {
    ...r,
    item,
    subject: { ...r.subject, title: item ? item.subject : r.subject.title, options: r.subject.options.map((o) => ({ ...o, label: redactText(o.label, source, mask) })) },
    options,
    starters: maskChips(r.starters),
  };
  return {
    r: shown,
    messages: messages.map((m) => ({ ...m, bubbles: m.bubbles.map((b) => redactText(b, source, mask)), quickReplies: maskChips(m.quickReplies), handOff: m.handOff ? { ...m.handOff, instruction: redactText(m.handOff.instruction, source, mask) } : null })),
    chips: maskChips(chips),
  };
}

/**
 * A send's answer as the person who sent it may read it (audit RUI-02): the two new messages quote what was pressed or
 * typed ("Go with Send Wren Garza a thank-you." and "Going with …"), so they come back masked the way the thread is.
 * The stored messages stay whole; anyone walled reads them through `getConversation`, which masks them again.
 */
async function sentAsSeen(ctx: BusinessContext, r: Resolved, sent: SendResult): Promise<SendResult> {
  if (!isWalled(inboxWalls(ctx.membership))) return sent;
  const seen = await ctx.rls((tx) => seenAtDesk(tx, ctx, r, sent.messages, sent.quickReplies));
  return { ...sent, messages: seen.messages, quickReplies: seen.chips };
}

/**
 * A bubble shown while the reply is still being written, masked exactly as `sentAsSeen` masks it in the stored reply:
 * the note's records and the bubble's own mentions are all a bubble's mask reads, so loading only those gives the same
 * text. The database is read only behind a CRM wall, and only when there is something to look up.
 */
async function bubbleAsSeen(ctx: BusinessContext, r: Resolved, text: string): Promise<string> {
  const walls = inboxWalls(ctx.membership);
  if (!isWalled(walls)) return text;
  const ids = [...(r.item ? idsOfItem(r.item) : []), ...mentionIds(text)];
  const source: RedactionSource = walls.crm && ids.length > 0 ? await ctx.rls((tx) => loadRedactionSource(tx, ctx.businessId, walls, ids)) : { walls, crm: new Map(), keep: new Set() };
  return redactText(text, source, r.item ? noteMask(r.item) : {});
}

// ---------------------------------------------------------------------------------------------------------------------
// Streaming a reply (audit MB-1): the founder reads the first bubble while the rest is still being written
// ---------------------------------------------------------------------------------------------------------------------

/** What a streamed reply sends before it is stored: a bubble that passed its checks, or `reset` when it is asked again. */
export type ReplyProgress = ({ type: "bubble" } & StreamedBubble) | { type: "reset" };
/** One event of `agent.conversation.sendStream`, `inboxReplyStream` and `idea.askStream`: progress, then the stored result. */
export type ReplyStreamEvent<R> = ReplyProgress | { type: "done"; result: R };

export interface ReplyHooks {
  /**
   * Receives the reply's bubbles as the model writes them (only a reply from the model streams; a decision, a staged
   * hand-off, a scripted or a repeated message has its result at once). Nothing is stored before the whole reply has
   * passed its checks, so a reply that fails part-way leaves no half exchange.
   */
  emit?: (event: ReplyProgress) => void;
}

/** Errors thrown mid-stream skip the error-mapping middleware: they are mapped the same way here. */
function replyStreamError(ctx: Pick<Context, "env" | "log" | "requestId">, path: string, err: unknown): TRPCError {
  const mapped = toTRPCError(err);
  if (mapped.code !== "INTERNAL_SERVER_ERROR") return mapped;
  ctx.log.error({ path, err: mapped.cause ?? mapped, requestId: ctx.requestId }, "procedure failed");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: internalErrorMessage(mapped.message, ctx.env.APP_ENV, ctx.requestId), cause: mapped.cause });
}

/**
 * A reply streamed from `run`: its progress as it comes, then `done` with its result. The stream's own abort signal is
 * not handed on: the send completes and is stored whether or not anyone is still reading.
 */
export async function* replyStream<R>(ctx: Pick<Context, "env" | "log" | "requestId">, path: string, signal: AbortSignal | undefined, run: (emit: (event: ReplyStreamEvent<R>) => void) => Promise<R>): AsyncGenerator<ReplyStreamEvent<R>, void, undefined> {
  try {
    yield* eventStream<ReplyStreamEvent<R>>(async (emit) => emit({ type: "done", result: await run(emit) }), signal);
  } catch (err) {
    throw replyStreamError(ctx, path, err);
  }
}

type ConversationCall = ConversationRequest & Pick<CompleteRequest<AgentReplyDraft>, "attribution" | "scope">;

/**
 * The `conversation` route call: one `complete()`, or with `stream` a streamed call whose bubbles are shown as each is
 * written and checked (`bubbleStream`). A streamed reply whose thinking left no room for its JSON is asked again whole
 * with twice the room, as `complete()` does on its own, after `reset` has withdrawn what was shown. A refusal is thrown
 * on to the caller (which answers with `refusedAgentReply`), after `reset` has withdrawn any bubble shown before it.
 */
async function conversationReply(models: ModelClient, call: ConversationCall, guard: MentionGuard, stream?: { show: (bubble: StreamedBubble) => void | Promise<void>; reset: () => void }): Promise<CompleteResultWithJson<AgentReplyDraft>> {
  if (!stream) return models.complete(call);
  try {
    return await streamStructured(models, { ...call, elementPath: "bubbles", elementSchema: z.string(), onElement: bubbleStream(guard, stream.show) });
  } catch (err) {
    if (isModelRefusal(err)) {
      stream.reset();
      throw err;
    }
    if (!(err instanceof ModelError && err.code === "max_tokens")) throw err;
    stream.reset();
    return models.complete({ ...call, maxTokens: call.maxTokens * 2 });
  }
}

/** What a refusal's stop details say, for the log (a category such as "cyber"; never the prompt or the reply). */
function refusalCategory(err: unknown): string | null {
  const details = (err as { details?: { stopDetails?: { category?: unknown } } } | null)?.details;
  const category = details?.stopDetails?.category;
  return typeof category === "string" ? category : null;
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
  /** This message (same client id) was already sent and answered: its stored exchange. */
  replay: { founder: AgentMessage; reply: AgentMessage | null } | null;
}

async function prepare(tx: DbTx, ctx: BusinessContext, input: SendInput): Promise<Prepared> {
  const findThread = (agentId: string, subjectId: string) => repos.conversations.findThread(tx, ctx.businessId, { agentId, subjectKind: input.subject.kind, subjectId });
  // At an agent's own desk the thread is known from the input, so it is read with the agent; otherwise once the agent is.
  const [r, early] = await Promise.all([resolve(tx, ctx, input.subject), input.subject.kind === "agent" ? findThread(input.subject.id, input.subject.id) : Promise.resolve(undefined)]);
  const thread = early !== undefined ? early : await findThread(r.agent.id, r.subject.id);
  const [history, latestAgent, replay] = thread
    ? await Promise.all([
        repos.conversations.listMessages(tx, ctx.businessId, thread.id, { limit: 12 }),
        repos.conversations.latestAgentMessage(tx, ctx.businessId, thread.id),
        // A repeat of a message that was stored (its answer was lost on the way back): nothing is checked or sent again.
        input.clientMessageId ? repos.conversations.findExchange(tx, ctx.businessId, thread.id, input.clientMessageId) : Promise.resolve(null),
      ])
    : [[], null, null];
  if (replay) return { r, thread, history, latestAgent, chip: null, founderText: replay.founder.bubbles.join("\n"), replay };
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
  return { r, thread, history, latestAgent, chip, founderText: chip ? chip.say : (input.text ?? ""), replay: null };
}

const preview = (text: string) => stripMarkup(text).replace(/\s+/g, " ").trim().slice(0, 140);

interface WriteReplyInput {
  /** The client's id for the founder's message (`SendInput.clientMessageId`). */
  clientMessageId?: string | null;
  /** The thread `prepare` read (null when this is the first message: the write opens it). */
  thread: AgentThread | null;
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
  try {
    return await writeExchangeOnce(ctx, w);
  } catch (err) {
    // The same message came in twice at once and the other copy stored its exchange first: answer with that one.
    if (!w.clientMessageId || sqlState(err) !== "23505") throw err;
    const stored = await ctx.rls(async (tx) => {
      const thread = await repos.conversations.findThread(tx, ctx.businessId, { agentId: w.r.agent.id, subjectKind: w.subject.kind, subjectId: w.r.subject.id });
      const exchange = thread ? await repos.conversations.findExchange(tx, ctx.businessId, thread.id, w.clientMessageId!) : null;
      return thread && exchange ? { thread, exchange } : null;
    });
    if (!stored) throw err;
    return { thread: stored.thread, messages: toMessageViews(stored.exchange.reply ? [stored.exchange.founder, stored.exchange.reply] : [stored.exchange.founder]) };
  }
}

/**
 * The exchange in as few round trips as the audit chain allows: the thread `prepare` read is written to (only a first
 * message opens one), both messages go in one insert with the thread's bump beside it, and both events (narrated as
 * they are written) go with them, since every id is known before anything is written; then the audit entry.
 */
async function writeExchangeOnce(ctx: BusinessContext, w: WriteReplyInput): Promise<{ thread: AgentThread; messages: ConversationMessageView[] }> {
  return ctx.rls(async (tx) => {
    const thread = w.thread ?? (await repos.conversations.ensureThread(tx, ctx.businessId, { agentId: w.r.agent.id, subjectKind: w.subject.kind, subjectId: w.r.subject.id }));
    const founderId = uuid();
    const agentMessageId = uuid();
    const base = { threadId: thread.id, agentId: w.r.agent.id, subjectKind: w.subject.kind, subjectId: w.r.subject.id };
    // Sent together. A repeated client message id fails the insert and everything after it: that error is the one
    // thrown, so `writeExchange` can answer with the exchange the other copy stored.
    const [appended, events] = await Promise.allSettled([
      repos.conversations.appendExchange(tx, ctx.businessId, thread, [
        { id: founderId, threadId: thread.id, authorKind: "founder", authorUserId: ctx.userId, bubbles: [w.founderText], chosenQuickReplyId: w.chip?.id ?? null, clientMessageId: w.clientMessageId ?? null },
        {
          id: agentMessageId,
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
      ]),
      // A chat is never an Inbox note: both events are written narrated.
      writeEventRows(
        tx,
        [
          { businessId: ctx.businessId, type: "conversation.message_posted", actor: { kind: "user", id: ctx.userId }, payload: { ...base, messageId: founderId, author: "founder", preview: preview(w.founderText), quickReplyIds: [], chosenQuickReplyId: w.chip?.id ?? null, handOff: false } },
          {
            businessId: ctx.businessId,
            type: "conversation.message_posted",
            actor: { kind: "agent", id: w.r.agent.id },
            entityIds: w.entityIds,
            payload: { ...base, messageId: agentMessageId, author: "agent", preview: preview(w.reply.bubbles.join(" ")), quickReplyIds: w.reply.quick_replies.map((q) => q.id), chosenQuickReplyId: null, handOff: w.reply.hand_off !== null },
          },
        ],
        { narrated: true },
      ),
    ]);
    if (appended.status === "rejected") throw appended.reason;
    if (events.status === "rejected") throw events.reason;
    const written = appended.value;
    await audit(tx, ctx, { action: "agent.conversation.send", target: { kind: "agent_thread", id: thread.id }, details: { subjectKind: w.subject.kind, subjectId: w.r.subject.id, agentId: w.r.agent.id, quickReplyId: w.chip?.id ?? null, handOff: w.reply.hand_off !== null, planId: w.planId ?? null } });
    return { thread: written.thread, messages: toMessageViews(written.messages) };
  });
}

/** A deterministic reply (no model call) in the agent's voice. */
function scriptedReply(bubbles: string[], quickReplies: QuickReply[], reaction: AgentReaction = "noted"): AgentReplyOutput {
  return { bubbles, reaction, quick_replies: quickReplies, hand_off: null, refers_to: [] };
}

/** The answer a repeated message gets: the exchange stored the first time (no decision or hand-off to show again). */
function replayedSend(p: Prepared & { replay: NonNullable<Prepared["replay"]> }): SendResult {
  const rows = p.replay.reply ? [p.replay.founder, p.replay.reply] : [p.replay.founder];
  return { thread: p.thread!, messages: toMessageViews(rows), quickReplies: asQuickReplies(p.replay.reply?.quickReplies), decision: null, handOff: null };
}

/**
 * How a send is answered: the decide path, staging a hand-off, a scripted reply from the agent's voice kit (a thanks, a
 * "not now" or a greeting: nothing a model would add), or the agent's reply from the model.
 */
function routeOf(p: Prepared, input: SendInput): "decide" | "hand_off" | "scripted" | "reply" {
  const chip = p.chip;
  if (chip?.kind === "choose_option" && input.subject.kind === "inbox_item" && chip.option_id) return "decide";
  if (chip?.kind === "hand_off" && p.latestAgent?.handOff && asQuickReplies(p.latestAgent.quickReplies).some((q) => q.id === chip.id) && chip.id !== TAKE_A_BREAK_ID) return "hand_off";
  if (scriptedIntent(p.founderText, chip?.kind ?? null)) return "scripted";
  return "reply";
}

const seedOf = (p: Prepared) => `${p.thread?.id ?? p.r.subject.id}:${p.history.length}`;

/**
 * What the agent's reply is built from, read in the same transaction as `prepare`: the desk as this person may read it
 * (both replies), and for the model its instructions, the manifest and the persona.
 */
async function replyContext(tx: DbTx, ctx: BusinessContext, p: Prepared, forModel: boolean) {
  // The prompt carries only what this person may read: the masked note and thread, and no CRM names without CRM read.
  const seen = await seenAtDesk(tx, ctx, p.r, toMessageViews(p.history));
  if (!forModel) return { seen, model: null };
  // Skills the founder added from the library or files: a delimited section after the house rules and instructions.
  const [ins, manifest, persona, skills] = await Promise.all([instructionsOf(tx, ctx, p.r.agent), manifestFor(tx, ctx), personaOf(tx, ctx, seen.r, seedOf(p)), repos.skills.listAddedForAgent(tx, ctx.businessId, p.r.agent.id, p.r.agent.agentType)]);
  return { seen, model: { ins, manifest, persona, skills: promptSkills(skills) } };
}

/** A scripted reply carries no mention it could check against the manifest: any markup is reduced to its name. */
const PLAIN_GUARD: MentionGuard = { isValid: (t) => !t.includes("[[ent:"), strip: (t) => stripMarkup(t), entityIds: () => [] };

export async function sendConversationMessage(ctx: BusinessContext, input: SendInput, hooks: ReplyHooks = {}): Promise<SendResult> {
  // One transaction reads the desk and, when the agent will answer, everything its reply is built from.
  const { p, ctxData } = await ctx.rls(async (tx) => {
    const prepared = await prepare(tx, ctx, input);
    const route = prepared.replay ? null : routeOf(prepared, input);
    return { p: prepared, ctxData: route === "reply" || route === "scripted" ? await replyContext(tx, ctx, prepared, route === "reply") : null };
  });
  if (p.replay) return replayedSend({ ...p, replay: p.replay });

  // Checked after the chip (a stale or write chip costs nothing), before any model call or decision.
  await takeConversationAllowance(ctx.limits, { userId: ctx.userId, businessId: ctx.businessId });
  const { r, chip } = p;
  const voice = voiceOf(r.agent);
  const seed = seedOf(p);
  const route = routeOf(p, input);

  // 1. "Go with: …" on an open Inbox decision → the existing decide path.
  if (route === "decide" && chip?.option_id) {
    const decision = await decideInboxItem(ctx, { itemId: r.subject.id, chosenOption: chip.option_id });
    const option = r.options.find((o) => o.id === chip.option_id);
    // An approval's item says what the answer did ("Legal Lead carries on."), not that a plan is under way.
    const next = decision.approval ? decision.approval.summary : decision.requiresConfirmation ? "It's outside policy, so nothing runs until you confirm the plan." : decision.followUp ? "The plan is under way; the follow-up is in the Inbox." : "The plan is under way.";
    // The first sentence of the voice's acknowledgement ("Noted."), then what was chosen.
    const fullAck = ackLine(voice, seed);
    const ack = fullAck.match(/^.*?[.!](?=\s|$)/)?.[0] ?? fullAck;
    const reply = scriptedReply([`${ack} Going with ${option?.label ?? "that option"}.`, next], [quickReply("thanks", "Thanks", "Thanks.", "acknowledge"), quickReply("what_happens_next", "What happens next?", "What happens next?", "ask")], "pleased");
    const written = await writeExchange(ctx, { clientMessageId: input.clientMessageId, thread: p.thread, r, subject: input.subject, founderText: p.founderText, chip, reply, entityIds: [], handOffGated: false, planId: decision.plan.id, meta: { source: "decide", requiresConfirmation: decision.requiresConfirmation } });
    return sentAsSeen(ctx, r, { ...written, quickReplies: reply.quick_replies, decision, handOff: null });
  }

  // 2. "Review the plan" on a message that carries a hand-off → stage it (nothing runs until plan.confirm).
  if (route === "hand_off" && p.latestAgent) {
    const staged = await stageHandOff(ctx, p.latestAgent.id, { allowanceTaken: true });
    const reply = scriptedReply(
      ["Here's what would happen.", staged.hardGates > 0 ? "Part of it is yours to do; I've listed exactly what. Nothing runs until you confirm." : "Nothing runs until you confirm it."],
      [quickReply("thanks", "Thanks", "Thanks.", "acknowledge"), quickReply("change_it", "Change it", "I want to change the plan.", "write"), quickReply("not_now", "Not now", "Not now.", "decline")],
    );
    const written = await writeExchange(ctx, { clientMessageId: input.clientMessageId, thread: p.thread, r, subject: input.subject, founderText: p.founderText, chip, reply, entityIds: [], handOffGated: false, meta: { source: "hand_off", planId: staged.planId } });
    return sentAsSeen(ctx, r, { ...written, quickReplies: reply.quick_replies, decision: null, handOff: staged });
  }

  if (!ctxData) throw new Error("the reply context is read with the desk");
  // What the reply is about, as this person may read it (shared by the scripted reply and the model's). With
  // anthropomorphic agents on, the agent goes by its persona's first name with this founder; it is still an AI agent.
  const prefs = await repos.preferences.get(ctx.db, ctx.userId).catch(() => null);
  const turn: ConversationTurnInput = {
    agent: { id: r.agent.id, name: agentDisplayName(r.agent, prefs?.anthropomorphicAgents === true), role: ctxData.model?.persona.role ?? (r.agent.role || "Agent"), voice },
    currentWork: { task: taskInput(r.currentTask), nextTask: taskInput(r.nextTask), status: r.agent.status, presence: ctxData.model?.persona.presence ?? agentPresence(r.agent.status, r.currentTask) },
    subject: promptSubject(ctxData.seen.r, ctx.business.currency),
    thread: ctxData.seen.messages.map((m) => ({ author: m.author, text: m.bubbles.join("\n") })),
    founderMessage: { text: p.founderText, quickReply: chip ? { id: chip.id, kind: chip.kind, option_id: chip.option_id } : null },
  };

  // 3. A thanks, a "not now" or a greeting → the agent's voice kit, through the same checks, with no model call.
  const scripted = route === "scripted" ? scriptedAgentReply(turn, { seed, guard: PLAIN_GUARD, fallbackQuickReplies: r.starters }) : null;
  if (scripted) {
    const written = await writeExchange(ctx, { clientMessageId: input.clientMessageId, thread: p.thread, r, subject: input.subject, founderText: p.founderText, chip, reply: scripted.reply, entityIds: [], handOffGated: false, meta: { source: "scripted", intent: scriptedIntent(p.founderText, chip?.kind ?? null), repairs: scripted.repairs.slice(0, 10) } });
    return sentAsSeen(ctx, r, { ...written, quickReplies: scripted.reply.quick_replies, decision: null, handOff: null });
  }

  // 4. Everything else → the conversation route, then the server-side checks.
  const model = ctxData.model ?? (await ctx.rls((tx) => replyContext(tx, ctx, p, true))).model!;
  const requestInput: ConversationRequestInput = {
    ...turn,
    businessName: ctx.business.name,
    appName: APP_NAME,
    agent: { ...turn.agent, instructions: model.ins.instructions, description: model.ins.description, skills: model.skills },
    glossary: Object.fromEntries(Object.entries(ctx.business.glossary ?? {}).filter(([from]) => from !== "currency")),
    // What the reply can use; its mentions are still checked against the whole manifest.
    manifest: promptManifest(model.manifest.entries, [JSON.stringify(turn.subject), ...turn.thread.map((m) => m.text), p.founderText, r.currentTask?.title ?? "", r.nextTask?.title ?? ""]).map((e) => ({ id: e.id, kind: e.kind, name: e.name, aliases: e.aliases ?? [] })),
  };
  const request = buildConversationRequest(requestInput);
  const emit = hooks.emit;
  let fin: FinalisedReply;
  let meta: Record<string, unknown>;
  try {
    const result = await conversationReply(
      ctx.models,
      { ...request, attribution: { businessId: ctx.businessId, agentId: r.agent.id, inboxItemId: r.item?.id, kind: "conversation" }, scope: `conversation:${r.agent.id}` },
      model.manifest.guard,
      // Each bubble is shown as this person may read it (the stored reply is masked the same way by `sentAsSeen`).
      emit ? { show: async (b) => emit({ type: "bubble", index: b.index, text: await bubbleAsSeen(ctx, r, b.text) }), reset: () => emit({ type: "reset" }) } : undefined,
    );
    // Open decision options (ids + labels), quoted vs trusted text: the same checks the conversation evals measure.
    fin = finaliseAgentReply(result.json, { ...finaliseOptionsFor(requestInput), guard: model.manifest.guard, fallbackQuickReplies: r.starters });
    meta = { source: "model", route: result.route, model: result.model, mode: result.mode, durationMs: result.durationMs, costMinor: result.cost.costMinorInt, costLabel: "Estimate", repairs: fin.repairs.slice(0, 10) };
  } catch (err) {
    if (!isModelRefusal(err)) throw err;
    // The model declined (stop_reason refusal, usually on quoted text that addresses it): the founder gets a calm line
    // from the agent's voice kit that nothing in it is acted on, and the subject's usual chips. Nothing from the model.
    ctx.log.warn({ path: "agent.conversation.send", agentId: r.agent.id, subjectKind: input.subject.kind, category: refusalCategory(err), requestId: ctx.requestId }, "conversation model refused; scripted reply sent");
    fin = refusedAgentReply(turn, { seed, guard: PLAIN_GUARD, fallbackQuickReplies: r.starters });
    meta = { source: "refused", route: request.route, category: refusalCategory(err), repairs: fin.repairs.slice(0, 10) };
  }
  const written = await writeExchange(ctx, {
    clientMessageId: input.clientMessageId,
    thread: p.thread,
    r,
    subject: input.subject,
    founderText: p.founderText,
    chip,
    reply: fin.reply,
    entityIds: fin.entityIds,
    handOffGated: fin.handOffGates.length > 0,
    meta,
  });
  return sentAsSeen(ctx, r, { ...written, quickReplies: fin.reply.quick_replies, decision: null, handOff: null });
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

  // What the rule engine already sees in the instruction is checked against the person's walls before the model is paid
  // for (SEC2 S3); the compiled plan is checked again below.
  assertInstructionSectionAccess(ctx.membership, instruction, planCtx);
  // Compiling is a model call: it counts against the send limits (unless the send that asked for it already did).
  if (!opts.allowanceTaken) await takeConversationAllowance(ctx.limits, { userId: ctx.userId, businessId: ctx.businessId });
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
        actions: evaluations.map(stagedAction),
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
export async function replyToInboxItem(ctx: BusinessContext, input: { itemId: string; text: string; clientMessageId?: string }, hooks: ReplyHooks = {}): Promise<InboxReplyResult> {
  // A note that asks for no decision (an Update, a Milestone, a follow-up) has nothing to decide: what the founder writes
  // on it is a message to the agent (audit VRUI-X2).
  const item = await ctx.rls((tx) => repos.inbox.get(tx, ctx.businessId, input.itemId));
  if (isConversationalText(input.text) || (!decidesByText(item) && item.state !== "answered" && item.state !== "archived")) {
    const sent = await sendConversationMessage(ctx, { subject: { kind: "inbox_item", id: input.itemId }, text: input.text, ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}) }, hooks);
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

/** A concept card's Research agent knows no records: any mention markup in its reply is reduced to its name. */
const CONCEPT_GUARD: MentionGuard = { isValid: (t) => !t.includes("[[ent:"), strip: (t) => stripMarkup(t) };

/**
 * One reply from the Research agent about a concept card, for `idea.ask` (audit-conversation §4 "Ask on a concept").
 * Same route, house rules and checks as the desk; the mock answers from the card's attributes, never "Mock …". With
 * `hooks.emit` its bubbles stream as they are written (`idea.askStream`).
 */
export async function replyAboutConcept(
  models: ModelClient,
  input: { concept: ConceptInput; question?: string; quickReplyId?: string; history?: ReadonlyArray<{ question: string; answer: string }> } & ({ userId: string; limits: RateLimitStore } | { userId?: undefined; limits?: undefined }),
  hooks: ReplyHooks = {},
): Promise<ConceptReply> {
  const starters = conceptStarters();
  const chip = input.quickReplyId ? (starters.find((q) => q.id === input.quickReplyId) ?? null) : null;
  if (input.quickReplyId && !chip) throw new ValidationError("That quick reply is no longer available", { quickReplyId: input.quickReplyId });
  const text = chip?.say ?? input.question?.trim() ?? "";
  if (!text) throw new ValidationError("Ask a question or pick a quick reply");
  // The same per-person send limits as the desk (Ideation has no business yet).
  if (input.userId) await takeConversationAllowance(input.limits, { userId: input.userId });
  // Title, pitch and evidence travel as untrusted data; the house rules name a neutral principal, never the concept.
  const requestInput = conceptConversationInput({ appName: APP_NAME, concept: input.concept, text, quickReply: chip, history: input.history });
  const request = buildConversationRequest(requestInput);
  const emit = hooks.emit;
  let fin: FinalisedReply;
  try {
    const result = await conversationReply(
      models,
      { ...request, attribution: { kind: "ideation_ask" }, scope: input.userId ? `ideation:${input.userId}` : undefined },
      CONCEPT_GUARD,
      emit ? { show: (b) => emit({ type: "bubble", ...b }), reset: () => emit({ type: "reset" }) } : undefined,
    );
    fin = finaliseAgentReply(result.json, { ...finaliseOptionsFor(requestInput), guard: CONCEPT_GUARD, fallbackQuickReplies: starters });
  } catch (err) {
    if (!isModelRefusal(err)) throw err;
    // The model declined (usually on a card whose text addresses it): the Research agent's calm scripted line, the starters.
    fin = refusedAgentReply(requestInput, { seed: input.concept.id, guard: CONCEPT_GUARD, fallbackQuickReplies: starters });
  }
  return {
    bubbles: fin.reply.bubbles,
    quickReplies: fin.reply.quick_replies,
    reaction: fin.reply.reaction,
    persona: conceptPersona(input.concept.title),
    answerMd: fin.reply.bubbles.join("\n\n"),
  };
}
