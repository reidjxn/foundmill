/**
 * Mock Inbox Composer (BUILD §11.3, §12.2).
 *
 * Writes one note in the voice of the from-agent: fact → why it matters → ask, 60–180 words, entity mentions only from
 * the manifest, 2–4 options with exactly one recommended, exhibit only from the named queries, and NO number that is
 * not present in the inputs (numbers are only ever copied from metric values, event payloads and option costs; every
 * template sentence is digit-free).
 */
import { CHANNEL_KEYS, EXHIBIT_KINDS, INBOX_ITEM_TYPES, type ChannelKey, type ExhibitKind, type InboxItemType } from "@foundmill/shared";
import type { ComposerOption, ComposerOutput } from "../schemas";
import { type ManifestEntry, type MockContext, asUuid, channelLabel, ent, formatMoneyMinor, humaniseKey, isRecord, sentenceCase, truncate, wordCount } from "./inputs";

interface EventIn {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

interface MetricIn {
  metric: string;
  value?: string;
  source: string;
}

interface NamedQuery {
  id: string;
  title: string;
  kind: ExhibitKind;
}

interface Voice {
  id: string;
  name: string;
  role: string;
}

const TYPE_BY_EVENT: Array<[RegExp, InboxItemType]> = [
  [/^(payment\.received|customer\.converted|signup\.created|activation\.reached)$/, "customer_won"],
  [/^(runway\.threshold_crossed|channel\.threshold_breached|credential\.expiring|task\.blocked|agent\.health_changed|filing\.due)$/, "warning"],
  [/^(approval\.requested|spec\.proposal_created|negotiation\.message|decision\.needed)$/, "decision"],
  [/^(idea\.committed|spec\.version_published|contract\.signed|holiday\.(started|ended)|agent\.promoted)$/, "milestone"],
  [/^(message\.received|connection\.requested)$/, "human_message"],
  [/^(cycle\.completed|report\.)/, "report"],
];

const DECISION_TYPES = new Set<InboxItemType>(["decision", "customer_won", "warning"]);

export function generateInboxComposer(ctx: MockContext): ComposerOutput {
  const { rng } = ctx;
  const events = readEvents(ctx);
  const metrics = readMetrics(ctx);
  const queries = readNamedQueries(ctx);
  const voice = readVoice(ctx);
  const businessName = ctx.getString("business_name", "business.name", "club_name") ?? readNested(ctx, ["business", "brief"], ["name"]) ?? "the business";
  const type = decideType(ctx, events);
  const primary = events[0];
  const subjectEntity = primary ? entityFor(ctx, primary) : undefined;
  const channel = primary ? channelFor(primary) : undefined;
  const taskTitle = primary ? stringField(primary.payload, ["title", "task_title", "pr_title", "name", "subject"]) : undefined;
  const amount = primary ? moneyField(primary.payload) : undefined;

  const who = subjectEntity ? ent(subjectEntity) : (primary && stringField(primary.payload, ["customer_name", "customer", "entity_name", "supplier", "contact"])) || undefined;

  // With no event, the composer service (and the api's in-process fallback) hands over a grounded next-best decision
  // or a data-change insight: write from it, never a "nothing new" filler note.
  const grounded = events.length === 0 ? readGrounded(ctx) : undefined;

  // --- fact → why → ask -------------------------------------------------------------------------------------------
  const fact = grounded ? groundedFact(grounded) : factSentence(type, primary, who, channel, taskTitle, amount, businessName, rng);
  const why = grounded
    ? grounded.kind === "decision"
      ? "It is the most useful call while the team waits for news; each option below says what changes and whether it can be undone."
      : "It is a real change in the numbers rather than an event, so I have kept to the figures behind it."
    : whySentence(type, metrics, channel, rng);
  const ask = askSentence(type, rng);
  const brief = briefSentence(ctx);

  const sentences = [fact, why, brief, ask].filter((s): s is string => Boolean(s));
  const fillers = rng.shuffle(FILLERS[type] ?? FILLERS.update ?? GENERIC_FILLERS);
  let body = sentences.join(" ");
  let fi = 0;
  while (wordCount(body) < 60 && fi < fillers.length) body += ` ${fillers[fi++]}`;
  while (wordCount(body) < 60) body += ` ${rng.pick(GENERIC_FILLERS)}`;
  body = trimToWords(body, 180);

  const paragraphs = splitParagraphs(body);
  const bodyMd = paragraphs.join("\n\n");

  // --- decision --------------------------------------------------------------------------------------------------
  const decision = DECISION_TYPES.has(type) || readOptions(ctx).length >= 2 ? buildDecision(ctx, type, channel, rng) : null;

  // --- exhibit ---------------------------------------------------------------------------------------------------
  const exhibit = chooseExhibit(type, queries, channel, rng);

  const subject = truncate(grounded ? grounded.title : subjectLine(type, who ? plainName(subjectEntity, who) : undefined, channel, taskTitle, voice, rng), 80);

  const runway = metrics.find((m) => /runway/i.test(m.metric));
  const runwayMonths = runway?.value !== undefined ? Number.parseFloat(runway.value) : primary ? numberField(primary.payload, ["months", "runway_months"]) : undefined;
  const blocksContinue = type === "decision" || type === "customer_won" || (type === "warning" && runwayMonths !== undefined && Number.isFinite(runwayMonths) && runwayMonths < 3);

  return {
    type,
    from_agent_id: voice.id,
    subject,
    body_md: bodyMd,
    status_strip: metrics.slice(0, 4).map((m) => ({ metric: m.metric, source: m.source })),
    exhibit,
    decision,
    blocks_continue: blocksContinue,
    source_event_ids: events.map((e) => e.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Input readers
// ---------------------------------------------------------------------------------------------------------------------

function readEvents(ctx: MockContext): EventIn[] {
  const raw = ctx.getArray<unknown>("source_events", "events", "event");
  const single = ctx.getRecord("event");
  const list = raw.length > 0 ? raw : single ? [single] : [];
  const out: EventIn[] = [];
  list.forEach((e, i) => {
    if (!isRecord(e)) return;
    const id = typeof e.id === "string" ? e.id : typeof e.event_id === "string" ? e.event_id : asUuid(undefined, `${ctx.hash}:event:${i}`);
    const type = typeof e.type === "string" ? e.type : typeof e.event_type === "string" ? e.event_type : "update";
    const payload = isRecord(e.payload) ? e.payload : isRecord(e.data) ? e.data : e;
    out.push({ id, type, payload });
  });
  return out;
}

function readMetrics(ctx: MockContext): MetricIn[] {
  const raw = ctx.get<unknown>("metrics", "current_metrics", "status_strip");
  const out: MetricIn[] = [];
  if (Array.isArray(raw)) {
    for (const m of raw) {
      if (!isRecord(m)) continue;
      const metric = typeof m.metric === "string" ? m.metric : typeof m.key === "string" ? m.key : typeof m.name === "string" ? m.name : undefined;
      if (!metric) continue;
      const value = m.value === undefined || m.value === null ? undefined : String(m.value);
      const source = typeof m.source === "string" ? m.source : "metrics";
      out.push({ metric, value, source });
    }
  } else if (isRecord(raw)) {
    for (const [metric, v] of Object.entries(raw)) {
      if (isRecord(v)) out.push({ metric, value: v.value === undefined ? undefined : String(v.value), source: typeof v.source === "string" ? v.source : "metrics" });
      else if (v !== undefined && v !== null) out.push({ metric, value: String(v), source: "metrics" });
    }
  }
  return out;
}

interface Grounded {
  kind: "decision" | "insight";
  title: string;
  facts: Record<string, unknown>;
}

/** The composer's `next_best_decision` or `insight` block (apps/composer/src/compose.ts composerInputs). */
function readGrounded(ctx: MockContext): Grounded | undefined {
  for (const [key, kind] of [["next_best_decision", "decision"], ["insight", "insight"]] as const) {
    const rec = ctx.getRecord(key);
    if (rec && typeof rec.title === "string" && rec.title.trim()) return { kind, title: rec.title.trim(), facts: isRecord(rec.facts) ? rec.facts : {} };
  }
  return undefined;
}

/** "Nothing new since my last note, so here is the call I would make next: … (blocked tasks: 3; running tasks: 2)." */
function groundedFact(g: Grounded): string {
  const facts = Object.entries(g.facts)
    .filter(([k, v]) => !/_minor$|^currency$|^label$/.test(k) && (typeof v === "number" || (typeof v === "string" && v.length <= 60)))
    .slice(0, 3)
    .map(([k, v]) => `${humaniseKey(k)}: ${String(v)}`);
  const title = g.title.charAt(0).toLowerCase() + g.title.slice(1);
  const lead = g.kind === "decision" ? `Nothing new has happened since my last note, so here is the call I would make next: ${title}.` : `No new event, but the data moved: ${title}.`;
  return facts.length ? `${lead} Where things stand (${facts.join("; ")}).` : lead;
}

function readNamedQueries(ctx: MockContext): NamedQuery[] {
  const raw = ctx.getArray<unknown>("named_queries", "queries", "exhibits", "available_exhibits");
  const out: NamedQuery[] = [];
  for (const q of raw) {
    if (typeof q === "string") {
      out.push({ id: q, title: humaniseKey(q), kind: "chart" });
      continue;
    }
    if (!isRecord(q)) continue;
    const id = typeof q.id === "string" ? q.id : typeof q.key === "string" ? q.key : typeof q.name === "string" ? q.name : undefined;
    if (!id) continue;
    const kindRaw = typeof q.kind === "string" ? q.kind : typeof q.exhibit_kind === "string" ? q.exhibit_kind : "chart";
    const kind = (EXHIBIT_KINDS as readonly string[]).includes(kindRaw) && kindRaw !== "none" ? (kindRaw as ExhibitKind) : "chart";
    out.push({ id, title: typeof q.title === "string" ? q.title : humaniseKey(id), kind });
  }
  return out;
}

function readVoice(ctx: MockContext): Voice {
  const raw = ctx.getRecord("from_agent", "agent", "author");
  const agentEntry = ctx.manifest.find((e) => e.kind === "agent");
  const name = (raw && typeof raw.name === "string" && raw.name) || ctx.getString("from_agent_name") || agentEntry?.name || "Chief of Staff";
  const role = (raw && typeof raw.role === "string" && raw.role) || ctx.getString("from_agent_role") || agentEntry?.role || "Chief of Staff";
  const idRaw = (raw && typeof raw.id === "string" && raw.id) || ctx.getString("from_agent_id") || agentEntry?.id;
  return { id: asUuid(idRaw, `${ctx.hash}:from_agent`), name, role };
}

function readOptions(ctx: MockContext): Array<Record<string, unknown>> {
  return ctx.getArray<unknown>("options", "decision_options", "choices").filter(isRecord);
}

function readNested(ctx: MockContext, containers: string[], keys: string[]): string | undefined {
  for (const c of containers) {
    const rec = ctx.getRecord(c);
    if (!rec) continue;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

const stringField = (payload: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
};

const numberField = (payload: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
};

function moneyField(payload: Record<string, unknown>): string | undefined {
  const minor = numberField(payload, ["amount_minor", "amountMinor", "value_minor", "total_minor"]);
  const currency = stringField(payload, ["currency"]) ?? "EUR";
  if (minor !== undefined) return formatMoneyMinor(minor, currency);
  const amountRaw = payload.amount ?? payload.total ?? payload.value;
  if (isRecord(amountRaw) && typeof amountRaw.amountMinor === "number") return formatMoneyMinor(amountRaw.amountMinor, typeof amountRaw.currency === "string" ? amountRaw.currency : currency);
  if (typeof amountRaw === "number") return `${amountRaw} ${currency}`;
  if (typeof amountRaw === "string" && /\d/.test(amountRaw)) return amountRaw;
  return undefined;
}

function entityFor(ctx: MockContext, event: EventIn): ManifestEntry | undefined {
  const ids = ["entity_id", "customer_id", "entityId", "customerId", "supplier_id", "agent_id", "contact_id"]
    .map((k) => event.payload[k])
    .filter((v): v is string => typeof v === "string");
  const entityIds = Array.isArray(event.payload.entity_ids) ? (event.payload.entity_ids as unknown[]).filter((v): v is string => typeof v === "string") : [];
  for (const id of [...ids, ...entityIds]) {
    const found = ctx.manifest.find((e) => e.id === id);
    if (found) return found;
  }
  const name = stringField(event.payload, ["customer_name", "customer", "entity_name", "supplier", "contact"]);
  if (name) {
    const lower = name.toLowerCase();
    return ctx.manifest.find((e) => e.name.toLowerCase() === lower || e.aliases.some((a) => a.toLowerCase() === lower));
  }
  return ctx.manifest.find((e) => e.kind !== "agent");
}

function channelFor(event: EventIn): ChannelKey | undefined {
  const raw = stringField(event.payload, ["channel_key", "channel", "channelKey"]);
  return raw && (CHANNEL_KEYS as readonly string[]).includes(raw) ? (raw as ChannelKey) : undefined;
}

function plainName(entity: ManifestEntry | undefined, fallback: string): string {
  return entity ? entity.name : fallback;
}

// ---------------------------------------------------------------------------------------------------------------------
// Type decision
// ---------------------------------------------------------------------------------------------------------------------

function decideType(ctx: MockContext, events: EventIn[]): InboxItemType {
  const hint = ctx.getString("type", "item_type", "inbox_type", "note_type");
  if (hint && (INBOX_ITEM_TYPES as readonly string[]).includes(hint)) return hint as InboxItemType;
  if (ctx.getBoolean("decision_needed") === true || readOptions(ctx).length >= 2) return "decision";
  for (const e of events) {
    for (const [re, t] of TYPE_BY_EVENT) if (re.test(e.type)) return t;
  }
  if (events.length === 0 && /\b(decide|decision|choose|option)/i.test(ctx.userText)) return "decision";
  return "update";
}

// ---------------------------------------------------------------------------------------------------------------------
// Sentences (all templates digit-free; numbers only arrive through interpolated input values)
// ---------------------------------------------------------------------------------------------------------------------

function factSentence(type: InboxItemType, e: EventIn | undefined, who: string | undefined, channel: ChannelKey | undefined, title: string | undefined, amount: string | undefined, business: string, rng: MockContext["rng"]): string {
  const ch = channel ? channelLabel(channel) : "the channel";
  const subject = who ?? "A customer";
  if (!e) {
    return rng.pick([
      `Quiet period across ${business}: nothing new landed since the last cycle, so this note is a pulse check rather than news.`,
      `No fresh events for ${business} this cycle; I am using the gap to flag what deserves your attention next.`,
    ]);
  }
  switch (true) {
    case /^payment\.received$/.test(e.type):
      return rng.pick([
        `${subject} has paid${amount ? ` ${amount}` : ""} — ${business} has a paying customer on the books.`,
        `Money in: ${subject} settled${amount ? ` ${amount}` : " their first invoice"}, so this is revenue on the books rather than a forecast.`,
      ]);
    case /^customer\.converted$/.test(e.type):
      return rng.pick([`${subject} converted — the full journey is ready to replay.`, `Debrief: ${subject} is now a customer of ${business}.`]);
    case /^signup\.created$/.test(e.type):
      return `${subject} signed up${channel ? ` through ${ch}` : ""}; the first touch is in the replay.`;
    case /^activation\.reached$/.test(e.type):
      return `${subject} reached activation, which is the step most trials never make.`;
    case /^channel\.threshold_breached$/.test(e.type):
      return rng.pick([
        `${ch} has gone past its cap${metricPhrase(e)}; the engine paused itself as the rules require.`,
        `Guardrail breached on ${ch}${metricPhrase(e)}; the engine is holding until you decide.`,
      ]);
    case /^runway\.threshold_crossed$/.test(e.type):
      return `Runway just crossed a warning line${metricPhrase(e)}; cash is the fact behind everything else in this note.`;
    case /^credential\.expiring$/.test(e.type):
      return `A credential${title ? ` for ${title}` : ""} is about to expire, and the agents who depend on it will be down until it is renewed.`;
    case /^agent\.health_changed$/.test(e.type):
      return `${who ?? "An agent"} changed health status${title ? ` (${title})` : ""}; I have checked it is not a wider outage.`;
    case /^task\.blocked$/.test(e.type):
      return `${title ? `"${title}"` : "A task"} is blocked and needs a call from you before the team can continue.`;
    case /^(pr\.merged|deploy\.succeeded|task\.completed)$/.test(e.type):
      return rng.pick([
        `${who ?? "The team"} shipped ${title ? `"${title}"` : "the latest piece of work"}; tests passed and the branch is merged.`,
        `Done: ${title ? `"${title}"` : "the task"} is complete${who ? ` thanks to ${who}` : ""}, review clean, nothing left in the queue for it.`,
      ]);
    case /^campaign\.launched$/.test(e.type):
      return `${ch} is live${title ? ` with "${title}"` : ""}; measurement links and codes are in place.`;
    case /^approval\.requested$/.test(e.type):
      return `${who ?? "An agent"} is asking for approval${title ? ` on "${title}"` : ""}${amount ? ` worth ${amount}` : ""} before going further.`;
    case /^spec\.proposal_created$/.test(e.type):
      return `A change proposal${title ? ` touching "${title}"` : ""} is waiting for your review, with evidence attached.`;
    case /^message\.received$/.test(e.type):
      return `${who ?? "Someone"} sent a message${title ? ` about "${title}"` : ""}; it is quoted in full below the note.`;
    case /^(idea\.committed|spec\.version_published|contract\.signed|holiday\.)/.test(e.type):
      return `Milestone: ${title ?? humaniseKey(e.type)} for ${business}.`;
    default:
      return `${sentenceCase(humaniseKey(e.type))}${title ? `: ${title}` : ""}${who ? `, involving ${who}` : ""}.`;
  }
}

function metricPhrase(e: EventIn): string {
  const metric = stringField(e.payload, ["metric", "threshold_metric"]);
  const value = e.payload.value ?? e.payload.current ?? e.payload.observed;
  if (metric && (typeof value === "number" || typeof value === "string")) return ` (${humaniseKey(metric)} at ${String(value)})`;
  if (metric) return ` on ${humaniseKey(metric)}`;
  return "";
}

function whySentence(type: InboxItemType, metrics: MetricIn[], channel: ChannelKey | undefined, rng: MockContext["rng"]): string {
  const m = metrics.find((x) => x.value !== undefined);
  const metricClause = m ? `${humaniseKey(m.metric)} stands at ${m.value} (from ${humaniseKey(m.source)})` : undefined;
  switch (type) {
    case "customer_won":
      return rng.pick([
        `It matters because revenue from real customers is the only number that compounds${metricClause ? `; ${metricClause}` : ""}.`,
        `Every paying customer sharpens the attribution model and tells the team which channels are actually converting${metricClause ? `; ${metricClause}` : ""}.`,
      ]);
    case "warning":
      return rng.pick([
        `This matters because the guardrail exists to protect cash${metricClause ? `: ${metricClause}` : ""}, and sitting on it costs us a week of learning.`,
        `Left alone this compounds${metricClause ? `; ${metricClause}` : ""}, so the sooner you pick a direction the cheaper it is.`,
      ]);
    case "decision":
      return rng.pick([
        `It needs you because the options differ in cost and reversibility, not because the team is stuck${metricClause ? `; for context, ${metricClause}` : ""}.`,
        `The reason it is on your desk: it is outside the current policy caps${metricClause ? `, and ${metricClause}` : ""}.`,
      ]);
    case "milestone":
      return `Why it matters: this moves ${channel ? channelLabel(channel) : "the business"} from plan to proof${metricClause ? `; ${metricClause}` : ""}.`;
    case "human_message":
      return `I have not replied; outbound messages in your name wait for you${metricClause ? `. For context, ${metricClause}` : ""}.`;
    case "report":
      return `The headline is steady progress with no gated items waiting${metricClause ? `; ${metricClause}` : ""}.`;
    default:
      return rng.pick([
        `Why it matters: it unblocks the next piece of customer-facing work${metricClause ? `; ${metricClause}` : ""}.`,
        `This keeps the roadmap honest; the status is computed from tests, not from promises${metricClause ? `. Context: ${metricClause}` : ""}.`,
      ]);
  }
}

function askSentence(type: InboxItemType, rng: MockContext["rng"]): string {
  switch (type) {
    case "decision":
      return rng.pick([`Pick an option below or tell me in your own words; I will turn it into a plan before anything runs.`, `Your call: choose below, or tell me in your own words and I will show you the plan before anything runs.`]);
    case "customer_won":
      return `Choose how we follow up, or just celebrate; any choice marks this answered and opens the replay.`;
    case "warning":
      return `Tell me whether to hold, adjust the cap, or keep going; nothing moves money without you.`;
    case "human_message":
      return `Tell me how you want to respond and I will draft it for your approval.`;
    default:
      return rng.pick([`No action needed from you; I will post a follow-up when the next step lands.`, `Nothing to decide here; this is for your awareness and the record.`]);
  }
}

function briefSentence(ctx: MockContext): string | undefined {
  const brief = ctx.getString("brief", "business_brief", "summary") ?? readNested(ctx, ["business", "brief"], ["summary", "one_liner", "description", "pitch"]);
  if (!brief) return undefined;
  const first = brief.split(/(?<=[.!?])\s+/)[0] ?? brief;
  if (!first || /\d/.test(first)) return undefined; // never import stray numbers through the brief
  return `Context: ${truncate(first.replace(/\s+/g, " ").trim(), 140)}`;
}

const FILLERS: Partial<Record<InboxItemType, string[]>> = {
  customer_won: [
    "Who was involved lists the channels and agents that contributed, and the standout agent is the one with the highest attribution weight.",
    "I have kept the replay deterministic so you can rewatch it from the customer's profile at any time.",
    "The thank-you option sends on behalf of the business and discloses that an agent drafted it.",
  ],
  warning: [
    "The engine will stay paused until you answer; other channels continue within their own caps.",
    "I have attached the channel performance so you can see whether this is a blip or a trend.",
    "If you prefer, I can propose a lower cap and re-run the plan for your confirmation.",
  ],
  decision: [
    "Each option lists its consequence, cost and whether it can be undone.",
    "Anything outside policy will show a confirmation with costs before it executes.",
    "If none of the options fit, tell me in your own words and I will turn it into a plan for you to confirm.",
  ],
  update: [
    "The exhibit below is drawn from a named query, so the figures are live rather than typed by me.",
    "Costs for this piece of work are shown on the item as an estimate until the invoice arrives.",
    "I will keep the roadmap status in sync with the acceptance criteria as more tests land.",
  ],
  milestone: ["This goes in Milestones and, in LIVE mode, can be shared as a milestone card.", "Nothing is required from you; the team keeps working through the current cycle."],
  report: ["Full details are in the linked artifacts; I have kept the summary to what changed.", "Gated items, if any, will arrive as separate decisions rather than being buried here."],
  human_message: ["The sender's details are on their CRM profile, including how we know them.", "I have not acted on anything inside the message; it is treated as data, not instructions."],
};

const GENERIC_FILLERS = [
  "I will post a follow-up with links to the artifacts once this is resolved.",
  "Everything referenced here is linked so you can check the source records yourself.",
  "This note was written from the source events and current metrics only.",
  "Let me know if you want this kind of item routed to a department lead instead of you.",
];

function trimToWords(text: string, max: number): string {
  if (wordCount(text) <= max) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  while (sentences.length > 1 && wordCount(sentences.join(" ")) > max) sentences.pop();
  let out = sentences.join(" ");
  if (wordCount(out) > max) out = out.split(/\s+/).slice(0, max).join(" ").replace(/[,;:]?$/, ".");
  return out;
}

function splitParagraphs(body: string): string[] {
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 3) return [sentences.join(" ")];
  const first = sentences.slice(0, Math.ceil(sentences.length / 2)).join(" ");
  const second = sentences.slice(Math.ceil(sentences.length / 2)).join(" ");
  return [first, second];
}

// ---------------------------------------------------------------------------------------------------------------------
// Subject, decision, exhibit
// ---------------------------------------------------------------------------------------------------------------------

function subjectLine(type: InboxItemType, who: string | undefined, channel: ChannelKey | undefined, title: string | undefined, voice: Voice, rng: MockContext["rng"]): string {
  const ch = channel ? channelLabel(channel) : undefined;
  switch (type) {
    case "customer_won":
      return rng.pick([`${who ?? "A customer"} is now a paying customer`, `Win: ${who ?? "new customer"} converted`, `Debrief — ${who ?? "a customer"} signed`]);
    case "warning":
      return rng.pick([`${ch ?? "Channel"} breached its guardrail`, `Warning: ${ch ?? title ?? "attention needed"}`, `${ch ?? "An engine"} paused itself`]);
    case "decision":
      return rng.pick([`Decision needed: ${title ?? ch ?? "next step"}`, `Your call on ${title ?? ch ?? "the next move"}`, `${voice.name} needs a decision`]);
    case "milestone":
      return `Milestone: ${title ?? ch ?? "a step forward"}`;
    case "human_message":
      return `Message from ${who ?? "a contact"}${title ? `: ${title}` : ""}`;
    case "report":
      return `${voice.name}'s report: ${title ?? "cycle summary"}`;
    default:
      return rng.pick([`${title ?? ch ?? "Work"} shipped`, `Update: ${title ?? ch ?? "progress"}`, `${voice.name}: ${title ?? "latest progress"}`]);
  }
}

function buildDecision(ctx: MockContext, type: InboxItemType, channel: ChannelKey | undefined, rng: MockContext["rng"]): ComposerOutput["decision"] {
  const provided = readOptions(ctx);
  let options: ComposerOption[];
  if (provided.length >= 2) {
    options = provided.slice(0, 4).map((o, i) => ({
      id: typeof o.id === "string" ? o.id : String.fromCharCode(97 + i),
      label: typeof o.label === "string" ? o.label : `Option ${String.fromCharCode(65 + i)}`,
      recommended: o.recommended === true,
      consequence: typeof o.consequence === "string" ? o.consequence : "See note.",
      cost_minor: typeof o.cost_minor === "number" && Number.isInteger(o.cost_minor) && o.cost_minor >= 0 ? o.cost_minor : 0,
      reversible: typeof o.reversible === "boolean" ? o.reversible : true,
    }));
  } else {
    const ch = channel ? channelLabel(channel) : "the channel";
    const pool: Array<Omit<ComposerOption, "id" | "recommended">> =
      type === "customer_won"
        ? [
            { label: "Send a thank-you", consequence: "A short, disclosed note goes out on behalf of the business.", cost_minor: 0, reversible: false },
            { label: "Ask for a review in two weeks", consequence: "A scheduled, suppressible request after they have used the product.", cost_minor: 0, reversible: true },
            { label: "Offer an annual upgrade", consequence: "An upgrade offer is drafted for your approval first.", cost_minor: 0, reversible: true },
            { label: "Just celebrate", consequence: "No outbound message; the replay opens.", cost_minor: 0, reversible: true },
          ]
        : type === "warning"
          ? [
              { label: `Hold ${ch} for a week`, consequence: "No spend until the review; learning pauses.", cost_minor: 0, reversible: true },
              { label: "Raise the cap and continue", consequence: "The engine resumes within the new cap; you approve the amount.", cost_minor: 0, reversible: true },
              { label: "Keep the cap, let it resume", consequence: "The engine restarts and pauses again if the guardrail trips.", cost_minor: 0, reversible: true },
            ]
          : [
              { label: "Approve as proposed", consequence: "The team executes within policy and reports back.", cost_minor: 0, reversible: false },
              { label: "Approve a smaller first step", consequence: "A reduced scope ships first; the rest waits for results.", cost_minor: 0, reversible: true },
              { label: "Hold for more evidence", consequence: "Nothing runs; the lead gathers data and comes back.", cost_minor: 0, reversible: true },
              { label: "Decline", consequence: "The proposal is archived with your reason.", cost_minor: 0, reversible: true },
            ];
    // Match Day items always carry the four BUILD §11.4 options; other decisions vary between two and four by hash.
    const count = type === "customer_won" ? pool.length : Math.min(pool.length, Math.max(2, rng.int(2, 4)));
    options = pool.slice(0, count).map((o, i) => ({ ...o, id: String.fromCharCode(97 + i), recommended: false }));
  }
  const recommendedIdx = options.findIndex((o) => o.recommended);
  const chosen = recommendedIdx >= 0 ? recommendedIdx : type === "customer_won" ? 0 : rng.int(0, Math.min(1, options.length - 1));
  options = options.map((o, i) => ({ ...o, recommended: i === chosen }));
  const expires = ctx.getString("expires_at", "decision_expires_at") ?? null;
  return { options, free_text: true, expires_at: expires };
}

function chooseExhibit(type: InboxItemType, queries: NamedQuery[], channel: ChannelKey | undefined, rng: MockContext["rng"]): ComposerOutput["exhibit"] {
  if (queries.length === 0) return { kind: "none", spec_ref: null };
  const prefer: RegExp =
    type === "customer_won"
      ? /customer|mrr|revenue|journey|conversion|signup/i
      : type === "warning"
        ? /cpa|runway|cash|burn|channel|spend|cost/i
        : type === "decision"
          ? /option|forecast|budget|channel|spend/i
          : /task|progress|velocity|roadmap|channel/i;
  const byChannel = channel ? queries.find((q) => q.id.toLowerCase().includes(channel) || q.title.toLowerCase().includes(channelLabel(channel).toLowerCase())) : undefined;
  const preferred = byChannel ?? queries.find((q) => prefer.test(q.id) || prefer.test(q.title));
  const pick = preferred ?? (queries.length > 1 && rng.chance(0.3) ? rng.pick(queries) : (queries[0] as NamedQuery));
  return { kind: pick.kind, spec_ref: pick.id };
}
