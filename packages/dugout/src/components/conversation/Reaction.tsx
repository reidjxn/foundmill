import type { HTMLAttributes } from "react";
import { Check, Lightbulb, ThumbsUp, TriangleAlert } from "lucide-react";
import type { AgentReaction, DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "../foundation/Icon";
import { toneClass } from "./types";

/** A Lucide glyph per reaction: never an emoji (DIRECTION #6). */
export const REACTION_ICONS: Record<Exclude<AgentReaction, "none">, IconComponent> = {
  noted: Check,
  thinking: Lightbulb,
  concerned: TriangleAlert,
  pleased: ThumbsUp,
};

/** The words a screen reader and the tooltip use: "Juno reacted: good question". */
export const REACTION_WORDS: Record<Exclude<AgentReaction, "none">, string> = {
  noted: "noted",
  thinking: "good question",
  concerned: "concerned",
  pleased: "pleased",
};

export interface ReactionProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  reaction: AgentReaction | null | undefined;
  /** Who reacted ("Juno"). */
  by: string;
  /** The agent's department colour; a concerned reaction always uses the warning tone. */
  dept?: DeptColourToken | "kit";
}

/**
 * The agent's reaction to a founder message: a 22 px icon disc in the agent's colour, popping onto the bubble's corner
 * on the spring curve. Place it inside a positioned bubble. `none` renders nothing. Server-safe.
 */
export function Reaction({ reaction, by, dept, className, ...rest }: ReactionProps) {
  if (!reaction || reaction === "none") return null;
  const label = `${by} reacted: ${REACTION_WORDS[reaction]}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "desk-reaction",
        reaction === "concerned" ? "tone-status-warn" : toneClass(dept),
        className,
      )}
      data-reaction={reaction}
      {...rest}
    >
      <Icon icon={REACTION_ICONS[reaction]} size={12} strokeWidth={2.2} />
    </span>
  );
}
