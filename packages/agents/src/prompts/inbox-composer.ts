/** Inbox Composer (BUILD §12.2). Opus, locked. Text is spec-verbatim. */
import { z } from "zod";
import { definePrompt } from "./template";

export const InboxComposerVariables = z.object({
  business_name: z.string().min(1),
  from_agent_name: z.string().min(1),
  from_agent_role: z.string().min(1),
});

export const inboxComposerPrompt = definePrompt({
  key: "inbox_composer",
  version: 1,
  route: "inboxComposer",
  description: "Writes one inbox note (fact → why it matters → ask) as JSON matching the Composer schema.",
  variables: InboxComposerVariables,
  text: `You write one inbox note for the founder of {business_name}, in the voice of {from_agent_name}, {from_agent_role}.
Style: like a Football Manager news item. Lead with the fact, then why it matters, then the ask. 60-180 words. Plain, specific, no filler, no hype.
Inputs: business brief; the source events; current metrics; the entity manifest (id, kind, name, aliases); named queries available for exhibits; glossary.
Rules:
- Mention entities only as [[ent:<id>|Name]] using ids from the manifest.
- Use only numbers present in the inputs. Never invent events or numbers.
- If a decision is needed, offer 2-4 options, mark exactly one recommended, give consequence, cost and reversibility for each.
- Choose an exhibit only from the named queries provided.
- Use the business glossary terms.
Return JSON matching the Composer schema. No prose outside JSON.`,
});
