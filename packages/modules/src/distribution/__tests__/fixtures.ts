/** Deterministic fixtures for the distribution screens (Northwind Botanics, a skincare brand on EUR). */
import type { ChannelKey } from "@foundmill/shared";
import { addDays, dayKey, weekKey } from "@foundmill/widgets";
import type { AgentRow, AssetRow, CampaignRow, ChannelMetricRow, ChannelRow, ChannelsListResponse, JourneyRow, LeadRow, RecommendResponse } from "../types";

export const BID = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number, block = "a") => `${block}${block}${block}${block}${block}${block}${block}${block}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const AGENT = { mara: uuid(1, "e"), otis: uuid(2, "e") };
export const CHANNEL = { paid: uuid(1, "c"), social: uuid(2, "c"), email: uuid(3, "c"), seo: uuid(4, "c"), content: uuid(5, "c"), print: uuid(6, "c") };
export const CAMPAIGN = { launch: uuid(1, "d"), spring: uuid(2, "d"), welcome: uuid(3, "d") };
export const ASSET = { ad: uuid(1, "f"), post: uuid(2, "f"), email: uuid(3, "f"), video: uuid(4, "f") };
export const LEAD = { anna: uuid(1, "b"), bo: uuid(2, "b"), cai: uuid(3, "b") };
export const JOURNEY = { first: uuid(1, "9"), second: uuid(2, "9"), third: uuid(3, "9") };
export const TODAY = dayKey();

const summary = (channelId: string, channelKey: ChannelKey, line: ChannelRow["line"], spendMinor: number, leads: number, signups: number, customers: number) => ({
  channelId,
  channelKey,
  line,
  spendMinor,
  impressions: leads * 40,
  leads,
  signups,
  activations: Math.round(signups * 0.6),
  customers,
  cpaMinor: customers > 0 ? Math.round(spendMinor / customers) : null,
  days: 35,
});

const channel = (id: string, channelKey: ChannelKey, line: ChannelRow["line"], extra: Partial<ChannelRow>): ChannelRow => ({
  id,
  channelKey,
  enabled: false,
  line,
  fit: 10,
  potential: 60,
  recommended: false,
  whyMd: "",
  scoredAt: "2026-10-01T09:00:00.000Z",
  budgetMinor: 0,
  currency: "EUR",
  kitMode: false,
  ownerAgentId: null,
  form: null,
  ...extra,
});

export const channels: ChannelRow[] = [
  channel(CHANNEL.paid, "paid_ads", "attack", { enabled: true, fit: 17, potential: 80, recommended: true, whyMd: "Paid social finds skincare buyers fast. Creative already exists. Cost per customer sits inside the runway budget.", budgetMinor: 120000, ownerAgentId: AGENT.mara, form: summary(CHANNEL.paid, "paid_ads", "attack", 90000, 240, 60, 30), meta: { label: "Paid advertising", line: "attack", coreMetric: "CPA" } }),
  channel(CHANNEL.social, "social", "midfield", { enabled: true, fit: 16, potential: 80, recommended: true, budgetMinor: 40000, ownerAgentId: AGENT.otis, form: summary(CHANNEL.social, "social", "midfield", 20000, 120, 30, 10), meta: { label: "Social media", line: "midfield", coreMetric: "Engaged followers, clicks" } }),
  channel(CHANNEL.email, "email_automation", "midfield", { enabled: true, fit: 14, potential: 60, recommended: true, budgetMinor: 20000, form: summary(CHANNEL.email, "email_automation", "midfield", 5000, 80, 40, 8), meta: { label: "Email automation", line: "midfield", coreMetric: "Reply/conversion rate" } }),
  channel(CHANNEL.seo, "seo", "defence", { enabled: false, fit: 11, potential: 60, recommended: false, meta: { label: "SEO", line: "defence", coreMetric: "Organic signups" } }),
  channel(CHANNEL.content, "content", "defence", { enabled: false, fit: 12, potential: 60, recommended: false, meta: { label: "Content marketing", line: "defence", coreMetric: "Leads from content" } }),
  channel(CHANNEL.print, "print", "wings", { enabled: true, fit: 6, potential: 40, recommended: false, kitMode: true, budgetMinor: 15000, form: summary(CHANNEL.print, "print", "wings", 15000, 10, 4, 2), meta: { label: "Print", line: "wings", coreMetric: "Code redemptions" } }),
];

export const channelsList: ChannelsListResponse = {
  channels,
  lines: { attack: ["paid_ads"], midfield: ["social", "email_automation"], defence: ["seo", "content"], wings: ["print"] },
  blended: { spendMinor: 130000, impressions: 18000, leads: 450, signups: 134, activations: 80, customers: 50, cpaMinor: 2600, days: 35 },
};

export const channelsEmpty: ChannelsListResponse = { channels: [], lines: { attack: [], midfield: [], defence: [], wings: [] }, blended: { spendMinor: 0, impressions: 0, leads: 0, signups: 0, activations: 0, customers: 0, cpaMinor: null, days: 0 } };

/** Five ISO weeks of daily paid-ads metrics: weeks 1–3 under a 3,000 cap, week 4 near it, week 5 (this week) over it. */
const WEEK_KEYS = Array.from({ length: 5 }, (_, i) => weekKey(addDays(TODAY, -(4 - i) * 7)));
export const metrics: ChannelMetricRow[] = Array.from({ length: 42 }, (_, i) => {
  const day = addDays(TODAY, -(41 - i));
  const idx = WEEK_KEYS.indexOf(weekKey(day));
  const cpa = idx < 0 ? 2000 : [2000, 2200, 2400, 3300, 4200][idx]!;
  return { channelId: CHANNEL.paid, day, spendMinor: cpa * 2, customers: 2, impressions: 800, leads: 7, signups: 2, activations: 1, cpaMinor: cpa };
});

export const recommendResponse: RecommendResponse = {
  channels,
  recommendation: [
    { channel: "paid_ads", fit: 18, potential: 4, recommended: true, cpa_range_minor: { low: 1800, high: 3000 }, why: "Paid social finds skincare buyers fast." },
    { channel: "social", fit: 16, potential: 4, recommended: true, cpa_range_minor: { low: 1200, high: 2600 }, why: "Brand accounts already have a following." },
    { channel: "email_automation", fit: 14, potential: 3, recommended: true, cpa_range_minor: { low: 300, high: 900 }, why: "Lifecycle email is cheap and fast." },
    { channel: "seo", fit: 11, potential: 3, recommended: false, cpa_range_minor: { low: 900, high: 2400 }, why: "Slow to signal." },
    { channel: "content", fit: 12, potential: 3, recommended: false, cpa_range_minor: { low: 900, high: 2400 }, why: "Useful later." },
    { channel: "print", fit: 6, potential: 2, recommended: false, cpa_range_minor: { low: 4000, high: 9000 }, why: "Expensive at this stage." },
    ...(["lead_generation", "geo", "influencer", "affiliate", "direct_mail", "broadcast", "outdoor", "pr", "events"] as ChannelKey[]).map((channel) => ({ channel, fit: 5, potential: 1, recommended: false, cpa_range_minor: { low: 3000, high: 8000 }, why: "Not a fit yet." })),
  ],
  cpaLabel: "Estimate",
};

export const campaigns: CampaignRow[] = [
  { id: CAMPAIGN.launch, channelId: CHANNEL.paid, name: "Launch week on Meta", goal: "Reach 2,000 skincare shoppers in Berlin and Hamburg and win 40 first orders.", status: "live", budgetMinor: 60000, currency: "EUR", startsAt: `${addDays(TODAY, -10)}T09:00:00.000Z`, endsAt: `${addDays(TODAY, 20)}T09:00:00.000Z`, config: {} },
  { id: CAMPAIGN.spring, channelId: CHANNEL.social, name: "Spring routine series", goal: "Six posts on the morning routine.", status: "paused", budgetMinor: 10000, currency: "EUR", startsAt: `${addDays(TODAY, -4)}T09:00:00.000Z`, endsAt: null, config: {} },
  { id: CAMPAIGN.welcome, channelId: CHANNEL.email, name: "Welcome sequence", goal: "Three onboarding emails after signup.", status: "draft", budgetMinor: 0, currency: "EUR", startsAt: null, endsAt: null, config: {} },
];

export const assets: AssetRow[] = [
  { id: ASSET.ad, campaignId: CAMPAIGN.launch, kind: "ad", title: "Glow serum carousel", contentRef: "https://assets.example.com/ad-1", approvalState: "pending", authoredByAgentId: AGENT.mara, createdAt: `${addDays(TODAY, -2)}T08:00:00.000Z` },
  { id: ASSET.post, campaignId: CAMPAIGN.spring, kind: "post", title: "Morning routine, day one", contentRef: null, approvalState: "approved", authoredByAgentId: AGENT.otis, createdAt: `${addDays(TODAY, -5)}T08:00:00.000Z` },
  { id: ASSET.email, campaignId: CAMPAIGN.welcome, kind: "email", title: "Welcome to Northwind", contentRef: "drive://welcome-1", approvalState: "draft", authoredByAgentId: null, createdAt: `${addDays(TODAY, -1)}T08:00:00.000Z` },
  { id: ASSET.video, campaignId: CAMPAIGN.launch, kind: "video", title: "Founder story 30s", contentRef: null, approvalState: "rejected", authoredByAgentId: AGENT.mara, createdAt: `${addDays(TODAY, -3)}T08:00:00.000Z` },
];

export const agents: AgentRow[] = [
  { id: AGENT.mara, name: "Mara", role: "Paid advertising engine", status: "healthy", avatarSeed: "mara", departmentIds: ["d1"], departments: [{ id: "d1", name: "Distribution", colourToken: "dept-3" }] },
  { id: AGENT.otis, name: "Otis", role: "Social media engine", status: "idle", avatarSeed: "otis", departmentIds: ["d1"], departments: [{ id: "d1", name: "Distribution", colourToken: "dept-3" }] },
];

const leadRole = (id: string, entityId: string, stage: string | null, ownerId: string | null, startedAt: string) => ({ id, entityId, role: "lead", stage, ownerRef: ownerId ? { kind: "agent" as const, id: ownerId } : null, startedAt, endedAt: null });

export const leads: LeadRow[] = [
  { id: LEAD.anna, kind: "person", displayName: "Anna Lindqvist", identifiers: { email: "anna@lumen.se", company: "Lumen Studio" }, lawfulBasis: "legitimate_interest", source: "apollo", role: leadRole(uuid(1, "7"), LEAD.anna, "new", AGENT.mara, `${addDays(TODAY, -1)}T10:00:00.000Z`) },
  { id: LEAD.bo, kind: "person", displayName: "Bo Nakamura", identifiers: { email: "bo@kintsugi.jp", domain: "kintsugi.jp" }, lawfulBasis: null, source: "event", role: leadRole(uuid(2, "7"), LEAD.bo, "contacted", null, `${addDays(TODAY, -3)}T10:00:00.000Z`) },
  { id: LEAD.cai, kind: "person", displayName: "Cai Oduya", identifiers: { email: "cai@example.eu", suppressed: true, suppression_reason: "Unsubscribed 2026-09-30" }, lawfulBasis: "consent", source: "newsletter", role: leadRole(uuid(3, "7"), LEAD.cai, "suppressed", AGENT.otis, `${addDays(TODAY, -9)}T10:00:00.000Z`) },
];

export const journeys: JourneyRow[] = [
  { id: JOURNEY.first, conversionId: uuid(1, "6"), touchIds: [uuid(1, "5"), uuid(2, "5"), uuid(3, "5")], weights: { [uuid(1, "5")]: 0.4, [uuid(2, "5")]: 0.2, [uuid(3, "5")]: 0.4 }, matchdayLevel: "cup", createdAt: `${addDays(TODAY, -1)}T12:00:00.000Z`, conversion: { id: uuid(1, "6"), entityId: LEAD.anna, kind: "payment", amountMinor: 4900, currency: "EUR", occurredAt: `${addDays(TODAY, -1)}T12:00:00.000Z` } },
  { id: JOURNEY.second, conversionId: uuid(2, "6"), touchIds: [uuid(4, "5"), uuid(5, "5")], weights: { [uuid(4, "5")]: 1 }, matchdayLevel: "cup", createdAt: `${addDays(TODAY, -6)}T12:00:00.000Z`, conversion: { id: uuid(2, "6"), entityId: LEAD.bo, kind: "payment", amountMinor: 8900, currency: "EUR", occurredAt: `${addDays(TODAY, -6)}T12:00:00.000Z` } },
  { id: JOURNEY.third, conversionId: uuid(3, "6"), touchIds: [uuid(6, "5")], weights: { [uuid(6, "5")]: 1 }, matchdayLevel: "friendly", createdAt: `${addDays(TODAY, -2)}T12:00:00.000Z`, conversion: { id: uuid(3, "6"), entityId: null, kind: "signup", amountMinor: 0, currency: "EUR", occurredAt: `${addDays(TODAY, -2)}T12:00:00.000Z` } },
];

export const departments = [{ id: "d1", name: "Distribution", slug: "distribution", colourToken: "dept-3", position: 0, moduleKeys: ["distribution"], lead: null, squad: [], tabs: [{ id: "t1", slug: "formation", title: "Formation", position: 0 }, { id: "t2", slug: "channels", title: "Channels", position: 1 }, { id: "t3", slug: "creative", title: "Creative", position: 4 }] }];

export const dataResponses: Record<string, unknown> = {
  "distribution.channels.list": channelsList,
  "distribution.channels.metrics": metrics,
  "distribution.campaigns.list": { items: campaigns, nextCursor: null },
  "distribution.assets.list": assets,
  "team.agents.list": agents,
  "department.list": departments,
  "crm.roles.byRole": { items: leads, nextCursor: null },
  "journey.list": { items: journeys, nextCursor: null },
};

export const emptyResponses: Record<string, unknown> = {
  "distribution.channels.list": channelsEmpty,
  "distribution.channels.metrics": [],
  "distribution.campaigns.list": { items: [], nextCursor: null },
  "distribution.assets.list": [],
  "team.agents.list": [],
  "department.list": departments,
  "crm.roles.byRole": { items: [], nextCursor: null },
  "journey.list": { items: [], nextCursor: null },
};
