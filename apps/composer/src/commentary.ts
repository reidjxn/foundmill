/**
 * Match Day commentary (BUILD §11.4 "Match (touches as events with Sonnet commentary, entities linked)";
 * ARCHITECTURE §11 `POST /v1/commentary`). One line per touch plus kick-off and full time, written by the
 * `journeyCommentary` route (Sonnet), every mention validated against a manifest of the customer and the agents on the
 * team sheet, persisted on `journeys.commentary` in the shape Dugout's JourneyStage reads (`{ text, touchId?, highlight? }`).
 */
import { prompts } from "@foundmill/agents";
import { repos, type Db, type JourneyDetail } from "@foundmill/db";
import { buildManifest, stripInvalidMentions, validateMarkup, type ManifestEntityInput } from "@foundmill/entity-linker";
import { CommentaryOutput, type ModelClient, type ModelLogger } from "@foundmill/models";
import { CHANNEL_META, type EntityKind } from "@foundmill/shared";

export interface CommentaryLine {
  /** Markdown with `[[ent:<id>|Name]]` mentions, validated against the manifest. */
  text: string;
  /** The touch this line describes; null for kick-off / full-time lines. */
  touchId: string | null;
  touchIndex: number | null;
  tone: CommentaryOutput["lines"][number]["tone"];
  /** True for the goal line (the Goal stage in the replay). */
  highlight: boolean;
}

export interface CommentaryResult {
  journeyId: string;
  businessId: string;
  headline: string;
  lines: CommentaryLine[];
  /** Mentions outside the manifest that were demoted to plain text (never rendered as links). */
  stripped: number;
  costMinor: number;
  model: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Agent ids a journey names: on its team sheet (`journeys.agents`) and in touch sources. */
function agentIdsOf(journey: JourneyDetail): string[] {
  const ids = new Set<string>();
  for (const a of journey.agents) {
    if (!isRecord(a)) continue;
    const id = a.agentId ?? a.agent_id ?? a.id;
    if (typeof id === "string") ids.add(id);
  }
  for (const t of journey.touches) {
    const src = t.source as Record<string, unknown>;
    const id = src.agentId ?? src.agent_id;
    if (typeof id === "string") ids.add(id);
  }
  return [...ids];
}

export async function composeCommentary(deps: { db: Db; models: ModelClient; log: ModelLogger }, businessId: string, journeyId: string): Promise<CommentaryResult> {
  const [business, journey] = await Promise.all([repos.businesses.get(deps.db, businessId), repos.journeys.get(deps.db, businessId, journeyId)]);
  const agentIds = agentIdsOf(journey);
  const agents = agentIds.length ? await repos.agents.byIds(deps.db, businessId, agentIds) : [];
  const campaignIds = [...new Set(journey.touches.map((t) => t.campaignId).filter((id): id is string => Boolean(id)))];
  const campaigns = await Promise.all(campaignIds.map((id) => repos.campaigns.get(deps.db, businessId, id).catch(() => null)));
  const campaignName = new Map(campaigns.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => [c.id, c.name]));

  const entities: ManifestEntityInput[] = [];
  if (journey.entity) entities.push({ id: journey.entity.id, kind: journey.entity.kind as EntityKind, name: journey.entity.displayName, visible: true, role: business.glossary.customer ?? "customer" });
  for (const a of agents) entities.push({ id: a.id, kind: "agent", name: a.name, role: a.role || a.agentType, visible: true });
  const manifest = buildManifest(entities, { strictKinds: false });

  const touches = journey.touches.map((t, index) => {
    const src = t.source as Record<string, unknown>;
    const agentId = typeof (src.agentId ?? src.agent_id) === "string" ? String(src.agentId ?? src.agent_id) : undefined;
    return {
      index,
      id: t.id,
      occurred_at: t.occurredAt.toISOString(),
      channel_key: t.channelKey,
      channel: t.channelKey ? CHANNEL_META[t.channelKey].label : null,
      kind: t.kind,
      campaign: t.campaignId ? (campaignName.get(t.campaignId) ?? null) : null,
      agent_id: agentId ?? null,
      attribution_weight: journey.weights[t.id] ?? null,
    };
  });
  const customerTerm = business.glossary.customer ?? "customer";
  const touchCount = Math.max(1, touches.length);
  const system = prompts.journeyCommentaryPrompt.render({ business_name: business.name, matchday_level: journey.matchdayLevel, customer_term: customerTerm, touch_count: touchCount });
  const inputs = {
    business_name: business.name,
    matchday_level: journey.matchdayLevel,
    conversion_kind: journey.conversion.kind,
    conversion: { id: journey.conversion.id, kind: journey.conversion.kind, amount_minor: journey.conversion.amountMinor, currency: journey.conversion.currency, occurred_at: journey.conversion.occurredAt.toISOString() },
    customer: journey.entity ? { id: journey.entity.id, name: journey.entity.displayName, kind: journey.entity.kind } : null,
    journey: { id: journey.id, touches, agents: journey.agents },
    touches,
    manifest: manifest.toJSON(),
    glossary: business.glossary,
  };

  const result = await deps.models.complete({
    route: "journeyCommentary",
    schema: CommentaryOutput,
    system,
    messages: [{ role: "user", content: "```json\n" + JSON.stringify(inputs) + "\n```" }],
    attribution: { businessId, kind: "journey_commentary" },
    scope: `composer:${businessId}`,
  });

  let stripped = 0;
  const lines: CommentaryLine[] = result.json.lines.map((l) => {
    const v = validateMarkup(l.text, manifest);
    let text = l.text;
    if (!v.valid) {
      stripped += v.unknownIds.length + v.invisibleIds.length + v.malformed.length;
      text = stripInvalidMentions(l.text, manifest);
    }
    const touch = journey.touches[l.touch_index];
    return { text, touchId: touch?.id ?? null, touchIndex: touch ? l.touch_index : null, tone: l.tone, highlight: l.tone === "goal" };
  });
  if (stripped > 0) deps.log.warn({ businessId, journeyId, stripped }, "commentary mentioned ids outside the manifest; demoted to plain text");

  await repos.journeys.setCommentary(deps.db, businessId, journeyId, lines);
  return { journeyId, businessId, headline: result.json.headline, lines, stripped, costMinor: result.cost.costMinorInt, model: result.model };
}
