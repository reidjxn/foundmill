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
  Ellipsis,
  ExternalLink,
  FlaskConical,
  GitMerge,
  Hourglass,
  ListTodo,
  Megaphone,
  Pause,
  Play,
  SearchCheck,
  Square,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { formatCompact, formatMoney } from "../../lib/format";
import { useAgentPersona } from "../foundation/AgentPersona";
import { Avatar } from "../foundation/Avatar";
import { FitText } from "../foundation/FitText";
import { ProvenanceChip } from "../foundation/Chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Icon, type IconComponent } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { ProgressRing } from "../foundation/ProgressRing";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { useGuided, useTerm } from "../guidance/GuidanceProvider";
import { elapsedLabel, etaLabel } from "./progress";
import { SHOUT_PRESETS, ShoutMenu } from "./ShoutMenu";
import type { AgentTileSession, TileControls, TileTask } from "./types";

/** The label of the model upgrade everywhere a tile or a task offers it (the API's `upgradeModel` moves the task to Opus). */
export const STRONGEST_MODEL_LABEL = "Use the strongest model";

export interface TileViewOption {
  id: string;
  label: string;
  icon: IconComponent;
}

/**
 * Pill tone, word and icon for a session: status wins over phase (a blocked testing session reads "Waiting"), and a
 * started session no worker has picked up yet reads "Queued" whatever its stored phase.
 */
export function sessionPill(session: Pick<AgentTileSession, "status" | "phase" | "queued">): { tone: StatusTone; word: string; icon: IconComponent } {
  if (session.queued && session.status === "running") return { tone: "neutral", word: "Queued", icon: Clock };
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
  /** Small tile (16 or 24 on screen): labels collapse to icons, the footer keeps elapsed and the cost with its Estimate label. */
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
 * (Pause / Resume, Nudge, Reassign, Use the strongest model, Stop). While guidance is on the header also carries a
 * visible "…" that opens the same actions as a menu, so hovering is never the only way to find them (UX plan §7.12).
 * Shared by AgentTile and SpecialistTile.
 */
export function TileFrame({ session, views, view, onViewChange, focused, compact, controls = {}, onFocus, onOpenTask, now, children, className }: TileFrameProps) {
  const id = useId();
  const guided = useGuided();
  // Anthropomorphic agents: "Bob (Frontend engineer)" when on, the agent's own name otherwise.
  const who = useAgentPersona().labelFor(session.agent);
  // The footer's token count says what a token is on hover (the definitions map's own sentence; "AI usage" outside a provider).
  const tokensDef = useTerm("tokens");
  const pill = sessionPill(session);
  const pct = Math.round(session.progress * 100);
  // A queued session has not started for real: no clock runs and nothing pulses until a worker picks it up.
  const queued = Boolean(session.queued) && session.status === "running";
  const elapsed = queued ? null : elapsedLabel(session, now);
  const eta = queued ? null : etaLabel(session.etaAt, now);
  const live = !queued && (session.status === "running" || session.status === "review" || session.status === "merging");
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
  const canUpgrade = !!controls.onUpgradeModel && session.agent.model !== "opus";
  const hasControls = Boolean(controls.onPause || controls.onResume || controls.onShout || controls.onReassign || canUpgrade || controls.onOpenInClaudeCode || controls.onStop);

  return (
    <article
      aria-label={`${who}: ${session.task.title}`}
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
          <Avatar size={24} name={who} agent={{ seed: session.agent.seed, dept: session.agent.dept, personaKey: session.agent.personaKey }} status={session.agent.status} presence={live ? "live" : undefined} />
          {/* Name over task, each on one line of the slot's full width. */}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="block min-w-0 text-action font-semibold leading-4 text-primary" title={who} data-tile-name>
              <FitText minPx={11} tooltip={false}>
                {who}
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
          {/* Guided: the same actions as the hover toolbar, behind a visible "…" (hover is never the only path). */}
          {guided && hasControls ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={Ellipsis} label={`More actions for ${who}`} size="sm" variant="ghost" className="shrink-0" data-tile-actions="" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>{who}</DropdownMenuLabel>
                {canResume ? (
                  <DropdownMenuItem onSelect={() => controls.onResume?.(session.id)}>
                    <Icon icon={Play} size="inline" className="text-secondary" />
                    Resume
                  </DropdownMenuItem>
                ) : controls.onPause ? (
                  <DropdownMenuItem disabled={!canPause} onSelect={() => controls.onPause?.(session.id)}>
                    <Icon icon={Pause} size="inline" className="text-secondary" />
                    Pause
                  </DropdownMenuItem>
                ) : null}
                {controls.onShout ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={over}>
                      <Icon icon={Megaphone} size="inline" className="text-secondary" />
                      Nudge
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-64">
                      {SHOUT_PRESETS.map((p) => (
                        <DropdownMenuItem key={p.key} onSelect={() => controls.onShout?.(session.id, { preset: p.key, text: p.label })}>
                          {p.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                {controls.onReassign ? (
                  <DropdownMenuItem disabled={over} onSelect={() => controls.onReassign?.(session.id)}>
                    <Icon icon={UserRoundCog} size="inline" className="text-secondary" />
                    Reassign
                  </DropdownMenuItem>
                ) : null}
                {canUpgrade ? (
                  <DropdownMenuItem disabled={over} onSelect={() => controls.onUpgradeModel?.(session.id)}>
                    <Icon icon={ArrowUpCircle} size="inline" className="text-secondary" />
                    {STRONGEST_MODEL_LABEL}
                  </DropdownMenuItem>
                ) : null}
                {controls.onOpenInClaudeCode ? (
                  <DropdownMenuItem onSelect={() => controls.onOpenInClaudeCode?.(session.id)}>
                    <Icon icon={ExternalLink} size="inline" className="text-secondary" />
                    Open in Claude Code
                  </DropdownMenuItem>
                ) : null}
                {controls.onStop ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="danger" disabled={over} onSelect={() => controls.onStop?.(session.id)}>
                      <Icon icon={Square} size="inline" />
                      Stop and discard
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      {/* The body and its hover controls: the controls float at the body's top right whatever the header's height. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          role="toolbar"
          aria-label={`Controls for ${who}`}
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
          {controls.onShout ? <ShoutMenu target={who} disabled={over} onShout={(s) => controls.onShout?.(session.id, s)} /> : null}
          {controls.onReassign ? <IconButton icon={UserRoundCog} label="Reassign" size="sm" disabled={over} onClick={() => controls.onReassign?.(session.id)} /> : null}
          {canUpgrade ? <IconButton icon={ArrowUpCircle} label={STRONGEST_MODEL_LABEL} size="sm" disabled={over} onClick={() => controls.onUpgradeModel?.(session.id)} /> : null}
          {controls.onOpenInClaudeCode ? <IconButton icon={ExternalLink} label="Open in Claude Code" size="sm" onClick={() => controls.onOpenInClaudeCode?.(session.id)} /> : null}
          {controls.onStop ? <IconButton icon={Square} label="Stop and discard" size="sm" variant="ghost" className="text-status-bad hover:bg-status-bad/12" disabled={over} onClick={() => controls.onStop?.(session.id)} /> : null}
        </div>

        {/* The body clips: an empty terminal's prompt in a small tile never grows over the header. */}
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabIds[views.findIndex((v) => v.id === view)] ?? tabIds[0]} className="min-h-0 flex-1 overflow-hidden bg-ink">
          {children}
        </div>
      </div>

      {/* Footer: one line that never wraps. Items drop out by priority as the tile narrows (tokens first, then the
          note, then the ETA and the icons); elapsed and the cost with its Estimate label always stay, the label as a
          chip where there is room and as the plain word in the smallest tiles. */}
      <footer className="@container/foot flex h-control-sm shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line px-2.5 text-small text-secondary tabular-nums" data-testid="tile-footer">
        {elapsed === null ? (
          <span className="inline-flex shrink-0 items-center gap-1" title="Waiting for a worker to pick the session up" data-tile-queued>
            <Icon icon={Clock} size={12} className="hidden text-tertiary @xs/foot:inline" />
            Queued
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1" title="Elapsed">
            <Icon icon={Clock} size={12} className="hidden text-tertiary @xs/foot:inline" />
            {elapsed}
          </span>
        )}
        {!compact || focused ? (
          <span className="hidden shrink-0 items-center gap-1 @xl/foot:inline-flex" title={tokensDef ? `${tokensDef.word}: ${tokensDef.short}` : "AI usage"}>
            <Icon icon={CircleDot} size={12} className="text-tertiary" />
            {formatCompact(session.tokens)}
            <span className="text-tertiary">tokens</span>
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center gap-1.5" title="Cost (estimate)">
          <Icon icon={Coins} size={12} className="hidden text-tertiary @xs/foot:inline" />
          {formatMoney(session.cost)}
          {/* Every cost carries its Estimate label at every width: the chip where it fits, the word in the smallest tiles. */}
          <ProvenanceChip kind="estimate" className="hidden @xs/foot:inline-flex" />
          <ProvenanceChip kind="estimate" appearance="word" className="@xs/foot:hidden" />
        </span>
        {eta && !over ? (
          <span className="hidden shrink-0 items-center gap-1 @xs/foot:inline-flex" title="Estimated time remaining">
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
