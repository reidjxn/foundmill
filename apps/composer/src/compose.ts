/**
 * The narration pipeline (BUILD §11.3 "Hyperlinking pipeline", §12.2):
 *
 *   inputs → `inboxComposer` route (locked Opus; mock in mock mode) → Zod Composer schema → entity-linker
 *   `checkComposerText` (unknown / invisible ids rejected) → one re-ask → still invalid → reject (narrate) or strip
 *   (refresh, which must always yield an item) → `linkComposerText` sweep for remaining proper nouns → a `ComposerItem`
 *   for `repos.inbox.createItem` with `blocks_continue` set by the type rules, not by the model.
 *
 * The model never decides which events were narrated (`source_event_ids` are the real ids), never chooses an exhibit
 * outside the registry (AC-11.3.6) and never puts an unknown id in front of the founder (AC-11.3.1).
 */
import { SIMULATED_FINDINGS_NOTE, clubRulesPrompt, composerEventPayload, composerNotesFor, prompts } from "@foundmill/agents";
import { APP_NAME, LIMITS } from "@foundmill/config";
import type { ComposerItem, Event } from "@foundmill/db";
import { checkComposerText, linkComposerText, stripMarkup, type LinkedText, type ValidationResult } from "@foundmill/entity-linker";
import { ComposerOutput, ModelAbortedError, type ChatMessage, type CompleteResultWithJson, type ComposerOption, type ModelClient, type ModelLogger, type TokenUsage } from "@foundmill/models";
import { AppError, UNKNOWN_FOUNDER_CONTEXT, founderContextJson, founderJargonHits, futureDeadline, PARKED_DETAIL_MAX, PARKED_TASKS_MAX, PARKED_TITLE_MAX, type InboxItemType, type ParkedTask } from "@foundmill/shared";
import { businessBrief, type ComposeContext } from "./context";
import type { NextBestDecision } from "./decisions";
import { namedQueryCatalogue, sanitizeExhibit } from "./exhibits";
import type { Insight } from "./insights";

/** The Zod Composer schema (BUILD §11.3), shared with @foundmill/models' mock and the API. */
export const ComposerSchema = ComposerOutput;
export type ComposerSchema = ComposerOutput;

export type ComposeBrief = { mode: "events"; events: Event[]; parked?: readonly ParkedTask[] } | { mode: "insight"; insight: Insight } | { mode: "decision"; decision: NextBestDecision };

export type ComposeSlot = ComposeBrief["mode"];

export interface ComposeOptions {
  /** `reject` throws `ComposerRejectedError` after the single re-ask (narrate); `strip` demotes the offending mentions (refresh). */
  onInvalidLinks: "reject" | "strip";
  /** Rate-limit scope / cost attribution for the model calls. */
  scope?: string;
  /** Longest the note may take before it is abandoned (`ComposeTimeoutError`); default `LIMITS.composerDeadlineMs`. */
  deadlineMs?: number;
}

export interface ComposedNote {
  item: ComposerItem;
  slot: ComposeSlot;
  /** Ids of the events this note narrates (what `markNarrated` receives). */
  eventIds: string[];
  /** Metered cost of the composer completions in minor units (label "Estimate"). */
  costMinorInt: number;
  costCurrency: string;
  usage: TokenUsage;
  model: string;
  modelKey: string;
  /** True when the first output had invalid mentions and the model was asked once more. */
  reasked: boolean;
  /** True when the final text still had invalid mentions and they were stripped (refresh only). */
  stripped: boolean;
  /** True when the mock/live client repaired the JSON against the schema. */
  repaired: boolean;
  validation: ValidationResult;
  linked: LinkedText;
  /** Unknown proper nouns the sweep found (BUILD §11.3: drafted as unverified CRM entities). */
  drafts: { name: string; kindGuess: string }[];
}

export class ComposerRejectedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("composer_rejected", message, 422, details);
    this.name = "ComposerRejectedError";
  }
}

/**
 * The note was not ready within the compose deadline and was abandoned: nothing was written, no event was marked
 * narrated. The deadline sits below the api's and the orchestrator's wait (`LIMITS.composerClientTimeoutMs`), so a
 * caller hears this instead of timing out while the note is still being written (audit CML-04).
 */
export class ComposeTimeoutError extends AppError {
  constructor(deadlineMs: number) {
    super("composer_timeout", `The note took longer than ${Math.round(deadlineMs / 1000)} seconds to write, so nothing was added. Try again.`, 504, { deadlineMs });
    this.name = "ComposeTimeoutError";
  }
}

/**
 * Default options of a Customer Update (customer_won) decision when the model offers none. Consequences are written from
 * the founder's seat and the recommended option says why (UX plan §7.19).
 */
export const CUSTOMER_UPDATE_OPTIONS: readonly ComposerOption[] = Object.freeze([
  { id: "thank_you", label: "Send a thank-you", recommended: true, consequence: "A short note goes out from the business, marked as written by an agent.", cost_minor: 0, reversible: false, because: "Recommended because it costs nothing and a quick thank-you keeps a new customer warm." },
  { id: "review_14d", label: "Ask for a review in 14 days", recommended: false, consequence: "A review request goes out after they have used the product; they can opt out.", cost_minor: 0, reversible: true },
  { id: "annual_upgrade", label: "Offer an annual upgrade", recommended: false, consequence: "An upgrade offer is drafted for you to approve before anything is sent.", cost_minor: 0, reversible: true },
  { id: "celebrate", label: "Just celebrate", recommended: false, consequence: "No message goes out; the replay opens.", cost_minor: 0, reversible: true },
]);

export const DEFAULT_DECISION_OPTIONS: readonly ComposerOption[] = Object.freeze([
  { id: "proceed", label: "Proceed as recommended", recommended: true, consequence: "The team carries on with the next step the note argues for.", cost_minor: 0, reversible: true, because: "Recommended because it is the step the note argues for, and you can stop it any time." },
  { id: "hold", label: "Hold for now", recommended: false, consequence: "Nothing changes until you decide.", cost_minor: 0, reversible: true },
]);

/** The engineering words in a note's subject and body (entity markup read as its display name). */
export function founderJargonOf(subject: string, bodyMd: string): string[] {
  const plain = bodyMd.replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1");
  return [...new Set(founderJargonHits(`${subject}\n${plain}`).map((h) => h.term.toLowerCase()))];
}

/** The re-ask for engineering words: the founder is not technical, so say what happened for the business. */
export function jargonReask(terms: readonly string[]): string {
  return `The founder is not technical. Rewrite the note without these words: ${terms.map((t) => `"${t}"`).join(", ")}. Say what happened for the business and what, if anything, the founder should do, in at most three short sentences. Keep the same type, mentions and facts.`;
}

/**
 * blocks_continue for a Composer note: never (founder, Nov 7, 2026). A Composer note informs or asks; it is never a hard
 * stop the team cannot work past, so a decision waits for its answer without stopping the team, a customer win is good
 * news, and a runway warning below three months says so without freezing the work that might fix it. Until Nov 7 a
 * decision and a win always held Continue and turned the top bar's button into a red "Respond". Only the platform's own
 * hard stops (credits used up, a revoked key) hold it, and `inboxRepo.createItem` keeps the flag on warnings alone (0071).
 */
export function blocksContinueFor(_type: InboxItemType, _ctx: Pick<ComposeContext, "metrics">, _events: readonly Event[]): boolean {
  return false;
}

/** Read with a narrated `campaign.launched` in offline tracking (evals `channel_engine.reports_prepared_not_launched` sends the same). */
export const OFFLINE_TRACKING_NOTE =
  "Offline tracking: the team prepared these materials and the founder submits them. Nothing was launched, sent or published from here. Say the materials are ready for the founder to submit; never say the campaign launched, went live, was sent or was published.";

/** Read with a narrated `task.completed` whose findings were simulated (packages/agents, shared with the api's fallback). */
export { SIMULATED_FINDINGS_NOTE };

/** Builds the JSON input block the model (and the mock) reads. */
export function composerInputs(ctx: ComposeContext, brief: ComposeBrief): Record<string, unknown> {
  const base: Record<string, unknown> = {
    business: businessBrief(ctx),
    business_name: ctx.business.name,
    app_name: APP_NAME,
    from_agent: { id: ctx.voice.id, name: ctx.voice.name, role: ctx.voice.role || "Chief of Staff" },
    agents: ctx.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, agent_type: a.agentType, status: a.status })),
    manifest: ctx.manifest.toJSON(),
    metrics: ctx.status.map((m) => ({ metric: m.metric, value: m.value, source: m.source, label: m.label })),
    named_queries: namedQueryCatalogue(),
    glossary: ctx.glossary,
    // The model has no clock: without today's date it guesses deadlines, and a guessed one in the past locks the options.
    now: ctx.now.toISOString(),
    // Who the note is written to (WP-04 T10): trusted JSON from their own profile, never in the system text, which stays
    // the same for every founder (the cached prefix). A hand-built context without one still says the experience.
    founder: founderContextJson(ctx.founder ?? { ...UNKNOWN_FOUNDER_CONTEXT, experience: ctx.founderExperience }),
  };
  switch (brief.mode) {
    case "events": {
      const events = brief.events.map((e) => ({ id: e.id, type: e.type, occurred_at: e.occurredAt.toISOString(), actor: e.actor, entity_ids: e.entityIds, payload: composerEventPayload(e) }));
      // Tasks the round parked for want of a tool (WP-05 T18): the prompt ends the note with one sentence about them.
      const parked = (brief.parked ?? []).slice(0, PARKED_TASKS_MAX).map((p) => ({ title: p.title.slice(0, PARKED_TITLE_MAX), what_the_agent_said: (p.detail ?? "").slice(0, PARKED_DETAIL_MAX) }));
      if (parked.length > 0) base.parked = parked;
      // Wins the volume rule rolled up: one results note for the day, not a story per win.
      const rolled = brief.events.length > 0 && brief.events.every((e) => e.type === "customer.converted" && (e.payload as { fullMatchDay?: unknown } | null)?.fullMatchDay === false);
      if (rolled) return { ...base, events, note: "These wins were rolled up into the day's results table (volume rule): write one short results note that counts them by kind, names no more than three customers from the manifest, and does not narrate any journey." };
      // Offline tracking: the engine's "launch" prepared materials for the founder to submit; nothing went out (WP-02 T2).
      const offline = brief.events.some((e) => e.type === "campaign.launched" && (e.payload as { kitMode?: unknown } | null)?.kitMode === true);
      // A finished task whose findings rest on simulated results is narrated as simulated, never as real (WP-05 T3).
      const notes = [...(offline ? [OFFLINE_TRACKING_NOTE] : []), ...composerNotesFor(brief.events)];
      return notes.length > 0 ? { ...base, events, note: notes.join(" ") } : { ...base, events };
    }
    case "insight":
      return {
        ...base,
        events: [],
        type: "warning",
        insight: { kind: brief.insight.kind, title: brief.insight.title, facts: brief.insight.facts, exhibit: brief.insight.exhibit },
        note: "No new event. This note reports a real change in the data described under `insight`. Quote only its facts. Never invent an event.",
      };
    case "decision":
      return {
        ...base,
        events: [],
        type: "decision",
        decision_needed: true,
        next_best_decision: { kind: brief.decision.kind, title: brief.decision.title, facts: brief.decision.facts, exhibit: brief.decision.exhibit },
        options: brief.decision.options,
        note: "No new event and no data change. Offer the next-best decision grounded in the current state using the options given. Never invent an event.",
      };
  }
}

/** The house rules, then the Composer's own rules, the same for every founder: who the founder is travels in the inputs (`founder`, UX plan §7.19, WP-04 T10). */
export function systemPrompt(ctx: ComposeContext): string[] {
  return [
    clubRulesPrompt.render({ business_name: ctx.business.name, APP_NAME }),
    // plain-allow: agent-facing. The fallback role fills the system prompt's from_agent_role; only the model reads it.
    prompts.inboxComposerPrompt.render({ business_name: ctx.business.name, from_agent_name: ctx.voice.name, from_agent_role: ctx.voice.role || "Chief of Staff" }),
  ];
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

const plain = (s: string): string => stripMarkup(s).replace(/\s+/g, " ").trim();

export interface ComposeDeps {
  models: ModelClient;
  log: ModelLogger;
}

export async function composeNote(deps: ComposeDeps, ctx: ComposeContext, brief: ComposeBrief, options: ComposeOptions): Promise<ComposedNote> {
  const deadlineMs = options.deadlineMs ?? LIMITS.composerDeadlineMs;
  const deadline = AbortSignal.timeout(deadlineMs);
  try {
    const note = await composeWithin(deps, ctx, brief, options, deadline);
    // The entity sweep cannot be stopped mid-call; a note finished past the deadline is still abandoned unwritten.
    if (deadline.aborted) throw new ComposeTimeoutError(deadlineMs);
    return note;
  } catch (err) {
    if (deadline.aborted && (err instanceof ModelAbortedError || err instanceof ComposeTimeoutError)) {
      deps.log.warn({ businessId: ctx.businessId, slot: brief.mode, deadlineMs }, "composer note abandoned at the deadline; nothing written");
      throw err instanceof ComposeTimeoutError ? err : new ComposeTimeoutError(deadlineMs);
    }
    throw err;
  }
}

async function composeWithin(deps: ComposeDeps, ctx: ComposeContext, brief: ComposeBrief, options: ComposeOptions, signal: AbortSignal): Promise<ComposedNote> {
  const events = brief.mode === "events" ? brief.events : [];
  const eventIds = events.map((e) => e.id);
  const system = systemPrompt(ctx);
  const inputs = composerInputs(ctx, brief);
  const messages: ChatMessage[] = [{ role: "user", content: "```json\n" + JSON.stringify(inputs) + "\n```" }];
  const attribution = { businessId: ctx.businessId, agentId: ctx.voice.id, kind: "inbox_composer" };

  const call = (msgs: ChatMessage[]): Promise<CompleteResultWithJson<ComposerOutput>> =>
    deps.models.complete({ route: "inboxComposer", schema: ComposerSchema, system, messages: msgs, attribution, cacheSystem: true, scope: options.scope ?? `composer:${ctx.businessId}`, signal });

  let result = await call(messages);
  let usage = result.usage;
  let costMinorInt = result.cost.costMinorInt;
  let repaired = result.repaired;
  let reasked = false;
  let stripped = false;

  let check = checkComposerText(result.json.body_md, ctx.manifest, 0);
  // Engineering words in a note to the founder (founder, Nov 7, 2026: "I don't really want to see any of these technical
  // details"): the same single re-ask asks for plain business words. Whatever is left after it is logged, never blocks.
  const jargon = founderJargonOf(result.json.subject, result.json.body_md);
  if ((!check.ok && check.reask) || jargon.length > 0) {
    reasked = true;
    deps.log.debug({ businessId: ctx.businessId, unknown: check.ok ? [] : check.validation.unknownIds, jargon }, "composer output had invalid mentions or engineering words; re-asking once");
    const asks = [...(!check.ok && check.reask ? [String(check.reask.message.content)] : []), ...(jargon.length > 0 ? [jargonReask(jargon)] : [])];
    result = await call([...messages, { role: "assistant", content: result.text }, { role: "user", content: asks.join("\n\n") }]);
    usage = addUsage(usage, result.usage);
    costMinorInt += result.cost.costMinorInt;
    repaired = repaired || result.repaired;
    check = checkComposerText(result.json.body_md, ctx.manifest, 1);
  }

  let bodyMd = result.json.body_md;
  if (!check.ok) {
    if (options.onInvalidLinks === "reject") {
      throw new ComposerRejectedError("The composer referenced entities outside the manifest after one re-ask; the note was not written (AC-11.3.1).", {
        unknownIds: check.validation.unknownIds,
        invisibleIds: check.validation.invisibleIds,
        malformed: check.validation.malformed.length,
      });
    }
    stripped = true;
    bodyMd = check.fallbackText;
    deps.log.warn({ businessId: ctx.businessId, unknown: check.validation.unknownIds }, "composer output still invalid after re-ask; invalid mentions stripped so Refresh can still answer");
  }

  const linked = await linkComposerText(bodyMd, ctx.manifest, deps.models, {
    ignore: [ctx.business.name, APP_NAME],
    attribution: { businessId: ctx.businessId, kind: "entity_sweep" },
    scope: options.scope ?? `composer:${ctx.businessId}`,
    businessId: ctx.businessId,
  });

  const out = result.json;
  const type = out.type;
  const decision =
    type === "decision" || type === "customer_won"
      ? (out.decision ?? { options: [...(type === "customer_won" ? CUSTOMER_UPDATE_OPTIONS : DEFAULT_DECISION_OPTIONS)], free_text: true, expires_at: null })
      : out.decision;
  const allowedMetrics = new Set(ctx.status.map((m) => m.metric));
  const item: ComposerItem = {
    type,
    from_agent_id: ctx.agentIds.has(out.from_agent_id) ? out.from_agent_id : ctx.voice.id,
    subject: plain(out.subject).slice(0, 80) || plain(linked.text).slice(0, 80) || "Update",
    body_md: linked.text.trim().length > 0 ? linked.text : plain(out.subject),
    status_strip: out.status_strip.filter((m) => allowedMetrics.has(m.metric)).slice(0, 4),
    // Insight and next-best-decision notes exhibit the query their facts came from; event notes take the model's pick, registry-checked.
    exhibit: brief.mode === "insight" ? sanitizeExhibit(brief.insight.exhibit) : brief.mode === "decision" ? sanitizeExhibit(brief.decision.exhibit) : sanitizeExhibit(out.exhibit),
    decision: decision
      ? {
          // The option's "because" (why it is recommended) travels with it to the stored note and the DecisionBar.
          options: decision.options.map(({ because, ...o }) => ({ ...o, id: plain(o.id).slice(0, 40) || "option", label: plain(o.label).slice(0, 120) || "Option", consequence: plain(o.consequence), ...(because && plain(because) ? { because: plain(because) } : {}) })),
          free_text: decision.free_text,
          // A deadline is a future ISO timestamp within a bounded horizon, or none (audit CML-13).
          expires_at: futureDeadline(decision.expires_at, ctx.now),
          // The grounded decision this note is about, so Refresh does not write it twice while it is open (audit CML-02).
          ...(brief.mode === "decision" ? { key: brief.decision.identity } : {}),
        }
      : null,
    blocks_continue: blocksContinueFor(type, ctx, events),
    source_event_ids: eventIds,
    entity_ids: linked.entityIds.filter((id) => ctx.crmIds.has(id)),
  };

  return {
    item,
    slot: brief.mode,
    eventIds,
    costMinorInt,
    costCurrency: result.cost.currency,
    usage,
    model: result.model,
    modelKey: result.modelKey,
    reasked,
    stripped,
    repaired,
    validation: check.validation,
    linked,
    drafts: linked.sweep.drafts.map((d) => ({ name: d.name, kindGuess: d.kindGuess })),
  };
}
