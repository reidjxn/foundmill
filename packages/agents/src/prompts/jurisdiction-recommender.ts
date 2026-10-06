/** Jurisdiction recommender (BUILD §11.11, Opus + web research): two-jurisdiction headline and up to 6 cards with "date checked" stamps. */
import { z } from "zod";
import { Archetype } from "@founder-manager/shared";
import { definePrompt } from "./template";

export const JurisdictionRecommenderVariables = z.object({
  citizenship: z.array(z.string().min(1)).min(1),
  residence: z.string().min(1),
  target_markets: z.array(z.string().min(1)).min(1),
  fundraising_plans: z.string().min(1),
  archetype: Archetype,
  budget: z.string().min(1),
  cofounders: z.string().min(1),
  /** ISO date the research tools were run; stamped on every card. */
  date_checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  max_cards: z.number().int().min(2).max(6),
});

export const jurisdictionRecommenderPrompt = definePrompt({
  key: "jurisdiction_recommender",
  version: 1,
  route: "departmentLead",
  description: "Scores jurisdictions for a founder and business; headline recommends two; every fee is stamped with the date checked.",
  variables: JurisdictionRecommenderVariables,
  text: `You are the Legal lead recommending where to incorporate. This is information, not legal or tax advice, and you say so.
Founder: citizenship {citizenship}; resident in {residence}; co-founders: {cofounders}.
Business: {archetype}; target markets {target_markets}; fundraising plans: {fundraising_plans}; budget {budget}.
Use the web research tool to confirm current government fees, minimum capital and typical formation times from official sources; every figure carries the date it was checked: {date_checked}.
Return JSON {{"headline": "For your business, we recommend X or Y", "cards": [{{"jurisdiction", "entity_type", "route": "stripe_atlas|companies_house_web|kit", "formation_cost_text", "annual_cost_text", "minimum_capital_text", "time_to_form_text", "banking", "investor_familiarity": 1-5, "tax_notes_for_this_founder", "advantages": [...], "disadvantages": [...], "date_checked": "{date_checked}", "citation_ids": [...]}}], "citations": [{{"id", "url", "title"}}], "disclaimer"}}.
Rules:
- Between 2 and {max_cards} cards; the two headline jurisdictions come first.
- Tax notes must address this founder's situation, for example permanent-establishment risk when a company is managed from another country, personal tax residence, and withholding on cross-border payments. Name the risk; do not quantify it unless a cited source does.
- Only Delaware (Stripe Atlas) and UK private limited companies (Companies House website) have supervised routes; everything else is route "kit" with documents prepared for the founder.
- Never state a fee without a citation from an official or primary source checked on {date_checked}; if none was reachable, write "not verified" in the text field.
- The disclaimer says this is information, not legal or tax advice, and offers partner professionals.
- Output JSON only.`,
});
