"use client";
import { useState } from "react";
import { GitCompareArrows, ListChecks, MonitorPlay, SquareTerminal } from "lucide-react";
import { useAgentPersona } from "../foundation/AgentPersona";
import { useBuilderView } from "../guidance/BuilderView";
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

/** The views with Builder view off (Nov 8, 2026): the agent's plan and its preview; no terminal and no diff. */
export const FOUNDER_TILE_VIEWS: readonly TileViewOption[] = AGENT_TILE_VIEWS.filter((v) => v.id === "plan" || v.id === "preview").sort((a, b) => (a.id === "plan" ? -1 : b.id === "plan" ? 1 : 0));

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
 * What a session has done that is not terminal output, for an empty terminal (TPD-35): a tool call waiting for the
 * founder's approval first, then the latest note, then the latest tool call. Null when it has done nothing yet.
 */
export function sessionActivity(session: Pick<AgentTileSession, "toolCalls" | "notes" | "awaitingApprovalId" | "files">): string | null {
  const waiting = session.toolCalls.findLast((c) => c.status === "awaiting_approval");
  if (waiting || session.awaitingApprovalId) return `Waiting for your approval${waiting ? `: ${waiting.tool}` : ""}`;
  // The founder's own nudges are not the agent's activity.
  const note = session.notes.findLast((n) => n.source !== "shout");
  if (note) return note.text;
  const call = session.toolCalls.at(-1);
  if (call) return `Called ${call.tool}${call.argsSummary ? ` (${call.argsSummary})` : ""}`;
  const file = session.files.at(-1);
  return file ? `Changed ${file.path}` : null;
}

/**
 * AgentTile (BUILD §5.4, §11.6; DESIGN §8): header, switchable body (Terminal on bg-ink, Diff, Preview, Plan),
 * footer and hover controls. State comes from `reduceSessionEvents` or the app's store.
 */
export function AgentTile({ session, view: viewProp, defaultView = "terminal", onViewChange, focused, compact, controls, onFocus, onOpenTask, now, terminalRenderer, diffEngine, className }: AgentTileProps) {
  const [viewState, setViewState] = useState<TileView>(defaultView);
  // Builder view off: the agent's screen (terminal) and its code (diff) are the engine; the tile opens on the plan.
  const builder = useBuilderView();
  const views = builder ? AGENT_TILE_VIEWS : FOUNDER_TILE_VIEWS;
  const wanted = viewProp ?? viewState;
  const view = (views.some((v) => v.id === wanted) ? wanted : views[0]!.id) as TileView;
  const setView = (v: string) => {
    setViewState(v as TileView);
    onViewChange?.(v as TileView);
  };
  // The activity line names the agent under the reader's preference (its notes carry the stored name).
  const persona = useAgentPersona();
  const raw = sessionActivity(session);
  const activity = raw ? persona.withNames(raw, [session.agent]) : null;
  return (
    <TileFrame session={session} views={views} view={view} onViewChange={setView} focused={focused} compact={compact} controls={controls} onFocus={onFocus} onOpenTask={onOpenTask} now={now} className={className}>
      {view === "terminal" ? (
        <TerminalView
          chunks={session.stdout}
          label={`Terminal output for ${session.agent.name}`}
          renderer={terminalRenderer}
          agentName={session.agent.name}
          brief={session.task.goal}
          compact={compact && !focused}
          queued={Boolean(session.queued) && session.status === "running"}
          live={!session.queued && (session.status === "running" || session.status === "review" || session.status === "merging")}
          activity={activity}
        />
      ) : null}
      {view === "diff" ? <DiffPane files={session.files} engine={diffEngine} hideFiles={compact && !focused} /> : null}
      {view === "preview" ? <PreviewView preview={session.preview} agentName={session.agent.name} now={now} /> : null}
      {view === "plan" ? <PlanView plan={session.plan} tests={session.tests} /> : null}
    </TileFrame>
  );
}
