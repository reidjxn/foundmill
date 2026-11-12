import type { CSSProperties, HTMLAttributes } from "react";
import { TEAM_CALL_LIMITS, type TeamCallKind, type TeamCallParticipantView } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { CallTile, type CallTileState } from "./CallTile";

/** Most tiles on the stage: eight agents and You. */
export const CALL_STAGE_MAX_TILES = TEAM_CALL_LIMITS.maxAgentsInTeamCall + 1;

/** Columns for n tiles: 1, 2, 2, 2, 3, 3, 3, 3, 3. Stable: a tile's cell never depends on who is speaking. */
export function callStageColumns(tiles: number): number {
  if (tiles <= 1) return 1;
  if (tiles <= 4) return 2;
  return 3;
}

export interface CallStageProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  kind: TeamCallKind;
  /** The agents on the call, in stable order (a tile keeps its place while speakers change). */
  participants: readonly TeamCallParticipantView[];
  /** Who is speaking now (an agent id), if an agent is. */
  speakingAgentId?: string | null;
  /** Agents whose next turn is being written. */
  thinkingAgentIds?: readonly string[];
  /** The founder is speaking (the mic is above the threshold). */
  founderSpeaking?: boolean;
  micOn?: boolean;
  /** 0..1, the founder's live mic level. */
  micLevel?: number;
  /** The founder's display name, for the initials on their tile. */
  founderName?: string;
  /** 0..1, the playing agent's level when the app has one. */
  speakingLevel?: number;
  /** Show the You tile. Default true. */
  showYou?: boolean;
}

/**
 * The stage: one to nine tiles (up to eight agents and You) in a stable grid, each tile keyed by its agent so it stays
 * put while speakers change. In a one-to-one call the agent fills the stage and You is a small tile in its corner.
 * Everyone but the speaker is `listening` while anyone speaks, else `idle`.
 */
export function CallStage({
  kind,
  participants,
  speakingAgentId = null,
  thinkingAgentIds = [],
  founderSpeaking = false,
  micOn = true,
  micLevel = 0,
  founderName,
  speakingLevel,
  showYou = true,
  className,
  style,
  ...rest
}: CallStageProps) {
  const agents = kind === "one_to_one" ? participants.slice(0, 1) : participants.slice(0, TEAM_CALL_LIMITS.maxAgentsInTeamCall);
  const someoneSpeaks = founderSpeaking || speakingAgentId !== null;
  const stateOf = (id: string): CallTileState => {
    if (id === speakingAgentId) return "speaking";
    if (thinkingAgentIds.includes(id)) return "thinking";
    return someoneSpeaks ? "listening" : "idle";
  };
  const youState: CallTileState = founderSpeaking && micOn ? "speaking" : someoneSpeaks ? "listening" : "idle";
  const tiles = agents.length + (showYou ? 1 : 0);
  const cols = kind === "one_to_one" ? 1 : callStageColumns(tiles);
  return (
    <div
      role="group"
      aria-label="Call"
      className={cn("call-stage", className)}
      style={{ "--call-cols": cols, ...style } as CSSProperties}
      data-testid="call-stage"
      data-layout={kind}
      data-tiles={tiles}
      {...rest}
    >
      {agents.map((p) => (
        <CallTile key={p.agentId} participant={p} state={stateOf(p.agentId)} level={p.agentId === speakingAgentId ? speakingLevel : undefined} />
      ))}
      {showYou ? (
        kind === "one_to_one" ? (
          <div data-call-you="">
            <CallTile founderName={founderName} state={youState} micOn={micOn} level={micLevel} size="small" />
          </div>
        ) : (
          <CallTile founderName={founderName} state={youState} micOn={micOn} level={micLevel} />
        )
      ) : null}
    </div>
  );
}
