"use client";
import type { CSSProperties, HTMLAttributes } from "react";
import { Ear, MicOff } from "lucide-react";
import { TEAM_CALL_WORDS, type TeamCallParticipantView } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Icon } from "../foundation/Icon";
import { AiAgentTag } from "../conversation/DeskPresence";
import { toneClass } from "../conversation/types";
import { participantIdentity, useCallAgentDisplay } from "./identity";

/** What a tile shows: `speaking` lights it; `listening` while someone else speaks; `thinking` while a reply is written. */
export type CallTileState = "speaking" | "listening" | "idle" | "thinking";
export const CALL_TILE_STATES: readonly CallTileState[] = ["speaking", "listening", "idle", "thinking"];

const STATE_WORD: Record<CallTileState, string> = { speaking: "Speaking", listening: TEAM_CALL_WORDS.listening, idle: "", thinking: "Thinking" };

/** Three bars: a speaking agent moves on its own; a given level (0..1) sets their height; `still` stops them. */
export function CallLevelBars({ level, still, className }: { level?: number; still?: boolean; className?: string }) {
  const known = typeof level === "number" && Number.isFinite(level);
  const l = known ? Math.min(1, Math.max(0, level as number)) : 0;
  const bar = (scale: number) => ({ "--bar": Math.max(0.2, Math.min(1, l * scale + 0.1)).toFixed(2) }) as CSSProperties;
  return (
    <span aria-hidden className={cn("call-bars", className)} data-level={known ? l.toFixed(2) : undefined} data-still={still || undefined}>
      <span style={known ? bar(0.8) : undefined} />
      <span style={known ? bar(1.1) : undefined} />
      <span style={known ? bar(0.9) : undefined} />
    </span>
  );
}

export interface CallTileProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The agent on this tile. Omit it for the "You" tile. */
  participant?: TeamCallParticipantView;
  /** The founder's display name: the You tile shows their initials (the plate still reads "You"). */
  founderName?: string;
  state?: CallTileState;
  /** 0..1. The You tile's live mic level; an agent's playback level when the app has one (else its bars move on their own). */
  level?: number;
  /** You tile: the mic is off. */
  micOn?: boolean;
  /** "small" is the picture-in-picture You tile of a one-to-one call. */
  size?: "default" | "small";
  /** The portrait's size in px. Default 68 (the largest step of the avatar scale), 36 when `size` is small. */
  avatarSize?: number;
}

/**
 * One tile of the call (TEAM_CALL §6, DESIGN §9 "Team call"): 16:9, the agent's Avatar large and centered, a name plate
 * bottom left reading `nameFor · positionFor`, the "AI agent" marker top right. Speaking lights the tile's edge in the
 * agent's department color with a glow and three level bars (still under reduced motion); thinking shows typing dots.
 * The agent is named and pictured only through `useAgentPersona()` and `Avatar`, as at its desk. Without `participant`
 * it is the founder's tile: initials, "You", a live mic level, a slashed mic when off.
 */
export function CallTile({ participant, founderName = TEAM_CALL_WORDS.you, state = "idle", level, micOn = true, size = "default", avatarSize, className, ...rest }: CallTileProps) {
  const display = useCallAgentDisplay();
  const px = avatarSize ?? (size === "small" ? 36 : 68);
  const word = STATE_WORD[state];

  if (!participant) {
    const speaking = state === "speaking" && micOn;
    return (
      <div
        role="group"
        aria-label={`${TEAM_CALL_WORDS.you}${micOn ? (speaking ? ", speaking" : "") : `, ${TEAM_CALL_WORDS.muted.toLowerCase()}`}`}
        className={cn("call-tile tone-kit-lift", className)}
        data-testid="call-tile"
        data-you=""
        data-state={micOn ? state : "idle"}
        data-size={size}
        {...rest}
      >
        <div className="absolute inset-0 grid place-items-center" data-call-portrait>
          <Avatar size={px} name={founderName} surface="surface-2" />
        </div>
        <div className="call-plate">
          <span className="font-medium text-primary">{TEAM_CALL_WORDS.you}</span>
          {micOn ? (
            <CallLevelBars level={level ?? 0} className="self-center" />
          ) : (
            <span className="inline-flex items-center gap-1 self-center text-micro text-status-bad">
              <Icon icon={MicOff} size={12} />
              {size === "small" ? null : TEAM_CALL_WORDS.muted}
            </span>
          )}
        </div>
      </div>
    );
  }

  const d = display(participant);
  const identity = participantIdentity(participant);
  return (
    <div
      role="group"
      aria-label={[d.name, d.position, "AI agent", word.toLowerCase()].filter(Boolean).join(", ")}
      className={cn("call-tile", toneClass(d.dept), className)}
      data-testid="call-tile"
      data-agent-id={participant.agentId}
      data-state={state}
      data-size={size}
      {...rest}
    >
      <div className="absolute inset-0 grid place-items-center" data-call-portrait>
        <Avatar
          size={px}
          name={d.name}
          agent={{ seed: participant.avatarSeed, dept: d.dept ?? "dept-1", personaKey: identity.personaKey, layer: identity.layer, src: d.portrait }}
          surface="surface-2"
        />
      </div>
      <AiAgentTag className="absolute right-2 top-2 z-[1]" />
      <div className="call-plate" data-testid="call-plate">
        <span className="truncate font-medium text-primary" data-testid="call-name">
          {d.name}
        </span>
        {d.position ? (
          <>
            <span aria-hidden className="text-tertiary">
              ·
            </span>
            <span className="truncate text-secondary" data-testid="call-role">
              {d.position}
            </span>
          </>
        ) : null}
      </div>
      {state === "speaking" ? (
        <span className="absolute bottom-2.5 right-3 z-[1] inline-flex items-center gap-1.5 text-micro text-secondary" data-testid="call-speaking">
          <CallLevelBars level={level} />
          <span className="sr-only">{word}</span>
        </span>
      ) : state === "thinking" ? (
        <span className="absolute bottom-3 right-3 z-[1] inline-flex items-center gap-1.5 text-micro text-secondary" data-testid="call-thinking">
          <span aria-hidden className="typing-dots">
            <span />
            <span />
            <span />
          </span>
          {word}
        </span>
      ) : state === "listening" ? (
        <span className="absolute bottom-2.5 right-3 z-[1] inline-flex items-center gap-1 text-micro text-tertiary" data-testid="call-listening">
          <Icon icon={Ear} size={12} />
          {word}
        </span>
      ) : null}
    </div>
  );
}
