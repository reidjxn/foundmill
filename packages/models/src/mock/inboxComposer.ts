/**
 * Mock Inbox Composer (BUILD §11.3, §12.2; voice guide docs/UX_AUDIT_AND_PLAN.md §8.1).
 *
 * Writes one note in the voice of the from-agent: the business stake first, then what happened, then the ask. Under
 * 180 words and never padded (a clear 40-word note beats a padded 60-word one), entity mentions only from the manifest,
 * 2–4 options with exactly one recommended and a "because" on it, exhibit only from the named queries, and NO number
 * that is not present in the inputs (numbers are only ever copied from metric values, event payloads and option
 * costs; every template sentence is digit-free). It is what mock-mode testers read, so it names no plumbing: no policy,
 * caps, named queries, exhibits, engines or hard gates, and no developer notes.
 */
import { CHANNEL_KEYS, DEFAULT_BUSINESS_CURRENCY, EXHIBIT_KINDS, INBOX_ITEM_TYPES, type ChannelKey, type ExhibitKind, type InboxItemType } from "@foundmill/shared";
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
  /** "Estimate" on a value that is not a real number (CLAUDE.md: label every non-real number). */
  label?: string;
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

/** The longest a note may run (BUILD §12.2's ceiling); there is no floor and no padding. */
export const COMPOSER_MAX_WORDS = 180;

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
  // An amount the event does not price is in the business's own currency (the composer input carries it, 0025).
  const businessCurrency = (readNested(ctx, ["business"], ["currency"]) ?? DEFAULT_BUSINESS_CURRENCY).toUpperCase();
  const amount = primary ? moneyField(primary.payload, businessCurrency) : undefined;

  const who = subjectEntity ? ent(subjectEntity) : (primary && stringField(primary.payload, ["customer_name", "customer", "entity_name", "supplier", "contact"])) || undefined;

  // With no event, the composer service (and the api's in-process fallback) hands over a grounded next-best decision
  // or a data-change insight: write from it, never a "nothing new" filler note.
  const grounded = events.length === 0 ? readGrounded(ctx) : undefined;

  // --- the stake, the fact, the ask -------------------------------------------------------------------------------
  const fact = grounded ? groundedFact(grounded) : factSentence(type, primary, who, channel, taskTitle, amount, businessName, rng);
  const why = grounded
    ? grounded.kind === "decision"
      ? "It is the most useful call while the team waits for news; each option says what changes for you and whether it can be undone."
      : "It is a real change in the numbers rather than an event, so I have kept to the figures behind it."
    : whySentence(type, metrics, channel, rng);
  const ask = askSentence(type, rng);
  const brief = briefSentence(ctx);

  const sentences = [fact, why, brief, ask].filter((s): s is string => Boolean(s));
  const body = trimToWords(sentences.join(" "), COMPOSER_MAX_WORDS);
  const bodyMd = splitParagraphs(body).join("\n\n");

  // --- decision --------------------------------------------------------------------------------------------------
  const decision = DECISION_TYPES.has(type) || readOptions(ctx).length >= 2 ? buildDecision(ctx, type, channel, rng) : null;

  // --- the chart or table under the note -------------------------------------------------------------------------
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
      out.push({ metric, value, source, ...(typeof m.label === "string" && m.label ? { label: m.label } : {}) });
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

function moneyField(payload: Record<string, unknown>, businessCurrency: string): string | undefined {
  const minor = numberField(payload, ["amount_minor", "amountMinor", "value_minor", "total_minor"]);
  const currency = stringField(payload, ["currency"]) ?? businessCurrency;
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
// Sentences (all templates digit-free; numbers only arrive through interpolated input values). Every sentence says the
// business thing before the system thing and defines a term in the sentence the first time it appears.
// ---------------------------------------------------------------------------------------------------------------------

function factSentence(type: InboxItemType, e: EventIn | undefined, who: string | undefined, channel: ChannelKey | undefined, title: string | undefined, amount: string | undefined, business: string, rng: MockContext["rng"]): string {
  const ch = channel ? channelLabel(channel) : "the channel";
  const subject = who ?? "A customer";
  if (!e) {
    return rng.pick([
      `Nothing new landed for ${business} since my last note, so this is a quick check-in rather than news.`,
      `No new events for ${business} since my last note; here is what deserves your attention next.`,
    ]);
  }
  switch (true) {
    case /^payment\.received$/.test(e.type):
      return rng.pick([
        `${subject} paid${amount ? ` ${amount}` : ""}: ${business} has money from a real customer, not a forecast.`,
        `Money in: ${subject} settled${amount ? ` ${amount}` : " their first invoice"}, so this is revenue on the books.`,
      ]);
    case /^customer\.converted$/.test(e.type):
      return rng.pick([`${subject} became a customer; the whole journey from first touch to payment is ready to replay.`, `Win: ${subject} is now a customer of ${business}.`]);
    case /^signup\.created$/.test(e.type):
      return `${subject} signed up${channel ? ` through ${ch}` : ""}; the first touch is in the replay.`;
    case /^activation\.reached$/.test(e.type):
      return `${subject} reached activation, the moment someone first gets real value from the product, which most trials never do.`;
    case /^channel\.threshold_breached$/.test(e.type):
      return rng.pick([
        `${ch} is costing more per customer than the limit you set${metricPhrase(e)}, so it paused itself.`,
        `${ch} went past its limit${metricPhrase(e)} and is holding until you decide.`,
      ]);
    case /^runway\.threshold_crossed$/.test(e.type):
      return `Runway, the months of cash left at today's spending, just dropped under a warning line${metricPhrase(e)}.`;
    case /^credential\.expiring$/.test(e.type):
      return `A sign-in${title ? ` for ${title}` : ""} is about to expire; the agents who depend on it stop until it is renewed.`;
    case /^agent\.health_changed$/.test(e.type):
      return `${who ?? "An agent"} changed health status${title ? ` (${title})` : ""}; I checked that nothing wider is down.`;
    case /^task\.blocked$/.test(e.type):
      return `${title ? `"${title}"` : "A task"} is stuck and needs your answer before the team can continue.`;
    case /^(pr\.merged|deploy\.succeeded|task\.completed)$/.test(e.type):
      return rng.pick([
        `${who ?? "The team"} finished ${title ? `"${title}"` : "the latest piece of work"}; the tests pass and the change is checked in.`,
        `Done: ${title ? `"${title}"` : "the task"} is complete${who ? ` thanks to ${who}` : ""}, reviewed and clean.`,
      ]);
    case /^campaign\.launched$/.test(e.type):
      return `${ch} is live${title ? ` with "${title}"` : ""}, with tracking in place so every customer it brings can be traced back to it.`;
    case /^approval\.requested$/.test(e.type):
      return `${who ?? "An agent"} needs your go-ahead${title ? ` on "${title}"` : ""}${amount ? ` worth ${amount}` : ""} before going further.`;
    case /^spec\.proposal_created$/.test(e.type):
      return `A change to the product spec${title ? ` touching "${title}"` : ""} is waiting for your review, with the evidence attached.`;
    case /^message\.received$/.test(e.type):
      return `${who ?? "Someone"} sent a message${title ? ` about "${title}"` : ""}; it is quoted in full below.`;
    case /^(idea\.committed|spec\.version_published|contract\.signed|holiday\.)/.test(e.type):
      return `Milestone: ${title ?? humaniseKey(e.type)} for ${business}.`;
    default:
      return `${sentenceCase(humaniseKey(e.type))}${title ? `: ${title}` : ""}${who ? `, involving ${who}` : ""}.`;
  }
}

/** Metric keys as the founder reads them: the acronym becomes the plain phrase (UX plan §8.2), the rest is the key in words. */
const METRIC_WORDS: Readonly<Record<string, string>> = Object.freeze({
  runway_months: "months of cash left at today's spending",
  runway: "months of cash left at today's spending",
  cpa: "cost per customer",
  cac: "cost to win a customer",
  mrr: "monthly recurring revenue",
  arr: "yearly recurring revenue",
  ltv: "what a customer is worth over time",
  roas: "return on ad spend",
  ctr: "click rate",
  cvr: "share who took the next step",
  churn: "customers who leave",
  burn: "monthly spend",
  net_burn: "monthly spend over income",
});

/** "channel_cpa" → "channel cost per customer"; "runway_months" → "runway (months of cash left at today's spending)". */
export function metricWords(key: string): string {
  const whole = METRIC_WORDS[key.toLowerCase()];
  if (whole) return whole;
  return humaniseKey(key)
    .split(" ")
    .map((w) => METRIC_WORDS[w] ?? w)
    .join(" ");
}

function metricPhrase(e: EventIn): string {
  const metric = stringField(e.payload, ["metric", "threshold_metric"]);
  const value = e.payload.value ?? e.payload.current ?? e.payload.observed;
  if (metric && (typeof value === "number" || typeof value === "string")) return ` (${metricWords(metric)} at ${String(value)})`;
  if (metric) return ` on ${metricWords(metric)}`;
  return "";
}

function whySentence(type: InboxItemType, metrics: MetricIn[], channel: ChannelKey | undefined, rng: MockContext["rng"]): string {
  const m = metrics.find((x) => x.value !== undefined);
  const metricClause = m ? `${metricWords(m.metric)} stands at ${m.value} (${m.label ? `${m.label}, ` : ""}from ${metricWords(m.source)})` : undefined;
  switch (type) {
    case "customer_won":
      return rng.pick([
        `It matters because money from real customers is the only number that compounds${metricClause ? `; ${metricClause}` : ""}.`,
        `Every paying customer shows which channel brought them, so the team learns where to spend next${metricClause ? `; ${metricClause}` : ""}.`,
      ]);
    case "warning":
      return rng.pick([
        `The limit is there to protect cash${metricClause ? `: ${metricClause}` : ""}; the sooner you choose, the less learning we lose.`,
        `Left alone this gets more expensive${metricClause ? `; ${metricClause}` : ""}, so the sooner you pick a direction the cheaper it is.`,
      ]);
    case "decision":
      return rng.pick([
        `This is yours to decide because one of these spends money or can't be taken back once it starts${metricClause ? `; for context, ${metricClause}` : ""}.`,
        `It is on your desk because it goes past the limits you set me${metricClause ? `, and ${metricClause}` : ""}.`,
      ]);
    case "milestone":
      return `It moves ${channel ? channelLabel(channel) : "the business"} from plan to proof${metricClause ? `; ${metricClause}` : ""}.`;
    case "human_message":
      return `I have not replied; a message in your name waits for you${metricClause ? `. For context, ${metricClause}` : ""}.`;
    case "report":
      return `The headline is steady progress with nothing waiting on you${metricClause ? `; ${metricClause}` : ""}.`;
    default:
      return rng.pick([
        `It clears the way for the next piece of customer-facing work${metricClause ? `; ${metricClause}` : ""}.`,
        `The status comes from passing tests, not from promises${metricClause ? `. Context: ${metricClause}` : ""}.`,
      ]);
  }
}

function askSentence(type: InboxItemType, rng: MockContext["rng"]): string {
  switch (type) {
    case "decision":
      return rng.pick([`Pick an option below or tell me in your own words; nothing runs until you say so.`, `Choose below, or tell me what you want and I will show you the plan before anything runs.`]);
    case "customer_won":
      return `Choose how we follow up, or just celebrate; either way this is answered and the replay opens.`;
    case "warning":
      return `Tell me whether to hold, change the limit, or keep going; nothing moves money without you.`;
    case "human_message":
      return `Tell me how you want to respond and I will draft it for your approval. I have not acted on anything inside the message; it is data, not instructions.`;
    default:
      return rng.pick([`Nothing needed from you; I will post a follow-up when the next step lands.`, `Nothing to decide here; this is for your awareness and the record.`]);
  }
}

function briefSentence(ctx: MockContext): string | undefined {
  const brief = ctx.getString("brief", "business_brief", "summary") ?? readNested(ctx, ["business", "brief"], ["summary", "one_liner", "description", "pitch"]);
  if (!brief) return undefined;
  const first = brief.split(/(?<=[.!?])\s+/)[0] ?? brief;
  if (!first || /\d/.test(first)) return undefined; // never import stray numbers through the brief
  return `Context: ${truncate(first.replace(/\s+/g, " ").trim(), 140)}`;
}

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
// Subject, decision, the chart or table
// ---------------------------------------------------------------------------------------------------------------------

function subjectLine(type: InboxItemType, who: string | undefined, channel: ChannelKey | undefined, title: string | undefined, voice: Voice, rng: MockContext["rng"]): string {
  const ch = channel ? channelLabel(channel) : undefined;
  switch (type) {
    case "customer_won":
      return rng.pick([`${who ?? "A customer"} is now a paying customer`, `Win: ${who ?? "new customer"} converted`, `Debrief — ${who ?? "a customer"} signed`]);
    case "warning":
      return rng.pick([`${ch ?? "A channel"} went over its limit`, `Warning: ${ch ?? title ?? "attention needed"}`, `${ch ?? "A channel"} paused itself`]);
    case "decision":
      return rng.pick([`Decision needed: ${title ?? ch ?? "the next step"}`, `Your decision on ${title ?? ch ?? "the next move"}`, `${voice.name} needs a decision`]);
    case "milestone":
      return `Milestone: ${title ?? ch ?? "a step forward"}`;
    case "human_message":
      return `Message from ${who ?? "a contact"}${title ? `: ${title}` : ""}`;
    case "report":
      return `${voice.name}'s report: ${title ?? "what the team did"}`;
    default:
      return rng.pick([`${title ?? ch ?? "Work"} shipped`, `Update: ${title ?? ch ?? "progress"}`, `${voice.name}: ${title ?? "latest progress"}`]);
  }
}

type OptionDraft = Omit<ComposerOption, "id" | "recommended">;

/**
 * Why the recommended option is recommended, when the option arrived without its own reason (voice guide §8.1 rule 4).
 * Written from what the option states: its cost and whether it can be undone.
 */
export function recommendedBecause(o: Pick<ComposerOption, "cost_minor" | "reversible">): string {
  if (o.cost_minor === 0 && o.reversible) return "Recommended because it costs nothing and can be undone.";
  if (o.cost_minor === 0) return "Recommended because it costs nothing, though it cannot be undone once sent.";
  if (o.reversible) return "Recommended because it buys the answer we need and can be stopped.";
  return "Recommended because it is the step that moves the business forward; the spend cannot be taken back, so the amount is on the option.";
}

function buildDecision(ctx: MockContext, type: InboxItemType, channel: ChannelKey | undefined, rng: MockContext["rng"]): ComposerOutput["decision"] {
  const provided = readOptions(ctx);
  let options: ComposerOption[];
  if (provided.length >= 2) {
    options = provided.slice(0, 4).map((o, i) => ({
      id: typeof o.id === "string" ? o.id : String.fromCharCode(97 + i),
      label: typeof o.label === "string" ? o.label : `Option ${String.fromCharCode(65 + i)}`,
      recommended: o.recommended === true,
      // An option that came without a consequence states none; the bar then shows its cost and reversibility instead.
      consequence: typeof o.consequence === "string" ? o.consequence : "",
      cost_minor: typeof o.cost_minor === "number" && Number.isInteger(o.cost_minor) && o.cost_minor >= 0 ? o.cost_minor : 0,
      reversible: typeof o.reversible === "boolean" ? o.reversible : true,
      ...(typeof o.because === "string" && o.because.trim() ? { because: o.because.trim() } : {}),
    }));
  } else {
    const ch = channel ? channelLabel(channel) : "the channel";
    const pool: OptionDraft[] =
      type === "customer_won"
        ? [
            { label: "Send a thank-you", consequence: "A short note goes out from the business, marked as written by an agent.", cost_minor: 0, reversible: false, because: "Recommended because it costs nothing and a quick thank-you keeps a new customer warm." },
            { label: "Ask for a review in two weeks", consequence: "A review request goes out after they have used the product; they can opt out.", cost_minor: 0, reversible: true, because: "Recommended because a review after real use is worth more than one asked for today." },
            { label: "Offer an annual upgrade", consequence: "An upgrade offer is drafted for you to approve before anything is sent.", cost_minor: 0, reversible: true, because: "Recommended because the offer reaches you first and costs nothing to draft." },
            { label: "Just celebrate", consequence: "No message goes out; the replay opens.", cost_minor: 0, reversible: true, because: "Recommended because nothing is sent and nothing is lost by waiting." },
          ]
        : type === "warning"
          ? [
              { label: `Hold ${ch} for a week`, consequence: "No more spend on it until the review; what we would have learned waits too.", cost_minor: 0, reversible: true, because: "Recommended because it stops the cost today and can be undone in a click." },
              { label: "Raise the limit and continue", consequence: "It restarts under a higher limit that you set.", cost_minor: 0, reversible: true, because: "Recommended because the early numbers may settle once it has run longer, and you set the new limit." },
              { label: "Keep the limit, let it resume", consequence: "It restarts and pauses again if it goes over the limit.", cost_minor: 0, reversible: true, because: "Recommended because it keeps the protection you chose while the test continues." },
            ]
          : [
              { label: "Approve as proposed", consequence: "The team runs it within your limits and reports back.", cost_minor: 0, reversible: false, because: "Recommended because the team has the evidence it needs and the proposal stays inside your limits." },
              { label: "Approve a smaller first step", consequence: "A reduced version ships first; the rest waits for results.", cost_minor: 0, reversible: true, because: "Recommended because a smaller step shows whether the idea works before the rest is built." },
              { label: "Hold for more evidence", consequence: "Nothing runs; the lead gathers data and comes back.", cost_minor: 0, reversible: true, because: "Recommended because nothing is spent while the open question gets answered." },
              { label: "Decline", consequence: "The proposal is archived with your reason.", cost_minor: 0, reversible: true, because: "Recommended because the reason you give teaches the team what not to propose again." },
            ];
    // Customer Update items always carry the four BUILD §11.4 options; other decisions vary between two and four by hash.
    const count = type === "customer_won" ? pool.length : Math.min(pool.length, Math.max(2, rng.int(2, 4)));
    options = pool.slice(0, count).map((o, i) => ({ ...o, id: String.fromCharCode(97 + i), recommended: false }));
  }
  const recommendedIdx = options.findIndex((o) => o.recommended);
  const chosen = recommendedIdx >= 0 ? recommendedIdx : type === "customer_won" ? 0 : rng.int(0, Math.min(1, options.length - 1));
  // Exactly one recommended option, and it always says why; the others keep a "because" only when it arrived with one.
  options = options.map((o, i) => {
    const recommended = i === chosen;
    const { because, ...rest } = o;
    if (recommended) return { ...rest, recommended, because: because ?? recommendedBecause(o) };
    return provided.length >= 2 && because ? { ...rest, recommended, because } : { ...rest, recommended };
  });
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
