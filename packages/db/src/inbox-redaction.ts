/**
 * Section walls in the Inbox (BUILD §11.9; audit RUI-02). The Inbox is a section of its own, but a note quotes the
 * others: composer and seed notes put cash, revenue and runway in the subject, the body and the status strip, name
 * customers through entity mentions, and exhibit finance queries. A reader walled from Finance or the CRM (permission
 * "none") gets each note with that content taken out, the same content finance.overview and crm.entity.get refuse them:
 *
 *   finance  money amounts and runway figures in the subject, body, decision options, plan and decision text read
 *            "(amount hidden)" / "(hidden)"; finance status metrics and finance exhibits are dropped; option costs and
 *            plan amounts are removed.
 *   crm      mentions of CRM records, and the names of the note's CRM records, read "a customer" / "a contact" / "an
 *            organization"…; the related records list is empty; an entity-card exhibit is dropped.
 *
 * Agents and staff stay named (they are the Team's, not the CRM's). Everyone gets related records as stubs
 * (`{ id, kind, displayName }`), never identifiers or a lawful basis. `redacted` on a note lists the walls that changed
 * it, so the reading pane can say so.
 *
 * One implementation for every reader (security review, Nov 11, 2026): the api's Inbox, Today and plan procedures
 * (apps/api `services/inbox-redaction.ts` re-exports this module) and the gateway's email to a person
 * (apps/gateway `notify-email.ts`), which quotes a note's subject as `noteAsSeenBy` shows it to that person.
 */
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { PlanWithActions } from "./repos/plans";
import type { Decision, InboxItem, Plan } from "./schema";
import { hasSectionAccess, type SectionMembership } from "@foundmill/shared";

export type WallSection = "finance" | "crm";

/** True for each section the reader may not read. */
export interface InboxWalls {
  finance: boolean;
  crm: boolean;
}

export const inboxWalls = (membership: SectionMembership): InboxWalls => ({ finance: !hasSectionAccess(membership, "finance", "read"), crm: !hasSectionAccess(membership, "crm", "read") });
export const isWalled = (walls: InboxWalls): boolean => walls.finance || walls.crm;

/** A CRM record a note mentions: what its name and aliases are, and what to call it instead. */
export interface CrmRecord {
  id: string;
  kind: string;
  displayName: string;
  aliases: readonly string[];
}

/** What the redaction needs besides the notes: the walls, the CRM records mentioned, and the mention ids to keep. */
export interface RedactionSource {
  walls: InboxWalls;
  crm: ReadonlyMap<string, CrmRecord>;
  /** Agents and staff (named as they are). Any other mention id behind a CRM wall is hidden. */
  keep: ReadonlySet<string>;
}

export const AMOUNT_HIDDEN = "(amount hidden)";
export const FIGURE_HIDDEN = "(hidden)";

// --- text ----------------------------------------------------------------------------------------------------------

const MENTION_RE = /\[\[ent:([^|\]]+)\|([^\]]*)\]\]/g;
const KEEP_KINDS = new Set(["agent", "team_member"]);

let isoCodes: ReadonlySet<string> | null = null;
/** Every ISO 4217 code the runtime knows (so "263345.71 GBP" and "SEK 1,200" are money, "SKU 2000" is not). */
function currencyCodes(): ReadonlySet<string> {
  isoCodes ??= new Set([...supportedCurrencies(), "USD", "EUR", "GBP", "SEK", "NOK", "DKK", "CHF", "CAD", "AUD", "JPY"]);
  return isoCodes;
}

function supportedCurrencies(): string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return [];
  }
}

const NUMBER = String.raw`-?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmMbB]n?|million|billion)\b)?`;
const SYMBOL_MONEY_RE = new RegExp(String.raw`(?:[A-Z]{0,2}[£$€¥₹]|\bkr\.?)\s?${NUMBER}`, "g");
const CODE_FIRST_RE = new RegExp(String.raw`\b([A-Z]{3})\s?(${NUMBER})`, "g");
const CODE_AFTER_RE = new RegExp(String.raw`(${NUMBER})\s?([A-Z]{3})\b`, "g");
// What a founder types in a decision ("spend 500 euros", "200 usd"): currency words and the common codes in any case.
// Only these few codes: in lowercase, three letters before or after a number are far more often words ("all 5").
const MONEY_WORDS = String.raw`(?:eur|usd|gbp|sek|nok|dkk|chf|euros?|dollars?|bucks|quid|kronor|kroner|francs|pounds?\s+sterling)`;
const WORD_MONEY_RE = new RegExp(String.raw`(?:\b(?:eur|usd|gbp|sek|nok|dkk|chf)\s?${NUMBER}|${NUMBER}\s?${MONEY_WORDS}\b)`, "gi");
const MONTHS_OF_RUNWAY_RE = /\b\d+(?:\.\d+)?\s*(?:months?|mo)\b(?=\s+(?:of\s+)?runway\b)/gi;
const RUNWAY_MONTHS_RE = /(\brunway\b[^.\n\d]{0,24})\d+(?:\.\d+)?\s*(?:months?|mo)\b/gi;

/** Money and runway figures out of a text (Finance wall). */
export function maskFinance(text: string): string {
  const codes = currencyCodes();
  return text
    .replace(SYMBOL_MONEY_RE, AMOUNT_HIDDEN)
    .replace(CODE_FIRST_RE, (all, code: string) => (codes.has(code) ? AMOUNT_HIDDEN : all))
    .replace(CODE_AFTER_RE, (all, _n: string, code: string) => (codes.has(code) ? AMOUNT_HIDDEN : all))
    .replace(WORD_MONEY_RE, AMOUNT_HIDDEN)
    .replace(MONTHS_OF_RUNWAY_RE, FIGURE_HIDDEN)
    .replace(RUNWAY_MONTHS_RE, (_all, lead: string) => `${lead}${FIGURE_HIDDEN}`);
}

/** What a hidden CRM record is called instead ("a customer" in a won-customer note). */
export function standIn(kind: string | undefined, customer: boolean): string {
  switch (kind) {
    case "person":
      return customer ? "a customer" : "a contact";
    case "organisation":
      return "an organization";
    case "community":
      return "a community";
    case "venue":
      return "a venue";
    case "platform_member":
      return "a member";
    default:
      return customer ? "a customer" : "a contact";
  }
}

const startsSentence = (whole: string, offset: number) => offset === 0 || /(?:^|[.!?]\s+|\n\s*)$/.test(whole.slice(Math.max(0, offset - 4), offset));
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** CRM mentions and the names of the given records out of a text (CRM wall). */
export function maskCrm(text: string, source: RedactionSource, records: readonly CrmRecord[], customer: boolean): string {
  let out = text.replace(MENTION_RE, (all, id: string, _name: string, offset: number, whole: string) => {
    if (source.keep.has(id)) return all;
    const word = standIn(source.crm.get(id)?.kind, customer);
    return startsSentence(whole, offset) ? capitalise(word) : word;
  });
  const names = records.flatMap((r) => [r.displayName, ...r.aliases].filter((n) => n.trim().length >= 3).map((n) => ({ name: n.trim(), word: standIn(r.kind, customer) })));
  names.sort((a, b) => b.name.length - a.name.length);
  for (const n of names) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n.name)}(?![\\p{L}\\p{N}])`, "giu"), (_m, offset: number, whole: string) => (startsSentence(whole, offset) ? capitalise(n.word) : n.word));
  }
  return out;
}

/** Mention ids written in a text. */
export function mentionIds(text: string): string[] {
  return [...text.matchAll(MENTION_RE)].map((m) => m[1]!);
}

// --- notes -----------------------------------------------------------------------------------------------------------

const FINANCE_STRIP_RE = /\b(?:cash|runway|net[\s_]?burn|burn|revenue|mrr|arr|spend|cpa|cac|margin|profit|p&l|pnl|payroll|wage|invoice|vat|budget|balance|price|cost)/i;
const FINANCE_SOURCES = new Set(["accounts", "bank", "forecast", "forecasts", "cash_position", "runway_forecast", "usage_ledger", "channel_cpa", "pnl", "invoices", "monthly_totals"]);
const FINANCE_EXHIBITS = new Set(["cash_position", "runway_forecast", "channel_cpa"]);
const MONEY_KEYS = new Set(["amount_minor", "budget_minor", "cost_minor", "price_minor", "spend_minor", "currency"]);
const ID_KEY_RE = /^id$|_id$|Id$/;

type StripEntry = Record<string, unknown>;

function financeStripEntry(m: StripEntry): boolean {
  const text = [m.metric, m.value, m.label].filter((v): v is string => typeof v === "string").join(" ");
  const source = typeof m.source === "string" ? m.source.toLowerCase() : "";
  return FINANCE_STRIP_RE.test(text.replace(/_/g, " ")) || FINANCE_SOURCES.has(source) || maskFinance(text) !== text;
}

/** The CRM records a note mentions (its entity ids and the mentions in its text). */
function recordsOf(ids: Iterable<string>, source: RedactionSource): CrmRecord[] {
  const out = new Map<string, CrmRecord>();
  for (const id of ids) {
    const r = source.crm.get(id);
    if (r) out.set(id, r);
  }
  return [...out.values()];
}

interface Masker {
  text(s: string): string;
  touched: Set<WallSection>;
}

function maskerFor(source: RedactionSource, ids: Iterable<string>, customer: boolean): Masker {
  const touched = new Set<WallSection>();
  const records = source.walls.crm ? recordsOf(ids, source) : [];
  return {
    touched,
    text(s: string) {
      let out = s;
      if (source.walls.crm) {
        const next = maskCrm(out, source, records, customer);
        if (next !== out) touched.add("crm");
        out = next;
      }
      if (source.walls.finance) {
        const next = maskFinance(out);
        if (next !== out) touched.add("finance");
        out = next;
      }
      return out;
    },
  };
}

function maskParams(params: unknown, m: Masker, finance: boolean): unknown {
  if (Array.isArray(params)) return params.map((v) => maskParams(v, m, finance));
  if (typeof params === "string") return m.text(params);
  if (!params || typeof params !== "object") return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (finance && MONEY_KEYS.has(k)) {
      m.touched.add("finance");
      continue;
    }
    // Ids stay as they are: an option is decided, and a record opened, by its id.
    out[k] = ID_KEY_RE.test(k) ? v : maskParams(v, m, finance);
  }
  return out;
}

export type RedactedInboxItem<T extends InboxItem = InboxItem> = T & { redacted: WallSection[] };

/** How a text is masked besides its own mentions: which records' plain names to hide, and whether they are customers. */
export interface MaskOptions {
  /** Record ids whose plain names are hidden too (a note's entity ids and mentions). */
  ids?: Iterable<string>;
  /** A won-customer note: a hidden person reads "a customer". */
  customer?: boolean;
}

/** Every id a note may mention a record by (for loading what the CRM wall needs). */
export function idsOfItem(item: Pick<InboxItem, "entityIds" | "subject" | "bodyMd" | "decision" | "statusStrip">): string[] {
  return [...item.entityIds, ...mentionIds(item.subject), ...mentionIds(item.bodyMd), ...mentionIds(JSON.stringify(item.decision ?? null)), ...mentionIds(JSON.stringify(item.statusStrip ?? []))];
}

/** The mask options of a note: its records' names, and "a customer" in a won-customer note. */
export const noteMask = (item: Pick<InboxItem, "type" | "entityIds" | "subject" | "bodyMd" | "decision" | "statusStrip">): MaskOptions => ({ ids: idsOfItem(item), customer: item.type === "customer_won" });

/** One text as the reader may see it. */
export function redactText(text: string, source: RedactionSource, opts: MaskOptions = {}): string {
  if (!isWalled(source.walls)) return text;
  return maskerFor(source, [...(opts.ids ?? []), ...mentionIds(text)], opts.customer ?? false).text(text);
}

/** Any JSON value as the reader may see it: every string masked and, behind a Finance wall, the money keys dropped. */
export function redactValue<T>(value: T, source: RedactionSource, opts: MaskOptions = {}): T {
  if (!isWalled(source.walls)) return value;
  const m = maskerFor(source, [...(opts.ids ?? []), ...mentionIds(JSON.stringify(value ?? null))], opts.customer ?? false);
  return maskParams(value, m, source.walls.finance) as T;
}

/** One note as the reader may see it. With no wall in force it is returned as is (plus `redacted: []`). */
export function redactInboxItem<T extends InboxItem>(item: T, source: RedactionSource): RedactedInboxItem<T> {
  if (!isWalled(source.walls)) return { ...item, redacted: [] };
  const m = maskerFor(source, idsOfItem(item), item.type === "customer_won");
  const strip = Array.isArray(item.statusStrip) ? (item.statusStrip as StripEntry[]) : [];
  const keptStrip = strip
    .filter((e) => {
      if (source.walls.finance && e && typeof e === "object" && financeStripEntry(e)) {
        m.touched.add("finance");
        return false;
      }
      return true;
    })
    .map((e) => (e && typeof e === "object" ? (maskParams(e, m, false) as StripEntry) : e));
  const exhibit = item.exhibit ?? { kind: "none" };
  const specRef = typeof exhibit.spec_ref === "string" ? exhibit.spec_ref : null;
  const financeExhibit = source.walls.finance && specRef !== null && FINANCE_EXHIBITS.has(specRef);
  const crmExhibit = source.walls.crm && exhibit.kind === "entity_card";
  if (financeExhibit) m.touched.add("finance");
  if (crmExhibit) m.touched.add("crm");
  const decision = item.decision ? (maskParams(item.decision, m, source.walls.finance) as Record<string, unknown>) : item.decision;
  const subject = m.text(item.subject);
  const bodyMd = m.text(item.bodyMd);
  return {
    ...item,
    subject,
    bodyMd,
    statusStrip: keptStrip,
    exhibit: financeExhibit || crmExhibit ? { kind: "none", spec_ref: null } : exhibit,
    decision,
    redacted: [...m.touched].sort(),
  };
}

/**
 * One note as this person may read it (the walls of inbox.get), for every answer that carries a note: markRead, archive,
 * inbox.refresh and the note an in-process Continue step wrote (business.continue).
 */
export async function noteAsSeenBy<T extends InboxItem>(db: Executor, businessId: string, membership: SectionMembership, item: T): Promise<RedactedInboxItem<T>> {
  const walls = inboxWalls(membership);
  return redactInboxItem(item, await loadRedactionSource(db, businessId, walls, idsOfItem(item)));
}

/**
 * Plan summaries as this person may read them (plan.list, plan.status). A summary quotes the option it carries out
 * ("carries out your choice: Send Wren Garza a thank-you"), so behind a CRM wall it also hides the plain names of its
 * note's records, as inbox.get does: the plans' notes are read for their ids.
 */
export async function planSummariesAsSeenBy<P extends Pick<Plan, "summaryMd" | "inboxItemId">>(db: Executor, businessId: string, membership: SectionMembership, plans: readonly P[]): Promise<P[]> {
  const walls = inboxWalls(membership);
  if (!isWalled(walls)) return [...plans];
  const noteIds = walls.crm ? [...new Set(plans.flatMap((p) => (p.inboxItemId ? [p.inboxItemId] : [])))] : [];
  const notes = new Map((await repos.inbox.byIds(db, businessId, noteIds)).map((note) => [note.id, note]));
  const source = await loadRedactionSource(db, businessId, walls, [...plans.flatMap((p) => mentionIds(p.summaryMd)), ...[...notes.values()].flatMap(idsOfItem)]);
  return plans.map((p) => {
    const note = p.inboxItemId ? notes.get(p.inboxItemId) : undefined;
    return { ...p, summaryMd: redactText(p.summaryMd, source, note ? noteMask(note) : {}) };
  });
}

/** A plan as the reader may see it (summary, action texts and amounts, results). */
export function redactPlan<P extends Pick<PlanWithActions, "summaryMd" | "actions">>(plan: P, source: RedactionSource, opts: MaskOptions = {}): P {
  if (!isWalled(source.walls)) return plan;
  return { ...plan, summaryMd: redactText(plan.summaryMd, source, opts), actions: plan.actions.map((a) => ({ ...a, params: redactValue(a.params, source, opts), result: redactValue(a.result, source, opts) })) };
}

/** Decisions on a note (the free text the decider typed). */
export function redactDecisions(decisions: Decision[], source: RedactionSource, opts: MaskOptions = {}): Decision[] {
  if (!isWalled(source.walls)) return decisions;
  return decisions.map((d) => ({ ...d, freeText: d.freeText === null ? null : redactText(d.freeText, source, opts) }));
}

/** Related records as stubs: never identifiers or a lawful basis, and none at all behind a CRM wall. */
export function entityStubs(entities: readonly { id: string; kind: string; displayName: string; agentId?: string | null }[], walls: InboxWalls): { id: string; kind: string; displayName: string; agentId: string | null }[] {
  // An agent's record carries the agent it stands for: the note's About links open the agent's profile (audit GTM-19).
  return walls.crm ? [] : entities.map((e) => ({ id: e.id, kind: e.kind, displayName: e.displayName, agentId: e.agentId ?? null }));
}

/**
 * Loads what the walls need for these texts: with a CRM wall, the records behind every id they mention (CRM kinds to
 * hide; agents and staff to keep). Nothing is read when the reader is not walled from the CRM.
 */
export async function loadRedactionSource(db: Executor, businessId: string, walls: InboxWalls, ids: Iterable<string>): Promise<RedactionSource> {
  if (!walls.crm) return { walls, crm: new Map(), keep: new Set() };
  const wanted = [...new Set([...ids].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  const crm = new Map<string, CrmRecord>();
  const keep = new Set<string>();
  if (wanted.length === 0) return { walls, crm, keep };
  const rows = await repos.entities.byIds(db, businessId, wanted);
  for (const e of rows) {
    if (KEEP_KINDS.has(e.kind)) keep.add(e.id);
    else crm.set(e.id, { id: e.id, kind: e.kind, displayName: e.displayName, aliases: e.aliases ?? [] });
  }
  // A mention by agent id (the composer's) is not an entity row: keep it when it is one of the business's agents.
  if (rows.length < wanted.length) {
    const agents = await repos.agents.list(db, businessId, { limit: 200, includeArchived: true });
    for (const a of agents.items) keep.add(a.id);
  }
  return { walls, crm, keep };
}
