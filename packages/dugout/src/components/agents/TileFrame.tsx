"use client";
import { useId, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  ArrowUpCircle,
  Ban,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleX,
  Clock,
  Coins,
  ExternalLink,
  FlaskConical,
  GitMerge,
  Hourglass,
  ListTodo,
  Pause,
  Play,
  SearchCheck,
  Square,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCompact, formatMoney } from "../../lib/format";
import { Avatar } from "../foundation/Avatar";
import { ProvenanceChip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { ProgressRing } from "../foundation/ProgressRing";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { elapsedLabel, etaLabel } from "./progress";
import { ShoutMenu } from "./ShoutMenu";
import type { AgentTileSession, TileControls, TileTask } from "./types";

export interface TileViewOption {
  id: string;
  label: string;
  icon: IconComponent;
}

/** Pill tone, word and icon for a session: status wins over phase (a blocked testing session reads "Waiting"). */
export function sessionPill(session: Pick<AgentTileSession, "status" | "phase">): { tone: StatusTone; word: string; icon: IconComponent } {
  switch (session.status) {
    case "blocked":
      return { tone: "warn", word: "Waiting", icon: Hourglass };
    case "paused":
      return { tone: "neutral", word: "Paused", icon: CirclePause };
    case "failed":
      return { tone: "bad", word: "Failed", icon: CircleX };
    case "stopped":
      return { tone: "neutral", word: "Stopped", icon: Ban };
    case "done":
      return { tone: "good", word: "Done", icon: CircleCheck };
    default:
      break;
  }
  switch (session.phase) {
    case "planning":
      return { tone: "info", word: "Planning", icon: ListTodo };
    case "implementing":
      return { tone: "info", word: "Implementing", icon: Wrench };
    case "testing":
      return { tone: "info", word: "Testing", icon: FlaskConical };
    case "review":
      return { tone: "info", word: "Review", icon: SearchCheck };
    case "merge":
      return { tone: "info", word: "Merging", icon: GitMerge };
    case "done":
      return { tone: "good", word: "Done", icon: CircleCheck };
  }
}

export function progressTone(session: Pick<AgentTileSession, "status">): "good" | "warn" | "bad" | "kit" {
  if (session.status === "failed" || session.status === "stopped") return "bad";
  if (session.status === "blocked") return "warn";
  if (session.status === "done") return "good";
  return "kit";
}

/** True when a click landed on something interactive (so the tile does not steal it as a focus click). */
export function isInteractiveTarget(target: EventTarget | null, root: HTMLElement | null): boolean {
  let el = target as HTMLElement | null;
  while (el && el !== root) {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.getAttribute("role") === "button" || el.getAttribute("role") === "tab") return true;
    el = el.parentElement;
  }
  return false;
}

export interface TileFrameProps {
  session: AgentTileSession;
  views: readonly TileViewOption[];
  view: string;
  onViewChange: (id: string) => void;
  /** Focused tile: two-thirds width with a rail (TileGrid). Labels and controls stay visible. */
  focused?: boolean;
  /** Small tile (16 or 24 on screen): labels collapse to icons, the footer keeps elapsed, cost and ETA. */
  compact?: boolean;
  controls?: TileControls;
  /** Click on the header or body (not on a control). */
  onFocus?: (sessionId: string) => void;
  onOpenTask?: (task: TileTask) => void;
  /** For deterministic elapsed/ETA in tests and stories. */
  now?: Date;
  children: ReactNode;
  className?: string;
}

/**
 * The AgentTile chrome (DESIGN §8): 32 px header (avatar 20 with status ring, name, task link, phase pill, progress
 * ring 16), body slot, 24 px small-style footer (elapsed, tokens, cost, ETA, last note) and hover controls
 * (Pause / Resume, Shout, Reassign, Upgrade to Opus, Stop). Shared by AgentTile and SpecialistTile.
 */
export function TileFrame({ session, views, view, onViewChange, focused, compact, controls = {}, onFocus, onOpenTask, now, children, className }: TileFrameProps) {
  const id = useId();
  const pill = sessionPill(session);
  const pct = Math.round(session.progress * 100);
  const elapsed = elapsedLabel(session, now);
  const eta = etaLabel(session.etaAt, now);
  const live = session.status === "running" || session.status === "review" || session.status === "merging";
  const canPause = live && !!controls.onPause;
  const canResume = (session.status === "paused" || session.status === "blocked") && !!controls.onResume;
  const over = session.status === "done" || session.status === "failed" || session.status === "stopped";
  const tabIds = views.map((v) => `${id}-tab-${v.id}`);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = views.findIndex((v) => v.id === view);
    if (i < 0) return;
    let next: number;
    if (e.key === "ArrowRight") next = (i + 1) % views.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + views.length) % views.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = views.length - 1;
    else return;
    e.preventDefault();
    const target = views[next];
    if (target) {
      onViewChange(target.id);
      document.getElementById(tabIds[next] as string)?.focus();
    }
  };

  const onRootClick = (e: MouseEvent<HTMLElement>) => {
    if (!onFocus) return;
    if (isInteractiveTarget(e.target, e.currentTarget)) return;
    onFocus(session.id);
  };

  return (
    <article
      aria-label={`${session.agent.name}: ${session.task.title}`}
      data-session-id={session.id}
      data-status={session.status}
      data-focused={focused || undefined}
      data-compact={compact || undefined}
      onClick={onRootClick}
      className={cn(
        "group relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel text-primary",
        "border border-subtle shadow-inner-highlight",
        focused && "border-kit-primary/60",
        onFocus && "cursor-pointer",
        className,
      )}
    >
      <header className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt pl-2 pr-1">
        <Avatar size={20} name={session.agent.name} agent={{ seed: session.agent.seed, dept: session.agent.dept }} status={session.agent.status} />
        <span className="shrink-0 text-body-strong">{session.agent.name}</span>
        {onOpenTask || session.task.href ? (
          <a
            href={session.task.href ?? `#${session.task.id}`}
            onClick={(e) => {
              if (onOpenTask) {
                e.preventDefault();
                onOpenTask(session.task);
              }
            }}
            title={session.task.title}
            className="entity-link min-w-0 flex-1 truncate text-body text-primary"
          >
            {session.task.title}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-body text-secondary" title={session.task.title}>
            {session.task.title}
          </span>
        )}
        {compact && !focused ? (
          <Tooltip content={pill.word}>
            <span className={cn("inline-flex", pill.tone === "good" ? "text-status-good" : pill.tone === "warn" ? "text-status-warn" : pill.tone === "bad" ? "text-status-bad" : pill.tone === "info" ? "text-status-info" : "text-secondary")}>
              <Icon icon={pill.icon} size="inline" label={pill.word} />
            </span>
          </Tooltip>
        ) : (
          <StatusPill tone={pill.tone} icon={pill.icon} pulse={live && !compact}>
            {pill.word}
          </StatusPill>
        )}
        <ProgressRing value={session.progress} size={16} tone={progressTone(session)} label={`Progress ${pct}%`} />
        <div role="tablist" aria-label="Tile view" onKeyDown={onTabKey} className="ml-1 flex items-center gap-px">
          {views.map((v, i) => {
            const selected = v.id === view;
            return (
              <button
                key={v.id}
                id={tabIds[i]}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                title={v.label}
                onClick={() => onViewChange(v.id)}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-chip px-1.5 t-tab-sm text-secondary outline-none transition-colors duration-micro ease-dugout",
                  "hover:bg-white/6 hover:text-primary focus-visible:outline-2 focus-visible:outline-link",
                  selected && "bg-panel text-primary",
                )}
              >
                <Icon icon={v.icon} size="inline" />
                {focused || !compact ? <span className={cn(!focused && "hidden wide:inline")}>{v.label}</span> : null}
              </button>
            );
          })}
        </div>
      </header>

      <div
        role="toolbar"
        aria-label={`Controls for ${session.agent.name}`}
        className={cn(
          "absolute right-1 top-9 z-10 flex items-center gap-0.5 rounded-panel border border-subtle bg-panel-alt/95 p-0.5 shadow-overlay",
          "transition-opacity duration-micro ease-dugout",
          focused ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {canResume ? (
          <IconButton icon={Play} label="Resume" size="sm" onClick={() => controls.onResume?.(session.id)} />
        ) : (
          <IconButton icon={Pause} label="Pause" size="sm" disabled={!canPause} onClick={() => controls.onPause?.(session.id)} />
        )}
        {controls.onShout ? <ShoutMenu target={session.agent.name} disabled={over} onShout={(s) => controls.onShout?.(session.id, s)} /> : null}
        {controls.onReassign ? <IconButton icon={UserRoundCog} label="Reassign" size="sm" disabled={over} onClick={() => controls.onReassign?.(session.id)} /> : null}
        {controls.onUpgradeModel && session.agent.model !== "opus" ? (
          <IconButton icon={ArrowUpCircle} label="Upgrade to Opus" size="sm" disabled={over} onClick={() => controls.onUpgradeModel?.(session.id)} />
        ) : null}
        {controls.onOpenInClaudeCode ? <IconButton icon={ExternalLink} label="Open in Claude Code" size="sm" onClick={() => controls.onOpenInClaudeCode?.(session.id)} /> : null}
        {controls.onStop ? <IconButton icon={Square} label="Stop and discard" size="sm" variant="ghost" className="text-status-bad hover:bg-status-bad/12" disabled={over} onClick={() => controls.onStop?.(session.id)} /> : null}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabIds[views.findIndex((v) => v.id === view)] ?? tabIds[0]} className="min-h-0 flex-1">
        {children}
      </div>

      <footer className="flex h-6 shrink-0 items-center gap-2 overflow-hidden border-t border-subtle bg-panel px-2 text-small text-secondary tabular-nums" data-testid="tile-footer">
        <span className="inline-flex items-center gap-1" title="Elapsed">
          <Icon icon={Clock} size={12} />
          {elapsed}
        </span>
        {!compact || focused ? (
          <span className="inline-flex items-center gap-1" title="Tokens">
            <Icon icon={CircleDot} size={12} />
            {formatCompact(session.tokens)} tokens
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1" title="Cost (estimate)">
          <Icon icon={Coins} size={12} />
          {formatMoney(session.cost)}
        </span>
        {eta && !over ? (
          <span className="inline-flex items-center gap-1" title="Estimated time remaining">
            <Icon icon={Hourglass} size={12} />
            ETA {eta}
          </span>
        ) : null}
        {!compact || focused ? <ProvenanceChip kind="estimate" className="h-4 px-1 text-[10px]" /> : null}
        {session.lastNote && (!compact || focused) ? (
          <span className={cn("min-w-0 flex-1 truncate", session.lastNote.level === "error" ? "text-status-bad" : session.lastNote.level === "warn" ? "text-status-warn" : "text-primary")} title={session.lastNote.text}>
            {session.lastNote.source === "shout" ? "Nudge: " : ""}
            {session.lastNote.text}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
