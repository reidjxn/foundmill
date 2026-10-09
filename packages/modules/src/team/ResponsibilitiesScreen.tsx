"use client";
/**
 * Team › Responsibilities (BUILD §6.3, §11.9, AC-11.9.2): the matrix of decision types × handler (founder, a named
 * human, a named agent). One click takes a decision back; "Delegate…" picks a handler and, optionally, a single
 * department. Every change goes through `team.responsibilities.set`, which routes the matching approvals and logs it.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeftRight, Lock, ScrollText, Undo2 } from "lucide-react";
import { Avatar, Button, Chip, DataTable, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Field, MiniTable, Panel, RadioGroup, RadioOption, SimpleSelect, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { DECISION_TYPES, type DecisionType } from "@foundmill/shared/constants";
import { useDepartments } from "@foundmill/widgets/shared/departments";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import type { ModuleScreenProps } from "../registry";
import { AGENT_GATED_DECISIONS, DECISION_DESCRIPTIONS, DECISION_LABELS, InlineError, Screen, agentDept, agentEntity, agentHref, memberEntity, memberName, readMe, useAction, useAgents, useHumans, useMe, type Me } from "./shared";
import type { AgentRow, HandlerKind, MembershipRow, ResponsibilitiesResponse, ResponsibilityHandler } from "./types";

export interface ResponsibilityRowView {
  id: DecisionType;
  decisionType: DecisionType;
  label: string;
  description: string;
  handler: ResponsibilityHandler;
  handlerName: string;
  handlerKind: HandlerKind;
  uniform: boolean;
  gated: boolean;
  departments: { departmentId: string; departmentName: string; handler: ResponsibilityHandler; handlerName: string }[];
}

export const RESPONSIBILITY_VIEWS: SavedView[] = [
  { id: "all", name: "All decisions", builtIn: true, columns: ["label", "handler", "scope", "actions"], sort: [], filters: [] },
  { id: "delegated", name: "Delegated", builtIn: true, columns: ["label", "handler", "scope", "actions"], sort: [], filters: [{ id: "kind-not-founder", field: "handler", op: "neq", value: "founder" }] },
  { id: "mine", name: "Mine", builtIn: true, columns: ["label", "scope", "actions"], sort: [], filters: [{ id: "kind-founder", field: "handler", op: "eq", value: "founder" }] },
];

export function handlerName(h: ResponsibilityHandler, ctx: { agents: Map<string, AgentRow>; humans: Map<string, MembershipRow>; me: Me }): string {
  if (h.kind === "founder") return "You (founder)";
  if (h.kind === "agent") return h.id ? (ctx.agents.get(h.id)?.name ?? `Agent ${h.id.slice(0, 8)}`) : "An agent";
  if (!h.id) return "A staff member";
  const m = ctx.humans.get(h.id);
  return m ? memberName(m, ctx.me) : `Member ${h.id.slice(0, 8)}`;
}

export function toResponsibilityRows(data: ResponsibilitiesResponse | undefined, departments: readonly DepartmentRow[] | undefined, ctx: { agents: Map<string, AgentRow>; humans: Map<string, MembershipRow>; me: Me }): ResponsibilityRowView[] {
  const types = data?.decisionTypes ?? DECISION_TYPES;
  const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
  return types.map((decisionType) => {
    const row = data?.matrix.find((r) => r.decisionType === decisionType);
    const handler = row?.handler ?? { kind: "founder", id: null };
    const perDept = (data?.perDepartment ?? []).map((p) => {
      const h = p.rows.find((r) => r.decisionType === decisionType)?.handler ?? { kind: "founder" as const, id: null };
      return { departmentId: p.departmentId, departmentName: deptName.get(p.departmentId) ?? p.departmentId.slice(0, 8), handler: h, handlerName: handlerName(h, ctx) };
    });
    return { id: decisionType, decisionType, label: DECISION_LABELS[decisionType], description: DECISION_DESCRIPTIONS[decisionType], handler, handlerName: handlerName(handler, ctx), handlerKind: handler.kind, uniform: row?.uniform ?? true, gated: AGENT_GATED_DECISIONS.includes(decisionType), departments: perDept };
  });
}

/* ---------- Delegate dialog ---------- */

export interface DelegateDialogProps {
  row: ResponsibilityRowView | null;
  onOpenChange: (open: boolean) => void;
  agents: readonly AgentRow[];
  humans: readonly MembershipRow[];
  departments: readonly DepartmentRow[] | undefined;
  me: Me;
  onDelegated: (row: ResponsibilityRowView, handler: ResponsibilityHandler, departmentId: string | null) => void;
}

export function DelegateDialog({ row, onOpenChange, agents, humans, departments, me, onDelegated }: DelegateDialogProps) {
  const id = useId();
  const action = useAction();
  const [kind, setKind] = useState<"user" | "agent">("user");
  const [handlerId, setHandlerId] = useState("");
  const [departmentId, setDepartmentId] = useState("all");
  useEffect(() => {
    if (row) {
      setKind(row.gated ? "user" : row.handlerKind === "agent" ? "agent" : "user");
      setHandlerId(row.handler.kind !== "founder" && row.handler.id ? row.handler.id : "");
      setDepartmentId("all");
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per row
  }, [row?.decisionType]);
  const humanOptions = humans.filter((h) => h.userId !== me.userId).map((h) => ({ value: h.userId, label: memberName(h, me) }));
  const agentOptions = agents.filter((a) => !a.archivedAt).map((a) => ({ value: a.id, label: a.role ? `${a.name} · ${a.role}` : a.name }));
  const options = kind === "user" ? humanOptions : agentOptions;
  const deptOptions = [{ value: "all", label: "All departments" }, ...(departments ?? []).filter((d) => !d.hidden).map((d) => ({ value: d.id, label: `Only ${d.name}` }))];
  const confirm = async () => {
    if (!row || !handlerId) return;
    const handler: ResponsibilityHandler = { kind, id: handlerId };
    const input: Record<string, unknown> = { decisionType: row.decisionType, handler };
    if (departmentId !== "all") input.departmentId = departmentId;
    const r = await action.run("team.responsibilities.set", input, { key: `delegate:${row.decisionType}` });
    if (r !== undefined) {
      onDelegated(row, handler, departmentId === "all" ? null : departmentId);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`} data-testid="delegate-dialog">
        <DialogHeader>
          <DialogTitle>Delegate “{row?.label}”</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{row?.description} Approvals for this decision go to the handler from now on. Logged.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <fieldset>
            <legend className="t-label mb-1">Handler</legend>
            <RadioGroup value={kind} onValueChange={(v) => { setKind(v as "user" | "agent"); setHandlerId(""); }} aria-label="Handler kind" className="gap-1">
              <RadioOption id={`${id}-user`} value="user" label="A staff member" />
              <RadioOption id={`${id}-agent`} value="agent" label="An agent" disabled={row?.gated} description={row?.gated ? "A hard gate: an agent can never sign or accept terms." : undefined} />
            </RadioGroup>
          </fieldset>
          <Field htmlFor={`${id}-who`} label={kind === "user" ? "Staff member" : "Agent"} required>
            <SimpleSelect id={`${id}-who`} aria-label={kind === "user" ? "Staff member" : "Agent"} options={options} value={handlerId || undefined} onValueChange={setHandlerId} placeholder={options.length ? "Choose" : kind === "user" ? "No other staff yet; invite from the Staff tab" : "No agents yet"} disabled={!options.length} />
          </Field>
          <Field htmlFor={`${id}-dept`} label="Where">
            <SimpleSelect id={`${id}-dept`} aria-label="Where" options={deptOptions} value={departmentId} onValueChange={setDepartmentId} />
          </Field>
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={ArrowLeftRight} disabled={!handlerId} loading={action.pending !== null} onClick={() => void confirm()} data-testid="delegate-confirm">
            Delegate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Screen ---------- */

export function ResponsibilitiesScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const data = useWidgetQuery<ResponsibilitiesResponse>("team.responsibilities.get", undefined);
  const agentsQuery = useAgents();
  const humansQuery = useHumans();
  const meQuery = useMe();
  const departments = useDepartments();
  const action = useAction();
  const me = useMemo(() => readMe(meQuery.data, businessId), [meQuery.data, businessId]);
  const agentIndex = useMemo(() => new Map((agentsQuery.data?.agents ?? []).map((a) => [a.id, a])), [agentsQuery.data]);
  const humanIndex = useMemo(() => new Map((humansQuery.data ?? []).map((h) => [h.userId, h])), [humansQuery.data]);
  const ctx = useMemo(() => ({ agents: agentIndex, humans: humanIndex, me }), [agentIndex, humanIndex, me]);
  const rows = useMemo(() => toResponsibilityRows(data.data, departments.data, ctx), [data.data, departments.data, ctx]);
  const [views, setViews] = useState<SavedView[]>(RESPONSIBILITY_VIEWS);
  const [delegate, setDelegate] = useState<ResponsibilityRowView | null>(null);
  const [selected, setSelected] = useState<DecisionType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedRow = rows.find((r) => r.decisionType === selected) ?? null;

  const takeBack = async (row: ResponsibilityRowView, departmentId?: string) => {
    const input: Record<string, unknown> = { decisionType: row.decisionType, handler: { kind: "founder", id: null } };
    if (departmentId) input.departmentId = departmentId;
    const r = await action.run("team.responsibilities.set", input, { key: `takeback:${row.decisionType}${departmentId ? `:${departmentId}` : ""}` });
    if (r !== undefined) {
      setNotice(`${row.label} is yours again${departmentId ? ` in ${departments.data?.find((d) => d.id === departmentId)?.name ?? "that department"}` : ""}.`);
      data.refetch();
    }
  };

  const renderHandler = (h: ResponsibilityHandler, name: string) => {
    if (h.kind === "founder") return <Chip tone="kit">{name}</Chip>;
    if (h.kind === "agent" && h.id) {
      const agent = agentIndex.get(h.id);
      return (
        <span className="inline-flex min-w-0 items-center gap-2">
          {agent ? <Avatar size={20} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept: agentDept(agent) }} status={agent.status} /> : null}
          <EntityLink entity={{ id: h.id, kind: "agent", name, href: agentHref(businessId, h.id) }} details={agent ? agentEntity(businessId, agent) : undefined} onOpen={(e) => e.href && navigate(e.href)} onVerb={(verb, e) => verb === "open_profile" && e.href && navigate(e.href)} />
        </span>
      );
    }
    const m = h.id ? humanIndex.get(h.id) : undefined;
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Avatar size={20} name={name} />
        <EntityLink entity={{ id: m?.entityId ?? h.id ?? name, kind: "team_member", name, href: m?.entityId ? `/b/${businessId}/crm/${m.entityId}/overview` : undefined }} details={m ? memberEntity(businessId, m, me) : undefined} onOpen={(e) => e.href && navigate(e.href)} />
      </span>
    );
  };

  const columns = useMemo<DataTableColumn<ResponsibilityRowView>[]>(
    () => [
      {
        id: "label",
        accessorKey: "label",
        header: "Decision",
        size: 300,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col py-0.5">
            <span className="inline-flex items-center gap-1.5 text-body-strong">
              {row.original.label}
              {row.original.gated ? (
                <Chip tone="warn" icon={Lock}>
                  Hard gate
                </Chip>
              ) : null}
            </span>
            <span className="truncate text-small text-secondary" title={row.original.description}>
              {row.original.description}
            </span>
          </span>
        ),
      },
      { id: "handler", accessorFn: (r) => r.handlerKind, header: "Handler", size: 260, meta: { filter: "select", filterOptions: [{ value: "founder", label: "You" }, { value: "user", label: "Staff" }, { value: "agent", label: "Agent" }], csv: (r) => r.handlerName }, cell: ({ row }) => renderHandler(row.original.handler, row.original.handlerName) },
      {
        id: "scope",
        accessorFn: (r) => (r.uniform ? "Every department" : "Differs by department"),
        header: "Scope",
        size: 200,
        cell: ({ row }) => (row.original.uniform ? <span className="text-secondary">Every department</span> : <Chip tone="warn">Differs by department</Chip>),
      },
      {
        id: "actions",
        header: "",
        size: 220,
        enableSorting: false,
        meta: { filter: false, locked: true, csv: () => "" },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={() => setDelegate(row.original)} aria-label={`Delegate ${row.original.label}`}>
              Delegate…
            </Button>
            {row.original.handlerKind !== "founder" || !row.original.uniform ? (
              <Button size="sm" variant="ghost" icon={Undo2} loading={action.pending === `takeback:${row.original.decisionType}`} onClick={() => void takeBack(row.original)} aria-label={`Take back ${row.original.label}`}>
                Take back
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read the latest indexes through closures
    [agentIndex, humanIndex, me, businessId, action.pending],
  );

  const rowActions = (row: ResponsibilityRowView): RowAction<ResponsibilityRowView>[] => [
    { id: "delegate", label: "Delegate…", icon: ArrowLeftRight, onSelect: () => setDelegate(row) },
    { id: "takeback", label: "Take back", icon: Undo2, disabled: row.handlerKind === "founder" && row.uniform, onSelect: () => void takeBack(row) },
    { id: "departments", label: "Show by department", icon: ScrollText, separatorBefore: true, onSelect: () => setSelected(row.decisionType) },
  ];

  const delegated = rows.filter((r) => r.handlerKind !== "founder").length;
  const differing = rows.filter((r) => !r.uniform).length;

  return (
    <Screen name="team/responsibilities">
      <Panel
        span={selectedRow ? 8 : 12}
        title="Responsibilities"
        flush
        loading={data.isLoading && !data.data}
        error={data.error ? data.error.message : undefined}
        onRetry={data.refetch}
        actions={
          <span className="text-small text-secondary tabular-nums" data-testid="responsibilities-summary">
            {rows.length} decision types · {delegated} delegated{differing ? ` · ${differing} differ by department` : ""}
          </span>
        }
        footer={
          <span className="flex items-center gap-2">
            <span>Delegating changes who receives the approvals for that decision; every change is logged. Signing stays a hard gate: no agent can ever hold it.</span>
            {notice ? <span data-testid="responsibilities-notice">{notice}</span> : null}
            <InlineError error={action.error} />
          </span>
        }
      >
        <DataTable<ResponsibilityRowView> aria-label="Responsibilities" data={rows} columns={columns} views={views} onViewsChange={setViews} defaultViewId="all" rowActions={rowActions} onRowClick={(row) => setSelected(row.decisionType)} onRowOpen={(row) => setDelegate(row)} height={Math.max(320, rows.length * 44 + 48)} density="comfortable" exportFileName="responsibilities" footer={null} className="border-0" />
      </Panel>

      {selectedRow ? (
        <Panel span={4} title={`${selectedRow.label} by department`} flush actions={<Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>} empty={selectedRow.departments.length === 0 ? { children: "No departments yet; the business-wide handler applies." } : undefined}>
          <MiniTable<ResponsibilityRowView["departments"][number]>
            aria-label={`${selectedRow.label} by department`}
            rows={selectedRow.departments}
            getRowKey={(d) => d.departmentId}
            columns={[
              { id: "department", header: "Department", cell: (d) => d.departmentName },
              { id: "handler", header: "Handler", cell: (d) => renderHandler(d.handler, d.handlerName) },
              {
                id: "action",
                header: "",
                numeric: true,
                cell: (d) => (d.handler.kind === "founder" ? null : <Button size="sm" variant="ghost" icon={Undo2} loading={action.pending === `takeback:${selectedRow.decisionType}:${d.departmentId}`} onClick={() => void takeBack(selectedRow, d.departmentId)} aria-label={`Take back ${selectedRow.label} in ${d.departmentName}`}>Take back</Button>),
              },
            ]}
          />
        </Panel>
      ) : null}

      <DelegateDialog
        row={delegate}
        onOpenChange={(o) => !o && setDelegate(null)}
        agents={agentsQuery.data?.agents ?? []}
        humans={humansQuery.data ?? []}
        departments={departments.data}
        me={me}
        onDelegated={(row, handler, departmentId) => {
          setNotice(`${row.label} delegated to ${handlerName(handler, ctx)}${departmentId ? ` in ${departments.data?.find((d) => d.id === departmentId)?.name ?? "one department"}` : ""}.`);
          data.refetch();
        }}
      />
    </Screen>
  );
}
