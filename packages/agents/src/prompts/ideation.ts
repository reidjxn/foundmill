/** Ideation agent (BUILD §11.1 Door A, Opus): drafts 6–12 concept cards with 10 attributes 1–20. */
import { z } from "zod";
import { definePrompt } from "./template";

export const IDEA_ATTRIBUTES = [
  "Market pull",
  "Market size",
  "Competition",
  "Speed to first customer",
  "Capital intensity",
  "Agent-executability",
  "Founder fit",
  "Defensibility",
  "Regulatory load",
  "Distribution clarity",
] as const;
export type IdeaAttribute = (typeof IDEA_ATTRIBUTES)[number];

export const IdeationVariables = z.object({
  /** Founder profile summary: experience, skills 1-20, time, budget, citizenship/residence, target markets, constraints, risk appetite. */
  founder_profile: z.string().min(1),
  /** The founder's prompt; "surprise me within my constraints" when empty. */
  concept_prompt: z.string().min(1),
  min_cards: z.number().int().min(1),
  max_cards: z.number().int().min(1),
  attribute_names: z.array(z.string()).length(10),
});

export const ideationPrompt = definePrompt({
  key: "ideation",
  version: 1,
  route: "ideation",
  description: "Drafts concept cards (name, pitch, archetype, 10 attributes with evidence requests) for the Ideation Studio.",
  variables: IdeationVariables,
  text: `You draft business concepts for a founder with this profile: {founder_profile}
Founder's prompt: {concept_prompt}
Produce between {min_cards} and {max_cards} distinct concept cards as JSON {{"cards": [...]}}. Each card: {{"name", "pitch" (<= 40 words), "archetype" (one of b2b_saas, consumer_app, marketplace, dtc_physical, hardware, services, content_media), "customer", "problem", "wedge" (the first product that wins a first customer), "attributes": [{{"name", "score" (integer 1-20), "rationale" (<= 30 words), "evidence_needed" (what the Research agent should verify)}}], "stars_current" (1-5), "stars_potential" (1-5), "research_questions": [3-5 strings]}}.
Attributes are exactly these ten, in this order: {attribute_names}.
Rules:
- Every card must be executable mostly by AI agents with the founder's time and budget; score Agent-executability honestly and Capital intensity high when physical inventory or hardware is needed.
- Respect every constraint in the profile (citizenship, residence, markets, time, budget, exclusions). A concept that breaks a constraint is not offered.
- Cards must differ in customer or wedge; no two cards may be the same idea with a different name.
- Scores are your prior; label them "unverified" in rationale and name the evidence the Research agent must find. Never state market sizes, competitor names or prices as facts here.
- Prefer concepts that reach a first paying customer within 90 days where the profile allows.
- Output JSON only.`,
});
