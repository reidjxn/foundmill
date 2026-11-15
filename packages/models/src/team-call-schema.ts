/**
 * Team call output contracts (docs/TEAM_CALL.md §4; routes `teamCallTurn` and `teamCallWrapUp`).
 *
 * - `TeamCallTurnsOutput`: the next one to four spoken turns of a call between the founder and their team of agents, and
 *   whether the agents now want the founder (`hand_back`). Each turn is one agent speaking in the first person, plain
 *   text that may name a teammate as `[[ent:<id>|Name]]`.
 * - `TeamCallWrapUpOutput`: what the call discussed and agreed (plain text) and its action items, each a typed plan
 *   action exactly as the plan compiler writes it (`PlanAction`: `{ type, params, agent_id }`).
 *
 * The model calls send the looser `*Draft` shapes (no length limits, which structured outputs cannot enforce anyway), so
 * a turn a few characters long or a sixth action is repaired locally instead of costing a second call: packages/agents
 * `finaliseTeamCallTurns` and `finaliseTeamCallWrapUp` read the draft and return values within these schemas.
 */
import { TEAM_CALL_LIMITS } from "@foundmill/shared";
import { z } from "zod";
import { PlanAction } from "./schemas";

/** One wrap-up summary, in characters. */
export const TEAM_CALL_SUMMARY_MAX = 1200;
/** An action item's title and detail, in characters. */
export const TEAM_CALL_ACTION_TITLE_MAX = 200;
export const TEAM_CALL_ACTION_DETAIL_MAX = 1000;

/** Whom a turn is addressed to: the founder, the whole room, or one teammate on the call. */
export const TeamCallTurnAddressee = z.union([z.literal("founder"), z.literal("team"), z.object({ agent_id: z.string() })]);
export type TeamCallTurnAddressee = z.infer<typeof TeamCallTurnAddressee>;

export const TeamCallTurnOutput = z.object({
  /** One of the participants. */
  agent_id: z.string(),
  to: TeamCallTurnAddressee,
  /** Spoken words, plain text; may contain [[ent:<id>|Name]]. */
  text: z.string().min(1).max(TEAM_CALL_LIMITS.maxTurnChars),
});
export type TeamCallTurnOutput = z.infer<typeof TeamCallTurnOutput>;

export const TeamCallTurnsOutput = z.object({
  turns: z.array(TeamCallTurnOutput).min(1).max(TEAM_CALL_LIMITS.maxTurnsPerRound),
  /** True when the agents now want the founder. */
  hand_back: z.boolean(),
});
export type TeamCallTurnsOutput = z.infer<typeof TeamCallTurnsOutput>;

export const TeamCallWrapUpAction = z.object({
  /** One line in the founder's words. */
  title: z.string().min(1).max(TEAM_CALL_ACTION_TITLE_MAX),
  detail: z.string().max(TEAM_CALL_ACTION_DETAIL_MAX).nullable(),
  /** Who does it: a participant or another agent of the business; null for the founder's own step. */
  agent_id: z.string().nullable(),
  /** `{ type, params, agent_id }` exactly as the plan compiler writes it. */
  action: PlanAction,
});
export type TeamCallWrapUpAction = z.infer<typeof TeamCallWrapUpAction>;

export const TeamCallWrapUpOutput = z.object({
  /** Plain text: what was discussed and agreed. */
  summary: z.string().min(1).max(TEAM_CALL_SUMMARY_MAX),
  actions: z.array(TeamCallWrapUpAction).max(TEAM_CALL_LIMITS.maxActionsPerCall),
});
export type TeamCallWrapUpOutput = z.infer<typeof TeamCallWrapUpOutput>;

// ---------------------------------------------------------------------------------------------------------------------
// What the model calls send (repaired locally into the outputs above)
// ---------------------------------------------------------------------------------------------------------------------

export const TeamCallTurnsDraft = z.object({
  turns: z
    .array(
      z.object({
        agent_id: z.string().describe("The id of the participant who speaks, from participants."),
        to: TeamCallTurnAddressee.describe('"founder", "team", or {"agent_id": "<id>"} for one teammate on the call.'),
        text: z.string().describe("What the agent says aloud: two to four short spoken sentences, at most 600 characters, plain text; a teammate is named as [[ent:<id>|Name]]."),
      }),
    )
    .describe("1-4 turns in speaking order."),
  hand_back: z.boolean().describe("True when the agents now want the founder: the last turn asks them a question or there is something for them to decide."),
});
export type TeamCallTurnsDraft = z.infer<typeof TeamCallTurnsDraft>;

export const TeamCallWrapUpDraft = z.object({
  summary: z.string().describe("Plain text, at most 1,200 characters: what was discussed and what was agreed."),
  actions: z
    .array(
      z.object({
        title: z.string().describe("One line in the founder's words, ten words at most."),
        detail: z.string().nullable().describe("What done looks like, at most 1,000 characters; null when the title says it all."),
        agent_id: z.string().nullable().describe("Who does it, an id from agents; null for the founder's own step."),
        action: PlanAction,
      }),
    )
    .describe("At most 20 action items, one per agreed step."),
});
export type TeamCallWrapUpDraft = z.infer<typeof TeamCallWrapUpDraft>;
