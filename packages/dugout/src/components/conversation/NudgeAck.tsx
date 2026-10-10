import type { HTMLAttributes } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { toneClass } from "./types";

export interface NudgeAckProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The agent who heard the nudge. */
  name: string;
  avatarSeed: string | number;
  dept?: DeptColourToken | null;
  /** The acknowledgement in the agent's own voice (`voice.ack`, no model call): "Noted.", "Understood." */
  text: string;
  /** What the founder said, for screen readers ("Nudge: Focus on tests"). */
  nudge?: string | null;
}

/**
 * One bubble from the agent after a nudge (audit-conversation §4 "Nudge"): its portrait and a short acknowledgement in
 * its own voice, in its department's tint. Deterministic and instant: nothing is asked of a model. The caller places it
 * (over the tile it answers) and decides how long it stays. Server-safe.
 */
export function NudgeAck({ name, avatarSeed, dept, text, nudge, className, ...rest }: NudgeAckProps) {
  return (
    <div role="status" aria-live="polite" className={cn("nudge-ack", toneClass(dept ?? undefined), className)} data-testid="nudge-ack" {...rest}>
      <Avatar size={22} name={name} agent={{ seed: avatarSeed, dept: dept ?? "dept-1" }} surface="surface-2" />
      <div className="desk-bubble desk-arrive" data-author="agent">
        <span className="sr-only">
          {nudge ? `Nudge: ${nudge}. ` : ""}
          {name}:{" "}
        </span>
        {text}
      </div>
    </div>
  );
}
