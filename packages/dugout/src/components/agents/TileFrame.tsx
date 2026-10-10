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
import { FitText } from "../foundation/FitText";
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

/** The tone's colour and --tone for the phase pill and its icon-only form. */
const PILL_TONE: Record<StatusTone, string> = {
  good: "tone-status-good text-status-good",
  warn: "tone-status-warn text-status-warn",
  bad: "tone-status-bad text-status-bad",
  info: "tone-status-info text-status-info",
  neutral: "tone-secondary text-secondary",
};

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

  const pillToneText = PILL_TONE[pill.tone];
  const noteTone = session.lastNote?.level === "error" ? "text-status-bad" : session.lastNote?.level === "warn" ? "text-status-warn" : "text-primary";

  return (
    <article
      aria-label={`${session.agent.name}: ${session.task.title}`}
      data-session-id={session.id}
      data-status={session.status}
      data-focused={focused || undefined}
      data-compact={compact || undefined}
      onClick={onRootClick}
      className={cn(
        "@container group relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface-1 text-primary shadow-elev-1",
        "transition duration-hover ease-out hover:border-line-strong",
        focused && "tile-focused",
        onFocus && "cursor-pointer",
        className,
      )}
    >
      {/* Header (DIRECTION #15: never clip). A wide tile (focused, or one or two across) keeps one 40 px row: who and
          what, then phase, progress and the view tabs. A narrower tile gives who and what a row of their own at the
          tile's full width and moves phase, progress and tabs to a second row, so the agent's name and the task read
          in full; they step down to 11 px first and end in an ellipsis with a tooltip only as the last resort. Every
          tile of a width gets the same header height, so the bodies of a row line up. */}
      <header
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-2.5 pb-1.5 pt-2 rule-fade",
          "@min-[600px]:h-panel-header @min-[600px]:flex-nowrap @min-[600px]:py-0 @min-[600px]:pr-1.5",
        )}
        data-tile-header
      >
        <div className="flex min-w-0 basis-full items-center gap-2 @min-[600px]:basis-0 @min-[600px]:flex-1" data-tile-identity>
          <Avatar size={24} name={session.agent.name} agent={{ seed: session.agent.seed, dept: session.agent.dept }} status={session.agent.status} presence={live ? "live" : undefined} />
          {/* Name over task, each on one line of the slot's full width. */}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="block min-w-0 text-action font-semibold leading-4 text-primary" title={session.agent.name} data-tile-name>
              <FitText minPx={11} tooltip={false}>
                {session.agent.name}
              </FitText>
            </span>
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
                className="entity-link block min-w-0 text-small leading-4 text-secondary"
                data-tile-task
              >
                <FitText minPx={11} tooltip={false}>
                  {session.task.title}
                </FitText>
              </a>
            ) : (
              <span className="block min-w-0 text-small leading-4 text-secondary" title={session.task.title} data-tile-task>
                <FitText minPx={11} tooltip={false}>
                  {session.task.title}
                </FitText>
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 @min-[600px]:flex-none" data-tile-status>
          {/* The phase pill never clips: in a tile under 300 px it becomes its icon with the word in a tooltip. */}
          <StatusPill tone={pill.tone} icon={pill.icon} pulse={live && !compact} className="hidden shrink-0 @min-[300px]:inline-flex">
            {pill.word}
          </StatusPill>
          <Tooltip content={pill.word}>
            <span className={cn("chip-tone inline-flex size-control-xs shrink-0 items-center justify-center rounded-pill border @min-[300px]:hidden", pillToneText)} data-tone={pill.tone}>
              <Icon icon={pill.icon} size="inline" label={pill.word} />
            </span>
          </Tooltip>
          <span className="inline-flex shrink-0 items-center gap-1">
            <ProgressRing value={session.progress} size={16} tone={progressTone(session)} label={`Progress ${pct}%`} />
            <span className="hidden text-small text-secondary tabular-nums @min-[300px]:inline" aria-hidden data-tile-progress>
              {pct}%
            </span>
          </span>
          <div role="tablist" aria-label="Tile view" onKeyDown={onTabKey} className="seg-track ml-auto h-control-sm shrink-0" data-tile-tabs>
            {views.map((v, i) => {
              const selected = v.id === view;
              const tab = (
                <button
                  key={v.id}
                  id={tabIds[i]}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`${id}-panel`}
                  aria-label={v.label}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onViewChange(v.id)}
                  className={cn(
                    "relative inline-flex h-full items-center gap-1 rounded-sm px-1.5 font-body text-action-sm font-medium text-tertiary outline-none transition-colors duration-hover ease-out",
                    "hover:text-primary focus-visible:shadow-ring",
                    selected && "tile-tab-on text-primary",
                  )}
                >
                  <Icon icon={v.icon} size="inline" />
                  {/* Labels only where the identity keeps its room (a tile 800 px or wider); otherwise the icon carries a tooltip. */}
                  {!compact || focused ? <span className="hidden whitespace-nowrap @min-[800px]:inline">{v.label}</span> : null}
                </button>
              );
              return (
                <Tooltip key={v.id} content={v.label}>
                  {tab}
                </Tooltip>
              );
            })}
          </div>
        </div>
      </header>

      {/* The body and its hover controls: the controls float at the body's top right whatever the header's height. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          role="toolbar"
          aria-label={`Controls for ${session.agent.name}`}
          className={cn(
            "surface-overlay absolute right-2 top-2 z-10 flex items-center gap-0.5 p-0.5",
            "transition-opacity duration-hover ease-out",
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

        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabIds[views.findIndex((v) => v.id === view)] ?? tabIds[0]} className="min-h-0 flex-1 bg-ink">
          {children}
        </div>
      </div>

      {/* Footer: one line that never wraps. Items drop out by priority as the tile narrows (tokens first, then the
          note); elapsed, cost with its Estimate chip and ETA always stay. */}
      <footer className="@container/foot flex h-control-sm shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line px-2.5 text-small text-secondary tabular-nums" data-testid="tile-footer">
        <span className="inline-flex shrink-0 items-center gap-1" title="Elapsed">
          <Icon icon={Clock} size={12} className="text-tertiary" />
          {elapsed}
        </span>
        {!compact || focused ? (
          <span className="hidden shrink-0 items-center gap-1 @xl/foot:inline-flex" title="Tokens">
            <Icon icon={CircleDot} size={12} className="text-tertiary" />
            {formatCompact(session.tokens)}
            <span className="text-tertiary">tokens</span>
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center gap-1.5" title="Cost (estimate)">
          <Icon icon={Coins} size={12} className="text-tertiary" />
          {formatMoney(session.cost)}
          {/* The Estimate label stays wherever the footer has room for it (the focus rail included), not only on big tiles. */}
          <ProvenanceChip kind="estimate" className="hidden @xs/foot:inline-flex" />
        </span>
        {eta && !over ? (
          <span className="inline-flex shrink-0 items-center gap-1" title="Estimated time remaining">
            <Icon icon={Hourglass} size={12} className="text-tertiary" />
            <span className="text-tertiary">ETA</span> {eta}
          </span>
        ) : null}
        {session.lastNote && (!compact || focused) ? (
          <span className={cn("hidden min-w-0 flex-1 truncate @2xl/foot:block", noteTone)} title={session.lastNote.text} data-allow-truncate="">
            {session.lastNote.source === "shout" ? "Nudge: " : ""}
            {session.lastNote.text}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
