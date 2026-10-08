"use client";
/** Dialogs the Training Ground and Plan tabs share: Reassign, Stop and discard, Open in Claude Code. */
import { useId, useState } from "react";
import { ExternalLink, Square, UserRoundCog } from "lucide-react";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, KeyValueList, SimpleSelect, Skeleton, Textarea } from "@foundmill/dugout";
import { useWidgetQuery } from "@foundmill/widgets";
import { InlineError, errorMessage } from "./shared";
import type { AgentRow, OpenInClaudeCodeResponse } from "./types";

export interface ReassignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  currentAgentId: string | null | undefined;
  agents: readonly AgentRow[];
  pending?: boolean;
  error?: Error | null;
  onConfirm: (agentId: string) => void;
}

/** Pick another agent for a task (BUILD §11.6 Reassign). A running session is stopped and the task returns to ready. */
export function ReassignDialog({ open, onOpenChange, taskTitle, currentAgentId, agents, pending, error, onConfirm }: ReassignDialogProps) {
  const id = useId();
  const [agentId, setAgentId] = useState<string>("");
  const options = agents.filter((a) => a.id !== currentAgentId).map((a) => ({ value: a.id, label: a.role ? `${a.name} · ${a.role}` : a.name }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Reassign task</DialogTitle>
          <DialogDescription id={`${id}-desc`}>“{taskTitle}” moves to another agent. A running session is stopped and the task returns to ready.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor={`${id}-agent`} label="New agent">
            <SimpleSelect id={`${id}-agent`} aria-label="New agent" options={options} value={agentId || undefined} onValueChange={setAgentId} placeholder={options.length ? "Choose an agent" : "No other agents in the team"} disabled={!options.length} />
          </Field>
          <InlineError error={error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserRoundCog} disabled={!agentId} loading={pending} onClick={() => onConfirm(agentId)}>
            Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface StopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  pending?: boolean;
  error?: Error | null;
  onConfirm: () => void;
}

/** Stop and discard confirmation (the branch is discarded; the task can be started again). */
export function StopDialog({ open, onOpenChange, taskTitle, pending, error, onConfirm }: StopDialogProps) {
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Stop and discard</DialogTitle>
          <DialogDescription id={`${id}-desc`}>The agent working on “{taskTitle}” stops now and its branch is discarded. The task can be started again later.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <InlineError error={error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep working
          </Button>
          <Button variant="danger" icon={Square} loading={pending} onClick={onConfirm}>
            Stop and discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface OpenInClaudeCodeDialogProps {
  taskId: string | null;
  taskTitle?: string;
  onOpenChange: (open: boolean) => void;
}

/** Exports the branch and task context so the founder can continue in Claude Code (BUILD §11.6). */
export function OpenInClaudeCodeDialog({ taskId, taskTitle, onOpenChange }: OpenInClaudeCodeDialogProps) {
  const id = useId();
  const open = !!taskId;
  const q = useWidgetQuery<OpenInClaudeCodeResponse>("dev.tasks.openInClaudeCode", { taskId: taskId ?? "" }, { enabled: open });
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Open in Claude Code</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{taskTitle ? `“${taskTitle}”: ` : ""}check out the agent's branch and paste the task context into Claude Code to continue by hand.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {q.isLoading ? <Skeleton className="h-24" /> : null}
          {q.error ? <InlineError error={errorMessage(q.error)} /> : null}
          {q.data ? (
            <>
              <KeyValueList
                items={[
                  { label: "Branch", value: q.data.branch, mono: true },
                  { label: "Agent", value: q.data.agent ? <span>{q.data.agent.name} <Chip mono>{q.data.agent.modelKey}</Chip></span> : "Unassigned" },
                ]}
              />
              <Field htmlFor={`${id}-checkout`} label="Checkout">
                <Textarea id={`${id}-checkout`} mono readOnly rows={2} value={q.data.checkout} />
              </Field>
              <Field htmlFor={`${id}-context`} label="Task context (Markdown)">
                <Textarea id={`${id}-context`} mono readOnly rows={10} value={q.data.contextMd} />
              </Field>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {copied ? <span className="mr-auto text-small text-secondary">Copied {copied}</span> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={!q.data} onClick={() => q.data && copy("the checkout command", q.data.checkout)}>
            Copy checkout
          </Button>
          <Button variant="primary" icon={ExternalLink} disabled={!q.data} onClick={() => q.data && copy("the task context", q.data.contextMd)}>
            Copy context
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
