/**
 * Pure helpers for the legal screens (no React, no data source): incorporation routes and step states, officer
 * matching, the compliance calendar, contract obligations, generated policies, the trademark screen and the
 * regulated-sector gates. Everything here is information for the founder, never legal or tax advice, and nothing
 * here files, signs, pays or accepts terms (BUILD §11.11, AC-11.11.4).
 */
import { ARCHETYPE_LABELS, type Archetype, type IncorporationRoute } from "@foundmill/shared/constants";
import { usSpelling } from "@foundmill/shared/us-spelling";
import type { ComplianceEventRow, ComplianceListResponse, ContractRow, FilingRow, FilingStatus, IncorporationRow, IncorporationStepRecord, IntegrationRow, LegalEntityRow, OfficerEntityRow } from "./types";

export const DAY_MS = 86_400_000;

/* ---------- Plain words for stored keys (never show a registry code or an enum to the founder) ---------- */

/** "private_limited_company" → "Private limited company"; "costOfSales" → "Cost of sales". */
export function plainWords(key: string | null | undefined): string {
  if (!key) return "";
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return usSpelling(words.charAt(0).toUpperCase() + words.slice(1));
}

/** Contract kinds as words; an agreement's acronym keeps its capitals ("nda" → "NDA", "customer_msa" → "Customer"). */
const CONTRACT_KIND_WORDS: Record<string, string> = {
  nda: "NDA",
  dpa: "Data processing",
  safe: "SAFE",
  msa: "Services",
  customer_msa: "Customer",
  supplier_msa: "Supplier",
  sow: "Statement of work",
  ip_assignment: "IP assignment",
};
const CONTRACT_INITIALISMS = new Set(["nda", "dpa", "msa", "safe", "sow", "ip", "saas", "sla"]);

export function contractKindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  const key = kind.trim().toLowerCase();
  if (CONTRACT_KIND_WORDS[key]) return CONTRACT_KIND_WORDS[key]!;
  const words = plainWords(key).split(" ").map((w) => (CONTRACT_INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : w));
  return words.join(" ");
}

const ENTITY_TYPE_WORDS: Record<string, string> = {
  private_limited_company: "Private limited company",
  public_limited_company: "Public limited company",
  limited_liability_partnership: "Limited liability partnership",
  ltd: "Private limited company (Ltd)",
  plc: "Public limited company (plc)",
  llp: "Limited liability partnership (LLP)",
  llc: "LLC",
  c_corp: "C-corp",
  "c-corp": "C-corp",
  s_corp: "S-corp",
  aktiebolag: "Aktiebolag (AB)",
  ab: "Aktiebolag (AB)",
  gmbh: "GmbH",
  sas: "SAS",
  sole_trader: "Sole trader",
};

/** A legal form as words: registry keys become sentences, forms typed by hand ("C-corp", "Ltd") stay as written. */
export function entityTypeLabel(entityType: string | null | undefined): string {
  if (!entityType) return "";
  const key = entityType.trim().toLowerCase().replace(/\s+/g, "_");
  if (ENTITY_TYPE_WORDS[key]) return ENTITY_TYPE_WORDS[key]!;
  return /[_]/.test(entityType) || entityType === entityType.toLowerCase() ? plainWords(entityType) : entityType;
}

const SUBDIVISION_WORDS: Record<string, string> = { "us-de": "Delaware", "gb-eng": "England and Wales", "gb-sct": "Scotland", "gb-nir": "Northern Ireland", "england-wales": "England and Wales" };

/** "GB" → "United Kingdom", "se" → "Sweden", "us-de" → "Delaware"; a name typed by hand ("Delaware") stays as written. */
export function jurisdictionName(jurisdiction: string | null | undefined): string {
  if (!jurisdiction) return "";
  const j = jurisdiction.trim();
  const sub = SUBDIVISION_WORDS[j.toLowerCase()];
  if (sub) return sub;
  if (/^[A-Za-z]{2}$/.test(j)) {
    const code = j.toUpperCase() === "UK" ? "GB" : j.toUpperCase();
    try {
      const name = new Intl.DisplayNames(["en-US"], { type: "region" }).of(code);
      if (name && name !== code) return name;
    } catch {
      // Fall through to the code itself.
    }
    return code;
  }
  return j;
}

/** The business archetype as words ("dtc_physical" → "DTC physical product"). */
export function archetypeLabel(archetype: string | null | undefined): string {
  if (!archetype) return "";
  return (ARCHETYPE_LABELS as Record<string, string>)[archetype] ?? plainWords(archetype);
}

export function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(due: string | Date | null | undefined, now: Date): number | null {
  const d = toDate(due);
  if (!d) return null;
  return Math.ceil((d.getTime() - now.getTime()) / DAY_MS);
}

/* ---------- Incorporation routes (BUILD §11.11 "Incorporation routes (decided)") ---------- */

export interface RouteMeta {
  route: IncorporationRoute;
  label: string;
  jurisdictionLabel: string;
  /** Who does what, in one line. */
  who: string;
  /** The founder-only external page the final review, submit and payment happen on. Null for the kit. */
  external: { label: string; href: string } | null;
  /** Entity types the route forms. */
  entityTypes: string[];
}

export const ROUTE_META: Record<IncorporationRoute, RouteMeta> = {
  stripe_atlas: {
    route: "stripe_atlas",
    label: "Stripe Atlas",
    jurisdictionLabel: "Delaware (C-corp or LLC)",
    who: "The team prepares the answers and fills the Atlas application in a supervised browser session; you sign in, review, sign and pay.",
    external: { label: "Open Stripe Atlas", href: "https://dashboard.stripe.com/atlas" },
    entityTypes: ["C-corp", "LLC"],
  },
  companies_house_web: {
    route: "companies_house_web",
    label: "Companies House",
    jurisdictionLabel: "UK private limited company",
    who: "The team fills the online incorporation forms in a supervised session; you sign in, complete identity verification, review, submit and pay the fee.",
    external: { label: "Open Companies House", href: "https://www.gov.uk/limited-company-formation/register-your-company" },
    entityTypes: ["Ltd"],
  },
  kit: {
    route: "kit",
    label: "Document pack",
    jurisdictionLabel: "Any other jurisdiction",
    who: "The team prepares the documents and forms; you file them with the registry yourself.",
    external: null,
    entityTypes: ["As required by the registry"],
  },
};

export const ROUTE_ORDER: readonly IncorporationRoute[] = ["stripe_atlas", "companies_house_web", "kit"];

/** Delaware → Atlas, UK → Companies House, everything else → kit. */
export function routeForJurisdiction(jurisdiction: string): IncorporationRoute {
  const j = jurisdiction.trim().toLowerCase();
  if (/delaware|\bde\b|us-de/.test(j)) return "stripe_atlas";
  if (/united kingdom|\buk\b|\bgb\b|england|wales|scotland|northern ireland|england-wales/.test(j)) return "companies_house_web";
  return "kit";
}

/* ---------- Supervised session steps ---------- */

export type StepOwner = "squad" | "founder" | "system";
export type StepState = "done" | "current" | "todo" | "abandoned";

export interface IncorporationStepMeta {
  key: string;
  title: string;
  owner: StepOwner;
  /** The incorporation status while this step is the current one. */
  status: IncorporationRow["status"];
}

/** The steps the orchestrator's `incorporation` workflow records, in order. The founder's own steps are marked. */
export const INCORPORATION_STEPS: readonly IncorporationStepMeta[] = [
  { key: "prepare_documents", title: "Documents prepared", owner: "squad", status: "in_progress" },
  { key: "founder_review", title: "Your review", owner: "founder", status: "awaiting_founder" },
  { key: "founder_submits", title: "You submit and pay", owner: "founder", status: "submitted" },
  { key: "record_filing", title: "Filing recorded", owner: "system", status: "submitted" },
  { key: "complete", title: "Complete", owner: "system", status: "complete" },
];

export function readSteps(steps: unknown[] | null | undefined): IncorporationStepRecord[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    if (typeof o.step !== "string") return [];
    return [{ step: o.step, at: typeof o.at === "string" ? o.at : "", note: typeof o.note === "string" ? o.note : "", payload: o.payload && typeof o.payload === "object" ? (o.payload as Record<string, unknown>) : undefined }];
  });
}

export interface StepRow extends IncorporationStepMeta {
  state: StepState;
  at: string | null;
  note: string | null;
}

/** Fold the recorded steps and the row status into one state per step for the session panel. */
export function stepRows(incorporation: IncorporationRow | null): StepRow[] {
  const recorded = readSteps(incorporation?.steps);
  const byKey = new Map(recorded.map((r) => [r.step, r]));
  const abandoned = incorporation?.status === "abandoned";
  const complete = incorporation?.status === "complete";
  let currentSeen = false;
  return INCORPORATION_STEPS.map((meta) => {
    const rec = byKey.get(meta.key);
    let state: StepState;
    if (abandoned) state = rec ? "done" : "abandoned";
    else if (complete) state = "done";
    else if (rec) state = "done";
    else if (!incorporation) state = "todo";
    else if (!currentSeen) {
      currentSeen = true;
      state = "current";
    } else state = "todo";
    return { ...meta, state, at: rec?.at ?? null, note: rec?.note ?? null };
  });
}

/** The founder can take over the supervised session once the squad has prepared the kit and until it is submitted. */
export function founderCanTakeOver(incorporation: IncorporationRow | null): boolean {
  return !!incorporation && (incorporation.status === "in_progress" || incorporation.status === "awaiting_founder");
}

export const INCORPORATION_STATUS_WORD: Record<IncorporationRow["status"], string> = {
  draft: "Draft",
  in_progress: "Preparing",
  awaiting_founder: "Waiting for you",
  submitted: "Submitted",
  complete: "Complete",
  abandoned: "Abandoned",
};

/* ---------- Officers ---------- */

export interface OfficerRow {
  key: string;
  name: string;
  role: string;
  appointedOn: string | null;
  /** The CRM person this officer became (import confirm), when matched by name. */
  entityId: string | null;
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readOfficers(officers: unknown[] | null | undefined): { name: string; role: string; appointedOn: string | null }[] {
  if (!Array.isArray(officers)) return [];
  return officers.flatMap((o) => {
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) return [];
    return [{ name: r.name, role: typeof r.role === "string" && r.role ? r.role : "officer", appointedOn: typeof r.appointedOn === "string" ? r.appointedOn : null }];
  });
}

/** Entity officers joined with the CRM people that carry the `officer` role (matched by normalised name). */
export function officerRows(entity: LegalEntityRow | null, crmOfficers: readonly OfficerEntityRow[] | undefined): OfficerRow[] {
  const byName = new Map((crmOfficers ?? []).map((p) => [normaliseName(p.displayName), p]));
  const rows: OfficerRow[] = readOfficers(entity?.officers).map((o, i) => ({ key: `${i}-${normaliseName(o.name)}`, name: o.name, role: o.role, appointedOn: o.appointedOn, entityId: byName.get(normaliseName(o.name))?.id ?? null }));
  // CRM officers that the entity row does not list (added by hand in the CRM) still belong on the screen.
  const listed = new Set(rows.map((r) => normaliseName(r.name)));
  for (const p of crmOfficers ?? []) {
    if (listed.has(normaliseName(p.displayName))) continue;
    rows.push({ key: `crm-${p.id}`, name: p.displayName, role: p.role.stage ?? p.role.role, appointedOn: typeof p.role.startedAt === "string" ? p.role.startedAt : null, entityId: p.id });
  }
  return rows;
}

export function formatAddress(address: Record<string, string> | null | undefined): string {
  if (!address) return "";
  const order = ["line1", "address_line_1", "addressLine1", "line2", "address_line_2", "addressLine2", "street", "locality", "city", "postal_code", "postalCode", "postcode", "region", "country"];
  const used = new Set<string>();
  const parts: string[] = [];
  // A registry's two-letter country code reads as the country's name ("GB" → "United Kingdom").
  const show = (k: string, v: string) => (k === "country" || k === "country_code" || k === "countryCode" ? jurisdictionName(v) : v);
  for (const k of order) {
    const v = address[k];
    if (v && !used.has(k)) {
      parts.push(show(k, v));
      used.add(k);
    }
  }
  for (const [k, v] of Object.entries(address)) if (v && !used.has(k)) parts.push(show(k, v));
  return parts.join(", ");
}

/* ---------- Compliance calendar ---------- */

export type CalendarKind = "compliance" | "filing";
export type CalendarStatus = "upcoming" | "due" | "overdue" | "done" | "waived";

export interface CalendarRow {
  id: string;
  kind: CalendarKind;
  /** The compliance event kind or filing kind (`annual_accounts`, `confirmation_statement`, …). */
  category: string;
  title: string;
  dueAt: string | null;
  status: CalendarStatus;
  daysLeft: number | null;
  recurrence: string | null;
  ref: string | null;
  completedAt: string | null;
}

export const DUE_WINDOW_DAYS = 30;

export function titleForKind(kind: string, title: string | null | undefined): string {
  const t = (title ?? "").trim();
  if (t) return t.charAt(0).toUpperCase() + t.slice(1);
  const words = kind.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Deadline";
}

function iso(d: string | Date | null | undefined): string | null {
  const date = toDate(d);
  return date ? date.toISOString() : null;
}

export function complianceStatus(e: ComplianceEventRow, now: Date): CalendarStatus {
  if (e.completedAt) return "done";
  const days = daysUntil(e.dueAt, now);
  if (days === null) return "upcoming";
  if (days < 0) return "overdue";
  if (days <= DUE_WINDOW_DAYS) return "due";
  return "upcoming";
}

export function filingStatus(f: FilingRow, now: Date): CalendarStatus {
  const s: FilingStatus = f.status;
  if (s === "filed") return "done";
  if (s === "waived") return "waived";
  if (s === "overdue") return "overdue";
  if (s === "due") return "due";
  const days = daysUntil(f.dueAt, now);
  if (days !== null && days < 0) return "overdue";
  if (days !== null && days <= DUE_WINDOW_DAYS) return "due";
  return "upcoming";
}

/** Compliance events and filings as one calendar, soonest first, with the status computed against `now`. */
export function calendarRows(data: ComplianceListResponse | undefined, now: Date): CalendarRow[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: CalendarRow[] = [];
  const events = [...(data.events ?? []), ...(data.upcoming?.compliance ?? [])];
  for (const e of events) {
    if (seen.has(`c:${e.id}`)) continue;
    seen.add(`c:${e.id}`);
    rows.push({ id: e.id, kind: "compliance", category: e.kind, title: titleForKind(e.kind, e.title), dueAt: iso(e.dueAt), status: complianceStatus(e, now), daysLeft: daysUntil(e.dueAt, now), recurrence: e.recurrence, ref: null, completedAt: iso(e.completedAt) });
  }
  const filings = [...(data.filings ?? []), ...(data.upcoming?.filings ?? [])];
  for (const f of filings) {
    if (seen.has(`f:${f.id}`)) continue;
    seen.add(`f:${f.id}`);
    rows.push({ id: f.id, kind: "filing", category: f.kind, title: titleForKind(f.kind, f.title), dueAt: iso(f.dueAt), status: filingStatus(f, now), daysLeft: daysUntil(f.dueAt, now), recurrence: null, ref: f.ref, completedAt: iso(f.filedAt) });
  }
  return rows.sort((a, b) => {
    if (a.dueAt === b.dueAt) return a.title.localeCompare(b.title);
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt < b.dueAt ? -1 : 1;
  });
}

export function monthKey(d: string | Date): string {
  const date = toDate(d);
  return date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` : "";
}

/** Twelve month buckets from `from` (inclusive), each with the rows due in it. */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function calendarMonths(rows: readonly CalendarRow[], from: Date, months = 12): { key: string; label: string; rows: CalendarRow[] }[] {
  const out: { key: string; label: string; rows: CalendarRow[] }[] = [];
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = monthKey(d);
    // "Sep 2027", never ICU's "Sept 2027": the same three-letter months as every other date in the product.
    out.push({ key, label: `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`, rows: rows.filter((r) => r.dueAt && monthKey(r.dueAt) === key) });
  }
  return out;
}

/** The headline number the department card shows: days to the next open deadline. */
export function daysToNextDeadline(rows: readonly CalendarRow[]): number | null {
  const open = rows.filter((r) => (r.status === "upcoming" || r.status === "due" || r.status === "overdue") && r.daysLeft !== null);
  if (open.length === 0) return null;
  return Math.min(...open.map((r) => r.daysLeft as number));
}

/* ---------- Contracts and obligations ---------- */

export interface Obligation {
  id: string;
  title: string;
  /** Who owes it: the business ("us") or the counterparty ("them"). */
  party: "us" | "them" | "both";
  dueAt: string | null;
  status: "open" | "met" | "overdue";
  detail: string | null;
}

/** `contracts.obligations` is free JSON: strings or `{ title, party, dueAt, status, detail }`. */
export function readObligations(raw: unknown[] | null | undefined, now: Date): Obligation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o, i) => {
    if (typeof o === "string" && o.trim()) return [{ id: `o${i}`, title: o.trim(), party: "us" as const, dueAt: null, status: "open" as const, detail: null }];
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : typeof r.text === "string" ? r.text : typeof r.description === "string" ? r.description : "";
    if (!title) return [];
    const party = r.party === "them" || r.party === "counterparty" ? "them" : r.party === "both" ? "both" : "us";
    const dueAt = iso(typeof r.dueAt === "string" ? r.dueAt : typeof r.due_at === "string" ? r.due_at : null);
    const metRaw = r.status === "met" || r.status === "done" || r.met === true || r.completed === true;
    const days = daysUntil(dueAt, now);
    const status: Obligation["status"] = metRaw ? "met" : days !== null && days < 0 ? "overdue" : "open";
    return [{ id: typeof r.id === "string" ? r.id : `o${i}`, title, party, dueAt, status, detail: typeof r.detail === "string" ? r.detail : typeof r.description === "string" && r.description !== title ? r.description : null }];
  });
}

export const CONTRACT_STATUS_WORD: Record<ContractRow["status"], string> = {
  draft: "Draft",
  review: "In review",
  awaiting_signature: "Awaiting signature",
  signed: "Signed",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

/** Which lifecycle moves a screen may offer (mirrors packages/db `CONTRACT_TRANSITIONS`; `signed` is founder-only). */
export const CONTRACT_NEXT: Record<ContractRow["status"], readonly ContractRow["status"][]> = {
  draft: ["review", "awaiting_signature", "terminated"],
  review: ["draft", "awaiting_signature", "terminated"],
  awaiting_signature: ["signed", "review", "terminated"],
  signed: ["active", "terminated"],
  active: ["expired", "terminated"],
  expired: [],
  terminated: [],
};

export function isExternalHref(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && /^https?:\/\//i.test(ref);
}

/* ---------- Generated policies (privacy, terms, cookies) ---------- */

export interface DataFlow {
  connectorKey: string;
  processor: string;
  purpose: string;
  data: string[];
  /** Cookies the processor sets on the business's own site, when any. */
  cookies: { name: string; purpose: string; duration: string; category: "necessary" | "functional" | "analytics" | "marketing" }[];
}

/** What each connected integration implies for the data map. Unknown connectors get a generic entry. */
export const DATA_FLOWS: Record<string, Omit<DataFlow, "connectorKey">> = {
  stripe: { processor: "Stripe", purpose: "Payments, invoicing and subscription billing", data: ["name", "email", "billing address", "payment card (tokenized by Stripe)", "transaction history"], cookies: [{ name: "__stripe_mid", purpose: "Fraud prevention during checkout", duration: "1 year", category: "necessary" }, { name: "__stripe_sid", purpose: "Fraud prevention during checkout", duration: "30 minutes", category: "necessary" }] },
  sendgrid: { processor: "Twilio SendGrid", purpose: "Transactional and marketing email", data: ["email", "name", "email engagement (opens, clicks)"], cookies: [] },
  shopify: { processor: "Shopify", purpose: "Online store, orders and fulfillment", data: ["name", "email", "shipping address", "order history"], cookies: [{ name: "_shopify_y", purpose: "Shop analytics", duration: "1 year", category: "analytics" }, { name: "cart", purpose: "Keeps the basket between pages", duration: "2 weeks", category: "necessary" }] },
  github: { processor: "GitHub", purpose: "Source code hosting and issue tracking", data: ["GitHub account name", "issue and pull request content"], cookies: [] },
  gmail: { processor: "Google (Gmail)", purpose: "Email correspondence synced into the CRM", data: ["email address", "message content", "attachments"], cookies: [] },
  google_calendar: { processor: "Google Calendar", purpose: "Meeting scheduling", data: ["email address", "meeting times and attendees"], cookies: [] },
  google_drive: { processor: "Google Drive", purpose: "Document storage", data: ["documents shared with the business"], cookies: [] },
  notion: { processor: "Notion", purpose: "Internal documents and notes", data: ["notes that may name customers"], cookies: [] },
  plaid: { processor: "Plaid", purpose: "Bank account connection for the business's own accounts", data: ["business bank transactions"], cookies: [] },
  tink: { processor: "Tink", purpose: "Bank account connection for the business's own accounts", data: ["business bank transactions"], cookies: [] },
  dropbox_sign: { processor: "Dropbox Sign", purpose: "Electronic signature of contracts", data: ["signer name", "email", "signed documents", "IP address at signing"], cookies: [] },
  cloudflare_dns: { processor: "Cloudflare", purpose: "DNS and edge delivery for the website", data: ["IP address", "request logs"], cookies: [{ name: "__cf_bm", purpose: "Bot management", duration: "30 minutes", category: "necessary" }] },
  anthropic: { processor: "Anthropic", purpose: "AI agents that draft, research and classify on the business's behalf", data: ["text the team processes, which may include customer names and messages"], cookies: [] },
  voyage: { processor: "Voyage AI", purpose: "Search embeddings for notes and documents", data: ["text of notes and documents"], cookies: [] },
  e2b: { processor: "E2B", purpose: "Isolated sandboxes for coding agents", data: ["source code and test data"], cookies: [] },
  ecb_rates: { processor: "European Central Bank", purpose: "Exchange rates", data: [], cookies: [] },
  companies_house: { processor: "Companies House", purpose: "Company registry lookups", data: ["company and officer public records"], cookies: [] },
  bolagsverket: { processor: "Bolagsverket", purpose: "Company registry lookups", data: ["company public records"], cookies: [] },
  opencorporates: { processor: "OpenCorporates", purpose: "Company registry lookups", data: ["company public records"], cookies: [] },
};

export const ACTIVE_INTEGRATION_STATUSES: readonly IntegrationRow["status"][] = ["connected", "degraded", "mock"];

export function dataFlows(integrations: readonly IntegrationRow[] | undefined, catalogue?: readonly { key: string; displayName: string }[]): DataFlow[] {
  const names = new Map((catalogue ?? []).map((c) => [c.key, c.displayName]));
  return (integrations ?? [])
    .filter((i) => ACTIVE_INTEGRATION_STATUSES.includes(i.status))
    .map((i) => {
      const known = DATA_FLOWS[i.connectorKey];
      if (known) return { connectorKey: i.connectorKey, ...known };
      const processor = names.get(i.connectorKey) ?? i.connectorKey.replace(/_/g, " ");
      return { connectorKey: i.connectorKey, processor, purpose: `Connected service (${processor})`, data: ["data exchanged with this service"], cookies: [] };
    })
    .sort((a, b) => a.processor.localeCompare(b.processor));
}

export interface PolicyInput {
  businessName: string;
  legalName: string | null;
  jurisdiction: string | null;
  entityType: string | null;
  regNo: string | null;
  address: string;
  region: "eu" | "us";
  archetype: Archetype | null;
  flows: DataFlow[];
  /** ISO date the policies were generated for. */
  today: string;
  contactEmail?: string | null;
}

export type PolicyKey = "privacy" | "terms" | "cookies";
export const POLICY_KEYS: readonly PolicyKey[] = ["privacy", "terms", "cookies"];
export const POLICY_TITLES: Record<PolicyKey, string> = { privacy: "Privacy policy", terms: "Terms of service", cookies: "Cookie policy" };

const ARCHETYPE_SERVICE: Record<Archetype, string> = {
  b2b_saas: "a software service for businesses",
  consumer_app: "a consumer application",
  marketplace: "a marketplace connecting buyers and sellers",
  dtc_physical: "an online shop selling physical products",
  hardware: "connected hardware products and companion software",
  services: "professional services",
  content_media: "content, media and memberships",
};

function controller(p: PolicyInput): string {
  const name = p.legalName || p.businessName;
  const form = entityTypeLabel(p.entityType);
  const place = jurisdictionName(p.jurisdiction);
  // "Private limited company (Ltd)" reads lower-case mid-sentence; "C-corp", "LLC" and "GmbH" keep their capitals.
  const sentence = /^(Private|Public|Limited) /.test(form);
  const bits = [name, form ? (sentence ? form.charAt(0).toLowerCase() + form.slice(1) : form) : null, p.regNo ? `registration number ${p.regNo}` : null].filter(Boolean);
  return `${bits.join(", ")}${place ? ` (${place})` : ""}`;
}

/** "2026-10-09" → "October 9, 2026": a policy's date reads as a date, never an ISO key. */
export function policyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** A place mid-sentence: "the United Kingdom", "the Netherlands", "Delaware", "Sweden". */
export function placeInSentence(name: string): string {
  return /^(United |Netherlands$|Czech Republic$|Philippines$|Bahamas$)/.test(name) ? `the ${name}` : name;
}

/** A UK company answers to the UK GDPR, not the EU one (the UK left the EU's regime at the end of 2020). */
function isUkJurisdiction(jurisdiction: string | null | undefined): boolean {
  const j = (jurisdiction ?? "").trim().toLowerCase();
  return j === "gb" || j === "uk" || j.startsWith("gb-") || j === "england-wales" || jurisdictionName(jurisdiction) === "United Kingdom";
}

export function generatePrivacyPolicy(p: PolicyInput): string {
  const law = isUkJurisdiction(p.jurisdiction) ? "the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018" : p.region === "eu" ? "the EU General Data Protection Regulation (GDPR)" : "applicable US state privacy laws";
  const lines: string[] = [];
  lines.push(`# Privacy policy`, ``, `Last updated ${policyDate(p.today)}`, ``);
  lines.push(`${controller(p)} ("${p.businessName}", "we") provides ${p.archetype ? ARCHETYPE_SERVICE[p.archetype] : "its products and services"}. This policy explains what personal data we collect, why, and the rights you have under ${law}.`, ``);
  if (p.address) lines.push(`Our registered address is ${p.address}.`, ``);
  lines.push(`## What we collect and why`, ``);
  lines.push(`- **Account and contact details** (name, email) to provide the service and respond to you. Lawful basis: performance of a contract.`);
  lines.push(`- **Usage data** (pages viewed, features used, device and browser) to keep the service secure and improve it. Lawful basis: legitimate interests.`);
  if (p.flows.some((f) => f.connectorKey === "stripe" || f.connectorKey === "shopify")) lines.push(`- **Billing and order details** to take payment and deliver what you bought. Lawful basis: performance of a contract and legal obligations (accounting).`);
  if (p.flows.some((f) => f.connectorKey === "sendgrid")) lines.push(`- **Marketing preferences** so we only send you what you asked for. Lawful basis: consent, which you can withdraw with the unsubscribe link in every message.`);
  lines.push(``, `## Who we share it with`, ``);
  if (p.flows.length === 0) lines.push(`We do not share personal data with third-party processors.`);
  else {
    lines.push(`We use the following processors, each under a data processing agreement:`, ``);
    for (const f of p.flows) lines.push(`- **${f.processor}**: ${f.purpose.toLowerCase()}${f.data.length ? ` (${f.data.join(", ")})` : ""}.`);
  }
  lines.push(``, `## AI agents`, ``, `Parts of our operations are carried out by AI agents under human supervision. Agents never make payments, sign agreements or change security settings; a person in our team approves those actions.`, ``);
  lines.push(`## How long we keep it`, ``, `Account data for as long as you have an account and for 24 months after; billing records for the period our accounting law requires; prospect data that never converted is deleted after 24 months.`, ``);
  lines.push(`## Your rights`, ``, p.region === "eu" ? `You can ask us to access, correct, export or delete your data, to restrict or object to processing, and you can complain to your supervisory authority. Write to us and we answer within one month.` : `You can ask us to access, correct, export or delete your data and to opt out of the sale or sharing of personal information. We do not sell personal data.`, ``);
  if (p.contactEmail) lines.push(`## Contact`, ``, `${p.contactEmail}`, ``);
  return lines.join("\n");
}

export function generateTerms(p: PolicyInput): string {
  const lines: string[] = [];
  lines.push(`# Terms of service`, ``, `Last updated ${policyDate(p.today)}`, ``);
  lines.push(`These terms are an agreement between you and ${controller(p)} ("${p.businessName}") for ${p.archetype ? ARCHETYPE_SERVICE[p.archetype] : "our products and services"}.`, ``);
  lines.push(`## Your account`, ``, `Keep your credentials safe and tell us about any unauthorized use. You are responsible for activity under your account.`, ``);
  if (p.flows.some((f) => f.connectorKey === "stripe" || f.connectorKey === "shopify")) lines.push(`## Payment`, ``, `Prices are shown before you buy. Payments are processed by ${p.flows.filter((f) => f.connectorKey === "stripe" || f.connectorKey === "shopify").map((f) => f.processor).join(" and ")}; we never store full card numbers.`, ``);
  if (p.archetype === "marketplace") lines.push(`## Marketplace`, ``, `We connect buyers and sellers and are not a party to the contracts between them, except where these terms say otherwise.`, ``);
  if (p.archetype === "dtc_physical" || p.archetype === "hardware") lines.push(`## Delivery and returns`, ``, `Delivery times are estimates. You may return unused goods within 14 days of delivery for a refund where the law requires it.`, ``);
  lines.push(`## Acceptable use`, ``, `Do not misuse the service, break the law, infringe others' rights or try to access accounts or data that are not yours.`, ``);
  lines.push(`## Liability`, ``, `To the extent the law allows, we are not liable for indirect losses. Nothing in these terms limits liability that cannot be limited by law.`, ``);
  const place = jurisdictionName(p.jurisdiction);
  lines.push(`## Governing law`, ``, `${place ? `The law of ${placeInSentence(place)} applies and its courts have jurisdiction` : "The law of the place where the company is registered applies"}, without affecting consumer rights that apply where you live.`, ``);
  lines.push(`## Changes`, ``, `We may update these terms; material changes are announced at least 30 days before they apply.`, ``);
  return lines.join("\n");
}

export function generateCookiePolicy(p: PolicyInput): string {
  const cookies = p.flows.flatMap((f) => f.cookies.map((c) => ({ ...c, processor: f.processor })));
  const lines: string[] = [];
  lines.push(`# Cookie policy`, ``, `Last updated ${policyDate(p.today)}`, ``);
  lines.push(`${p.businessName} uses cookies and similar technologies on its website. Necessary cookies are set without consent; everything else waits for your choice in the cookie banner.`, ``);
  lines.push(`## Cookies we set`, ``, `| Cookie | Set by | Purpose | Duration | Category |`, `| --- | --- | --- | --- | --- |`);
  lines.push(`| session | ${p.businessName} | Keeps you signed in | Session | Necessary |`);
  lines.push(`| cookie_consent | ${p.businessName} | Remembers your cookie choice | 12 months | Necessary |`);
  for (const c of cookies) lines.push(`| ${c.name} | ${c.processor} | ${c.purpose} | ${c.duration} | ${c.category.charAt(0).toUpperCase() + c.category.slice(1)} |`);
  lines.push(``, `## Managing cookies`, ``, `Change your choice at any time from the cookie settings link in the footer or through your browser settings. Blocking necessary cookies may stop parts of the site working.`, ``);
  return lines.join("\n");
}

export function generatePolicies(p: PolicyInput): Record<PolicyKey, string> {
  return { privacy: generatePrivacyPolicy(p), terms: generateTerms(p), cookies: generateCookiePolicy(p) };
}

/* ---------- Trademark screen (information, not legal clearance) ---------- */

export type Distinctiveness = "fanciful" | "arbitrary" | "suggestive" | "descriptive" | "generic";

export interface TrademarkIssue {
  id: string;
  severity: "info" | "warn" | "bad";
  text: string;
}

export interface TrademarkScreen {
  mark: string;
  distinctiveness: Distinctiveness;
  /** 1–5, how registrable the word looks on its face. */
  strength: number;
  issues: TrademarkIssue[];
  /** Nice classes worth considering for this archetype. */
  classes: { number: number; title: string }[];
  /** Official databases the founder checks personally (the screen never scrapes them). */
  lookups: { office: string; label: string; href: string }[];
}

const GENERIC_WORDS = ["app", "software", "shop", "store", "market", "service", "services", "company", "co", "inc", "ltd", "llc", "group", "online", "digital", "cloud", "tech", "technologies", "solutions", "systems", "global", "international", "the", "and", "of", "for", "my", "your", "best", "pro", "plus", "hub", "labs", "lab", "studio", "media", "network", "platform", "data", "ai"];
const DESCRIPTIVE_WORDS = ["fast", "quick", "easy", "simple", "smart", "secure", "safe", "fresh", "natural", "organic", "premium", "cheap", "free", "instant", "clean", "pure", "healthy", "skin", "care", "skincare", "pay", "payments", "invoice", "invoices", "ledger", "books", "accounting", "finance", "bank", "legal", "health", "food", "coffee", "beauty", "fitness", "travel", "learn", "learning", "jobs", "hire", "rent", "rental", "deliver", "delivery"];

export const NICE_CLASSES_BY_ARCHETYPE: Record<Archetype, { number: number; title: string }[]> = {
  b2b_saas: [{ number: 9, title: "Downloadable software" }, { number: 42, title: "Software as a service (SaaS)" }, { number: 35, title: "Business services" }],
  consumer_app: [{ number: 9, title: "Downloadable software" }, { number: 42, title: "Software as a service (SaaS)" }, { number: 38, title: "Telecommunications" }],
  marketplace: [{ number: 35, title: "Online marketplace services" }, { number: 42, title: "Software as a service (SaaS)" }, { number: 36, title: "Payment services" }],
  dtc_physical: [{ number: 3, title: "Cosmetics and cleaning preparations" }, { number: 25, title: "Clothing" }, { number: 35, title: "Online retail services" }],
  hardware: [{ number: 9, title: "Electronic apparatus" }, { number: 42, title: "Software as a service (SaaS)" }, { number: 37, title: "Installation and repair" }],
  services: [{ number: 35, title: "Business consultancy" }, { number: 41, title: "Education and training" }, { number: 42, title: "Technical services" }],
  content_media: [{ number: 41, title: "Entertainment and publishing" }, { number: 9, title: "Downloadable media" }, { number: 38, title: "Streaming and broadcasting" }],
};

export function trademarkLookups(mark: string): TrademarkScreen["lookups"] {
  const q = encodeURIComponent(mark.trim());
  return [
    { office: "USPTO", label: "USPTO trademark search", href: `https://tmsearch.uspto.gov/search/search-information?q=${q}` },
    { office: "EUIPO", label: "EUIPO eSearch plus", href: `https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/${q}` },
    { office: "UKIPO", label: "UK IPO trade mark search", href: `https://trademarks.ipo.gov.uk/ipo-tmtext?wordSearchPhrase=${q}` },
    { office: "WIPO", label: "WIPO Global Brand Database", href: `https://branddb.wipo.int/en/similarname/results?sort=score%20desc&start=0&rows=30&asStructure=%7B%22_id%22%3A%22b1e4%22%2C%22boolean%22%3A%22AND%22%2C%22bricks%22%3A%5B%7B%22_id%22%3A%22b1e5%22%2C%22key%22%3A%22brandName%22%2C%22value%22%3A%22${q}%22%2C%22strategy%22%3A%22Simple%22%7D%5D%7D` },
  ];
}

/**
 * A heuristic look at a word mark: distinctiveness on the spectrum (generic → fanciful), obvious problems (too
 * short, descriptive words, numerals, clashes with names the founder already listed). A screen, not legal clearance.
 */
export function screenTrademark(mark: string, context: { archetype: Archetype | null; knownMarks?: readonly string[] }): TrademarkScreen {
  const raw = mark.trim();
  const words = normaliseName(raw).split(" ").filter(Boolean);
  const issues: TrademarkIssue[] = [];
  let distinctiveness: Distinctiveness;
  if (words.length === 0) {
    return { mark: raw, distinctiveness: "generic", strength: 0, issues: [{ id: "empty", severity: "info", text: "Enter a word mark to screen." }], classes: context.archetype ? NICE_CLASSES_BY_ARCHETYPE[context.archetype] : [], lookups: [] };
  }
  const genericCount = words.filter((w) => GENERIC_WORDS.includes(w)).length;
  const descriptiveCount = words.filter((w) => DESCRIPTIVE_WORDS.includes(w)).length;
  const dictionaryCount = genericCount + descriptiveCount;
  if (genericCount === words.length) distinctiveness = "generic";
  else if (dictionaryCount === words.length) distinctiveness = "descriptive";
  else if (dictionaryCount > 0) distinctiveness = "suggestive";
  else {
    // Coined-looking words (rare letters, no dictionary hits) read as fanciful; other real-looking words as arbitrary.
    const coined = words.every((w) => w.length >= 5 && /[xzqjkv]/.test(w));
    distinctiveness = coined ? "fanciful" : "arbitrary";
  }
  if (genericCount === words.length) issues.push({ id: "generic", severity: "bad", text: "Every word is a generic term for the goods or services; a generic mark cannot be registered." });
  else if (descriptiveCount > 0 && dictionaryCount === words.length) issues.push({ id: "descriptive", severity: "warn", text: `"${words.filter((w) => DESCRIPTIVE_WORDS.includes(w)).join(" ")}" describes the product; descriptive marks are refused unless they have acquired distinctiveness.` });
  else if (genericCount > 0) issues.push({ id: "generic-word", severity: "info", text: `"${words.filter((w) => GENERIC_WORDS.includes(w)).join(" ")}" is generic and will be disclaimed; the rest of the mark carries the protection.` });
  if (raw.length <= 2) issues.push({ id: "short", severity: "warn", text: "Marks of one or two letters are hard to register and to enforce." });
  if (/\d/.test(raw)) issues.push({ id: "numerals", severity: "info", text: "Numerals are fine but are often read as model numbers; make sure the mark is used as a brand." });
  if (/\.(com|io|co|app|ai|net|org)$/i.test(raw)) issues.push({ id: "tld", severity: "info", text: "A domain suffix adds nothing to a mark; registries treat \"name.com\" as \"name\"." });
  const known = (context.knownMarks ?? []).map(normaliseName).filter(Boolean);
  const norm = normaliseName(raw);
  for (const k of known) {
    if (k === norm) issues.push({ id: `clash-${k}`, severity: "bad", text: `Identical to a mark already on your list: "${k}".` });
    else if (k.includes(norm) || norm.includes(k)) issues.push({ id: `near-${k}`, severity: "warn", text: `Contains or is contained by a mark on your list: "${k}". Expect a likelihood-of-confusion objection in the same classes.` });
  }
  const base: Record<Distinctiveness, number> = { fanciful: 5, arbitrary: 4, suggestive: 3, descriptive: 2, generic: 1 };
  const penalty = issues.filter((i) => i.severity === "bad").length;
  const strength = Math.max(1, base[distinctiveness] - penalty);
  return { mark: raw, distinctiveness, strength, issues, classes: context.archetype ? NICE_CLASSES_BY_ARCHETYPE[context.archetype] : NICE_CLASSES_BY_ARCHETYPE.b2b_saas, lookups: trademarkLookups(raw) };
}

export const DISTINCTIVENESS_WORD: Record<Distinctiveness, string> = { fanciful: "Fanciful (coined word)", arbitrary: "Arbitrary (real word, unrelated)", suggestive: "Suggestive", descriptive: "Descriptive", generic: "Generic" };

/* ---------- Regulated-sector gates (BUILD §15: health, finance, legal services, food, cosmetics, children) ---------- */

export type SectorKey = "health" | "finance" | "legal_services" | "food" | "cosmetics" | "children";
export const SECTOR_KEYS: readonly SectorKey[] = ["health", "finance", "legal_services", "food", "cosmetics", "children"];

export interface SectorChecklistItem {
  id: string;
  title: string;
  /** The founder performs identity-bound steps; the squad prepares. */
  owner: "founder" | "squad";
  detail: string;
}

export interface SectorGate {
  key: SectorKey;
  label: string;
  /** What triggers the gate. */
  summary: string;
  /** Words in the business name, pitch or glossary that suggest the sector. */
  keywords: readonly string[];
  /** Archetypes that often fall into the sector. */
  archetypes: readonly Archetype[];
  /** What the squad will not do until the gate is cleared. */
  blocked: readonly string[];
  checklist: readonly SectorChecklistItem[];
}

export const SECTOR_GATES: Record<SectorKey, SectorGate> = {
  health: {
    key: "health",
    label: "Health",
    summary: "Products or advice that touch diagnosis, treatment, supplements or medical devices.",
    keywords: ["health", "medical", "clinic", "patient", "therapy", "doctor", "pharma", "supplement", "diagnos", "wellness", "mental"],
    archetypes: [],
    blocked: ["Publishing health claims", "Collecting health data before a lawful basis is recorded", "Running paid acquisition for medical claims"],
    checklist: [
      { id: "classification", title: "Classify the product (medical device, supplement, wellness, software as a medical device)", owner: "squad", detail: "Prepares a classification memo with the regulator's definitions (MDR/FDA) for a professional to confirm." },
      { id: "claims", title: "Review every health claim against the allowed list", owner: "squad", detail: "Flags claims that imply diagnosis, cure or treatment; the founder decides what stays." },
      { id: "health-data", title: "Record the lawful basis for health data and a DPIA", owner: "founder", detail: "Special-category data needs explicit consent or another Article 9 basis; the DPIA is signed by the founder." },
      { id: "professional", title: "Appoint a regulatory professional", owner: "founder", detail: "Partner professionals are offered; the engagement letter is signed by the founder." },
    ],
  },
  finance: {
    key: "finance",
    label: "Finance",
    summary: "Holding, moving or advising on other people's money: payments, lending, investments, crypto.",
    keywords: ["bank", "banking", "lending", "loan", "invest", "payment", "wallet", "crypto", "insurance", "credit", "fintech", "trading", "remittance"],
    archetypes: [],
    blocked: ["Taking customer funds before a license or an agent arrangement exists", "Marketing regulated products", "Giving investment advice"],
    checklist: [
      { id: "perimeter", title: "Map the activity against the licensing perimeter", owner: "squad", detail: "Prepares a perimeter memo: which activities need authorization (payments, e-money, lending, advice) and which can run under a partner's license." },
      { id: "partner", title: "Choose a licensed partner or apply for authorization", owner: "founder", detail: "Applications and agent agreements are filed and signed by the founder." },
      { id: "aml", title: "Write the AML/KYC policy and appoint an MLRO", owner: "founder", detail: "The team drafts; the founder appoints the officer and adopts the policy." },
      { id: "promotions", title: "Financial promotions sign-off", owner: "founder", detail: "Every public claim about returns, rates or safety is approved by a person before publication." },
    ],
  },
  legal_services: {
    key: "legal_services",
    label: "Legal services",
    summary: "Advice, documents or representation that count as reserved legal activities.",
    keywords: ["legal", "law", "lawyer", "attorney", "solicitor", "notary", "contract review", "litigation", "immigration"],
    archetypes: [],
    blocked: ["Presenting agent output as legal advice", "Reserved activities such as representation or conveyancing"],
    checklist: [
      { id: "reserved", title: "Separate information from reserved legal activities", owner: "squad", detail: "Lists what the product does and marks anything a regulator reserves for licensed practitioners." },
      { id: "supervision", title: "Name the supervising qualified lawyer", owner: "founder", detail: "Where advice is given, a qualified person supervises and is named on the site." },
      { id: "disclaimers", title: "Information-not-advice wording on every output", owner: "squad", detail: "The caption is mandatory in the product, emails and agent prose." },
      { id: "insurance", title: "Professional indemnity insurance", owner: "founder", detail: "Quotes prepared by the team; the policy is taken out by the founder." },
    ],
  },
  food: {
    key: "food",
    label: "Food and drink",
    summary: "Making, labeling or selling food, drink or supplements.",
    keywords: ["food", "drink", "beverage", "snack", "coffee", "tea", "meal", "kitchen", "restaurant", "grocery", "nutrition"],
    archetypes: ["dtc_physical"],
    blocked: ["Selling before registration with the food authority", "Publishing nutrition or health claims that are not on the permitted list"],
    checklist: [
      { id: "registration", title: "Register the food business with the local authority", owner: "founder", detail: "Registration is in the founder's name; the team prepares the form." },
      { id: "labelling", title: "Labeling check: allergens, ingredients, nutrition, origin", owner: "squad", detail: "Prepares a label checklist per product against the rules of each target market." },
      { id: "haccp", title: "Food safety plan (HACCP)", owner: "squad", detail: "Drafts the hazard analysis for the founder to adopt and train staff on." },
      { id: "claims", title: "Nutrition and health claims review", owner: "squad", detail: "Flags claims that need authorization before use." },
    ],
  },
  cosmetics: {
    key: "cosmetics",
    label: "Cosmetics",
    summary: "Skincare, make-up, fragrance and personal care products.",
    keywords: ["skincare", "skin", "cosmetic", "beauty", "serum", "cream", "fragrance", "perfume", "make-up", "makeup", "hair", "lotion"],
    archetypes: ["dtc_physical"],
    blocked: ["Selling before the product information file and safety assessment exist", "Claims that imply a medicinal effect"],
    checklist: [
      { id: "safety", title: "Cosmetic product safety report by a qualified assessor", owner: "founder", detail: "The team briefs the assessor; the founder engages them and signs the responsible-person declaration." },
      { id: "pif", title: "Product information file", owner: "squad", detail: "Assembles formulation, manufacturing method, safety report and labeling evidence per product." },
      { id: "notification", title: "Notify the product (CPNP / SCPN / FDA listing)", owner: "founder", detail: "Portal accounts and notifications are in the responsible person's name." },
      { id: "claims", title: "Claims and labeling review", owner: "squad", detail: "INCI list, warnings, period after opening, and substantiation for every claim." },
    ],
  },
  children: {
    key: "children",
    label: "Children's products",
    summary: "Products or services for children, or an audience that includes under-16s.",
    keywords: ["kids", "child", "children", "toy", "toys", "school", "teen", "baby", "infant", "parent", "family"],
    archetypes: [],
    blocked: ["Collecting personal data from children without verified parental consent", "Behavioral advertising to children", "Selling toys before safety testing and marking"],
    checklist: [
      { id: "age", title: "Age gate and parental consent flow", owner: "squad", detail: "Designs the age check and consent flow; the founder decides the age threshold per market (13 to 16)." },
      { id: "data", title: "Children's data: minimize, no profiling, age-appropriate design", owner: "squad", detail: "Checks every data flow against the age-appropriate design code and COPPA." },
      { id: "safety", title: "Toy or product safety testing and marking (CE/UKCA/ASTM)", owner: "founder", detail: "Test reports are commissioned and the declaration of conformity is signed by the founder." },
      { id: "marketing", title: "No behavioral advertising to children", owner: "squad", detail: "Campaign agents are configured with the restriction." },
    ],
  },
};

export interface SectorHit {
  key: SectorKey;
  /** Why the sector was suggested. */
  reasons: string[];
}

/** Sectors the business's name, pitch, glossary and archetype suggest. The founder confirms; this never decides alone. */
export function detectSectors(input: { name: string; pitch?: string | null; archetype: Archetype | null; glossary?: Record<string, string> }): SectorHit[] {
  const text = normaliseName([input.name, input.pitch ?? "", ...Object.values(input.glossary ?? {})].join(" "));
  const hits: SectorHit[] = [];
  for (const key of SECTOR_KEYS) {
    const gate = SECTOR_GATES[key];
    const reasons: string[] = [];
    const words = gate.keywords.filter((k) => text.includes(k));
    if (words.length) reasons.push(`mentions ${words.map((w) => `"${w}"`).join(", ")}`);
    if (input.archetype && gate.archetypes.includes(input.archetype)) reasons.push(`common for ${archetypeLabel(input.archetype)} businesses`);
    if (reasons.length) hits.push({ key, reasons });
  }
  return hits;
}

export type GateState = "clear" | "open" | "not_applicable";

/** A gate is open while any checklist item is unchecked; clear once all are done; not applicable when the sector is off. */
export function gateState(key: SectorKey, selected: ReadonlySet<SectorKey>, done: ReadonlySet<string>): GateState {
  if (!selected.has(key)) return "not_applicable";
  const items = SECTOR_GATES[key].checklist;
  return items.every((i) => done.has(`${key}:${i.id}`)) ? "clear" : "open";
}
