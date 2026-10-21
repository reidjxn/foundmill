"use client";
import { useEffect, useState, type ReactNode } from "react";
import { OctagonX, Play } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { useFormatters } from "../foundation/DateFormatProvider";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import { ConsequenceLine } from "../guidance/ConsequenceLine";
import { Term } from "../guidance/Term";

/** The team is stopped (Stop all agents, a revoked key, used-up credits): the kill switch becomes the way back. */
export interface AgentsStoppedState {
  /** When the team stopped. */
  since?: Date | string | null;
  /** Why, as the founder reads it ("Stop all agents", "the Anthropic key was revoked", "the credits ran out"). */
  reason: string;
  /** Called when an owner or admin confirms the resume. May return a promise; the dialog shows loading until it settles. */
  onResume: () => void | Promise<void>;
  /** Only owners and admins resume; everyone else sees why the team is stopped. */
  canResume: boolean;
  /** What else brings the team back by itself (e.g. "Storing a new key in Settings › Keys resumes the team."). */
  hint?: string | null;
}

export interface StopAllAgentsProps {
  /** Called when the founder confirms. May return a promise; the dialog shows loading until it settles. */
  onConfirm: () => void | Promise<void>;
  /** Number of running sessions, for the confirmation copy. */
  runningCount?: number;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Extra detail under the description (e.g. which agents are mid-task). */
  children?: ReactNode;
  className?: string;
  /** Render the trigger as a full button with a label instead of the icon button. */
  variant?: "icon" | "button";
  /** Set while the team is stopped: the trigger turns into Resume agents (same place, same size). */
  stopped?: AgentsStoppedState | null;
  /**
   * Only owners and admins stop the agents (default true). Everyone else opens the same dialog, which says who can,
   * instead of a confirm the API would refuse (audit RUI-05).
   */
  canStop?: boolean;
  /**
   * How long a pending stop or resume holds the dialog shut (default `STOP_PENDING_ESCAPE_MS`). After that the founder
   * may close it while the request carries on: a request that never answers must not lock the screen until a reload.
   */
  pendingEscapeMs?: number;
}

/** The API's kill-switch budget (30 s) plus a margin: past it a pending stop or resume no longer holds the dialog. */
export const STOP_PENDING_ESCAPE_MS = 35_000;

/** The trigger's tooltip: what it does and the reassurance, in one line (docs/UX_AUDIT_AND_PLAN.md §7.7, B6). */
export const STOP_ALL_TOOLTIP = "Stop all agents (pauses everything, nothing is lost)";

/**
 * The line under the confirm (a `ConsequenceLine`, always shown: a consequence is information, not tutoring): what the
 * stop does, that it costs nothing and that it can be undone (Resume agents).
 */
export const STOP_ALL_CONSEQUENCE = "Running sessions stop now; tasks keep their state. Nothing is deleted.";

/** The confirm dialog's description: the reassurance first, then what stops and who brings it back. Exported for tests. */
export function stopAllDescription(count: number, canStop: boolean): string {
  if (!canStop) return "Only an owner or admin can stop every agent at once. Ask one of them; they find the same button here.";
  const stops = count > 0 ? `${count} running ${count === 1 ? "session stops" : "sessions stop"} now.` : "Every running session stops now.";
  return `Nothing is deleted. ${stops} Tasks keep their state and nothing starts again until an owner or admin resumes the agents.`;
}

/**
 * Stop all agents (BUILD §5.4): visible on every screen, confirms before calling the API. Its tooltip says what it does
 * and that nothing is lost; the dialog opens with "Nothing is deleted." Sessions stop, tasks keep their state and can
 * be resumed. While the team is stopped the same control says so and offers Resume agents (owners and admins), so the
 * way back is where the stop was pulled.
 */
export function StopAllAgents(props: StopAllAgentsProps) {
  if (props.stopped) return <ResumeAgents {...props} stopped={props.stopped} />;
  return <StopAll {...props} />;
}

/**
 * Shared confirm-with-loading state: closes when `action` resolves, keeps the dialog open with the error otherwise.
 * While the action is pending the dialog cannot be dismissed, until `escapeAfterMs` has passed (`slow`): then it can be
 * closed and the request keeps going (audit RES-13).
 */
function useConfirm(action: () => void | Promise<void>, failure: string, open?: boolean, onOpenChange?: (open: boolean) => void, escapeAfterMs: number = STOP_PENDING_ESCAPE_MS) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setSlow(true), escapeAfterMs);
    return () => window.clearTimeout(t);
  }, [loading, escapeAfterMs]);
  const isOpen = open ?? internalOpen;
  // Locked while the request is pending and not yet slow.
  const locked = loading && !slow;
  const setOpen = (next: boolean) => {
    if (locked && !next) return;
    setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setError(null);
  };
  const confirm = async () => {
    setLoading(true);
    setSlow(false);
    setError(null);
    try {
      await action();
      setLoading(false);
      setInternalOpen(false);
      onOpenChange?.(false);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setSlow(false);
    }
  };
  return { isOpen, setOpen, loading, locked, slow: loading && slow, error, confirm };
}

/** The line a slow stop or resume shows once the dialog may be closed. */
function SlowNote({ what }: { what: "stop" | "resume" }) {
  return (
    <p role="status" className="text-small text-secondary" data-testid="stop-all-slow">
      The {what} is taking longer than usual. You can close this: the request keeps going, and each agent&apos;s status shows when it {what === "stop" ? "has stopped" : "is back at work"}.
    </p>
  );
}

function StopAll({ onConfirm, runningCount, open, onOpenChange, disabled, children, className, variant = "icon", pendingEscapeMs, canStop = true }: StopAllAgentsProps) {
  const { isOpen, setOpen, loading, locked, slow, error, confirm } = useConfirm(onConfirm, "The stop request failed. Try again.", open, onOpenChange, pendingEscapeMs);

  const count = runningCount ?? 0;
  // The icon trigger is glass on the brand slab (34 px) with the octagon in a light red; hover warms it towards red.
  const trigger =
    variant === "icon" ? (
      <Tooltip content={STOP_ALL_TOOLTIP}>
        <button
          type="button"
          aria-label="Stop all agents"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn("kitbar-glass kitbar-stop w-kitbar-chip justify-center px-0", className)}
          data-testid="stop-all-trigger"
        >
          <Icon icon={OctagonX} />
        </button>
      </Tooltip>
    ) : (
      <Button icon={OctagonX} variant="danger" disabled={disabled} onClick={() => setOpen(true)} className={className} data-testid="stop-all-trigger">
        Stop all agents
      </Button>
    );

  return (
    <>
      {trigger}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent size="sm" hideClose={locked}>
          <DialogHeader>
            <DialogTitle>{canStop ? "Stop all agents?" : "Stop all agents"}</DialogTitle>
            <DialogDescription>{stopAllDescription(count, canStop)}</DialogDescription>
          </DialogHeader>
          {children || error || slow ? (
            <DialogBody className="flex flex-col gap-2">
              {children}
              {slow ? <SlowNote what="stop" /> : null}
              {error ? (
                <p role="alert" className="text-small text-status-bad">
                  {error}
                </p>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            {/* Focus starts on Cancel, as on every destructive confirm: a stray Enter must not stop the whole team. */}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={locked} autoFocus>
              {slow ? "Close" : canStop ? "Cancel" : "Got it"}
            </Button>
            {canStop ? (
              <Button variant="danger" icon={OctagonX} onClick={confirm} loading={loading}>
                Stop all agents
              </Button>
            ) : null}
            {/* Its own row under the buttons (the footer wraps), lined up with the confirm. */}
            {canStop ? <ConsequenceLine consequence={STOP_ALL_CONSEQUENCE} cost="No cost" reversible className="basis-full justify-end text-right" data-testid="stop-all-consequence" /> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResumeAgents({ stopped, open, onOpenChange, disabled, className, variant = "icon", pendingEscapeMs }: StopAllAgentsProps & { stopped: AgentsStoppedState }) {
  const { formatDateTime } = useFormatters();
  const { isOpen, setOpen, loading, locked, slow, error, confirm } = useConfirm(stopped.onResume, "The resume request failed. Try again.", open, onOpenChange, pendingEscapeMs);
  const since = stopped.since ? formatDateTime(stopped.since) : null;
  const label = stopped.canResume ? "Agents stopped: resume agents" : "Agents stopped";
  // Same glass square as the kill switch, with a play mark in amber: the team is waiting, the way back is here.
  const trigger =
    variant === "icon" ? (
      <Tooltip content={label}>
        <button
          type="button"
          aria-label="Resume agents"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn("kitbar-glass kitbar-resume w-kitbar-chip justify-center px-0", className)}
          data-testid="resume-agents-trigger"
          data-agents-stopped=""
        >
          <Icon icon={Play} />
        </button>
      </Tooltip>
    ) : (
      <Button icon={Play} variant="primary" disabled={disabled} onClick={() => setOpen(true)} className={className} data-testid="resume-agents-trigger" data-agents-stopped="">
        Resume agents
      </Button>
    );

  return (
    <>
      {trigger}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent size="sm" hideClose={locked}>
          <DialogHeader>
            <DialogTitle>{stopped.canResume ? "Resume agents?" : "Agents are stopped"}</DialogTitle>
            <DialogDescription>
              The team stopped{since ? ` on ${since}` : ""} because {stopped.reason}. Nothing starts work until it is resumed.{" "}
              {stopped.canResume ? (
                <>
                  Resuming puts every agent the stop paused back to work; the next <Term id="cycle">cycle</Term> picks up the paused tasks. Campaigns the stop paused stay paused until you resume them in Distribution.
                </>
              ) : (
                "An owner or admin resumes the agents."
              )}
            </DialogDescription>
          </DialogHeader>
          {stopped.hint || error || slow ? (
            <DialogBody className="flex flex-col gap-2">
              {stopped.hint ? <p className="text-small text-secondary">{stopped.hint}</p> : null}
              {slow ? <SlowNote what="resume" /> : null}
              {error ? (
                <p role="alert" className="text-small text-status-bad">
                  {error}
                </p>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={locked}>
              {slow ? "Close" : stopped.canResume ? "Cancel" : "Got it"}
            </Button>
            {stopped.canResume ? (
              <Button variant="primary" icon={Play} onClick={confirm} loading={loading} autoFocus>
                Resume agents
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
