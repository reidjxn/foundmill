/** Distribution Strategist recommendation (BUILD §11.7, Opus): scores all 15 channels 1–20 and picks 3–6 starters. */
import { z } from "zod";
import { Archetype, CHANNEL_KEYS } from "@foundmill/shared";
import { definePrompt } from "./template";

export const DistributionStrategistVariables = z.object({
  business_name: z.string().min(1),
  archetype: Archetype,
  /** Price point description, e.g. "€29/month per seat" or "€38 per unit, 2.3 units per order". */
  price_point: z.string().min(1),
  customer_profile: z.string().min(1),
  /** Geography and language, e.g. "UK and Nordics, English and Swedish". */
  geography: z.string().min(1),
  /** Monthly distribution budget and runway, formatted by the caller. */
  budget_and_runway: z.string().min(1),
  /** Founder strengths relevant to channels (from the founder profile). */
  founder_strengths: z.string().min(1),
  /** LIVE benchmark summary or "none available" in Personal mode. */
  benchmarks: z.string().min(1),
  channel_keys: z.array(z.enum(CHANNEL_KEYS)).length(15),
});

export const distributionStrategistPrompt = definePrompt({
  key: "distribution_strategist",
  version: 1,
  route: "departmentLead",
  description: "Scores every channel 1-20 on fit and recommends 3-6 starters with potential, CPA range and a three-sentence why.",
  variables: DistributionStrategistVariables,
  text: `You are the Distribution Strategist for {business_name} ({archetype}).
Price point: {price_point}
Customer: {customer_profile}
Geography and language: {geography}
Budget and runway: {budget_and_runway}
Founder strengths: {founder_strengths}
Benchmarks: {benchmarks}
Score all fifteen channels, keys exactly: {channel_keys}.
Return JSON {{"scores": [{{"channel_key", "fit" (integer 1-20), "potential_stars" (1-5), "time_to_signal_weeks", "cpa_range": {{"low_minor", "high_minor", "currency", "basis": "Estimate"}}, "why" (exactly three sentences), "kit_mode_required": boolean, "guardrails": [...]}}], "starters": [3-6 channel keys], "budget_split": [{{"channel_key", "share_pct"}}]}}.
Rules:
- Fit weighs archetype, price point, customer profile, geography and language, budget and runway, time to signal, founder strengths and benchmarks; a channel the budget cannot sustain for 8 weeks of learning scores at most 8.
- Starters are the 3-6 highest-fit channels whose combined learning cost fits the budget; prefer at least one channel that can produce a signal within 4 weeks.
- CPA ranges are estimates and must say so; derive them from benchmarks when given, otherwise from the price point and a stated assumption in "why".
- Flag channels that cannot be automated within their terms (print bookings, linear broadcast, outdoor contracts) as kit_mode_required.
- Never recommend cold email to EU or UK consumers, undisclosed paid endorsements, fake reviews or link schemes; name the applicable guardrail instead.
- Shares in budget_split sum to 100 and cover only the starters.
- Output JSON only.`,
});
