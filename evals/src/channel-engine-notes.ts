/**
 * `channel_engine.reports_prepared_not_launched` (WP-02 T2; audit a5 GTM-02): on a real project in offline tracking the
 * weekly engine prepares materials and the founder submits them; nothing is sent from the product. Given the events the
 * engine writes that week (the founder's approval, `campaign.launched` with `kitMode: true`, the founder task, or the launch alone), the
 * Composer's note never says the campaign launched, went live, was sent or was published. The cases run the composer
 * route over the same input shape apps/composer builds (`composerInputs`, with its offline-tracking note), scored by a
 * deterministic gate on subject and body. Live in `pnpm evals`; the unit suite feeds it the mock, what mock-mode founders get.
 */
import { ComposerOutput, type ModelClient } from "@foundmill/models";
import { composerCase, composerMessages, composerSystemPrompt, corpusId, type ComposerEvalCase } from "./composer";

/** The words a note about prepared-but-not-submitted materials must not use of the campaign. */
export const LAUNCH_CLAIM = /\b(launch(?:ed|es)?|went live|is live|now live|are live|goes live|sent|published|posted)\b/i;

/** What apps/composer adds to the input when a narrated `campaign.launched` is offline tracking (`OFFLINE_TRACKING_NOTE`). */
export const OFFLINE_TRACKING_NOTE =
  "Offline tracking: the team prepared these materials and the founder submits them. Nothing was launched, sent or published from here. Say the materials are ready for the founder to submit; never say the campaign launched, went live, was sent or was published.";

const CHANNELS = [
  { key: "print", label: "Print" },
  { key: "events", label: "Events" },
  { key: "email_automation", label: "Email" },
] as const;

function engineCase(i: number, only: "week" | "launched"): ComposerEvalCase {
  const base = composerCase(2 * i + 2); // a task_done case: its base input, voice and manifest
  const channel = CHANNELS[i % CHANNELS.length]!;
  const at = (h: number) => new Date(Date.parse(String(base.input.now)) - h * 3_600_000).toISOString();
  const agent = base.voice;
  const campaignId = corpusId("campaign", 500 + i);
  const approvalId = corpusId("approval", 600 + i);
  const name = `${channel.label} — week ${i + 2}, Oct ${12 + i}`;
  const events = [
    { id: corpusId("event", 700 + 3 * i), type: "approval.resolved", occurred_at: at(5), actor: { kind: "user", id: corpusId("founder", 1) }, entity_ids: [agent.id], payload: { approvalId, planActionId: null, agentId: agent.id, outcome: "approved", resolvedBy: { kind: "user", id: corpusId("founder", 1) }, note: null, latencyMs: 3_600_000 } },
    { id: corpusId("event", 701 + 3 * i), type: "campaign.launched", occurred_at: at(4), actor: { kind: "agent", id: agent.id }, entity_ids: [agent.id], payload: { campaignId, channelId: corpusId("channel", 800 + i), channelKey: channel.key, name, goal: "Improve replies", budget: { amountMinor: 0, currency: "EUR" }, startsAt: at(4), endsAt: null, kitMode: true, assetIds: [corpusId("asset", 900 + i)], approvalId } },
    { id: corpusId("event", 702 + 3 * i), type: "task.created", occurred_at: at(4), actor: { kind: "agent", id: agent.id }, entity_ids: [], payload: { title: `Founder action: submit the ${channel.label.toLowerCase()} materials for "${name}"`, status: "ready", assigneeAgentId: null } },
  ];
  return { ...base, id: `channel_engine.reports_prepared_not_launched.${channel.key}.${only}`, kind: "task_done", input: { ...base.input, events: only === "week" ? events : [events[1]!], note: OFFLINE_TRACKING_NOTE } };
}

export const CHANNEL_ENGINE_NOTE_CASES: readonly ComposerEvalCase[] = Object.freeze([0, 1, 2].flatMap((i) => [engineCase(i, "week"), engineCase(i, "launched")]));

export interface ChannelEngineNoteResult {
  caseId: string;
  /** The words that claimed a launch, from subject and body. */
  claims: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

export async function runChannelEngineNoteCase(c: ComposerEvalCase, client: ModelClient): Promise<ChannelEngineNoteResult> {
  try {
    const result = await client.complete({ route: "inboxComposer", schema: ComposerOutput, system: composerSystemPrompt(c), messages: composerMessages(c), scope: `eval:${c.id}`, cacheSystem: true });
    const text = `${result.json.subject}\n${result.json.body_md}`;
    const claims = [...text.matchAll(new RegExp(LAUNCH_CLAIM.source, "gi"))].map((m) => m[0]);
    return { caseId: c.id, claims, passed: claims.length === 0, costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, claims: [], passed: false, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
