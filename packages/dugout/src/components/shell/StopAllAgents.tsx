import { useState, type ReactNode } from "react";
import { OctagonX } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { IconButton } from "../foundation/IconButton";

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
}

/**
 * The kill switch (BUILD §5.4): visible on every screen, confirms before calling the API.
 * Nothing is deleted: sessions stop, tasks keep their state and can be resumed.
 */
export function StopAllAgents({ onConfirm, runningCount, open, onOpenChange, disabled, children, className, variant = "icon" }: StopAllAgentsProps) {
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
      await onConfirm();
      setLoading(false);
      setInternalOpen(false);
      onOpenChange?.(false);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "The stop request failed. Try again.");
    }
  };

  const count = runningCount ?? 0;
  const trigger =
    variant === "icon" ? (
      <IconButton
        icon={OctagonX}
        label="Stop all agents"
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn("text-kit-on-primary/80 hover:bg-status-bad/20 hover:text-status-bad", className)}
        data-testid="stop-all-trigger"
      />
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
              {count > 0 ? `${count} running ${count === 1 ? "session stops" : "sessions stop"} now.` : "Every running session stops now."} Tasks keep their state and can be resumed.
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
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="danger" icon={OctagonX} onClick={confirm} loading={loading} autoFocus>
              Stop all agents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
