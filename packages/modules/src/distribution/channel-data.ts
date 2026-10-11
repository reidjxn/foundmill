/**
 * Pure helpers for the distribution screens (BUILD §11.7): the 15-channel roster merged with what the API stored,
 * potential stars, the five-week form guide from daily metrics, pause state from campaigns, guardrails per channel,
 * attribution rows and the campaign status machine. No React, no data access.
 */
import { LIMITS } from "@foundmill/config";
import { formatMoney, type ChannelTokenData, type FormCell } from "@foundmill/dugout";
import { CHANNEL_KEYS, CHANNEL_META, type ApprovalState, type CampaignStatus, type ChannelKey, type ChannelLine } from "@foundmill/shared/constants";
import { weekKey } from "@foundmill/widgets/shared/time";
import type { AgentRow, AssetRow, BlendedSummary, CampaignRow, ChannelMetricRow, ChannelRow, ChannelSummaryRow, JourneyRow, RecommendationRow } from "./types";

/* ---------- Roster ---------- */

export interface ChannelView extends ChannelRow {
  /** False when the API has no row for the channel yet (never scored, never enabled). */
  persisted: boolean;
  /** 0–5 in halves. */
  stars: number;
  cpaRange: { low: number; high: number } | null;
  why: string;
  paused: boolean;
  campaigns: CampaignRow[];
  form5: FormCell[];
}

export function potentialStars(potential: number | string | null | undefined): number {
  const raw = typeof potential === "number" ? potential : Number(potential ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Stored as stars × 20 (0–100); values ≤ 5 are already stars.
  const stars = raw > 5 ? raw / 20 : raw;
  return Math.max(0, Math.min(5, Math.round(stars * 2) / 2));
}

export function clampFit(fit: number | string | null | undefined): number {
  const n = typeof fit === "number" ? fit : Number(fit ?? 1);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.round(n))) : 1;
}

const defaultRow = (key: ChannelKey, currency: string): ChannelRow => ({
  id: "",
  channelKey: key,
  enabled: false,
  line: CHANNEL_META[key].line,
  fit: 1,
  potential: 0,
  recommended: false,
  whyMd: "",
  budgetMinor: 0,
  currency,
  kitMode: CHANNEL_META[key].kitModeByDefault,
  ownerAgentId: null,
  form: null,
});

export interface BuildChannelViewsInput {
  channels: readonly ChannelRow[] | undefined;
  campaigns?: readonly CampaignRow[];
  metrics?: readonly ChannelMetricRow[];
  recommendation?: readonly RecommendationRow[] | null;
  currency?: string;
  today?: string;
}

/** All 15 channels in line order, each merged with its stored row, recommendation, campaigns and five-week form. */
export function buildChannelViews({ channels, campaigns = [], metrics = [], recommendation, currency = "EUR", today }: BuildChannelViewsInput): ChannelView[] {
  const byKey = new Map((channels ?? []).map((c) => [c.channelKey, c]));
  const recByKey = new Map((recommendation ?? []).map((r) => [r.channel, r]));
  return CHANNEL_KEYS.map((key) => {
    const stored = byKey.get(key);
    const row: ChannelRow = stored ? { ...defaultRow(key, currency), ...stored } : defaultRow(key, currency);
    const rec = recByKey.get(key);
    const mine = campaigns.filter((c) => c.channelId === row.id && row.id);
    const cpaRange = rec ? rec.cpa_range_minor : null;
    const cap = cpaRange?.high ?? row.form?.cpaMinor ?? null;
    return {
      ...row,
      fit: clampFit(rec?.fit ?? row.fit),
      recommended: rec ? rec.recommended : row.recommended,
      persisted: !!stored,
      stars: rec ? potentialStars(rec.potential) : potentialStars(row.potential),
      cpaRange,
      why: (rec?.why ?? row.whyMd ?? "").trim(),
      paused: channelPaused(row, mine),
      campaigns: mine,
      form5: weeklyForm(metrics.filter((m) => m.channelId === row.id && row.id), cap, today),
    };
  }).sort((a, b) => LINE_RANK[a.line] - LINE_RANK[b.line] || b.fit - a.fit || a.channelKey.localeCompare(b.channelKey));
}

const LINE_RANK: Record<ChannelLine, number> = { attack: 0, midfield: 1, defence: 2, wings: 3 };

/** A channel reads paused when its engine is on and every running campaign has been paused (no live or scheduled one left). */
export function channelPaused(row: Pick<ChannelRow, "enabled">, campaigns: readonly CampaignRow[]): boolean {
  if (!row.enabled) return false;
  const paused = campaigns.filter((c) => c.status === "paused").length;
  const running = campaigns.filter((c) => c.status === "live" || c.status === "scheduled").length;
  return paused > 0 && running === 0;
}

/* ---------- Form guide ---------- */

/** Monday of the ISO week that contains `day`, as a sortable key. */
function weekOf(day: string): string {
  return weekKey(day);
}

/**
 * Last five ISO weeks of CPA versus the cap (BUILD §11.7 token form guide), oldest first. `good` ≤ cap, `warn` within
 * 20 % above it, `bad` beyond; `none` for weeks without spend or customers, or when no cap is known.
 */
export function weeklyForm(rows: readonly ChannelMetricRow[], capMinor: number | null, today: string = new Date().toISOString().slice(0, 10)): FormCell[] {
  const weeks: string[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(weekOf(d.toISOString().slice(0, 10)));
  }
  const spend = new Map<string, number>();
  const customers = new Map<string, number>();
  for (const r of rows) {
    const w = weekOf(r.day);
    spend.set(w, (spend.get(w) ?? 0) + Number(r.spendMinor ?? 0));
    customers.set(w, (customers.get(w) ?? 0) + Number(r.customers ?? 0));
  }
  return weeks.map((w) => {
    const s = spend.get(w) ?? 0;
    const c = customers.get(w) ?? 0;
    if (!capMinor || capMinor <= 0 || s <= 0 || c <= 0) return "none";
    const cpa = s / c;
    if (cpa <= capMinor) return "good";
    if (cpa <= capMinor * 1.2) return "warn";
    return "bad";
  });
}

/* ---------- Formation tokens ---------- */

export interface TokenOptions {
  agents?: readonly AgentRow[];
  totalBudgetMinor?: number;
  departmentId?: string;
}

export function channelAgents(view: Pick<ChannelView, "ownerAgentId" | "channelKey">, agents: readonly AgentRow[] | undefined, departmentId?: string): AgentRow[] {
  if (!agents?.length) return [];
  const label = CHANNEL_META[view.channelKey].label.toLowerCase();
  const out: AgentRow[] = [];
  const owner = agents.find((a) => a.id === view.ownerAgentId);
  if (owner) out.push(owner);
  for (const a of agents) {
    if (out.includes(a)) continue;
    const inDept = !departmentId || !a.departmentIds?.length || a.departmentIds.includes(departmentId);
    if (inDept && a.role.toLowerCase().includes(label)) out.push(a);
  }
  return out;
}

export function toChannelToken(view: ChannelView, opts: TokenOptions = {}): ChannelTokenData {
  const agents = channelAgents(view, opts.agents, opts.departmentId).map((a) => ({
    name: a.name,
    seed: a.avatarSeed,
    dept: a.departments?.[0]?.colourToken ?? ("dept-3" as const),
    status: a.status,
  }));
  const total = opts.totalBudgetMinor ?? 0;
  const results = view.form ? summaryResults(view.form, view.currency) : [];
  return {
    key: view.channelKey,
    fit: view.fit,
    recommended: view.recommended,
    enabled: view.enabled,
    form: view.form5,
    potential: view.stars,
    cpaRange: view.cpaRange ? { low: { amountMinor: view.cpaRange.low, currency: view.currency }, high: { amountMinor: view.cpaRange.high, currency: view.currency } } : undefined,
    why: view.why || undefined,
    agents,
    budgetShare: total > 0 ? view.budgetMinor / total : undefined,
    paused: view.paused,
    results,
  };
}

export function summaryResults(form: ChannelSummaryRow, currency: string): Array<{ label: string; value: string }> {
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency }, { compact: Math.abs(minor) >= 1_000_000 });
  return [
    { label: "Leads (35 days)", value: String(form.leads) },
    { label: "Signups", value: String(form.signups) },
    { label: "Customers", value: String(form.customers) },
    { label: "Spend", value: money(form.spendMinor) },
    { label: "Cost per customer (Estimate)", value: form.cpaMinor === null ? "No customers yet" : money(form.cpaMinor) },
  ];
}

export function totalBudget(views: readonly Pick<ChannelView, "enabled" | "budgetMinor">[]): number {
  return views.filter((v) => v.enabled).reduce((n, v) => n + v.budgetMinor, 0);
}

/* ---------- Status ---------- */

export type ChannelStatusWord = "Running" | "Paused" | "Off the board" | "Not scored";

export function channelStatus(view: Pick<ChannelView, "enabled" | "paused" | "persisted">): { tone: "good" | "warn" | "neutral"; word: ChannelStatusWord } {
  if (view.enabled && view.paused) return { tone: "warn", word: "Paused" };
  if (view.enabled) return { tone: "good", word: "Running" };
  if (!view.persisted) return { tone: "neutral", word: "Not scored" };
  return { tone: "neutral", word: "Off the board" };
}

/* ---------- Guardrails (BUILD §11.7 table; shown in the channel profile under "Rules") ---------- */

export const CHANNEL_RULES: Record<ChannelKey, readonly string[]> = {
  lead_generation: ["Lawful basis recorded per country before outreach", "Suppression list checked on every send", "No cold email to EU consumers"],
  email_automation: ["Sending subdomain with SPF, DKIM and DMARC", "Warm-up before volume", "One-click unsubscribe on every message", "Auto-pause when the spam rate passes 0.3%"],
  seo: ["No link schemes or doorway pages", "Changes land through pull requests"],
  geo: ["No fake reviews or sock puppets", "Share-of-answer panels are labeled approximate"],
  content: ["Brand voice applied", "AI audio and video labeled where required", "Anything in the founder's name needs founder approval"],
  social: ["Brand accounts only", "Platform rate limits respected"],
  paid_ads: ["Daily and lifetime caps", "Pause when cost per customer stays above cap for 48 hours", "Policy pre-check and special-category detection before launch"],
  influencer: ["Disclosure checked before any payout approval", "Creator fees need approval"],
  affiliate: ["Commission caps", "Payouts need approval"],
  direct_mail: ["Postal rules per country", "Suppression list checked before printing"],
  print: ["Offline tracking: bookings go to a founder task", "Founder signs insertion orders"],
  broadcast: ["Offline tracking for linear buys", "Voice licenses recorded"],
  outdoor: ["Founder approves every booking"],
  pr: ["Never fabricate quotes", "Quotes in the founder's name need founder approval"],
  events: ["Founder approves sponsorship contracts"],
};

export const SHARED_RULES: readonly string[] = [`Any single commitment above the approval threshold, any contract and any message in the founder's name goes to the Inbox for a decision`];

export function approvalThresholdMinor(): number {
  return LIMITS.approvalThresholdMinorDefault;
}

/* ---------- Campaigns ---------- */

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["pending_approval", "scheduled", "ended"],
  pending_approval: ["draft", "scheduled", "live", "ended"],
  scheduled: ["live", "paused", "draft", "ended"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: [],
};

export const CAMPAIGN_STATUS_WORDS: Record<CampaignStatus, { word: string; tone: "good" | "warn" | "bad" | "info" | "neutral" }> = {
  draft: { word: "Draft", tone: "neutral" },
  pending_approval: { word: "Awaiting approval", tone: "warn" },
  scheduled: { word: "Scheduled", tone: "info" },
  live: { word: "Live", tone: "good" },
  paused: { word: "Paused", tone: "warn" },
  ended: { word: "Ended", tone: "neutral" },
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export interface AssetCounts {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  draft: number;
}

export function assetCounts(assets: readonly AssetRow[]): AssetCounts {
  const c: AssetCounts = { total: 0, approved: 0, pending: 0, rejected: 0, draft: 0 };
  for (const a of assets) {
    c.total += 1;
    c[a.approvalState] += 1;
  }
  return c;
}

/** Asset kinds as words ("print" → "Print artwork"). */
export const ASSET_KIND_WORD: Record<string, string> = { email: "Email", post: "Post", ad: "Ad", video: "Video", article: "Article", mailer: "Mailer", print: "Print artwork", script: "Script" };

export const APPROVAL_WORDS: Record<ApprovalState, { word: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { word: "Draft", tone: "neutral" },
  pending: { word: "Awaiting approval", tone: "warn" },
  approved: { word: "Approved", tone: "good" },
  rejected: { word: "Rejected", tone: "bad" },
};

/* ---------- Attribution ---------- */

export type AttributionModelKey = "position_based_40_20_40" | "data_driven_markov";

export const MODEL_LABELS: Record<AttributionModelKey, string> = { position_based_40_20_40: "Position-based 40/20/40", data_driven_markov: "Data-driven (Markov removal effect)" };

/** Position-based until the configured number of labelled wins, data-driven from then on (packages/journey `chooseModel`). */
export function modelInUse(winCount: number): { model: AttributionModelKey; threshold: number; remaining: number } {
  const threshold = LIMITS.attributionPositionBasedUntilConversions;
  const model: AttributionModelKey = winCount < threshold ? "position_based_40_20_40" : "data_driven_markov";
  return { model, threshold, remaining: Math.max(0, threshold - winCount) };
}

/** A journey is partial when consent removed touches: the builder's flag, or fewer weighted touches than touch ids, or no touches at all. */
export function isPartialJourney(row: Pick<JourneyRow, "touchIds" | "weights" | "partialJourney">): boolean {
  if (typeof row.partialJourney === "boolean") return row.partialJourney;
  if (!row.touchIds.length) return true;
  return Object.keys(row.weights ?? {}).length < row.touchIds.length;
}

export const OFFLINE_LINE: ChannelLine = "wings";

export interface AttributionRow {
  channelKey: ChannelKey;
  line: ChannelLine;
  enabled: boolean;
  impressions: number;
  leads: number;
  signups: number;
  activations: number;
  customers: number;
  spendMinor: number;
  cpaMinor: number | null;
  /** Share of measured customers, 0–1. */
  share: number;
  /** Offline channels are measured through codes and vanity URLs, so their journeys are always partial. */
  partial: boolean;
}

export function attributionRows(views: readonly ChannelView[], blended: BlendedSummary | undefined): AttributionRow[] {
  const total = blended?.customers ?? views.reduce((n, v) => n + (v.form?.customers ?? 0), 0);
  return views
    .filter((v) => v.form || v.enabled)
    .map((v) => ({
      channelKey: v.channelKey,
      line: v.line,
      enabled: v.enabled,
      impressions: v.form?.impressions ?? 0,
      leads: v.form?.leads ?? 0,
      signups: v.form?.signups ?? 0,
      activations: v.form?.activations ?? 0,
      customers: v.form?.customers ?? 0,
      spendMinor: v.form?.spendMinor ?? 0,
      cpaMinor: v.form?.cpaMinor ?? null,
      share: total > 0 ? (v.form?.customers ?? 0) / total : 0,
      partial: v.line === OFFLINE_LINE || !!v.kitMode,
    }))
    .sort((a, b) => b.customers - a.customers || b.leads - a.leads || a.channelKey.localeCompare(b.channelKey));
}

/**
 * The touch funnel. A middle stage that reads 0 while a later stage has volume is not measured by any channel yet
 * (no lead capture, say), so it is left out rather than drawn as a 0 % step. A middle stage smaller than the stage
 * after it is a side door, not a step (self-serve signups that never were leads), so it is left out too: a funnel
 * never shows a step above 100 %.
 */
export function funnelStages(blended: BlendedSummary | undefined): Array<{ label: string; value: number }> {
  const b = blended ?? { impressions: 0, leads: 0, signups: 0, activations: 0, customers: 0 };
  const stages = [
    { label: "Impressions", value: b.impressions },
    { label: "Leads", value: b.leads },
    { label: "Signups", value: b.signups },
    { label: "Activations", value: b.activations },
    { label: "Customers", value: b.customers },
  ];
  const measured = stages.filter((s, i) => s.value > 0 || i === 0 || i === stages.length - 1 || !stages.slice(i + 1).some((later) => later.value > 0));
  return measured.filter((s, i) => i === 0 || i === measured.length - 1 || s.value >= (measured[i + 1]?.value ?? 0));
}

/* ---------- Leads ---------- */

export const LAWFUL_BASES: readonly { value: string; label: string }[] = [
  { value: "consent", label: "Consent" },
  { value: "contract", label: "Contract" },
  { value: "legitimate_interest", label: "Legitimate interest" },
  { value: "legal_obligation", label: "Legal obligation" },
  { value: "b2b_soft_opt_in", label: "B2B soft opt-in" },
];

export function lawfulBasisLabel(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return LAWFUL_BASES.find((b) => b.value === value)?.label ?? value.replace(/_/g, " ");
}

export interface SuppressionInfo {
  suppressed: boolean;
  reason: string | null;
}

/** Engines write `suppressed` / `suppression_reason` into the entity identifiers; a role stage of "suppressed" counts too. */
export function suppressionOf(lead: { identifiers?: Record<string, unknown>; role?: { stage: string | null } }): SuppressionInfo {
  const ids = lead.identifiers ?? {};
  const flag = ids["suppressed"];
  const reason = typeof ids["suppression_reason"] === "string" ? (ids["suppression_reason"] as string) : null;
  const byFlag = flag === true || flag === "true" || flag === 1;
  const byStage = (lead.role?.stage ?? "").toLowerCase() === "suppressed";
  return { suppressed: byFlag || byStage || !!reason, reason };
}
