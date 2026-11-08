"use client";
/** Dialogs the development tabs share: Reassign, Stop and discard, Open in Claude Code, Forget saved code, GitHub repository. */
import { useId, useState } from "react";
import { ExternalLink, FolderGit2, Settings2, Square, Trash2, UserRoundCog } from "lucide-react";
import { Button, Checkbox, Chip, ConsequenceLine, useAgentPersona, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, KeyValueList, SimpleSelect, Skeleton, Term, Textarea } from "@foundmill/dugout";
import { useWidgetQuery } from "@foundmill/widgets/data";
import { isBackgroundAgent } from "@foundmill/shared/team-tiers";
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
  // "Malik (Head of Engineering)" with anthropomorphic agents on (the role is in the label), else "Name · Role".
  const persona = useAgentPersona();
  // Background helpers never take tasks (Leads first), so they are not offered.
  const options = agents.filter((a) => a.id !== currentAgentId && !isBackgroundAgent(a)).map((a) => ({ value: a.id, label: persona.hasPersona(a) ? persona.labelFor(a) : a.role ? `${a.name} · ${a.role}` : a.name }));
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
          <DialogDescription id={`${id}-desc`}>
            The agent working on “{taskTitle}” stops now and its <Term id="branch">branch</Term> is discarded. The task can be started again later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {/* What stopping costs and whether it can be undone, always shown (UX plan §6.2 ConsequenceLine). */}
          <ConsequenceLine consequence="The work in progress on the branch is lost; the task returns to ready." cost="No cost" reversible />
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

/** Forget a task's saved code (Development › Code): every saved session goes, for good. Owners and admins only. */
export function ForgetCodeDialog({ open, onOpenChange, taskTitle, pending, error, onConfirm }: StopDialogProps) {
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Forget saved code</DialogTitle>
          <DialogDescription id={`${id}-desc`}>Every saved session of “{taskTitle}” is deleted for good. Sessions running on the task now cannot save it back, and the next one starts from an empty folder. A file another task saved with the same contents stays with that task.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {/* Deleting is one of the things that cannot be undone: the line says so, in both guidance states. */}
          <ConsequenceLine consequence="The next session on this task starts from an empty folder." cost="No cost" reversible={false} />
          <InlineError error={error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button variant="danger" icon={Trash2} loading={pending} onClick={onConfirm}>
            Forget saved code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface GitHubRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connected: boolean;
  simulated: boolean;
  /** `owner/name` currently chosen, or null. */
  repository: string | null;
  /** Whether saved code is pushed to it now (off until the founder turns it on). */
  pushEnabled: boolean;
  pending?: boolean;
  error?: Error | null;
  onSave: (repository: string | null, pushEnabled: boolean) => void;
  onOpenSettings: () => void;
}

/** Where saved code is pushed after each session (Development › Code). Owners and admins. */
export function GitHubRepositoryDialog({ open, onOpenChange, connected, simulated, repository, pushEnabled, pending, error, onSave, onOpenSettings }: GitHubRepositoryDialogProps) {
  const id = useId();
  const [value, setValue] = useState(repository ?? "");
  const [push, setPush] = useState(pushEnabled);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setValue(repository ?? "");
          setPush(pushEnabled);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent size="sm" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Push saved code to GitHub</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            When a session on a code task finishes, its saved code is committed to the task's own <Term id="branch">branch</Term> (agent/…) in this private <Term id="repository">repository</Term>. Nothing is ever written to the default branch: merging stays a <Term id="pull_request">pull request</Term>.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {simulated ? <Chip tone="info">Simulated GitHub: pushes are recorded here but do not reach github.com</Chip> : null}
          {connected ? (
            <>
              <Field htmlFor={`${id}-repo`} label="Repository" hint="owner/name, or the repository's github.com address">
                <Input id={`${id}-repo`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="acme/shop" mono />
              </Field>
              <label htmlFor={`${id}-push`} className="flex items-start gap-2 text-body">
                <Checkbox id={`${id}-push`} checked={push} onCheckedChange={(v) => setPush(v === true)} className="mt-0.5" data-testid="push-enabled" />
                <span className="flex flex-col gap-0.5">
                  <span>Push agents' saved code to this repository</span>
                  <span className="text-small text-secondary">
                    A push can start this repository's CI and preview deploys on code an agent wrote, with their secrets. Commits are marked [skip ci], but services that ignore it still build. Files under .github are never pushed.
                  </span>
                </span>
              </label>
            </>
          ) : (
            <p className="text-body text-secondary">GitHub is not connected for this business yet. Connect it in Settings › Integrations, then choose the repository here.</p>
          )}
          <InlineError error={error} />
        </DialogBody>
        <DialogFooter>
          {connected && repository ? (
            <Button variant="ghost" onClick={() => onSave(null, false)} disabled={pending}>
              Forget repository
            </Button>
          ) : null}
          {connected ? (
            <Button variant="primary" icon={FolderGit2} loading={pending} disabled={!value.trim()} onClick={() => onSave(value.trim(), push)}>
              Save
            </Button>
          ) : (
            <Button variant="primary" icon={Settings2} onClick={onOpenSettings}>
              Open Settings › Integrations
            </Button>
          )}
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
