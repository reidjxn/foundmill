"use client";
import { useState, type ReactNode } from "react";
import { OctagonX, Play } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { useFormatters } from "../foundation/DateFormatProvider";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";

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
}

/**
 * The kill switch (BUILD §5.4): visible on every screen, confirms before calling the API.
 * Nothing is deleted: sessions stop, tasks keep their state and can be resumed. While the team is stopped the same
 * control says so and offers Resume agents (owners and admins), so the way back is where the stop was pulled.
 */
export function StopAllAgents(props: StopAllAgentsProps) {
  if (props.stopped) return <ResumeAgents {...props} stopped={props.stopped} />;
  return <StopAll {...props} />;
}

/** Shared confirm-with-loading state: closes when `action` resolves, keeps the dialog open with the error otherwise. */
function useConfirm(action: () => void | Promise<void>, failure: string, open?: boolean, onOpenChange?: (open: boolean) => void) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (loading && !next) return;
    setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setError(null);
  };
  const confirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await action();
      setLoading(false);
      setInternalOpen(false);
      onOpenChange?.(false);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : failure);
    }
  };
  return { isOpen, setOpen, loading, error, confirm };
}

function StopAll({ onConfirm, runningCount, open, onOpenChange, disabled, children, className, variant = "icon" }: StopAllAgentsProps) {
  const { isOpen, setOpen, loading, error, confirm } = useConfirm(onConfirm, "The stop request failed. Try again.", open, onOpenChange);

  const count = runningCount ?? 0;
  // The icon trigger is glass on the brand slab (34 px) with the octagon in a light red; hover warms it towards red.
  const trigger =
    variant === "icon" ? (
      <Tooltip content="Stop all agents">
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
        <DialogContent size="sm" hideClose={loading}>
          <DialogHeader>
            <DialogTitle>Stop all agents?</DialogTitle>
            <DialogDescription>
              {count > 0 ? `${count} running ${count === 1 ? "session stops" : "sessions stop"} now.` : "Every running session stops now."} Tasks keep their state and nothing starts again until an owner or admin resumes the agents.
            </DialogDescription>
          </DialogHeader>
          {children || error ? (
            <DialogBody className="flex flex-col gap-2">
              {children}
              {error ? (
                <p role="alert" className="text-small text-status-bad">
                  {error}
                </p>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            {/* Focus starts on Cancel, as on every destructive confirm: a stray Enter must not stop the whole team. */}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading} autoFocus>
              Cancel
            </Button>
            <Button variant="danger" icon={OctagonX} onClick={confirm} loading={loading}>
              Stop all agents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResumeAgents({ stopped, open, onOpenChange, disabled, className, variant = "icon" }: StopAllAgentsProps & { stopped: AgentsStoppedState }) {
  const { formatDateTime } = useFormatters();
  const { isOpen, setOpen, loading, error, confirm } = useConfirm(stopped.onResume, "The resume request failed. Try again.", open, onOpenChange);
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
        <DialogContent size="sm" hideClose={loading}>
          <DialogHeader>
            <DialogTitle>{stopped.canResume ? "Resume agents?" : "Agents are stopped"}</DialogTitle>
            <DialogDescription>
              The team stopped{since ? ` on ${since}` : ""} because {stopped.reason}. Nothing starts work until it is resumed.{" "}
              {stopped.canResume ? "Resuming puts every agent the stop paused back to work; the next cycle picks up the paused tasks. Campaigns the stop paused stay paused until you resume them in Distribution." : "An owner or admin resumes the agents."}
            </DialogDescription>
          </DialogHeader>
          {stopped.hint || error ? (
            <DialogBody className="flex flex-col gap-2">
              {stopped.hint ? <p className="text-small text-secondary">{stopped.hint}</p> : null}
              {error ? (
                <p role="alert" className="text-small text-status-bad">
                  {error}
                </p>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              {stopped.canResume ? "Cancel" : "Got it"}
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
