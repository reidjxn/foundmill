"use client";
/**
 * Team › Responsibilities (BUILD §6.3, §11.9, AC-11.9.2): the matrix of decision types × handler (founder, a named
 * human, a named agent). One click takes a decision back; "Delegate…" picks a handler and, optionally, a single
 * department. Every change goes through `team.responsibilities.set`, which routes the matching approvals and logs it.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeftRight, Bot, Lock, ScrollText, Undo2, UserRound, UserRoundPlus } from "lucide-react";
import { Avatar, Button, Chip, DataTable, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Field, IconButton, MiniTable, Panel, RadioCard, RadioGroup, SimpleSelect, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { DECISION_TYPES, type DecisionType } from "@foundmill/shared/constants";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import { fitColumns, fitToGrow, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { PlaybooksPanel } from "./PlaybooksPanel";
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
  { id: "all", name: "All decisions", builtIn: true, columns: ["label", "covers", "handler", "scope", "actions"], sort: [], filters: [] },
  { id: "delegated", name: "Delegated", builtIn: true, columns: ["label", "covers", "handler", "scope", "actions"], sort: [], filters: [{ id: "kind-not-founder", field: "handler", op: "neq", value: "founder" }] },
  { id: "mine", name: "Mine", builtIn: true, columns: ["label", "covers", "scope", "actions"], sort: [], filters: [{ id: "kind-founder", field: "handler", op: "eq", value: "founder" }] },
];

/** Column minimums and how the extra width is shared (see fit.ts). The actions column holds Delegate and Take back. */
export const RESPONSIBILITY_FIT: Record<string, ColumnFit> = {
  // "Sign contracts" with its Hard gate chip fits whole at 1280; the description gives way first.
  label: { min: 236, grow: 1 },
  covers: { min: 220, grow: 5 },
  handler: { min: 168, grow: 1 },
  scope: { min: 136 },
  actions: { min: 204 },
};

/**
 * With the department detail open the matrix has two thirds of the width: Covers steps aside (the detail panel says
 * what the decision covers) and Delegate / Take back become icon buttons named in their tooltips, so every column
 * still fits at 1280 instead of the actions scrolling out of view.
 */
export const RESPONSIBILITY_FIT_NARROW: Record<string, ColumnFit> = { ...RESPONSIBILITY_FIT, actions: { min: 80 } };

const ROW_PX = 34;

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
  /** Opens Team › Staff, offered when a staff member is the handler and there is no one else yet. */
  onInviteStaff?: () => void;
}

export function DelegateDialog({ row, onOpenChange, agents, humans, departments, me, onDelegated, onInviteStaff }: DelegateDialogProps) {
  const id = useId();
  const action = useAction();
  const [kind, setKind] = useState<"user" | "agent">("user");
  const [handlerId, setHandlerId] = useState("");
  const [departmentId, setDepartmentId] = useState("all");
  const hasOtherStaff = humans.some((h) => h.userId !== me.userId);
  useEffect(() => {
    if (row) {
      // With no one else on the staff an agent is the only choice (except for signing, which stays with a person).
      setKind(row.gated ? "user" : row.handlerKind === "agent" || !hasOtherStaff ? "agent" : "user");
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
      <DialogContent size="md" aria-describedby={`${id}-desc`} data-testid="delegate-dialog">
        <DialogHeader>
          <DialogTitle>Delegate “{row?.label}”</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{row?.description} Approvals for this decision go to the handler from now on. Logged.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <fieldset>
            <legend className="t-label mb-1">Handler</legend>
            <RadioGroup
              value={kind}
              onValueChange={(v) => {
                setKind(v as "user" | "agent");
                setHandlerId("");
              }}
              aria-label="Handler kind"
              className="grid grid-cols-1 gap-2"
            >
              <RadioCard id={`${id}-user`} value="user" icon={UserRound} label="A staff member" description="A co-founder, advisor or contractor." />
              <RadioCard id={`${id}-agent`} value="agent" icon={Bot} label="An agent" disabled={row?.gated} description={row?.gated ? "A hard gate: an agent can never sign or accept terms." : "One of the team's agents."} />
            </RadioGroup>
          </fieldset>
          {kind === "user" && !options.length ? (
            // Nothing to choose from: say so in one line with the one action, instead of an empty, disabled list.
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2" data-testid="delegate-no-staff">
              <span className="text-small text-secondary">No one else is on the staff yet.</span>
              {onInviteStaff ? (
                <Button size="sm" icon={UserRoundPlus} onClick={onInviteStaff}>
                  Invite staff
                </Button>
              ) : null}
            </div>
          ) : (
            <Field htmlFor={`${id}-who`} label={kind === "user" ? "Staff member" : "Agent"} required>
              <SimpleSelect id={`${id}-who`} aria-label={kind === "user" ? "Staff member" : "Agent"} options={options} value={handlerId || undefined} onValueChange={setHandlerId} placeholder={options.length ? "Choose" : "No agents yet"} disabled={!options.length} />
            </Field>
          )}
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
  const { navigate, currency = "EUR" } = useWidgetData();
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
  // Signing can only go to a person: offer "Delegate to staff…" on the hard-gated rows only when there is someone.
  const otherStaff = (humansQuery.data ?? []).filter((h) => h.userId !== me.userId).length;
  const narrow = !!selectedRow;
  const [viewId, setViewId] = useState<string | null>("all");
  // Each column at its minimum; the table shares the spare width by the specs' weights itself (DataTable `meta.grow`).
  const fit = narrow ? RESPONSIBILITY_FIT_NARROW : RESPONSIBILITY_FIT;
  const sizes = useMemo(() => fitColumns(null, fit, []), [fit]);

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
        <span className="flex min-w-0 items-center gap-2">
          {agent ? <Avatar size={20} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept: agentDept(agent) }} status={agent.status} /> : null}
          <EntityLink entity={{ id: h.id, kind: "agent", name, href: agentHref(businessId, h.id) }} details={agent ? agentEntity(businessId, agent, currency) : undefined} className="min-w-0 truncate" onOpen={(e) => e.href && navigate(e.href)} onVerb={(verb, e) => verb === "open_profile" && e.href && navigate(e.href)} />
        </span>
      );
    }
    const m = h.id ? humanIndex.get(h.id) : undefined;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar size={20} name={name} />
        <EntityLink entity={{ id: m?.entityId ?? h.id ?? name, kind: "team_member", name, href: m?.entityId ? `/b/${businessId}/crm/${m.entityId}/overview` : undefined }} details={m ? memberEntity(businessId, m, me) : undefined} className="min-w-0 truncate" onOpen={(e) => e.href && navigate(e.href)} />
      </span>
    );
  };

  const delegateLabel = (row: ResponsibilityRowView) => (row.gated ? "Delegate to staff…" : "Delegate…");

  const columns = useMemo<DataTableColumn<ResponsibilityRowView>[]>(
    () => fitToGrow<ResponsibilityRowView>([
      {
        id: "label",
        accessorKey: "label",
        header: "Decision",
        size: sizes.label,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-body-strong">{row.original.label}</span>
            {row.original.gated ? (
              <Chip tone="warn" icon={Lock} className="shrink-0">
                Hard gate
              </Chip>
            ) : null}
          </span>
        ),
      },
      ...(narrow
        ? []
        : [
            {
              id: "covers",
              accessorKey: "description",
              header: "Covers",
              size: sizes.covers,
              enableSorting: false,
              cell: ({ row }) => (
                <span className="block min-w-0 truncate text-secondary" title={row.original.description}>
                  {row.original.description}
                </span>
              ),
            } satisfies DataTableColumn<ResponsibilityRowView>,
          ]),
      { id: "handler", accessorFn: (r) => r.handlerKind, header: "Handler", size: sizes.handler, meta: { filter: "select", filterOptions: [{ value: "founder", label: "You" }, { value: "user", label: "Staff" }, { value: "agent", label: "Agent" }], csv: (r) => r.handlerName }, cell: ({ row }) => renderHandler(row.original.handler, row.original.handlerName) },
      {
        id: "scope",
        accessorFn: (r) => (r.uniform ? "Every department" : "Differs by department"),
        header: "Scope",
        size: sizes.scope,
        cell: ({ row }) => (row.original.uniform ? <span className="text-secondary">Every department</span> : <Chip tone="warn">Differs by department</Chip>),
      },
      {
        id: "actions",
        header: "",
        size: sizes.actions,
        enableSorting: false,
        meta: { filter: false, locked: true, label: "Actions", csv: () => "" },
        cell: ({ row }) => {
          const r = row.original;
          const signOnly = r.gated && otherStaff === 0;
          const canTakeBack = r.handlerKind !== "founder" || !r.uniform;
          const takingBack = action.pending === `takeback:${r.decisionType}`;
          if (narrow) {
            return (
              <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {signOnly ? (
                  <span className="inline-flex size-control-sm items-center justify-center text-tertiary" title="A hard gate: only you, or a staff member you delegate to, can sign">
                    <Lock size={13} aria-label="Founder or staff only" />
                  </span>
                ) : (
                  <IconButton size="sm" icon={ArrowLeftRight} label={`Delegate ${r.label}`} onClick={() => setDelegate(r)} />
                )}
                {canTakeBack ? <IconButton size="sm" icon={Undo2} label={`Take back ${r.label}`} loading={takingBack} onClick={() => void takeBack(r)} /> : null}
              </span>
            );
          }
          return (
            <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {signOnly ? (
                <span className="inline-flex items-center gap-1.5 px-2 text-small text-tertiary" title="A hard gate: only you, or a staff member you delegate to, can sign">
                  <Lock size={13} aria-hidden className="shrink-0" />
                  Founder or staff only
                </span>
              ) : (
                <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={() => setDelegate(r)} aria-label={`Delegate ${r.label}`}>
                  {delegateLabel(r)}
                </Button>
              )}
              {canTakeBack ? (
                <Button size="sm" variant="ghost" icon={Undo2} loading={takingBack} onClick={() => void takeBack(r)} aria-label={`Take back ${r.label}`}>
                  Take back
                </Button>
              ) : null}
            </span>
          );
        },
      },
    ], fit),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read the latest indexes through closures
    [agentIndex, humanIndex, me, businessId, action.pending, sizes, otherStaff, currency, narrow],
  );

  const rowActions = (row: ResponsibilityRowView): RowAction<ResponsibilityRowView>[] => [
    { id: "delegate", label: delegateLabel(row), icon: ArrowLeftRight, disabled: row.gated && otherStaff === 0, onSelect: () => setDelegate(row) },
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
        meta={
          <span data-testid="responsibilities-summary">
            {plural(rows.length, "decision type")} · {delegated} delegated{differing ? ` · ${differing} ${differing === 1 ? "differs" : "differ"} by department` : ""}
          </span>
        }
        footer={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Delegating changes who receives the approvals for that decision; every change is logged. Signing stays a hard gate: no agent can ever hold it.</span>
            {notice ? (
              <span data-testid="responsibilities-notice" className="text-secondary">
                {notice}
              </span>
            ) : null}
            <InlineError error={action.error} />
          </span>
        }
      >
        <div className="min-w-0">
          {/* Remounted when the detail opens or closes, so the Covers column leaves and returns without marking the view as edited. */}
          <DataTable<ResponsibilityRowView> key={narrow ? "with-detail" : "full"} aria-label="Responsibilities" data={rows} columns={columns} views={views} onViewsChange={setViews} activeViewId={viewId} onActiveViewChange={setViewId} defaultViewId="all" getRowId={(r) => r.decisionType} selectedIds={selectedRow ? [selectedRow.decisionType] : []} rowActions={rowActions} onRowClick={(row) => setSelected(row.decisionType)} onRowOpen={(row) => (row.gated && otherStaff === 0 ? setSelected(row.decisionType) : setDelegate(row))} height={Math.max(3, rows.length) * ROW_PX + 44} density="comfortable" exportFileName="responsibilities" footer={null} className="border-0" />
        </div>
      </Panel>

      {selectedRow ? (
        <Panel span={4} title={`${selectedRow.label} by department`} flush actions={<Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>} empty={selectedRow.departments.length === 0 ? { children: "No departments yet; the business-wide handler applies." } : undefined}>
          <p className="border-b border-line-faint px-panel-pad py-2.5 text-small text-secondary">{selectedRow.description}</p>
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

      <PlaybooksPanel />

      <DelegateDialog
        row={delegate}
        onOpenChange={(o) => !o && setDelegate(null)}
        agents={agentsQuery.data?.agents ?? []}
        humans={humansQuery.data ?? []}
        departments={departments.data}
        me={me}
        onInviteStaff={() => navigate(routes.department(businessId, departmentForModule(departments.data, "team")?.slug ?? "team", "staff"))}
        onDelegated={(row, handler, departmentId) => {
          setNotice(`${row.label} delegated to ${handlerName(handler, ctx)}${departmentId ? ` in ${departments.data?.find((d) => d.id === departmentId)?.name ?? "one department"}` : ""}.`);
          data.refetch();
        }}
      />
    </Screen>
  );
}
