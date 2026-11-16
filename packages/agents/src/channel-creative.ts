/**
 * Channel creative (BUILD §11.7 "Create"; audit GTM-12): the request a channel engine sends to draft the week's assets
 * and the pure post-processing of the answer. Like the rest of this package nothing here calls a model: the
 * orchestrator's `channelStep` sends `buildChannelCreativeRequest` through its models client (the channel agent's
 * route and attribution, so the cost is the agent's and an Estimate) and stores what `finaliseCreative` returns as
 * `pending` assets the founder approves on the Creative tab or with the campaign's launch.
 *
 * The system prompt is the channel template's own (house rules first, then its instructions); the campaign, the brief
 * and the learnings travel as inert JSON. Assets of a kind the channel does not produce are dropped, bodies are capped
 * and stored as plain text.
 */
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { ASSET_KINDS, CHANNEL_META, type AssetKind, type ChannelKey } from "@foundmill/shared";
import { agentPromptFields, buildSystemPrompt, type AgentPromptParts } from "./club-rules";
import { inertJson, plainModelText } from "./foundations";
import { channelCreativePrompt } from "./prompts/channel-creative";
import { getChannelTemplate } from "./registry";

export const CHANNEL_CREATIVE_MAX_TOKENS = 4_000;
/** At most this many assets per campaign week. */
export const CHANNEL_CREATIVE_MAX_ASSETS = 3;
/** Stored body length (the `assets.body` check, 0028). */
export const CREATIVE_BODY_LIMIT = 8_000;

/** What each channel drafts, most important first (BUILD §11.7 table). */
export const CHANNEL_ASSET_KINDS: Record<ChannelKey, readonly AssetKind[]> = {
  lead_generation: ["email"],
  email_automation: ["email"],
  seo: ["article"],
  geo: ["article"],
  content: ["article", "post"],
  social: ["post"],
  paid_ads: ["ad"],
  influencer: ["post", "email"],
  affiliate: ["email", "post"],
  direct_mail: ["mailer"],
  print: ["print"],
  broadcast: ["script"],
  outdoor: ["print"],
  pr: ["article", "email"],
  events: ["post", "email"],
};

export const ChannelCreativeOutput = z.object({
  assets: z
    .array(z.object({ kind: z.enum(ASSET_KINDS), title: z.string().max(300).default(""), body: z.string().max(20_000).default("") }))
    .max(8)
    .default([]),
  channel_note: z.string().max(600).default(""),
});
export type ChannelCreativeOutput = z.output<typeof ChannelCreativeOutput>;

export interface ChannelCreativeInput {
  businessName: string;
  channelKey: ChannelKey;
  campaignName: string;
  objective: string;
  /** Last weeks' learnings (newest last). */
  learnings: readonly string[];
  /** Offline tracking (kit mode): the founder submits what the agent prepares. */
  kitMode: boolean;
  /** One paragraph on the business and its customers (the spec's summary, the idea's pitch). */
  brief?: string | null;
  weeklyBudget?: { amountMinor: number; currency: string } | null;
  /** The business's agent of this channel as it is now (its live instructions and skills); the template when absent. */
  agent?: AgentPromptParts;
}

export interface ChannelCreativeRequest {
  route: "worker";
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: typeof ChannelCreativeOutput;
  maxTokens: number;
}

export function buildChannelCreativeRequest(input: ChannelCreativeInput): ChannelCreativeRequest {
  const meta = CHANNEL_META[input.channelKey];
  const kinds = CHANNEL_ASSET_KINDS[input.channelKey];
  const prompt = channelCreativePrompt.render({ channel_label: meta.label, asset_kinds: [...kinds], offline_tracking: input.kitMode ? "yes" : "no" });
  const data = {
    creative_request: {
      business: { name: input.businessName, brief: input.brief ? input.brief.slice(0, 2_000) : null },
      channel: { key: input.channelKey, label: meta.label, core_metric: meta.coreMetric, offline_tracking: input.kitMode },
      campaign: { name: input.campaignName, objective: input.objective, weekly_budget: input.weeklyBudget ? { ...input.weeklyBudget, label: "Estimate" } : null },
      asset_kinds: kinds,
      learnings: input.learnings.slice(-5),
    },
  };
  return {
    route: "worker",
    system: [buildSystemPrompt({ businessName: input.businessName, appName: APP_NAME, ...agentPromptFields(input.agent, getChannelTemplate(input.channelKey)) })],
    messages: [{ role: "user", content: `${prompt}\n\n\`\`\`json\n${inertJson(data)}\n\`\`\`` }],
    schema: ChannelCreativeOutput,
    maxTokens: CHANNEL_CREATIVE_MAX_TOKENS,
  };
}

export interface FinalisedAsset {
  kind: AssetKind;
  title: string;
  body: string;
}

/**
 * The assets to store: kinds the channel produces only, empty bodies dropped, titles and bodies plain text within the
 * column limits, at most `CHANNEL_CREATIVE_MAX_ASSETS`. `label` (mock mode) is put in front of every body so a mock draft
 * is never mistaken for a written one.
 */
export function finaliseCreative(out: ChannelCreativeOutput, options: { channelKey: ChannelKey; label?: string | null }): FinalisedAsset[] {
  const allowed = new Set(CHANNEL_ASSET_KINDS[options.channelKey]);
  const fallbackTitle = `${CHANNEL_META[options.channelKey].label} draft`;
  const assets: FinalisedAsset[] = [];
  for (const a of out.assets) {
    if (!allowed.has(a.kind)) continue;
    const body = plainModelText(a.body).trim();
    if (!body) continue;
    const prefix = options.label ? `${options.label}\n\n` : "";
    assets.push({ kind: a.kind, title: (plainModelText(a.title).trim() || fallbackTitle).slice(0, 200), body: `${prefix}${body}`.slice(0, CREATIVE_BODY_LIMIT) });
    if (assets.length >= CHANNEL_CREATIVE_MAX_ASSETS) break;
  }
  return assets;
}
