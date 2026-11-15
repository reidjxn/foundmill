"use client";
/**
 * One department's settings (BUILD §11.13; audit AC-06): identity (name, icon, color, which is also its Ribbon band),
 * placement (its G shortcut, read from the name), people (lead and members; making an agent the lead adds it to the
 * department), budget, and approvals (this department's row of the responsibilities matrix, Team › Responsibilities).
 * Name, icon, color, lead and budget save together through `department.update`; an approval saves when it is chosen.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, Button, Chip, DeptChip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Field, Icon, Input, MoneyInput, SimpleSelect, type SelectOption } from "@foundmill/dugout";
import { AGENT_GATED_DECISIONS, DECISION_DESCRIPTIONS, DECISION_LABELS } from "@foundmill/modules/team/decisions";
import { DECISION_TYPES, DEPT_COLOUR_TOKENS, type DecisionType, type DeptColourToken } from "@foundmill/shared/constants";
import { routes } from "@foundmill/widgets/shared/routes";
import { isBackgroundAgent } from "@foundmill/shared/team-tiers";
import { useRouter } from "next/navigation";
import { DEPARTMENT_ICON_NAMES, iconByName } from "@/lib/icons";
import { plainWords } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { formatMajor, parseMajor } from "@/components/agents/logic";
import { useBusiness, useBusinessCurrency, type DepartmentRow } from "@/components/shell/business-context";
import { Hint } from "./shared";

export interface DepartmentSettingsDialogProps {
  department: DepartmentRow | null;
  /** "G X" when the department has a sidebar letter (hidden departments have none). */
  shortcut: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (what: string) => void;
  onFailed: (err: unknown) => void;
}

const NO_LEAD = "none";
const FOUNDER = "founder";

/** What the form holds; amounts stay as typed until saved (parseMajor). */
interface Draft {
  name: string;
  icon: string;
  colourToken: DeptColourToken;
  leadAgentId: string;
  budget: string;
}

function draftOf(d: DepartmentRow): Draft {
  return { name: d.name, icon: d.icon, colourToken: d.colourToken as DeptColourToken, leadAgentId: d.leadAgentId ?? NO_LEAD, budget: formatMajor(d.budgetMinor ?? null) };
}

/** The `department.update` patch for what changed (nothing for an untouched field). */
export function departmentPatch(d: DepartmentRow, draft: Draft, currency: string): { patch: Record<string, unknown>; error: string | null } {
  const patch: Record<string, unknown> = {};
  const name = draft.name.trim();
  if (!name) return { patch, error: "Give the department a name." };
  if (name !== d.name) patch.name = name;
  if (draft.icon !== d.icon) patch.icon = draft.icon;
  if (draft.colourToken !== d.colourToken) patch.colourToken = draft.colourToken;
  const lead = draft.leadAgentId === NO_LEAD ? null : draft.leadAgentId;
  if (lead !== (d.leadAgentId ?? null)) patch.leadAgentId = lead;
  const budget = parseMajor(draft.budget);
  if (Number.isNaN(budget) || (budget !== null && budget < 0)) return { patch, error: "Enter the monthly budget as an amount, like 450 or 1,200.50." };
  if (budget !== (d.budgetMinor ?? null)) {
    patch.budgetMinor = budget;
    patch.currency = currency;
  }
  return { patch, error: null };
}

export function DepartmentSettingsDialog({ department, shortcut, onOpenChange, onSaved, onFailed }: DepartmentSettingsDialogProps) {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const currency = useBusinessCurrency();
  const open = department !== null;
  const [draft, setDraft] = useState<Draft | null>(department ? draftOf(department) : null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(department ? draftOf(department) : null);
    setError(null);
  }, [department]);

  const agentsQ = useQuery(trpc.team.agents.list.queryOptions({ businessId }, { enabled: open, staleTime: 30_000 }));
  const respQ = useQuery(trpc.team.responsibilities.get.queryOptions({ businessId }, { enabled: open, staleTime: 10_000 }));
  const update = useMutation(trpc.department.update.mutationOptions());
  const setResponsibility = useMutation(trpc.team.responsibilities.set.mutationOptions({ onSuccess: () => void respQ.refetch(), onError: onFailed }));

  const agents = useMemo(() => agentsQ.data?.agents ?? [], [agentsQ.data]);
  const members = useMemo(() => department?.squad ?? [], [department]);
  const leadOptions: SelectOption[] = useMemo(() => {
    const inDept = new Set(members.map((m) => m.id));
    // Background helpers never lead (Leads first); the current lead stays listed whatever it is.
    const sorted = agents.filter((a) => !isBackgroundAgent(a) || a.id === department?.leadAgentId).sort((a, b) => Number(inDept.has(b.id)) - Number(inDept.has(a.id)) || a.name.localeCompare(b.name));
    return [{ value: NO_LEAD, label: "No lead yet" }, ...sorted.map((a) => ({ value: a.id, label: inDept.has(a.id) ? `${a.name} · ${a.role || plainWords(a.agentType)}` : `${a.name} · joins from ${a.departments.map((d) => d.name).join(", ") || "no department"}`, textValue: a.name }))];
  }, [agents, members, department?.leadAgentId]);
  const handlers = useMemo(() => {
    const rows = respQ.data?.perDepartment.find((p) => p.departmentId === department?.id)?.rows ?? [];
    return new Map(rows.map((r) => [r.decisionType, r.handler] as const));
  }, [respQ.data, department?.id]);

  if (!department || !draft) return null;

  const save = async () => {
    const { patch, error: invalid } = departmentPatch(department, draft, currency);
    setError(invalid);
    if (invalid) return;
    if (Object.keys(patch).length === 0) return onOpenChange(false);
    try {
      await update.mutateAsync({ businessId, departmentId: department.id, patch });
      onSaved(`${draft.name.trim()} saved`);
      onOpenChange(false);
    } catch (err) {
      onFailed(err);
    }
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const handlerValue = (t: DecisionType) => {
    const h = handlers.get(t);
    return !h || h.kind === "founder" ? FOUNDER : `${h.kind}:${h.id ?? ""}`;
  };
  const handlerOptions = (t: DecisionType): SelectOption[] => {
    const current = handlers.get(t);
    const options: SelectOption[] = [{ value: FOUNDER, label: "You (the founder)" }];
    // Background helpers never decide for the founder (Leads first); the current handler stays listed whatever it is.
    if (!AGENT_GATED_DECISIONS.includes(t)) for (const a of agents) if (!isBackgroundAgent(a) || (current?.kind === "agent" && current.id === a.id)) options.push({ value: `agent:${a.id}`, label: a.name });
    if (current?.kind === "user") options.push({ value: `user:${current.id ?? ""}`, label: "A staff member (set in Team › Responsibilities)" });
    return options;
  };
  const chooseHandler = (t: DecisionType, value: string) => {
    const [kind, id] = value === FOUNDER ? ["founder", null] : (value.split(":") as [string, string]);
    if (kind === "user") return;
    setResponsibility.mutate({ businessId, departmentId: department.id, decisionType: t, handler: { kind: kind as "founder" | "agent", id: id || null } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="department-settings">
        <DialogHeader>
          <DialogTitle>{department.name} settings</DialogTitle>
          <DialogDescription>Who leads it, how it looks in the sidebar, what it may spend and who approves its decisions.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-3" aria-labelledby="dept-identity">
              <h3 id="dept-identity" className="t-label">Identity</h3>
              <div className="grid grid-cols-3 gap-3">
                <Field htmlFor="dept-name" label="Name" required>
                  <Input id="dept-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
                </Field>
                <Field htmlFor="dept-icon" label="Icon">
                  <SimpleSelect
                    id="dept-icon"
                    value={draft.icon}
                    onValueChange={(icon) => set({ icon })}
                    options={[...new Set<string>([...DEPARTMENT_ICON_NAMES, draft.icon])].map((name) => ({
                      value: name,
                      textValue: plainWords(name),
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <Icon icon={iconByName(name)} size="inline" className="text-secondary" />
                          {plainWords(name.replace(/-\d+$/, ""))}
                        </span>
                      ),
                    }))}
                  />
                </Field>
                <Field htmlFor="dept-color" label="Color" hint="Also its band on the Ribbon.">
                  <SimpleSelect
                    id="dept-color"
                    value={draft.colourToken}
                    onValueChange={(v) => set({ colourToken: v as DeptColourToken })}
                    options={DEPT_COLOUR_TOKENS.map((token, i) => ({ value: token, textValue: `Color ${i + 1}`, label: <DeptChip dept={token}>Color {i + 1}</DeptChip> }))}
                  />
                </Field>
              </div>
              <p className="text-small text-secondary" data-testid="dept-shortcut">
                Shortcut: {shortcut ? <Chip tone="neutral">{shortcut}</Chip> : "none while the department is hidden"}. A department opens with its area's letter; one with no modules takes a letter from its name.
              </p>
            </section>

            <section className="flex flex-col gap-3" aria-labelledby="dept-people">
              <h3 id="dept-people" className="t-label">People</h3>
              <Field htmlFor="dept-lead" label="Lead" hint="Agents in this department who report to nobody, or to the previous lead, report to the new lead. An agent from elsewhere joins this department.">
                <SimpleSelect id="dept-lead" value={draft.leadAgentId} onValueChange={(leadAgentId) => set({ leadAgentId })} options={leadOptions} disabled={agentsQ.isLoading} />
              </Field>
              {members.length ? (
                <ul className="flex flex-col" data-testid="dept-members">
                  {members.map((m) => (
                    <li key={m.id} className="flex min-h-row-comfortable items-center gap-2 border-b border-line-faint last:border-b-0">
                      <Avatar size={24} name={m.name} agent={{ seed: m.avatarSeed || m.id, dept: draft.colourToken, personaKey: m.personaKey }} status={m.status} />
                      <EntityLink entity={{ id: m.id, kind: "agent", name: m.name, href: routes.agent(businessId, m.id) }} onOpen={() => router.push(routes.agent(businessId, m.id))} contextMenu={false} personaText="name" className="text-body-strong text-primary" />
                      <span className="min-w-0 flex-1 truncate text-small text-secondary">{m.role}</span>
                      {draft.leadAgentId === m.id ? (
                        <Chip tone="info" icon={Crown}>
                          Lead
                        </Chip>
                      ) : (
                        <Button size="sm" variant="ghost" icon={Crown} onClick={() => set({ leadAgentId: m.id })}>
                          Make lead
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <Hint>No agents in this department yet. Pick a lead above, or hire into it from Team › Recruitment.</Hint>
              )}
            </section>

            <section className="flex flex-col gap-3" aria-labelledby="dept-budget">
              <h3 id="dept-budget" className="t-label">Budget</h3>
              <Field htmlFor="dept-budget-input" label="Monthly budget" hint="The monthly amount the Chief of Staff plans this department's work against. Leave it empty for no department budget.">
                <MoneyInput id="dept-budget-input" controlSize="lg" value={draft.budget} onChange={(e) => set({ budget: e.target.value })} placeholder="0" currency={currency} />
              </Field>
            </section>

            <section className="flex flex-col gap-2" aria-labelledby="dept-approvals">
              <h3 id="dept-approvals" className="t-label">Approvals</h3>
              <Hint>Who approves each kind of decision for this department. Signing stays with you.</Hint>
              <ul className="flex flex-col" data-testid="dept-approvals">
                {DECISION_TYPES.map((t) => (
                  <li key={t} className="grid grid-cols-[1fr_16rem] items-center gap-3 border-b border-line-faint py-1.5 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block text-body-strong text-primary">{DECISION_LABELS[t]}</span>
                      <span className="block text-small text-secondary">{DECISION_DESCRIPTIONS[t]}</span>
                    </span>
                    <SimpleSelect aria-label={`Who approves ${DECISION_LABELS[t].toLowerCase()}`} value={handlerValue(t)} onValueChange={(v) => chooseHandler(t, v)} options={handlerOptions(t)} disabled={respQ.isLoading || setResponsibility.isPending} />
                  </li>
                ))}
              </ul>
            </section>
            {error ? (
              <p role="alert" className="text-small text-status-bad">
                {error}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
