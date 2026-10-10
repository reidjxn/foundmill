"use client";
/**
 * Nudges that fit the agent being nudged, and its answer (audit-conversation §4 "Nudge"): the presets come from the
 * agent's persona (`agent.conversation.get` → `persona.nudges`: "Focus on tests" for an engineer, other words for a
 * specialist), and after a nudge the tile shows one bubble in the agent's own voice (`persona.voice.ack`) — chosen
 * here, deterministically, with no model call. A nudge is advice into a running session (`dev.tasks.shout`).
 */
import { NudgeAck, type Nudge, type NudgeMenuPreset } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { useWidgetQuery } from "@foundmill/widgets/data";

/** The persona fields a nudge needs (a slice of `agent.conversation.get`'s persona). */
export interface NudgePersona {
  id: string;
  name: string;
  avatarSeed: string;
  colourToken: DeptColourToken | null;
  voice: { greeting?: string; thinking?: string[]; ack?: string[] } | null;
  nudges: Array<{ key: string; label: string; text: string; hint: string; apiPreset: string | null }>;
}

/** The agent's persona (presence, voice, nudges): no model call. Null id: nothing is fetched. */
export function useNudgePersona(agentId: string | null | undefined) {
  const q = useWidgetQuery<{ persona: NudgePersona }>("agent.conversation.get", { subject: { kind: "agent", id: agentId ?? "" } }, { enabled: !!agentId });
  return { persona: q.data?.persona ?? null, isLoading: q.isLoading, error: q.error };
}

/** The persona's presets for the NudgeMenu. */
export function nudgeMenuPresets(persona: NudgePersona | null): NudgeMenuPreset[] {
  return (persona?.nudges ?? []).map((n) => ({ key: n.key, label: n.label, hint: n.hint, text: n.text }));
}

/**
 * `dev.tasks.shout`'s input for a nudge: an engineering preset the API knows by name goes as `preset`, anything else
 * (another agent's preset, the founder's own words) as `text`, at most 280 characters.
 */
export function nudgeShoutInput(nudge: Nudge, persona: NudgePersona | null, taskId?: string): Record<string, unknown> {
  const base: Record<string, unknown> = taskId ? { taskId } : {};
  const preset = nudge.key ? persona?.nudges.find((n) => n.key === nudge.key) : undefined;
  if (preset?.apiPreset) return { ...base, preset: preset.apiPreset };
  return { ...base, text: nudge.text.slice(0, 280) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The acknowledgement: one of the voice's `ack` lines (deterministic per seed), its first sentence only ("Noted."). */
export function ackFor(voice: NudgePersona["voice"], seed: string): string {
  const acks = (voice?.ack ?? []).map((a) => a.trim()).filter(Boolean);
  if (!acks.length) return "Noted.";
  const line = acks[hash(seed) % acks.length]!;
  return line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
}

export interface SentNudge {
  agentId: string | null;
  /** What was nudged, for screen readers. */
  text: string;
  /** Distinguishes two nudges of the same words (the acknowledgement may differ). */
  nonce: number;
}

/**
 * The agent's one-bubble answer over the tile it was nudged on. Its voice comes from the persona (fetched once and
 * cached); until it arrives the tile's own name and portrait are used with the plainest acknowledgement.
 */
export function TileNudgeAck({ sent, fallback, className }: { sent: SentNudge; fallback: { name: string; seed: string | number; dept?: DeptColourToken | null }; className?: string }) {
  const { persona } = useNudgePersona(sent.agentId);
  return (
    <NudgeAck
      className={className}
      name={persona?.name ?? fallback.name}
      avatarSeed={persona?.avatarSeed ?? fallback.seed}
      dept={persona?.colourToken ?? fallback.dept ?? null}
      text={ackFor(persona?.voice ?? null, `${sent.agentId ?? fallback.name}:${sent.text}:${sent.nonce}`)}
      nudge={sent.text}
    />
  );
}
