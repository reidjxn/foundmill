/**
 * Mock Legal agent for the jurisdiction recommender (legal.recommend, AC-11.11.1): two or three plausible cards with
 * bounded estimates, so the mock golden path never shows a made-up figure out of the schema's range. It answers the
 * `departmentLead` route, like the Source Watcher's mock does, and is recognized by the shape of the requested schema.
 */
import type { MockContext } from "./inputs";

/** The request wants `{ headline, cards[] }`: the recommender's schema. */
export function isJurisdictionRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("headline") && ctx.schemaKeys.includes("cards");
}

interface Card {
  jurisdiction: string;
  entity_type: string;
  formation_cost_minor: number;
  annual_cost_minor: number;
  minimum_capital_minor: number;
  time_to_form_days: number;
  banking: string;
  investor_familiarity: number;
  tax_notes: string;
  advantages: string[];
  disadvantages: string[];
  route: "stripe_atlas" | "companies_house_web" | "kit";
}

const DELAWARE: Card = {
  jurisdiction: "Delaware",
  entity_type: "C-corp",
  formation_cost_minor: 50_000,
  annual_cost_minor: 30_000,
  minimum_capital_minor: 0,
  time_to_form_days: 3,
  banking: "US business accounts are available remotely through Stripe Atlas partners.",
  investor_familiarity: 5,
  tax_notes: "A non-US founder may owe US tax on US-source income and has annual US filings; a tax professional should confirm.",
  advantages: ["The standard structure for venture investors", "Stock option plans and SAFEs are well understood", "Fast online formation"],
  disadvantages: ["US annual filings and franchise tax", "Possible permanent-establishment questions for non-US founders"],
  route: "stripe_atlas",
};

const UK: Card = {
  jurisdiction: "United Kingdom",
  entity_type: "Ltd",
  formation_cost_minor: 5_000,
  annual_cost_minor: 6_000,
  minimum_capital_minor: 100,
  time_to_form_days: 2,
  banking: "Online business banks open UK accounts in a few days with identity checks.",
  investor_familiarity: 4,
  tax_notes: "Corporation tax and confirmation statements apply every year; investor relief schemes may be available.",
  advantages: ["Low formation cost and quick registration", "Government-backed investor tax schemes (EIS and SEIS)", "Clear company law"],
  disadvantages: ["US investors may ask for a Delaware parent later", "Public register shows directors and addresses"],
  route: "companies_house_web",
};

const PACK: Card = {
  jurisdiction: "Estonia",
  entity_type: "OÜ",
  formation_cost_minor: 40_000,
  annual_cost_minor: 120_000,
  minimum_capital_minor: 0,
  time_to_form_days: 7,
  banking: "Digital banks work with e-Residency companies; some need an in-person meeting.",
  investor_familiarity: 2,
  tax_notes: "Profits are taxed when distributed; accounting rules still apply every year.",
  advantages: ["Fully online administration", "No tax on reinvested profit"],
  disadvantages: ["Fewer investors know the structure", "You file the pack with the registry yourself"],
  route: "kit",
};

export function generateJurisdictionRecommendation(ctx: MockContext): { headline: string; cards: Card[] } {
  const fundraising = ctx.getString("fundraising");
  const cards = fundraising === "vc" ? [DELAWARE, UK, PACK] : [UK, DELAWARE, PACK];
  return { headline: `For your business, we recommend ${cards[0]!.jurisdiction} or ${cards[1]!.jurisdiction === "United Kingdom" ? "the United Kingdom" : cards[1]!.jurisdiction}`, cards };
}
