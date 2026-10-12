/**
 * Mock channel creative (BUILD §11.7 "Create"): the worker route answers a channel engine's creative request
 * (packages/agents channel-creative.ts) when the caller's schema asks for `assets` and a `channel_note`. The drafts are
 * built from the request itself (business, channel, campaign, objective, last learning), one per asset kind, so mock
 * mode fills the Creative tab with readable, deterministic copy; the orchestrator labels them as mock drafts.
 */
import { type MockContext, truncate } from "./inputs";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The creative request: the schema asks for assets and a channel note. */
export function isChannelCreativeRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("assets") && ctx.schemaKeys.includes("channel_note");
}

const BODY: Record<string, (b: string, objective: string) => string> = {
  email: (b, objective) => `Subject: A faster way to ${objective.toLowerCase()}\n\nHi {{first_name}},\n\n${b} helps teams like {{company}} ${objective.toLowerCase()} without adding work to their week. If it would help, reply and we will share how it works for a team your size.\n\nThe ${b} team (an AI agent writes on our behalf)\n\n{{{unsubscribe}}}`,
  post: (b, objective) => `${b}: ${objective}. Here is what we learned this week and what we are trying next. Tell us what you would want to see.`,
  ad: (b, objective) => `Headline: ${truncate(objective, 40)}\nDescription: ${b} makes it simple. Start free.\nCall to action: Learn more`,
  article: (b, objective) => `Working title: How to ${objective.toLowerCase()}\n\nOutline:\n1. The problem in one paragraph\n2. Three steps that work, with an example from ${b}'s customers (to be supplied by the founder)\n3. What to measure\n4. Next step: try ${b}`,
  mailer: (b, objective) => `Front: ${objective}\nBack: ${b}. Use code {{tracking_code}} at {{vanity_url}}.\nFormat: 6 x 9 in postcard. Audience and addresses come from the approved list only.`,
  print: (b, objective) => `Brief for the founder to submit: one quarter-page ad.\nHeadline: ${objective}\nBody: ${b}. Find us at {{vanity_url}} with code {{tracking_code}}.\nSizes and deadlines: from the publication's rate card. Nothing is booked until you approve and sign.`,
  script: (b, objective) => `30-second spot.\nVoice: ${objective}. ${b} makes it simple.\nClose: Visit {{vanity_url}}.\nAI voice is labeled where required.`,
  video: (b, objective) => `Storyboard: 3 shots showing how ${b} helps ${objective.toLowerCase()}; captions on; AI involvement labeled.`,
};

export function generateChannelCreative(ctx: MockContext): unknown {
  const req = ctx.getRecord("creative_request") ?? {};
  const business = isRecord(req.business) ? str(req.business.name) : "";
  const channel = isRecord(req.channel) ? str(req.channel.label) : "";
  const campaign = isRecord(req.campaign) ? req.campaign : {};
  const objective = str(campaign.objective).replace(/^Improve\s+/i, "improve ") || "reach the right customers";
  const kinds = (Array.isArray(req.asset_kinds) ? req.asset_kinds : []).filter((k): k is string => typeof k === "string" && k in BODY);
  const learnings = Array.isArray(req.learnings) ? req.learnings.filter((l): l is string => typeof l === "string") : [];
  const name = business || "We";
  const assets = (kinds.length ? kinds : ["post"]).slice(0, 2).map((kind, i) => ({
    kind,
    title: truncate(`${channel || "Channel"} ${kind} ${i + 1}: ${str(campaign.name) || objective}`, 80),
    body: BODY[kind]!(name, objective.charAt(0).toUpperCase() + objective.slice(1)),
  }));
  const last = learnings[learnings.length - 1];
  return { assets, channel_note: last ? truncate(`Changes one thing from last week (${last}).`, 200) : "First week: a baseline to learn from." };
}
