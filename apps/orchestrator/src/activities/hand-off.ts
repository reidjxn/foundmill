/**
 * The launch gate (founder, Nov 24, 2026: "nothing can be blocked"): what an agent could not do on its own reaches the
 * founder as one Needs you item, and the task still ends with its report (WP-05 T22, T26). The item is a `decision`
 * from the agent that did the work, with nothing blocking Continue; one with the same subject still waiting is not
 * written again, so five tasks that miss the same connection ask once.
 */
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent } from "../events";

/** The option ids of a hand-off note. */
export const HAND_OFF_OPTIONS = { done: "done", later: "later" } as const;

/** The subject of the one note that asks for missing connections. */
export const connectSubject = (names: string): string => `Connect ${names} for the team`.slice(0, 80);

/** The subject of the note that hands over what one task could not finish. */
export const handOffSubject = (title: string): string => {
  const t = title.length > 48 ? `${title.slice(0, 47)}…` : title;
  return `For you from "${t}"`.slice(0, 80);
};

/** Writes the note unless one with the same subject is still waiting. Returns its id, or null when one already waits. */
export async function handToFounder(deps: Pick<OrchestratorDeps, "db">, businessId: string, note: { fromAgentId: string; subject: string; body: string }): Promise<string | null> {
  if ((await repos.inbox.openBySubject(deps.db, businessId, note.subject)).some((i) => i.state !== "answered")) return null;
  const item = await repos.inbox.createItem(deps.db, businessId, {
    type: "decision",
    from_agent_id: note.fromAgentId,
    subject: note.subject,
    body_md: note.body.slice(0, 4_000),
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: HAND_OFF_OPTIONS.done, label: "Done", recommended: true, consequence: "The team picks it up in the next round of work.", cost_minor: 0, reversible: true },
        { id: HAND_OFF_OPTIONS.later, label: "Not now", recommended: false, consequence: "Nothing changes; the work already done stays.", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: false,
    source_event_ids: [],
    entity_ids: [],
  });
  await emitEvent(deps.db, { businessId, type: "inbox.item_created", actor: agentActor(note.fromAgentId), payload: { inboxItemId: item.id, type: item.type, fromAgentId: note.fromAgentId, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
  return item.id;
}

/** The lines under a report's "Needs you" heading (any level), up to the next heading; empty when it has none. */
export function needsYouSection(bodyMd: string): string {
  const lines = bodyMd.split("\n");
  const start = lines.findIndex((l) => /^\s{0,3}#{1,6}\s+needs you\s*#*\s*$/i.test(l));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s{0,3}#{1,6}\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}
