/**
 * Mock journey commentary (BUILD §11.4 Match Day): one line per touch in the voice of a match commentator, entities
 * linked with manifest ids only.
 */
import { CHANNEL_KEYS, CHANNEL_META, type ChannelKey, type ChannelLine } from "@foundmill/shared";
import type { CommentaryOutput } from "../schemas";
import { type ManifestEntry, type MockContext, ent, isRecord } from "./inputs";

interface TouchIn {
  index: number;
  channel: ChannelKey | undefined;
  kind: string;
  campaign?: string;
  agentId?: string;
}

const LINE_PHRASES: Record<ChannelLine, string[]> = {
  attack: ["{channel} goes direct — a sharp ball into the box and {customer} is looking", "Straight down the middle from {channel}; {customer} takes the first touch", "{channel} presses high and wins the ball; {customer} clicks through"],
  midfield: ["{channel} keeps possession, patient build-up, {customer} replies", "A neat one-two through {channel}; {customer} opens the message", "{channel} switches play and {customer} comes back for another look"],
  defence: ["Started from the back: {channel} brings {customer} in through organic search", "{channel} holds its shape; {customer} finds the page on their own terms", "Patient from {channel}; a long read, then {customer} moves forward"],
  wings: ["Out wide on {channel}: a code scanned and {customer} is in the building", "Cross from the wing via {channel}; {customer} arrives at the vanity URL", "{channel} delivers from the touchline and {customer} controls it"],
};

const SETBACK = /\b(bounce|unsubscribe|abandon|drop|churn|complaint|spam)\b/i;

export function generateJourneyCommentary(ctx: MockContext): CommentaryOutput {
  const touches = readTouches(ctx);
  const customer = readCustomer(ctx);
  const conversion = ctx.getString("conversion_kind", "conversion", "matchday_level", "level") ?? "payment";
  const customerText = customer ? (ctx.manifest.includes(customer) ? ent(customer) : customer.name) : "the visitor";

  const lines: CommentaryOutput["lines"] = touches.map((t, i) => {
    const isLast = i === touches.length - 1;
    const channelLabel = t.channel ? CHANNEL_META[t.channel].label : "an untracked source";
    const line: ChannelLine = t.channel ? CHANNEL_META[t.channel].line : "midfield";
    const agent = t.agentId ? ctx.manifest.find((e) => e.id === t.agentId) : undefined;
    const agentText = agent ? ` ${ent(agent)} set it up.` : "";
    if (SETBACK.test(t.kind)) {
      return { touch_index: t.index, text: `Setback: ${t.kind.replace(/_/g, " ")} on ${channelLabel}; ${customerText} drifts away for now.${agentText}`, tone: "setback" as const };
    }
    if (isLast && touches.length > 0) {
      const goal = conversion === "signup" ? "signs up — a friendly won" : conversion === "activation" ? "reaches activation — league points on the board" : "pays — the cup tie is won";
      return { touch_index: t.index, text: `GOAL! ${customerText} ${goal}, finished from ${channelLabel}${t.campaign ? ` ("${t.campaign}")` : ""}.${agentText}`, tone: "goal" as const };
    }
    const tone = i === 0 ? ("build_up" as const) : ctx.rng.chance(0.4) ? ("chance" as const) : ("build_up" as const);
    const phrase = ctx.rng.pick(LINE_PHRASES[line]).replace("{channel}", channelLabel).replace("{customer}", customerText);
    return { touch_index: t.index, text: `${phrase}${t.campaign ? ` ("${t.campaign}")` : ""}.${agentText}`, tone };
  });

  if (lines.length === 0) {
    lines.push({ touch_index: 0, text: `Kick-off: no recorded touches before ${customerText} converted; a direct arrival, so attribution is partial.`, tone: "neutral" });
  }

  const touchCount = touches.length;
  const headline = `${customer ? customer.name : "A visitor"} ${conversion === "signup" ? "signs up" : conversion === "activation" ? "activates" : "becomes a paying customer"} after ${touchCount === 0 ? "a direct arrival" : `${touchCount} touch${touchCount === 1 ? "" : "es"}`}`;
  return { headline, lines };
}

function readTouches(ctx: MockContext): TouchIn[] {
  const journey = ctx.getRecord("journey");
  const raw = ctx.getArray<unknown>("touches", "touchpoints", "events");
  const list = raw.length > 0 ? raw : journey && Array.isArray(journey.touches) ? journey.touches : [];
  const out: TouchIn[] = [];
  list.forEach((t, i) => {
    if (!isRecord(t)) return;
    const channelRaw = typeof t.channel_key === "string" ? t.channel_key : typeof t.channel === "string" ? t.channel : typeof t.channelKey === "string" ? t.channelKey : undefined;
    out.push({
      index: typeof t.index === "number" ? t.index : i,
      channel: channelRaw && (CHANNEL_KEYS as readonly string[]).includes(channelRaw) ? (channelRaw as ChannelKey) : undefined,
      kind: typeof t.kind === "string" ? t.kind : typeof t.type === "string" ? t.type : "visit",
      campaign: typeof t.campaign === "string" ? t.campaign : typeof t.campaign_name === "string" ? t.campaign_name : isRecord(t.campaign) && typeof t.campaign.name === "string" ? t.campaign.name : undefined,
      agentId: typeof t.agent_id === "string" ? t.agent_id : typeof t.agentId === "string" ? t.agentId : undefined,
    });
  });
  return out;
}

function readCustomer(ctx: MockContext): ManifestEntry | undefined {
  const c = ctx.getRecord("customer", "entity", "contact");
  if (c) {
    const id = typeof c.id === "string" ? c.id : typeof c.entity_id === "string" ? c.entity_id : undefined;
    const fromManifest = id ? ctx.manifest.find((e) => e.id === id) : undefined;
    if (fromManifest) return fromManifest;
    const name = typeof c.name === "string" ? c.name : typeof c.display_name === "string" ? c.display_name : undefined;
    if (name) return { id: id ?? "", kind: "person", name, aliases: [] };
  }
  return ctx.manifest.find((e) => e.kind === "person" || e.kind === "organisation");
}
