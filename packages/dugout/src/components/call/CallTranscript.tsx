"use client";
import { useEffect, useRef, type HTMLAttributes } from "react";
import { X } from "lucide-react";
import { TEAM_CALL_WORDS, type TeamCallParticipantView, type TeamCallTurnView } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { EntityText } from "../data/EntityText";
import { useFormatters } from "../foundation/DateFormatProvider";
import { IconButton } from "../foundation/IconButton";
import { toneClass } from "../conversation/types";
import { Panel } from "../shell/Panel";
import { useCallAgentDisplay } from "./identity";

export interface CallTranscriptProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "children"> {
  turns: readonly TeamCallTurnView[];
  participants: readonly TeamCallParticipantView[];
  /** The turn being spoken now: its row is lit in the speaker's color. */
  speakingTurnId?: string | null;
  /** Shows a close button (the transcript toggle's other end). */
  onClose?: () => void;
}

/**
 * The right rail: every turn with its speaker label (`labelFor`; "You" for the founder), the time in the person's own
 * date format (`useFormatters`) and the words, with names rendered as EntityLinks. Follows the newest turn.
 */
export function CallTranscript({ turns, participants, speakingTurnId = null, onClose, className, ...rest }: CallTranscriptProps) {
  const display = useCallAgentDisplay();
  const { formatTime } = useFormatters();
  const end = useRef<HTMLDivElement>(null);
  const byId = new Map(participants.map((p) => [p.agentId, p] as const));
  useEffect(() => {
    // Jumps, never scrolls smoothly: nothing here moves under reduced motion.
    const el = end.current?.closest<HTMLElement>("[data-panel-body]");
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length]);
  return (
    <Panel
      title="Transcript"
      meta={`${turns.length} ${turns.length === 1 ? "turn" : "turns"}`}
      actions={onClose ? <IconButton icon={X} label="Close transcript" size="sm" onClick={onClose} /> : undefined}
      flush
      className={cn("min-h-0", className)}
      bodyClassName="min-h-0 overflow-y-auto"
      data-testid="call-transcript"
      {...rest}
    >
      <div role="log" aria-label="Transcript" tabIndex={0} className="py-1 focus-visible:shadow-ring">
        {turns.length === 0 ? <p className="px-3 py-2 text-small text-tertiary">{TEAM_CALL_WORDS.listening}</p> : null}
        {turns.map((t) => {
          const p = t.speaker === "agent" && t.agentId ? byId.get(t.agentId) : undefined;
          const d = p ? display(p) : null;
          const label = t.speaker === "founder" ? TEAM_CALL_WORDS.you : (d?.label ?? "Team");
          return (
            <div key={t.id} className={cn("call-turn", d ? toneClass(d.dept) : "tone-kit-lift")} data-speaking={t.id === speakingTurnId || undefined} data-testid="call-turn" data-speaker={t.speaker}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-small font-semibold" style={{ color: "var(--tone)" }} data-testid="call-turn-speaker">
                    {label}
                  </span>
                  <time className="shrink-0 font-mono text-micro tabular text-tertiary" dateTime={t.createdAt} data-testid="call-turn-time">
                    {formatTime(new Date(t.createdAt))}
                  </time>
                </div>
                <p className="break-words text-body text-primary">
                  <EntityText>{t.text}</EntityText>
                </p>
                {t.via === "typed" ? <span className="text-micro text-tertiary">Typed</span> : null}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </Panel>
  );
}
