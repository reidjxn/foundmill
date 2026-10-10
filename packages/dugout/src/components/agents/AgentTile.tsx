"use client";
import { useState } from "react";
import { GitCompareArrows, ListChecks, MonitorPlay, SquareTerminal } from "lucide-react";
import { DiffPane } from "./DiffPane";
import { PlanView } from "./PlanView";
import { PreviewView } from "./PreviewView";
import { TerminalView } from "./TerminalView";
import { TileFrame, type TileViewOption } from "./TileFrame";
import type { AgentTileSession, TileControls, TileTask, TileView } from "./types";

export const AGENT_TILE_VIEWS: readonly TileViewOption[] = [
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "diff", label: "Diff", icon: GitCompareArrows },
  { id: "preview", label: "Preview", icon: MonitorPlay },
  { id: "plan", label: "Plan", icon: ListChecks },
];

export interface AgentTileProps {
  session: AgentTileSession;
  /** Controlled view. */
  view?: TileView;
  defaultView?: TileView;
  onViewChange?: (view: TileView) => void;
  focused?: boolean;
  compact?: boolean;
  controls?: TileControls;
  onFocus?: (sessionId: string) => void;
  onOpenTask?: (task: TileTask) => void;
  now?: Date;
  /** `plain` renders the terminal as a `<pre>` (tests, SSR). Default: xterm in a browser. */
  terminalRenderer?: "xterm" | "plain";
  /** `local` skips Monaco and uses Dugout's DiffView. Default: Monaco, lazy-loaded. */
  diffEngine?: "monaco" | "local";
  className?: string;
}

/**
 * AgentTile (BUILD §5.4, §11.6; DESIGN §8): header, switchable body (Terminal on bg-ink, Diff, Preview, Plan),
 * footer and hover controls. State comes from `reduceSessionEvents` or the app's store.
 */
export function AgentTile({ session, view: viewProp, defaultView = "terminal", onViewChange, focused, compact, controls, onFocus, onOpenTask, now, terminalRenderer, diffEngine, className }: AgentTileProps) {
  const [viewState, setViewState] = useState<TileView>(defaultView);
  const view = viewProp ?? viewState;
  const setView = (v: string) => {
    setViewState(v as TileView);
    onViewChange?.(v as TileView);
  };
  return (
    <TileFrame session={session} views={AGENT_TILE_VIEWS} view={view} onViewChange={setView} focused={focused} compact={compact} controls={controls} onFocus={onFocus} onOpenTask={onOpenTask} now={now} className={className}>
      {view === "terminal" ? <TerminalView chunks={session.stdout} label={`Terminal output for ${session.agent.name}`} renderer={terminalRenderer} agentName={session.agent.name} brief={session.task.goal} compact={compact && !focused} live={session.status === "running" || session.status === "review" || session.status === "merging"} /> : null}
      {view === "diff" ? <DiffPane files={session.files} engine={diffEngine} hideFiles={compact && !focused} /> : null}
      {view === "preview" ? <PreviewView preview={session.preview} agentName={session.agent.name} now={now} /> : null}
      {view === "plan" ? <PlanView plan={session.plan} tests={session.tests} /> : null}
    </TileFrame>
  );
}
