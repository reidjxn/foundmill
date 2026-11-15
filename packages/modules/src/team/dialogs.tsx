"use client";
/**
 * Dialogs the Agents and Recruitment tabs share (BUILD §11.9 Recruitment: hire, let go, duplicate, lend; the API paths
 * keep release / clone / loan). Each one owns its form state, runs the mutation through `useAction`, keeps the dialog
 * open on error and tells the caller when it succeeded so the list is refetched.
 */
import { useEffect, useId, useState } from "react";
import { ArrowLeftRight, Copy, UserRoundMinus, UserRoundPlus } from "lucide-react";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { Button, Checkbox, Chip, useAgentPersona, ConsequenceLine, MODEL_LABELS, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, KeyValueList, ProvenanceChip, ReassuranceLine, SimpleSelect, Term, formatMoney } from "@foundmill/dugout";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import { humanise } from "../fit";
import { FAMILY_LABELS, InlineError, isChiefOfStaff, useAction } from "./shared";
import { SkillsStep, toSkillChoices, type SkillDraft } from "./skills";
import type { AgentRow, TemplateRow } from "./types";

function departmentOptions(departments: readonly DepartmentRow[] | undefined) {
  return (departments ?? [])
    .filter((d) => !d.hidden)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((d) => ({ value: d.id, label: d.name }));
}

/* ---------- Consequences (UX plan §6.2 ConsequenceLine, always shown) ---------- */

/** Letting an agent go: what happens, said the same way in the dialog and the Team moves footer. */
export const RELEASE_CONSEQUENCE = "Running tasks stop; history and logs stay on the profile. Nothing is deleted.";
/** Lending: the agent gains a department. Moving: it leaves its current ones and follows the new lead. */
export const LOAN_CONSEQUENCE = { lend: "It joins the other department from the next cycle and keeps its tasks, skills, tools and model.", move: "It leaves its current departments; the new department's lead becomes its line manager." } as const;
/** Hiring: the agent starts next cycle; its wage cap is the most it can cost. */
export const HIRE_CONSEQUENCE = "Starts next cycle with the template's instructions, tools and skills, plus any you add here.";

/* ---------- Hire ---------- */

export interface HireDialogProps {
  template: TemplateRow | null;
  onOpenChange: (open: boolean) => void;
  departments: readonly DepartmentRow[] | undefined;
  /**
   * The department whose tab is open: preselected when it carries the template's module, otherwise the first
   * department over that module is (a newsletter writer opened from Team › Recruitment lands in Distribution).
   */
  defaultDepartmentId?: string;
  /**
   * Where the template works when the open tab's department is not over its module (`departmentForTemplate`: a
   * specialist goes to Operations); otherwise the first department over the module.
   */
  preferredDepartmentId?: string;
  /** Prefilled name (the agent builder's suggestion). */
  defaultName?: string;
  /** The wage cap's currency: a wage cap caps metered model cost, so US dollars (`CREDITS_CURRENCY`). */
  currency?: string;
  /** `skills`: how many skills from the library or files the agent was hired with. */
  onHired: (agent: AgentRow, template: TemplateRow, skills: number) => void;
}

/** Hire a catalogue template into a department (team.agents.hire), optionally with skills from the library or files. */
export function HireDialog({ template, onOpenChange, departments, defaultDepartmentId, preferredDepartmentId, defaultName, currency = CREDITS_CURRENCY, onHired }: HireDialogProps) {
  const id = useId();
  const action = useAction();
  const options = departmentOptions(departments);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [name, setName] = useState("");
  const [fullDescription, setFullDescription] = useState(false);
  const [skills, setSkills] = useState<SkillDraft[]>([]);
  useEffect(() => {
    if (template) {
      const mod = template.module;
      const forModule = mod ? (departments ?? []).filter((d) => d.moduleKeys.includes(mod)).map((d) => d.id) : [];
      const open = defaultDepartmentId && options.some((o) => o.value === defaultDepartmentId) ? defaultDepartmentId : undefined;
      const preferred = preferredDepartmentId && forModule.includes(preferredDepartmentId) ? preferredDepartmentId : undefined;
      setDepartmentId((open && (!forModule.length || forModule.includes(open)) ? open : (preferred ?? forModule[0])) ?? open ?? options[0]?.value ?? "");
      setName(defaultName ?? "");
      setFullDescription(false);
      setSkills([]);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form when a template is chosen
  }, [template?.key, defaultDepartmentId, preferredDepartmentId, defaultName]);
  const open = !!template;
  const confirm = async () => {
    if (!template || !departmentId) return;
    const input: Record<string, unknown> = { templateKey: template.key, departmentId };
    if (name.trim()) input.name = name.trim();
    if (skills.length) input.skills = toSkillChoices(skills);
    const agent = await action.run<AgentRow>("team.agents.hire", input, { key: `hire:${template.key}` });
    if (agent) {
      onHired(agent, template, skills.length);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        aria-describedby={`${id}-desc`}
        data-testid="hire-dialog"
        // Open on the first thing to fill (the department), not on the Estimate chip above it: a chip's tooltip would
        // open with the dialog, and Esc would then close the tooltip instead of the dialog.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById(`${id}-dept`)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Hire {template?.name ?? "agent"}</DialogTitle>
          {/* Template descriptions run long: three lines, the rest on request. */}
          <DialogDescription id={`${id}-desc`} className={fullDescription ? undefined : "line-clamp-3"}>
            {template?.description}
          </DialogDescription>
          {template && template.description.length > 220 ? (
            <Button size="sm" variant="ghost" className="-ml-2 self-start" onClick={() => setFullDescription((v) => !v)} aria-expanded={fullDescription}>
              {fullDescription ? "Show less" : "Read the full description"}
            </Button>
          ) : null}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {template ? (
            <KeyValueList
              dense
              items={[
                { label: "Role", value: template.role },
                { label: "Kind", value: FAMILY_LABELS[template.family] },
                { label: <Term id="model">Model</Term>, value: MODEL_LABELS[template.modelKey] ?? template.modelKey },
                { label: "Skills", value: template.skills.length ? template.skills.map(humanise).join(", ") : "None yet; train it from its profile" },
                {
                  // A wage cap caps metered model cost: US dollars, whatever the business's currency (C19).
                  label: <Term id="wage_cap">Wage cap (USD)</Term>,
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
          <SkillsStep value={skills} onChange={setSkills} disabled={action.pending !== null} />
          {/* What hiring does, what it can cost and that it can be undone, always shown; the reassurance only while guided. */}
          <ConsequenceLine consequence={HIRE_CONSEQUENCE} cost={template ? `Up to ${formatMoney({ amountMinor: template.wageCapMinor, currency })}/mo (Estimate)` : undefined} reversible data-testid="hire-consequence" />
          <ReassuranceLine>Train it from its profile to tune its skills; lend it or let it go later from Team › Agents.</ReassuranceLine>
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

/* ---------- Let go (team.agents.release) ---------- */

export interface ReleaseDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  onReleased: (agent: AgentRow) => void;
}

/** Let an agent go from the team (team.agents.release). The Chief of Staff cannot be let go. */
export function ReleaseDialog({ agent, onOpenChange, onReleased }: ReleaseDialogProps) {
  const id = useId();
  // The agent as every other surface names it, under the reader's preference (One name everywhere).
  const shown = useAgentPersona().labelFor(agent ?? { name: "" });
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
      <DialogContent
        size="sm"
        aria-describedby={`${id}-desc`}
        data-testid="release-dialog"
        // Open on Keep, the safe choice, never on a defined word in the description (its card would open with the dialog).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById(`${id}-keep`)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Let {shown} go</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            {cos ? (
              <>
                The <Term id="chief_of_staff">Chief of Staff</Term> plans every <Term id="cycle">cycle</Term> and cannot be let go.
              </>
            ) : (
              `${shown} leaves the team.`
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          {/* What letting go does and that there is no way back, always shown (UX plan §6.2 ConsequenceLine). */}
          {cos ? null : <ConsequenceLine consequence={RELEASE_CONSEQUENCE} reversible={false} data-testid="release-consequence" />}
          {agent?.currentTask ? <p className="text-small text-status-warn">Currently working on “{agent.currentTask.title}”; that task returns to ready.</p> : null}
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button id={`${id}-keep`} variant="ghost" onClick={() => onOpenChange(false)}>
            Keep
          </Button>
          <Button variant="danger" icon={UserRoundMinus} disabled={cos} loading={action.pending !== null} onClick={() => void confirm()} data-testid="release-confirm">
            Let go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Duplicate (team.agents.clone) ---------- */

export interface CloneDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  departments: readonly DepartmentRow[] | undefined;
  onCloned: (clone: AgentRow, from: AgentRow) => void;
}

/** Duplicate an agent with its instructions, tools, model and skills (team.agents.clone). */
export function CloneDialog({ agent, onOpenChange, departments, onCloned }: CloneDialogProps) {
  const id = useId();
  // The agent as every other surface names it, under the reader's preference (One name everywhere).
  const shown = useAgentPersona().labelFor(agent ?? { name: "" });
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
          <DialogTitle>Duplicate {shown}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>A new agent with the same instructions, tools, model and skills. Its history starts empty.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-name`} label="Name" required>
            <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="t-label mb-1">Departments</legend>
            {options.length === 0 ? <p className="text-small text-secondary">No departments to choose from; the duplicate keeps its source's departments.</p> : null}
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
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Lend (team.agents.loan) ---------- */

export interface LoanDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  departments: readonly DepartmentRow[] | undefined;
  onLoaned: (agent: AgentRow, departmentId: string, move: boolean) => void;
}

/** Lend an agent to another department, or move it there (team.agents.loan). */
export function LoanDialog({ agent, onOpenChange, departments, onLoaned }: LoanDialogProps) {
  const id = useId();
  // The agent as every other surface names it, under the reader's preference (One name everywhere).
  const shown = useAgentPersona().labelFor(agent ?? { name: "" });
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
          <DialogTitle>Lend {shown} to another department</DialogTitle>
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
              Move instead of lending (leaves the current departments)
            </label>
          </div>
          {/* What lending or moving does, and that either can be undone, always shown (UX plan §6.2 ConsequenceLine). */}
          <ConsequenceLine consequence={move ? LOAN_CONSEQUENCE.move : LOAN_CONSEQUENCE.lend} reversible data-testid="loan-consequence" />
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={ArrowLeftRight} disabled={!departmentId} loading={action.pending !== null} onClick={() => void confirm()} data-testid="loan-confirm">
            {move ? "Move" : "Lend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
