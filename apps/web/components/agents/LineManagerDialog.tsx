"use client";
/**
 * Change an agent's line manager (BUILD §11.9 Hierarchy: "Change a line manager from the agent's profile"): another
 * agent still on the team, or none, when the agent reports to the founder. Agents that report to this one (at any
 * depth) are left out so the chart stays a tree; `agent.profile.update` checks the same and the business boundary.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserRoundCog } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, SimpleSelect, Term, useToast } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { lineManagerOptions, ownerManagerLabel, type AgentProfile, type LineManagerCandidate } from "./logic";

/** The select's value for "reports to the founder" (no agent line manager). */
export const NO_AGENT_MANAGER = "founder";

export interface LineManagerDialogProps {
  businessId: string;
  profile: AgentProfile;
  /** The team (`team.agents.list`), loaded while the dialog is open. */
  agents: readonly LineManagerCandidate[] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function LineManagerDialog({ businessId, profile, agents, open, onOpenChange, onSaved }: LineManagerDialogProps) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const agent = profile.agent;
  const [value, setValue] = useState<string>(agent.lineManagerId ?? NO_AGENT_MANAGER);
  useEffect(() => {
    if (open) setValue(agent.lineManagerId ?? NO_AGENT_MANAGER);
  }, [open, agent.lineManagerId]);
  const options = useMemo(() => [{ value: NO_AGENT_MANAGER, label: `${ownerManagerLabel(profile)} (no agent line manager)` }, ...lineManagerOptions(agent.id, agents ?? [])], [agent.id, agents, profile]);
  const save = useMutation(
    trpc.agent.profile.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("team") as unknown[] });
        toast({ title: "Line manager changed", description: `${agent.name} now reports to ${options.find((o) => o.value === value)?.label.replace(/ \(no agent line manager\)$/, "") ?? "its new manager"}.`, tone: "good" });
        onSaved();
        onOpenChange(false);
      },
    }),
  );
  const unchanged = value === (agent.lineManagerId ?? NO_AGENT_MANAGER);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        aria-describedby={`${id}-desc`}
        data-testid="line-manager-dialog"
        // Open on the one field, not on the defined words in the description (their cards would open with the dialog).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById(`${id}-manager`)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Line manager for {agent.name}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            Who {agent.name} reports to in the <Term id="hierarchy">hierarchy</Term>: its <Term id="line_manager">line manager</Term> reviews its work and hands it tasks. Moving it to another department also makes that department's lead its manager.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-manager`} label="Reports to" required>
            <SimpleSelect id={`${id}-manager`} aria-label="Reports to" options={options} value={value} onValueChange={setValue} placeholder={agents ? "Choose a manager" : "Loading the team…"} disabled={!agents} />
          </Field>
          {save.error ? (
            <p role="alert" className="text-small text-status-bad">
              {errorMessage(save.error)}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserRoundCog} disabled={unchanged || !agents} loading={save.isPending} onClick={() => save.mutate({ businessId, agentId: agent.id, patch: { lineManagerId: value === NO_AGENT_MANAGER ? null : value } })} data-testid="line-manager-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
