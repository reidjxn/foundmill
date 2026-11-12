"use client";
import type { HTMLAttributes } from "react";
import { TEAM_CALL_WORDS, type TeamCallParticipantView } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { EntityText } from "../data/EntityText";
import { toneClass } from "../conversation/types";
import { useCallAgentDisplay } from "./identity";

export interface CallCaptionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Who is speaking: an agent on the call, or "founder". Null when nobody is. */
  speaker: TeamCallParticipantView | "founder" | null;
  /** What is being said. Agent text may name teammates as `[[ent:<uuid>|Name]]`; they render as EntityLinks. */
  text: string | null;
}

/**
 * The current line under the stage: the speaker's label (`labelFor`, "Bob (Chief of Staff)" with a persona, else the
 * stored name; "You" for the founder) in the speaker's department color, then the words, with names rendered through
 * EntityText. A polite live region with a fixed height, so the stage does not move when a line comes or goes.
 */
export function CallCaptions({ speaker, text, className, ...rest }: CallCaptionsProps) {
  const display = useCallAgentDisplay();
  const agent = speaker && speaker !== "founder" ? display(speaker) : null;
  const label = speaker === "founder" ? TEAM_CALL_WORDS.you : (agent?.label ?? "");
  return (
    <div
      className={cn("call-captions", agent ? toneClass(agent.dept) : "tone-kit-lift", className)}
      role="log"
      aria-live="polite"
      aria-label="Captions"
      data-testid="call-captions"
      {...rest}
    >
      {text && speaker ? (
        <p>
          <span className="mr-2 font-semibold" style={{ color: "var(--tone)" }} data-testid="call-captions-speaker">
            {label}
          </span>
          <EntityText>{text}</EntityText>
        </p>
      ) : null}
    </div>
  );
}
