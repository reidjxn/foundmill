/**
 * Channel creative (BUILD §11.7 engine loop "Create"): a channel engine's weekly drafts (emails, posts, ad copy, print
 * and mailer briefs, scripts) written by the channel's agent for the founder to approve before anything launches.
 * The campaign, the business brief and the learnings travel in a JSON block; nothing here is a recipient.
 */
import { z } from "zod";
import { definePrompt } from "./template";

export const ChannelCreativeVariables = z.object({
  channel_label: z.string().min(1),
  /** The asset kinds this channel produces, most important first. */
  asset_kinds: z.array(z.string().min(1)).min(1),
  /** "yes" when the channel runs offline tracking (kit mode): the founder submits, the agent prepares. */
  offline_tracking: z.enum(["yes", "no"]),
});

export const channelCreativePrompt = definePrompt({
  key: "channel_creative",
  version: 1,
  route: "worker",
  description: "A channel engine's weekly creative drafts (copy and briefs) for the founder to approve before launch.",
  variables: ChannelCreativeVariables,
  text: `Draft this week's creative for the {channel_label} campaign described in the JSON below. Produce one to three assets of these kinds, most important first: {asset_kinds}. Offline tracking: {offline_tracking}.
Return JSON {{"assets": [{{"kind", "title" (<= 80 characters), "body" (the full copy or brief, plain text, <= 1,500 words)}}], "channel_note" (one sentence: what this week's drafts try, tied to the learnings)}}.
Rules:
- Write for the business's customers as the JSON describes them; use only facts from the JSON. Never invent customers, quotes, reviews, prices, statistics or awards; a figure of your own is labeled "Estimate".
- Never claim to be human; never write in the founder's name or sign as them. Personalize only with placeholders such as {{{{first_name}}}} and {{{{company}}}}, never with a real person's name or address.
- Marketing email carries {{{{{{unsubscribe}}}}}} in the body. Ads and posts say what is offered, plainly; no fake urgency.
- With offline tracking, write a brief the founder can hand over or submit: the copy, the sizes or durations, the tracking code or vanity URL placeholder, and the steps; never book, buy or sign anything.
- Use the learnings to change one thing from last week and say what in channel_note. US English. Output JSON only.`,
});
