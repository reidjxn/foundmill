/**
 * Business scenarios used to instantiate skill-test blueprints. Each scenario is a coherent fictional business across the
 * seven archetypes, so a skill's 12 tests span different products, customers, markets and currencies rather than repeating
 * one example. Fields are the placeholders blueprints may use as `{field}`.
 */
import { type Archetype } from "@foundmill/shared";

export interface Scenario {
  key: string;
  archetype: Archetype;
  business: string;
  product: string;
  customer: string;
  market: string;
  currency: string;
  price: string;
  competitor: string;
  channel: string;
  supplier: string;
  regulator: string;
  stack: string;
  keyword: string;
  integration: string;
  publication: string;
  founder: string;
  metric: string;
  entity: string;
}

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  {
    key: "northwind_skincare",
    archetype: "dtc_physical",
    business: "Northwind Skincare",
    product: "a fragrance-free facial moisturizer in a 50 ml airless bottle",
    customer: "women aged 30-45 with sensitive skin who buy online",
    market: "the EU and the UK",
    currency: "EUR",
    price: "€38 per unit",
    competitor: "La Roche-Posay Toleriane",
    channel: "influencer",
    supplier: "Meridian Labs (contract manufacturer, Lyon)",
    regulator: "the EU Cosmetics Regulation 1223/2009",
    stack: "Shopify storefront, Next.js marketing site, Postgres",
    keyword: "moisturizer for sensitive skin",
    integration: "Shopify",
    publication: "Pharmacy Business",
    founder: "Elin",
    metric: "repeat purchase rate 31%",
    entity: "Meridian Labs",
  },
  {
    key: "ledgerly",
    archetype: "b2b_saas",
    business: "Ledgerly",
    product: "a month-end reconciliation tool for fintech operations teams",
    customer: "operations managers at 20-200 person fintechs",
    market: "the UK and the US",
    currency: "GBP",
    price: "£49 per seat per month",
    competitor: "BlackLine",
    channel: "lead_generation",
    supplier: "AWS (hosting)",
    regulator: "the FCA",
    stack: "Next.js, Hono, Postgres with RLS, Stripe billing",
    keyword: "month-end reconciliation software",
    integration: "Stripe",
    publication: "Fintech Futures",
    founder: "Reid",
    metric: "MRR £18,400",
    entity: "Harbour Payments",
  },
  {
    key: "pocketcoach",
    archetype: "consumer_app",
    business: "PocketCoach",
    product: "a habit-coaching mobile app with daily check-ins",
    customer: "adults 25-40 in Germany and Austria trying to build exercise habits",
    market: "Germany and Austria",
    currency: "EUR",
    price: "€6.99 per month after a 7-day trial",
    competitor: "Fabulous",
    channel: "paid_ads",
    supplier: "Apple App Store and Google Play",
    regulator: "the GDPR and the Digital Services Act",
    stack: "React Native, Supabase, RevenueCat",
    keyword: "habit tracker app",
    integration: "App Store Connect",
    publication: "t3n",
    founder: "Jonas",
    metric: "trial-to-paid 11%",
    entity: "Fitnessstudio Nord",
  },
  {
    key: "hollow_and_hearth",
    archetype: "marketplace",
    business: "Hollow & Hearth",
    product: "a marketplace for commissioned handmade furniture connecting makers with buyers",
    customer: "homeowners renovating in the UK and independent furniture makers",
    market: "the UK",
    currency: "GBP",
    price: "a 12% commission on each order",
    competitor: "Etsy",
    channel: "seo",
    supplier: "Stripe Connect (payouts)",
    regulator: "UK consumer law and the Consumer Rights Act 2015",
    stack: "Next.js, Postgres, Stripe Connect, Cloudinary",
    keyword: "custom oak dining table",
    integration: "Stripe Connect",
    publication: "Homes & Gardens",
    founder: "Priya",
    metric: "GMV £64,000 per month",
    entity: "Ashdown Joinery",
  },
  {
    key: "brightpath",
    archetype: "hardware",
    business: "Brightpath",
    product: "a smart bike light with crash detection and a companion app",
    customer: "urban commuters in the Netherlands and Germany",
    market: "the Netherlands and Germany",
    currency: "EUR",
    price: "€129 per unit",
    competitor: "Garmin Varia",
    channel: "content",
    supplier: "Shenzhen Luma Electronics (PCB assembly)",
    regulator: "the EU Radio Equipment Directive and the Battery Regulation 2023/1542",
    stack: "ESP32 firmware, React Native app, Postgres",
    keyword: "smart bike light crash detection",
    integration: "Shopify",
    publication: "Fiets",
    founder: "Mara",
    metric: "pre-orders 1,240",
    entity: "Shenzhen Luma Electronics",
  },
  {
    key: "northstar_books",
    archetype: "services",
    business: "Northstar Bookkeeping",
    product: "a monthly bookkeeping and VAT service for independent restaurants",
    customer: "owner-operated restaurants with 1-3 sites in Sweden",
    market: "Sweden",
    currency: "SEK",
    price: "3,900 SEK per month per site",
    competitor: "Fortnox partner accountants",
    channel: "events",
    supplier: "Fortnox (ledger)",
    regulator: "Skatteverket and Bokföringsnämnden",
    stack: "Next.js client portal, Fortnox API, Postgres",
    keyword: "bokföring restaurang",
    integration: "Fortnox",
    publication: "Restauratören",
    founder: "Anders",
    metric: "client retention 94%",
    entity: "Café Söder",
  },
  {
    key: "ops_letter",
    archetype: "content_media",
    business: "The Ops Letter",
    product: "a weekly newsletter and podcast for operations leaders with a paid membership",
    customer: "heads of operations at US tech companies with 50-500 staff",
    market: "the US",
    currency: "USD",
    price: "$12 per month membership plus sponsorships at $2,500 per issue",
    competitor: "Lenny's Newsletter",
    channel: "social",
    supplier: "SendGrid (delivery) and Transistor (podcast hosting)",
    regulator: "CAN-SPAM and the FTC endorsement guides",
    stack: "Next.js, SendGrid, Stripe, Postgres",
    keyword: "operations leadership newsletter",
    integration: "SendGrid",
    publication: "The Information",
    founder: "Dana",
    metric: "paid members 2,310",
    entity: "Fieldstone Robotics",
  },
  {
    key: "greenline",
    archetype: "b2b_saas",
    business: "Greenline",
    product: "fleet emissions reporting software for logistics companies",
    customer: "sustainability and fleet managers at mid-sized French and Belgian carriers",
    market: "France and Belgium",
    currency: "EUR",
    price: "€890 per month per fleet",
    competitor: "Shipzero",
    channel: "pr",
    supplier: "Google Cloud (hosting)",
    regulator: "the EU Corporate Sustainability Reporting Directive",
    stack: "Next.js, Hono, Postgres, Temporal",
    keyword: "logiciel reporting émissions flotte",
    integration: "Google Maps Platform",
    publication: "Flottes Automobiles",
    founder: "Camille",
    metric: "pipeline €210,000",
    entity: "Transports Delorme",
  },
] as const satisfies readonly Scenario[]);

export const SCENARIOS_BY_KEY: Readonly<Record<string, Scenario>> = Object.freeze(Object.fromEntries(SCENARIOS.map((s) => [s.key, s])));

export const SCENARIO_FIELDS = Object.keys(SCENARIOS[0]!) as (keyof Scenario)[];

/** Deterministic 32-bit FNV-1a hash used to rotate scenarios per skill so different skills pair with different businesses. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Scenarios in a stable order that depends on the skill key. */
export function scenariosForSkill(skillKey: string, count: number): Scenario[] {
  const start = fnv1a(skillKey) % SCENARIOS.length;
  const out: Scenario[] = [];
  for (let i = 0; i < Math.min(count, SCENARIOS.length); i++) out.push(SCENARIOS[(start + i) % SCENARIOS.length]!);
  return out;
}

const FIELD_RE = /\{([a-z_]+)\}/g;

/** Replace `{field}` placeholders with scenario values. Throws on an unknown field so blueprints cannot ship typos. */
export function fillScenario(text: string, scenario: Scenario): string {
  return text.replace(FIELD_RE, (_m, field: string) => {
    if (!(field in scenario)) throw new Error(`Unknown scenario field {${field}} in blueprint text: "${text.slice(0, 60)}..."`);
    return scenario[field as keyof Scenario];
  });
}
