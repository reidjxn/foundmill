/**
 * Seeded demo data for the data-group stories and tests (Northwind Skincare, BUILD §17.2). Deterministic; no network.
 * Not exported from the package barrel.
 */
import { Bot, Building2, Inbox, LineChart, ListChecks, Trophy, Users } from "lucide-react";
import type { ChannelKey, EntityKind, SkillGroup } from "@foundmill/shared";
import { createRng, seededUuid } from "../../lib/seed";
import type {
  AttributeRow,
  EntityDetails,
  SavedView,
  SkillRow,
  WidgetLayout,
  WidgetPreset,
  WidgetRegistryEntry,
} from "./types";

export const FIXTURE_NOW = new Date("2026-10-07T09:30:00Z");

// ---------------------------------------------------------------------------------------------------------------------
// Leads table
// ---------------------------------------------------------------------------------------------------------------------

export const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Quote sent",
  won: "Won",
  lost: "Lost",
};

export interface LeadRow {
  id: string;
  name: string;
  company: string;
  stage: LeadStage;
  owner: string;
  ownerKind: "agent" | "team_member";
  channel: ChannelKey;
  score: number;
  value: { amountMinor: number; currency: string };
  lastContact: Date;
  country: string;
  email: string;
  replied: boolean;
}

const FIRST = [
  "Sara",
  "Tomas",
  "Amara",
  "Jonas",
  "Linnea",
  "Mikael",
  "Freja",
  "Oskar",
  "Ines",
  "Hugo",
  "Maja",
  "Elias",
  "Nour",
  "Vera",
  "Leo",
  "Astrid",
  "Noah",
  "Alma",
  "Emil",
  "Ebba",
];
const LAST = [
  "Lindqvist",
  "Berg",
  "Okafor",
  "Nilsson",
  "Holm",
  "Andersson",
  "Dahl",
  "Ek",
  "Svensson",
  "Lund",
  "Falk",
  "Åberg",
  "Haddad",
  "Strand",
  "Blom",
  "Nyström",
  "Sandberg",
  "Vik",
  "Moberg",
  "Rask",
];
const COMPANIES = [
  "Nordic Beauty AB",
  "Meridian Labs",
  "Kalla Apotek",
  "Luma Retail",
  "Fjord Wellness",
  "Birch & Co",
  "Aurora Spa Group",
  "Saltwater Studio",
  "Granit Pharmacy",
  "Pure North",
  "Linden Boutique",
  "Harbour Hotels",
  "Tundra Outfitters",
  "Velvet Rooms",
  "Klar Skincare",
];
const OWNERS: Array<{ name: string; kind: "agent" | "team_member" }> = [
  { name: "Scout", kind: "agent" },
  { name: "Mailer", kind: "agent" },
  { name: "Reid Jackson", kind: "team_member" },
  { name: "Signal", kind: "agent" },
];
const CHANNELS: ChannelKey[] = [
  "lead_generation",
  "email_automation",
  "seo",
  "paid_ads",
  "influencer",
  "events",
  "pr",
  "content",
];
const COUNTRIES = ["SE", "NO", "DK", "FI", "DE", "NL", "GB"];

export function generateLeads(count: number, seed = "leads"): LeadRow[] {
  const rng = createRng(seed);
  const out: LeadRow[] = [];
  for (let i = 0; i < count; i++) {
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const company = rng.pick(COMPANIES);
    const owner = rng.pick(OWNERS);
    const stage = rng.pick([...LEAD_STAGES]);
    const daysAgo = rng.int(0, 120);
    out.push({
      id: seededUuid(rng),
      name: `${first} ${last}`,
      company,
      stage,
      owner: owner.name,
      ownerKind: owner.kind,
      channel: rng.pick(CHANNELS),
      score: rng.int(1, 20),
      value: { amountMinor: rng.int(20, 2400) * 1000, currency: "EUR" },
      lastContact: new Date(FIXTURE_NOW.getTime() - daysAgo * 86_400_000 - rng.int(0, 86_400_000)),
      country: rng.pick(COUNTRIES),
      email: `${first}.${last}@${company.toLowerCase().replace(/[^a-z]+/g, "")}.example`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
      replied: rng.bool(0.35),
    });
  }
  return out;
}

export const LEAD_VIEWS: SavedView[] = [
  {
    id: "all",
    name: "All leads",
    columns: [
      "name",
      "company",
      "stage",
      "owner",
      "channel",
      "score",
      "value",
      "lastContact",
      "country",
    ],
    sort: [{ id: "lastContact", desc: true }],
    filters: [],
    builtIn: true,
  },
  {
    id: "hot",
    name: "Hot this week",
    columns: ["name", "company", "stage", "score", "value", "lastContact"],
    sort: [
      { id: "score", desc: true },
      { id: "value", desc: true },
    ],
    filters: [
      { id: "f1", field: "stage", op: "in", value: ["qualified", "proposal"] },
      { id: "f2", field: "score", op: "gte", value: 14 },
    ],
  },
  {
    id: "scout",
    name: "Scout's pipeline",
    columns: ["name", "company", "stage", "channel", "value", "lastContact"],
    sort: [{ id: "value", desc: true }],
    filters: [{ id: "f3", field: "owner", op: "eq", value: "Scout" }],
    density: "comfortable",
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------------------------------

export const ENTITY_IDS = {
  sara: "0f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a40",
  tomas: "1a2b3c4d-5e6f-4a70-9b8c-0d1e2f3a4b51",
  nordic: "2b3c4d5e-6f70-4b81-8c9d-1e2f3a4b5c62",
  meridian: "3c4d5e6f-7081-4c92-9dae-2f3a4b5c6d73",
  scout: "4d5e6f70-8192-4da3-8ebf-3a4b5c6d7e84",
  ledger: "5e6f7081-92a3-4eb4-9fc0-4b5c6d7e8f95",
  reid: "6f708192-a3b4-4fc5-8ad1-5c6d7e8f90a6",
  amara: "7081a2b3-b4c5-40d6-9be2-6d7e8f90a1b7",
} as const;

export const ENTITY_DETAILS: Record<string, EntityDetails> = {
  [ENTITY_IDS.sara]: {
    id: ENTITY_IDS.sara,
    kind: "person",
    name: "Sara Lindqvist",
    subtitle: "Head of buying · Nordic Beauty AB",
    href: "#crm/sara",
    portrait: { type: "person" },
    chips: [
      { label: "Buyer", tone: "info" },
      { label: "Warm", tone: "good" },
    ],
    facts: [
      { label: "Relationship", value: "14 / 20" },
      { label: "Last contact", value: "2 days ago" },
      { label: "Owner", value: "Scout" },
    ],
  },
  [ENTITY_IDS.tomas]: {
    id: ENTITY_IDS.tomas,
    kind: "person",
    name: "Tomas Berg",
    subtitle: "Founder · Meridian Labs",
    href: "#crm/tomas",
    portrait: { type: "person" },
    chips: [{ label: "Supplier", tone: "neutral" }],
    facts: [
      { label: "Relationship", value: "11 / 20" },
      { label: "Open quotes", value: "2" },
      { label: "Owner", value: "Reid Jackson" },
    ],
  },
  [ENTITY_IDS.nordic]: {
    id: ENTITY_IDS.nordic,
    kind: "organisation",
    name: "Nordic Beauty AB",
    subtitle: "Retailer · Stockholm",
    href: "#crm/nordic",
    portrait: { type: "logo", primary: "#1F6F5F", monogram: "NB" },
    chips: [
      { label: "Retailer", tone: "info" },
      { label: "Quote sent", tone: "warn" },
    ],
    facts: [
      { label: "Open deals", value: "€48,000" },
      { label: "Stores", value: "23" },
      { label: "Contacts", value: "4" },
    ],
  },
  [ENTITY_IDS.meridian]: {
    id: ENTITY_IDS.meridian,
    kind: "organisation",
    name: "Meridian Labs",
    subtitle: "Contract manufacturer · Malmö",
    href: "#crm/meridian",
    portrait: { type: "logo", primary: "#2B6CB0", monogram: "ML" },
    chips: [{ label: "Supplier", tone: "neutral" }],
    facts: [
      { label: "Lead time", value: "12 days" },
      { label: "MOQ", value: "1,000" },
      { label: "On-time", value: "96%" },
    ],
  },
  [ENTITY_IDS.scout]: {
    id: ENTITY_IDS.scout,
    kind: "agent",
    name: "Scout",
    subtitle: "Distribution lead · Sonnet",
    href: "#agents/scout",
    portrait: { type: "agent", seed: "scout", dept: "dept-3", status: "healthy" },
    chips: [
      { label: "Lead", tone: "dept-3" },
      { label: "sonnet", tone: "ink" },
    ],
    facts: [
      { label: "Rating", value: "14" },
      { label: "Tasks", value: "42" },
      { label: "Status", value: "Healthy" },
    ],
  },
  [ENTITY_IDS.ledger]: {
    id: ENTITY_IDS.ledger,
    kind: "agent",
    name: "Ledger",
    subtitle: "Finance lead · Opus",
    href: "#agents/ledger",
    portrait: { type: "agent", seed: "ledger", dept: "dept-4", status: "paused" },
    chips: [
      { label: "Lead", tone: "dept-4" },
      { label: "opus", tone: "ink" },
    ],
    facts: [
      { label: "Rating", value: "16" },
      { label: "Tasks", value: "18" },
      { label: "Status", value: "Paused" },
    ],
  },
  [ENTITY_IDS.reid]: {
    id: ENTITY_IDS.reid,
    kind: "team_member",
    name: "Reid Jackson",
    subtitle: "Founder",
    href: "#team/reid",
    portrait: { type: "person" },
    chips: [{ label: "Owner", tone: "kit" }],
    facts: [
      { label: "Role", value: "Founder" },
      { label: "Departments", value: "All" },
      { label: "Since", value: "Jan 2026" },
    ],
  },
  [ENTITY_IDS.amara]: {
    id: ENTITY_IDS.amara,
    kind: "person",
    name: "Amara Okafor",
    subtitle: "Creator · 42k followers",
    href: "#crm/amara",
    portrait: { type: "person" },
    chips: [{ label: "Influencer", tone: "dept-8" }],
    facts: [
      { label: "Reach", value: "42,000" },
      { label: "Rate", value: "€1,200" },
      { label: "Owner", value: "Scout" },
    ],
  },
};

export function resolveFixtureEntity(id: string): EntityDetails | undefined {
  return ENTITY_DETAILS[id];
}

// plain-allow: "Ledger" here is the Finance lead's name, not the word.
const LEDGER_MENTION = `[[ent:${ENTITY_IDS.ledger}|Ledger]]`;

export const NOTE_WITH_MARKUP = `[[ent:${ENTITY_IDS.scout}|Scout]] closed the loop with [[ent:${ENTITY_IDS.sara}|Sara Lindqvist]] at [[ent:${ENTITY_IDS.nordic}|Nordic Beauty AB]]: they want 23 stores stocked before the holiday season, which means a reorder from [[ent:${ENTITY_IDS.meridian}|Meridian Labs]] by Friday. ${LEDGER_MENTION} has checked the cash position.`;

export const NOTE_MARKDOWN = `## Nordic Beauty wants the full range

[[ent:${ENTITY_IDS.scout}|Scout]] closed the loop with [[ent:${ENTITY_IDS.sara}|Sara Lindqvist]] at [[ent:${ENTITY_IDS.nordic}|Nordic Beauty AB]]. They want **23 stores** stocked before the holiday season, which means a reorder from [[ent:${ENTITY_IDS.meridian}|Meridian Labs]] by Friday.

- Reorder size: 2,000 units (covers 9 weeks at the current run rate)
- Unit cost at 2,000: €9.20, at 1,000: €9.94
- ${LEDGER_MENTION} confirms the cash position allows it

| Option | Units | Cost | Covers |
| --- | ---: | ---: | ---: |
| A (recommended) | 2,000 | €18,400 | 9 weeks |
| B | 1,000 | €9,940 | 4 weeks |

> Meridian's lead time is 12 days; after Friday the next slot is in November.

Sources: [supplier quote](https://example.com/quote), interview notes.`;

// ---------------------------------------------------------------------------------------------------------------------
// Skills and attributes
// ---------------------------------------------------------------------------------------------------------------------

function skill(
  id: string,
  name: string,
  group: SkillGroup,
  value: number,
  extra: Partial<SkillRow> = {},
): SkillRow {
  return {
    id,
    name,
    group,
    value,
    tested: Math.max(1, value - 1),
    proven: Math.min(20, value + 1),
    tasks: value * 3,
    potential: Math.min(20, value + 3),
    ...extra,
  };
}

/** Backend engineer (BUILD §11.10 craft table). */
export const BACKEND_SKILLS: SkillRow[] = [
  skill("api", "API design", "craft", 15, { delta: 2 }),
  skill("data", "Data modeling", "craft", 13, { delta: 0 }),
  skill("testing", "Testing", "craft", 17, { delta: 1 }),
  skill("debug", "Debugging", "craft", 12, { delta: -2 }),
  skill("sec", "Security awareness", "craft", 9, { delta: 1 }),
  skill("perf", "Performance", "craft", 7, { delta: -1 }),
  skill("plan", "Planning", "judgement", 14, { delta: 1 }),
  skill("scope", "Scope control", "judgement", 11, { delta: 0 }),
  skill("prio", "Prioritization", "judgement", 12, { delta: 3 }),
  skill("risk", "Risk awareness", "judgement", 16, { delta: 0 }),
  skill("ask", "Knowing when to ask", "judgement", 18, { delta: 1 }),
  skill("speed", "Speed", "execution", 13, { delta: -1 }),
  skill("rel", "Reliability", "execution", 15, { delta: 2 }),
  skill("tool", "Tool use", "execution", 14, { delta: 0 }),
  skill("cost", "Cost efficiency", "execution", 10, { delta: -3 }),
  skill("comm", "Communication", "execution", 4, { delta: 0, note: "Custom" }),
];

export const CONCEPT_ATTRIBUTES: AttributeRow[] = [
  {
    id: "market",
    name: "Market size",
    value: 14,
    compare: 11,
    hint: "How many people or businesses could pay for it. Higher means a bigger market.",
    evidence: {
      summary: "Nordic premium skincare grew 11% last year; 2.1M addressable households.",
      sources: ["Euromonitor 2025", "SCB household survey"],
      provenance: "estimate",
    },
  },
  {
    id: "urgency",
    name: "Customer urgency",
    value: 9,
    compare: 13,
    evidence: "Interviewees mentioned the problem unprompted in 4 of 12 calls.",
  },
  {
    id: "margin",
    name: "Gross margin",
    value: 16,
    compare: 12,
    evidence: { summary: "Landed cost €9.20 against a €39 retail price.", provenance: "forecast" },
  },
  {
    id: "moat",
    name: "Defensibility",
    value: 6,
    compare: 8,
    hint: "How hard it is for others to copy. Higher means harder to copy.",
    evidence: "Formulation is replicable; brand and retail relationships are the moat.",
  },
  {
    id: "speed",
    name: "Time to first sale",
    value: 17,
    compare: 10,
    evidence: "Shopify store plus a first batch is 6 weeks away.",
  },
  {
    id: "capital",
    name: "Capital needed",
    value: 12,
    compare: 15,
    evidence: { summary: "€40k to first batch and launch campaign.", provenance: "estimate" },
  },
  {
    id: "fit",
    name: "Founder fit",
    value: 18,
    compare: 9,
    evidence: "Five years in beauty retail buying; existing supplier relationships.",
  },
  // A hint without evidence: the label still explains itself on hover and focus.
  { id: "channel", name: "Channel access", value: 13, compare: 7, hint: "How clear the path to the first customers is. Higher means a clearer path." },
  {
    id: "regulatory",
    name: "Regulatory load",
    value: 8,
    compare: 14,
    hint: "How much regulation applies. Higher means fewer rules to deal with.",
    evidence: "EU CPNP notification and a safety assessment per product.",
  },
  { id: "timing", name: "Timing", value: 15, compare: 15 },
];

// ---------------------------------------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------------------------------------

export const SPEC_ORIGINAL = `## Pricing

Retail price €39 per 50 ml.
Wholesale price €19.50 (50% of retail).
Minimum order for retailers: 24 units.
Subscription discount: 10%.

## Packaging

Glass bottle with pump, recyclable carton.
Label printed in Sweden.
`;

export const SPEC_PROPOSED = `## Pricing

Retail price €42 per 50 ml.
Wholesale price €21 (50% of retail).
Minimum order for retailers: 24 units.
Subscription discount: 15% for the first three months, then 10%.
Introductory bundle: serum + cleanser at €69.

## Packaging

Glass bottle with pump, recyclable carton.
Label printed in Sweden.
Carton carries the CPNP reference number.
`;

export const SPEC_BASE = `## Pricing

Retail price €39 per 50 ml.
Wholesale price €19.50 (50% of retail).
Minimum order for retailers: 12 units.
Subscription discount: 10%.

## Packaging

Glass bottle with pump, recyclable carton.
Label printed in Sweden.
`;

// ---------------------------------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------------------------------

export const DEMO_WIDGET_REGISTRY: WidgetRegistryEntry[] = [
  {
    key: "journey_ribbon",
    title: "Journey Ribbon",
    description: "Two years of agent work and revenue as a river.",
    icon: LineChart,
    defaultSize: { w: 12, h: 38 },
    minSize: { w: 6, h: 20 },
    single: true,
    render: () => null,
  },
  {
    key: "status_strip",
    title: "Status strip",
    description: "Cash, months of cash left, revenue, customers, health.",
    icon: Trophy,
    defaultSize: { w: 12, h: 12 },
    minSize: { w: 6, h: 10 },
    render: () => null,
  },
  {
    key: "department_card",
    title: "Department card",
    description: "Lead, team, headline metric and next up.",
    icon: Users,
    defaultSize: { w: 4, h: 30 },
    minSize: { w: 3, h: 20 },
    settings: [
      {
        key: "department",
        label: "Department",
        kind: "select",
        options: [
          { value: "product", label: "Product" },
          { value: "distribution", label: "Distribution" },
          { value: "finance", label: "Finance" },
        ],
      },
    ],
    defaultSettings: { department: "distribution" },
    render: () => null,
  },
  {
    key: "inbox_preview",
    title: "Inbox preview",
    description: "The next four items.",
    icon: Inbox,
    defaultSize: { w: 4, h: 30 },
    minSize: { w: 3, h: 16 },
    settings: [
      { key: "rows", label: "Rows", kind: "number", min: 2, max: 8 },
      { key: "unreadOnly", label: "Unread only", kind: "boolean" },
    ],
    defaultSettings: { rows: 4, unreadOnly: false },
    render: () => null,
  },
  {
    key: "squad_pulse",
    title: "Team pulse",
    description: "Agent activity by hour and department, last 7 days.",
    icon: Bot,
    defaultSize: { w: 8, h: 30 },
    minSize: { w: 6, h: 20 },
    render: () => null,
  },
  {
    key: "custom_metric",
    title: "Custom metric",
    description: "A saved question, or a sentence turned into a read-only query.",
    icon: ListChecks,
    defaultSize: { w: 3, h: 12 },
    minSize: { w: 3, h: 10 },
    settings: [
      { key: "title", label: "Title", kind: "text", placeholder: "Returning customers" },
      {
        key: "query",
        label: "Query or sentence",
        kind: "text",
        hint: "Read-only SQL against business-scoped views, or a sentence Haiku compiles.",
      },
    ],
    render: () => null,
  },
  {
    key: "community_feed",
    title: "Community feed",
    description: "LIVE only.",
    icon: Building2,
    defaultSize: { w: 4, h: 24 },
    hidden: true,
    render: () => null,
  },
];

export const FOUNDERS_VIEW_LAYOUT: WidgetLayout = [
  { i: "ribbon", widget: "journey_ribbon", x: 0, y: 0, w: 12, h: 38, minW: 6, minH: 20 },
  { i: "strip", widget: "status_strip", x: 0, y: 38, w: 12, h: 12, minW: 6, minH: 10 },
  {
    i: "dept-product",
    widget: "department_card",
    x: 0,
    y: 50,
    w: 4,
    h: 30,
    settings: { department: "product" },
  },
  {
    i: "dept-dist",
    widget: "department_card",
    x: 4,
    y: 50,
    w: 4,
    h: 30,
    settings: { department: "distribution" },
  },
  {
    i: "dept-fin",
    widget: "department_card",
    x: 8,
    y: 50,
    w: 4,
    h: 30,
    settings: { department: "finance" },
  },
  { i: "pulse", widget: "squad_pulse", x: 0, y: 80, w: 8, h: 30 },
  { i: "inbox", widget: "inbox_preview", x: 8, y: 80, w: 4, h: 30, settings: { rows: 4 } },
];

export const WIDGET_PRESETS: WidgetPreset[] = [
  {
    id: "founder",
    name: "Founder's view",
    description: "Ribbon, status strip, department cards, pulse, Inbox.",
    layout: FOUNDERS_VIEW_LAYOUT,
  },
  {
    id: "builder",
    name: "Builder",
    description: "Product and development first.",
    layout: [
      { i: "strip", widget: "status_strip", x: 0, y: 0, w: 12, h: 12 },
      {
        i: "dept-product",
        widget: "department_card",
        x: 0,
        y: 12,
        w: 6,
        h: 30,
        settings: { department: "product" },
      },
      { i: "pulse", widget: "squad_pulse", x: 6, y: 12, w: 6, h: 30 },
    ],
  },
  {
    id: "seller",
    name: "Seller",
    description: "Distribution, leads and the Inbox.",
    layout: [
      { i: "ribbon", widget: "journey_ribbon", x: 0, y: 0, w: 12, h: 30 },
      {
        i: "dept-dist",
        widget: "department_card",
        x: 0,
        y: 30,
        w: 8,
        h: 30,
        settings: { department: "distribution" },
      },
      { i: "inbox", widget: "inbox_preview", x: 8, y: 30, w: 4, h: 30 },
    ],
  },
];

export const ENTITY_KIND_SAMPLE: EntityKind[] = [
  "person",
  "organisation",
  "agent",
  "team_member",
  "platform_member",
  "community",
  "venue",
];

/** A small team for nested-row tables (DataTable / Nested rows): leads with the specialists who report to them. */
export interface TeamRow {
  id: string;
  name: string;
  role: string;
  department: string;
  rating: number;
  pinned?: boolean;
  reports?: TeamRow[];
}

const member = (id: string, name: string, role: string, department: string, rating: number): TeamRow => ({ id, name, role, department, rating });

export const TEAM_ROWS: TeamRow[] = [
  { ...member("cos", "Chief of Staff", "Chief of Staff", "Team", 15), pinned: true },
  { ...member("prod", "Product Lead", "Head of Product", "Product", 13), reports: [member("research", "Researcher", "User researcher", "Product", 11), member("design", "Designer", "Product designer", "Product", 12)] },
  { ...member("eng", "Engineering Lead", "Head of Engineering", "Development", 16), reports: [member("backend", "Backend Engineer", "Backend engineer", "Development", 13), member("planner", "Planner", "Planner", "Development", 12), member("qa", "QA Engineer", "Quality engineer", "Development", 14)] },
  member("dist", "Distribution Lead", "Head of Distribution", "Distribution", 11),
];
