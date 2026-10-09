"use client";
/**
 * Dialogs the Squad and Recruitment tabs share (BUILD §11.9 Recruitment: hire, release, clone, loan). Each one owns
 * its form state, runs the mutation through `useAction`, keeps the dialog open on error and tells the caller when it
 * succeeded so the list is refetched.
 */
import { useEffect, useId, useState } from "react";
import { ArrowLeftRight, Copy, UserRoundMinus, UserRoundPlus } from "lucide-react";
import { Button, Checkbox, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, KeyValueList, ProvenanceChip, SimpleSelect, formatMoney } from "@foundmill/dugout";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import { FAMILY_LABELS, InlineError, isChiefOfStaff, useAction } from "./shared";
import type { AgentRow, TemplateRow } from "./types";

function departmentOptions(departments: readonly DepartmentRow[] | undefined) {
  return (departments ?? [])
    .filter((d) => !d.hidden)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((d) => ({ value: d.id, label: d.name }));
}

/* ---------- Hire ---------- */

export interface HireDialogProps {
  template: TemplateRow | null;
  onOpenChange: (open: boolean) => void;
  departments: readonly DepartmentRow[] | undefined;
  /** Preselected department (the one whose tab is open). */
  defaultDepartmentId?: string;
  /** Prefilled name (the agent builder's suggestion). */
  defaultName?: string;
  currency?: string;
  onHired: (agent: AgentRow, template: TemplateRow) => void;
}

/** Hire a catalogue template into a department (team.agents.hire). */
export function HireDialog({ template, onOpenChange, departments, defaultDepartmentId, defaultName, currency = "EUR", onHired }: HireDialogProps) {
  const id = useId();
  const action = useAction();
  const options = departmentOptions(departments);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (template) {
      setDepartmentId(defaultDepartmentId && options.some((o) => o.value === defaultDepartmentId) ? defaultDepartmentId : (options[0]?.value ?? ""));
      setName(defaultName ?? "");
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form when a template is chosen
  }, [template?.key, defaultDepartmentId, defaultName]);
  const open = !!template;
  const confirm = async () => {
    if (!template || !departmentId) return;
    const input: Record<string, unknown> = { templateKey: template.key, departmentId };
    if (name.trim()) input.name = name.trim();
    const agent = await action.run<AgentRow>("team.agents.hire", input, { key: `hire:${template.key}` });
    if (agent) {
      onHired(agent, template);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby={`${id}-desc`} data-testid="hire-dialog">
        <DialogHeader>
          <DialogTitle>Hire {template?.name ?? "agent"}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{template?.description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {template ? (
            <KeyValueList
              dense
              items={[
                { label: "Role", value: template.role },
                { label: "Family", value: FAMILY_LABELS[template.family] },
                { label: "Model", value: template.modelKey, mono: true },
                { label: "Skills", value: template.skills.length ? template.skills.join(", ") : "Set by the first training run" },
                {
                  label: "Wage cap",
                  value: (
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      {formatMoney({ amountMinor: template.wageCapMinor, currency })}/mo <ProvenanceChip kind="estimate" />
                    </span>
                  ),
                },
              ]}
            />
          ) : null}
          <Field htmlFor={`${id}-dept`} label="Department" required>
            <SimpleSelect id={`${id}-dept`} aria-label="Department" options={options} value={departmentId || undefined} onValueChange={setDepartmentId} placeholder={options.length ? "Choose a department" : "No departments yet"} disabled={!options.length} />
          </Field>
          <Field htmlFor={`${id}-name`} label="Name" hint="Leave empty to keep the template's name.">
            <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={template?.name} />
          </Field>
          <p className="text-small text-secondary">The first training run sets the skills and the agent appears in the team table straight away.</p>
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserRoundPlus} disabled={!departmentId} loading={action.pending !== null} onClick={() => void confirm()} data-testid="hire-confirm">
            Hire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Release ---------- */

export interface ReleaseDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  onReleased: (agent: AgentRow) => void;
}

/** Release an agent from the squad (team.agents.release). The Chief of Staff cannot be released. */
export function ReleaseDialog({ agent, onOpenChange, onReleased }: ReleaseDialogProps) {
  const id = useId();
  const action = useAction();
  const cos = agent ? isChiefOfStaff(agent) : false;
  const confirm = async () => {
    if (!agent) return;
    const r = await action.run("team.agents.release", { agentId: agent.id }, { key: `release:${agent.id}` });
    if (r !== undefined) {
      onReleased(agent);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`} data-testid="release-dialog">
        <DialogHeader>
          <DialogTitle>Release {agent?.name}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            {cos ? "The Chief of Staff plans every cycle and cannot be released." : `${agent?.name} leaves the team. Running tasks stop and its history and logs stay on the profile. Nothing is deleted.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {agent?.currentTask ? <p className="text-small text-status-warn">Currently working on “{agent.currentTask.title}”; that task returns to ready.</p> : null}
          <InlineError error={action.error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep
          </Button>
          <Button variant="danger" icon={UserRoundMinus} disabled={cos} loading={action.pending !== null} onClick={() => void confirm()} data-testid="release-confirm">
            Release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Clone ---------- */

export interface CloneDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  departments: readonly DepartmentRow[] | undefined;
  onCloned: (clone: AgentRow, from: AgentRow) => void;
}

/** Clone an agent with its instructions, tools, model and skills (team.agents.clone). */
export function CloneDialog({ agent, onOpenChange, departments, onCloned }: CloneDialogProps) {
  const id = useId();
  const action = useAction();
  const options = departmentOptions(departments);
  const [name, setName] = useState("");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  useEffect(() => {
    if (agent) {
      setName(`${agent.name} II`);
      setDepartmentIds(agent.departmentIds ?? (agent.departments ?? []).map((d) => d.id));
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the agent changes
  }, [agent?.id]);
  const toggle = (deptId: string, on: boolean) => setDepartmentIds((ids) => (on ? [...new Set([...ids, deptId])] : ids.filter((x) => x !== deptId)));
  const confirm = async () => {
    if (!agent || !name.trim()) return;
    const clone = await action.run<AgentRow>("team.agents.clone", { agentId: agent.id, name: name.trim(), departmentIds }, { key: `clone:${agent.id}` });
    if (clone) {
      onCloned(clone, agent);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`} data-testid="clone-dialog">
        <DialogHeader>
          <DialogTitle>Clone {agent?.name}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>A new agent with the same instructions, tools, model and skills. Its history starts empty.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-name`} label="Name" required>
            <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="t-label mb-1">Departments</legend>
            {options.length === 0 ? <p className="text-small text-secondary">No departments to choose from; the clone keeps its source's departments.</p> : null}
            {options.map((o) => {
              const cid = `${id}-dept-${o.value}`;
              return (
                <div key={o.value} className="flex items-center gap-2">
                  <Checkbox id={cid} checked={departmentIds.includes(o.value)} onCheckedChange={(v) => toggle(o.value, v === true)} />
                  <label htmlFor={cid} className="text-body text-primary">
                    {o.label}
                  </label>
                </div>
              );
            })}
          </fieldset>
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={Copy} disabled={!name.trim()} loading={action.pending !== null} onClick={() => void confirm()} data-testid="clone-confirm">
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Loan ---------- */

export interface LoanDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  departments: readonly DepartmentRow[] | undefined;
  onLoaned: (agent: AgentRow, departmentId: string, move: boolean) => void;
}

/** Loan an agent to another department, or move it there (team.agents.loan). */
export function LoanDialog({ agent, onOpenChange, departments, onLoaned }: LoanDialogProps) {
  const id = useId();
  const action = useAction();
  const current = new Set(agent?.departmentIds ?? (agent?.departments ?? []).map((d) => d.id));
  const options = departmentOptions(departments).filter((o) => !current.has(o.value));
  const [departmentId, setDepartmentId] = useState("");
  const [move, setMove] = useState(false);
  useEffect(() => {
    if (agent) {
      setDepartmentId("");
      setMove(false);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the agent changes
  }, [agent?.id]);
  const confirm = async () => {
    if (!agent || !departmentId) return;
    const r = await action.run("team.agents.loan", { agentId: agent.id, departmentId, move }, { key: `loan:${agent.id}` });
    if (r !== undefined) {
      onLoaned(agent, departmentId, move);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`} data-testid="loan-dialog">
        <DialogHeader>
          <DialogTitle>Loan {agent?.name}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>The agent joins another department's team and keeps its skills, tools and model.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="t-label">Now in</span>
            {(agent?.departments ?? []).length ? (agent?.departments ?? []).map((d) => <Chip key={d.id}>{d.name}</Chip>) : <span className="text-small text-secondary">no department</span>}
          </div>
          <Field htmlFor={`${id}-dept`} label="To department" required>
            <SimpleSelect id={`${id}-dept`} aria-label="To department" options={options} value={departmentId || undefined} onValueChange={setDepartmentId} placeholder={options.length ? "Choose a department" : "Already in every department"} disabled={!options.length} />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-move`} checked={move} onCheckedChange={(v) => setMove(v === true)} />
            <label htmlFor={`${id}-move`} className="text-body text-primary">
              Move instead of loan (leaves the current departments)
            </label>
          </div>
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={ArrowLeftRight} disabled={!departmentId} loading={action.pending !== null} onClick={() => void confirm()} data-testid="loan-confirm">
            {move ? "Move" : "Loan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
