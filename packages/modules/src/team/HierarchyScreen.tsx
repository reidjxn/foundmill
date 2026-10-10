"use client";
/**
 * Team › Hierarchy (BUILD §6.3, §11.9): the org chart founder → Chief of Staff → leads → workers on Dugout's
 * HierarchyChart (arrow keys walk the tree). Reporting lines come from `lineManagerId`; an agent without one reports
 * to its first department's lead, leads and utilities to the Chief of Staff, the Chief of Staff to the founder.
 * Selecting a node shows its facts and opens the profile.
 */
import { useMemo, useState } from "react";
import { ExternalLink, Network, UserRoundPlus } from "lucide-react";
import { Avatar, Button, DeptChip, EntityLink, HierarchyChart, KeyValueList, ModelChip, Panel, ProvenanceChip, Switch, formatMoney, layoutHierarchy, type HierarchyKind, type HierarchyNode } from "@foundmill/dugout";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData } from "@foundmill/widgets/data";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import { plural } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { AgentStatusWordPill, ROLE_LABELS, Screen, agentDept, agentRoleLine, agentEntity, agentHref, isChiefOfStaff, memberEntity, memberName, readMe, useAgents, useHumans, useLiveAgentStatus, useMe, useNow, useTeamOptions, withLiveStatus, type Me } from "./shared";
import type { AgentRow, MembershipRow } from "./types";

export const FOUNDER_NODE_ID = "founder";

export function hierarchyKind(agent: AgentRow): HierarchyKind {
  if (isChiefOfStaff(agent)) return "assistant";
  if (agent.layer === "lead" || agent.agentType?.endsWith("_lead")) return "lead";
  if (agent.layer === "utility") return "utility";
  return "worker";
}

/**
 * Chart nodes. Parents: explicit `lineManagerId` when it points at a live agent; otherwise the first department's
 * lead (not for the lead itself), else the Chief of Staff, else the founder. Staff (humans) hang under the founder
 * when `includeStaff` is on.
 */
export function toHierarchyNodes(agents: readonly AgentRow[], opts: { departments?: readonly DepartmentRow[]; founderName: string; staff?: readonly MembershipRow[]; me?: Me }): HierarchyNode[] {
  const live = agents.filter((a) => !a.archivedAt);
  const ids = new Set(live.map((a) => a.id));
  const cos = live.find(isChiefOfStaff);
  const leadOfDept = new Map<string, string>();
  for (const d of opts.departments ?? []) if (d.leadAgentId && ids.has(d.leadAgentId)) leadOfDept.set(d.id, d.leadAgentId);
  // The chart already labels the founder's kind ("Founder"), so the role line says who it is: you.
  const nodes: HierarchyNode[] = [{ id: FOUNDER_NODE_ID, name: opts.founderName, role: "You", kind: "founder", parentId: null }];
  for (const a of live) {
    const kind = hierarchyKind(a);
    let parentId: string | null = a.lineManagerId && ids.has(a.lineManagerId) && a.lineManagerId !== a.id ? a.lineManagerId : null;
    if (!parentId) {
      if (kind === "assistant") parentId = FOUNDER_NODE_ID;
      else if (kind === "worker") {
        const deptId = a.departmentIds?.[0] ?? a.departments?.[0]?.id;
        const lead = deptId ? leadOfDept.get(deptId) : undefined;
        parentId = lead && lead !== a.id ? lead : (cos?.id ?? FOUNDER_NODE_ID);
      } else parentId = cos?.id ?? FOUNDER_NODE_ID;
    }
    // A role that only repeats the name ("Quality Specialist" / "Quality specialist") gives way to the department.
    const roleLine = agentRoleLine(a);
    const department = a.departments?.[0]?.name;
    nodes.push({ id: a.id, name: a.name, role: roleLine ?? department ?? "Agent", kind, parentId, avatar: { seed: a.avatarSeed || a.id, dept: agentDept(a) }, status: a.status, model: a.modelKey, department: roleLine ? department : undefined });
  }
  for (const m of opts.staff ?? []) {
    if (opts.me?.userId && m.userId === opts.me.userId) continue;
    nodes.push({ id: `staff:${m.userId}`, name: memberName(m, opts.me), role: ROLE_LABELS[m.role], kind: "human", parentId: FOUNDER_NODE_ID });
  }
  return nodes;
}

export function HierarchyScreen({ businessId }: ModuleScreenProps) {
  const { navigate, currency = "EUR" } = useWidgetData();
  const { liveRefetchMs } = useTeamOptions();
  const now = useNow();
  const agentsQuery = useAgents();
  const humans = useHumans();
  const meQuery = useMe();
  const departments = useDepartments();
  const live = useLiveAgentStatus(agentsQuery, { debounceMs: liveRefetchMs });
  const agents = useMemo(() => withLiveStatus(agentsQuery.data?.agents, live), [agentsQuery.data, live]);
  const me = useMemo(() => readMe(meQuery.data, businessId), [meQuery.data, businessId]);
  const [includeStaff, setIncludeStaff] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodes = useMemo(() => toHierarchyNodes(agents, { departments: departments.data, founderName: me.displayName || me.email || "You", staff: includeStaff ? humans.data : undefined, me }), [agents, departments.data, me, includeStaff, humans.data]);
  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;
  const selectedStaff = selectedId?.startsWith("staff:") ? humans.data?.find((m) => `staff:${m.userId}` === selectedId) ?? null : null;
  const reports = selectedId ? nodes.filter((n) => n.parentId === selectedId).length : 0;
  const teamDept = departmentForModule(departments.data, "team");
  const recruitHref = routes.department(businessId, teamDept?.slug ?? "team", "recruitment");
  const liveAgents = agents.filter((a) => !a.archivedAt);
  const leads = liveAgents.filter((a) => hierarchyKind(a) === "lead").length;
  const workers = liveAgents.filter((a) => hierarchyKind(a) === "worker").length;
  // The chart area is as tall as the tree, up to the window: the tree scrolls inside it with fades at the edges.
  const treeHeight = useMemo(() => layoutHierarchy(nodes).height, [nodes]);

  return (
    <Screen name="team/hierarchy">
      <Panel
        span={selectedId ? 8 : 12}
        title="Hierarchy"
        flush
        loading={agentsQuery.isLoading && !agentsQuery.data}
        error={agentsQuery.error ? agentsQuery.error.message : undefined}
        onRetry={agentsQuery.refetch}
        empty={agentsQuery.data && liveAgents.length === 0 ? { icon: Network, title: "Just you", children: "The chart grows as you hire: the Chief of Staff reports to you, leads to the Chief of Staff, workers to their department's lead.", action: { label: "Go to Recruitment", icon: UserRoundPlus, onClick: () => navigate(recruitHref) } } : undefined}
        meta={
          liveAgents.length ? (
            <span data-testid="hierarchy-summary">
              {plural(liveAgents.length, "agent")} · {plural(leads, "lead")} · {plural(workers, "worker")}
            </span>
          ) : undefined
        }
        actions={
          <label className="flex items-center gap-2 text-small text-secondary">
            <Switch size="sm" checked={includeStaff} onCheckedChange={setIncludeStaff} aria-label="Show staff" />
            Show staff
          </label>
        }
        footer="Reporting lines come from each agent's line manager; agents without one report to their department's lead. Change a line manager from the agent's profile."
      >
        <div className="flex flex-col" style={{ height: `min(${treeHeight + 2}px, calc(100vh - 248px))`, minHeight: 240 }}>
          <HierarchyChart nodes={nodes} selectedId={selectedId} onSelect={(n) => setSelectedId(n.id === selectedId ? null : n.id)} className="min-h-0 flex-1" />
        </div>
      </Panel>

      {selectedId ? (
        <Panel span={4} title={selectedAgent ? "Agent" : selectedStaff ? "Staff" : "Founder"} actions={<Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Close</Button>}>
          {selectedAgent ? (
            <div className="flex flex-col gap-3" data-testid="hierarchy-detail">
              <div className="flex items-center gap-2">
                <Avatar size={48} name={selectedAgent.name} agent={{ seed: selectedAgent.avatarSeed || selectedAgent.id, dept: agentDept(selectedAgent) }} status={selectedAgent.status} />
                <span className="flex min-w-0 flex-col">
                  <EntityLink entity={{ id: selectedAgent.id, kind: "agent", name: selectedAgent.name, href: agentHref(businessId, selectedAgent.id) }} details={agentEntity(businessId, selectedAgent, currency)} className="t-display-sm min-w-0 truncate" onOpen={(e) => e.href && navigate(e.href)} onVerb={(verb, e) => verb === "open_profile" && e.href && navigate(e.href)} />
                  {agentRoleLine(selectedAgent) ? <span className="text-small text-secondary">{agentRoleLine(selectedAgent)}</span> : null}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <AgentStatusWordPill status={selectedAgent.status} expectedReturnAt={selectedAgent.expectedReturnAt ?? selectedAgent.health?.expectedReturnAt} now={now} />
                <ModelChip model={selectedAgent.modelKey} />
                {(selectedAgent.departments ?? []).map((d) => (
                  <DeptChip key={d.id} dept={d.colourToken}>
                    {d.name}
                  </DeptChip>
                ))}
              </div>
              <KeyValueList
                dense
                items={[
                  { label: "Reports to", value: nodes.find((n) => n.id === nodes.find((x) => x.id === selectedAgent.id)?.parentId)?.name ?? "—" },
                  { label: "Direct reports", value: reports, numeric: true },
                  { label: "Current task", value: selectedAgent.currentTask?.title ?? "None" },
                  {
                    label: "Wage",
                    value: (
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        {formatMoney({ amountMinor: selectedAgent.wage?.costMinor ?? 0, currency: selectedAgent.currency ?? currency })}/mo <ProvenanceChip kind="estimate" />
                      </span>
                    ),
                  },
                ]}
              />
              <Button size="sm" icon={ExternalLink} onClick={() => navigate(agentHref(businessId, selectedAgent.id))}>
                Open profile
              </Button>
            </div>
          ) : selectedStaff ? (
            <div className="flex flex-col gap-3" data-testid="hierarchy-detail">
              <div className="flex items-center gap-2">
                <Avatar size={48} name={memberName(selectedStaff, me)} />
                <span className="flex min-w-0 flex-col">
                  <EntityLink entity={{ id: selectedStaff.entityId ?? selectedStaff.userId, kind: "team_member", name: memberName(selectedStaff, me), href: selectedStaff.entityId ? routes.crm(businessId, selectedStaff.entityId) : undefined }} details={memberEntity(businessId, selectedStaff, me)} className="t-display-sm min-w-0 truncate" onOpen={(e) => e.href && navigate(e.href)} />
                  <span className="text-small text-secondary">{ROLE_LABELS[selectedStaff.role]}</span>
                </span>
              </div>
              <KeyValueList dense items={[{ label: "E-mail", value: selectedStaff.email ?? "—" }, { label: "Reports to", value: me.displayName || "You" }]} />
            </div>
          ) : (
            <div className="flex flex-col gap-3" data-testid="hierarchy-detail">
              <div className="flex items-center gap-2">
                <Avatar size={48} name={me.displayName || "You"} />
                <span className="flex min-w-0 flex-col">
                  <span className="t-display-sm">{me.displayName || me.email || "You"}</span>
                  <span className="text-small text-secondary">Founder</span>
                </span>
              </div>
              <KeyValueList dense items={[{ label: "Direct reports", value: reports, numeric: true }, { label: "Agents", value: liveAgents.length, numeric: true }, { label: "Staff", value: humans.data?.length ?? 0, numeric: true }]} />
            </div>
          )}
        </Panel>
      ) : null}
    </Screen>
  );
}
