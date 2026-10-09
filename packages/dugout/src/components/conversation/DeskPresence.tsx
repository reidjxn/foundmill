import type { CSSProperties, HTMLAttributes } from "react";
import { Bot } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar, type AvatarPresence, type AvatarSurface } from "../foundation/Avatar";
import { Icon } from "../foundation/Icon";
import { presenceWords, toneClass, type DeskLiveState, type DeskPersona } from "./types";

const AVATAR_PRESENCE: Record<DeskLiveState, AvatarPresence> = {
  live: "live",
  working: "working",
  available: "available",
  away: "away",
  down: "down",
};

export type DeskPresenceLayout = "column" | "band" | "head";

export interface DeskPresenceProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  persona: DeskPersona;
  /** The agent's reply is in flight: "Live · typing", the portrait breathes. */
  replying?: boolean;
  /** column: the inline desk's 156 px presence column. band: across the top of the sheet. head: the compact one-liner. */
  layout?: DeskPresenceLayout;
  /** The surface behind the portrait (its presence dot's cut-out). */
  surface?: AvatarSurface;
}

/** "Live · typing" with the dots, "In a session", "Available", "Away", "Down · back 14:30". */
export function DeskStateLine({
  persona,
  replying = false,
  className,
}: {
  persona: DeskPersona;
  replying?: boolean;
  className?: string;
}) {
  const { state, words } = presenceWords(persona, replying);
  return (
    <span className={cn("desk-state", className)} data-state={state} data-testid="desk-state">
      <span aria-hidden data-dot="" />
      <span>{words}</span>
      {replying ? (
        <span aria-hidden className={cn("typing-dots ml-0.5", toneClass(persona.dept))}>
          <span />
          <span />
          <span />
        </span>
      ) : null}
    </span>
  );
}

/** The "Now" card: what the agent is doing right now, and how far through it (when known). */
export function DeskNow({ persona, className }: { persona: DeskPersona; className?: string }) {
  if (!persona.doingNow) return null;
  const p = persona.progress;
  const pct =
    typeof p === "number" && Number.isFinite(p)
      ? Math.round(Math.min(1, Math.max(0, p)) * 100)
      : null;
  return (
    <div className={cn("desk-now", toneClass(persona.dept), className)} data-testid="desk-now">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-primary">Now</span>
        {pct !== null ? (
          <span className="font-mono text-micro tabular text-tertiary">{pct}%</span>
        ) : null}
      </div>
      <span>{persona.doingNow}</span>
      {pct !== null ? (
        <div
          className="desk-progress"
          role="progressbar"
          aria-label={`${persona.doingNow}: progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ "--progress": pct / 100 } as CSSProperties} />
        </div>
      ) : null}
    </div>
  );
}

/** "AI agent": agents feel like colleagues, and never pass as people. */
export function AiAgentTag({ className }: { className?: string }) {
  return (
    <span className={cn("desk-ai-tag", className)}>
      <Icon icon={Bot} size={12} />
      AI agent
    </span>
  );
}

/**
 * The agent at their desk (DIRECTION #6): a live portrait with its status ring and presence (breathing while live or
 * in a session) on a soft halo of the agent's colour, the name in display type, the role, the "AI agent" marker, the
 * state line and the Now card. Server-safe.
 */
export function DeskPresence({
  persona,
  replying = false,
  layout = "column",
  surface = "surface-1",
  className,
  ...rest
}: DeskPresenceProps) {
  const { state } = presenceWords(persona, replying);
  const live = state === "live" || state === "working";
  const portrait = (size: number) => (
    <span className="desk-portrait" data-live={live || undefined}>
      <Avatar
        size={size}
        name={persona.name}
        agent={{ seed: persona.avatarSeed, dept: persona.dept }}
        status={persona.status}
        presence={AVATAR_PRESENCE[state]}
        surface={surface}
      />
    </span>
  );

  if (layout === "head") {
    return (
      <header
        className={cn("desk-head", toneClass(persona.dept), className)}
        data-testid="desk-presence"
        data-layout="head"
        {...rest}
      >
        {portrait(36)}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-title font-semibold text-primary">{persona.name}</span>
            <span className="text-small text-tertiary">{persona.role}</span>
          </div>
          <DeskStateLine persona={persona} replying={replying} />
        </div>
        <AiAgentTag />
      </header>
    );
  }

  if (layout === "band") {
    return (
      <header
        className={cn("desk-band", toneClass(persona.dept), className)}
        data-testid="desk-presence"
        data-layout="band"
        {...rest}
      >
        <div className="flex min-w-0 items-center gap-4">
          {portrait(64)}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-display-md text-primary">{persona.name}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-small text-tertiary">
              <span>{persona.role}</span>
              <AiAgentTag />
            </div>
            <DeskStateLine persona={persona} replying={replying} className="mt-1" />
          </div>
        </div>
        <DeskNow persona={persona} />
      </header>
    );
  }

  return (
    <aside
      className={cn("desk-presence", toneClass(persona.dept), className)}
      aria-label={`${persona.name}, ${persona.role}`}
      data-testid="desk-presence"
      data-layout="column"
      {...rest}
    >
      {portrait(68)}
      <span className="t-display-md mt-4 text-primary">{persona.name}</span>
      <span className="mt-0.5 text-small text-tertiary">{persona.role}</span>
      <AiAgentTag className="mt-2" />
      <DeskStateLine persona={persona} replying={replying} className="mt-3" />
      <DeskNow persona={persona} className="mt-2" />
    </aside>
  );
}
