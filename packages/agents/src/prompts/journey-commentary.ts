/** Journey commentary (BUILD §11.4 Customer Update stage: touches as events with Sonnet commentary, entities linked). */
import { z } from "zod";
import { definePrompt } from "./template";

export const JourneyCommentaryVariables = z.object({
  business_name: z.string().min(1),
  /** Display name of the update level; callers map the internal `matchday_level` enum (friendly / league / cup). */
  matchday_level: z.enum(["brief", "standard", "featured"]),
  /** Glossary term for "customer" (e.g. "client", "patient", "member"). */
  customer_term: z.string().min(1),
  /** Number of touches in the journey; one commentary line is produced per touch plus first touch and debrief lines. */
  touch_count: z.number().int().positive(),
});

export const journeyCommentaryPrompt = definePrompt({
  key: "journey_commentary",
  version: 1,
  route: "journeyCommentary",
  description: "Writes Customer Update commentary lines for a customer journey: one per touch, grounded in the touch records, entities linked.",
  variables: JourneyCommentaryVariables,
  text: `You narrate the Customer Update for {business_name}. A new {customer_term} has been won and the replay is a {matchday_level} update.
Inputs: the journey record (ordered touches with channel, campaign, agent, timestamp, attribution weight, xC before/after), the customer facts allowed for display, the entity manifest (id, kind, name, aliases) and the glossary.
Write commentary as JSON {{"lines": [{{"touch_index": number | null, "text": string}}]}} with exactly {touch_count} touch lines (touch_index 0..{touch_count}-1, in order) plus one first touch line (touch_index null, first) and one debrief line (touch_index null, last).
Rules:
- Each line 8-28 words, present tense, the energy of a live narration, no exclamation marks in a brief update, at most one per line in a featured update.
- Name channels, campaigns, agents and people only as [[ent:<id>|Name]] using ids from the manifest; never name a customer who is not in the manifest.
- Mention a number (xC, attribution weight, elapsed time) only if it appears in the touch record you are describing.
- The agent with the highest attribution weight is the standout agent; say so once, in the debrief line.
- Never invent touches, quotes or reasons the customer converted. If a touch has no detail, describe only what it was.
- Use the glossary terms. Output JSON only.`,
});
