"use client";
/**
 * Team call lobby (docs/TEAM_CALL.md §6): Start a team call with the agents who join (the Chief of Staff and the leads
 * ticked), an optional topic, and the past calls in a table with saved views and a right-click menu.
 */
import { useQuery } from "@tanstack/react-query";
import { Lock, Phone, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, CallLobbyPicker, Chip, DataTable, EntityLink, Field, Input, Panel, formatRelative, type CallPickerAgent, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { isBackgroundAgent } from "@foundmill/shared/team-tiers";
import { TEAM_CALL_LIMITS, TEAM_CALL_WORDS, type TeamCallSummaryView } from "@foundmill/shared/team-call";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage } from "@/lib/trpc";
import { useTableViews } from "@/lib/table-views";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { callRowActionsLine, defaultCallSelection } from "./lobby-logic";
import { useStartCall } from "./use-start-call";

export const CALL_VIEWS: SavedView[] = [
  { id: "all", name: "All", builtIn: true, columns: ["startedAt", "kind", "topic", "summaryLine", "actions", "turnCount"], sort: [{ id: "startedAt", desc: true }], filters: [] },
  { id: "team", name: "Team calls", builtIn: true, columns: ["startedAt", "topic", "summaryLine", "actions"], sort: [{ id: "startedAt", desc: true }], filters: [{ id: "k1", field: "kind", op: "eq", value: "team" }] },
  { id: "one", name: "One-to-one", builtIn: true, columns: ["startedAt", "agent", "summaryLine", "actions"], sort: [{ id: "startedAt", desc: true }], filters: [{ id: "k1", field: "kind", op: "eq", value: "one_to_one" }] },
];

export function CallLobby() {
  const { businessId, access } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const { start, pending } = useStartCall();
  useShellChrome({ title: TEAM_CALL_WORDS.title }, []);

  const agentsQ = useQuery(trpc.team.agents.list.queryOptions({ businessId }, { staleTime: 60_000 }));
  const callsQ = useQuery(trpc.teamCall.list.queryOptions({ businessId, limit: 50 }, { staleTime: 10_000 }));

  const candidates = useMemo<CallPickerAgent[]>(
    () =>
      (agentsQ.data?.agents ?? [])
        .filter((a) => !a.archivedAt && !isBackgroundAgent(a))
        .map((a) => ({
          agentId: a.id,
          name: a.name,
          role: a.role ?? a.name,
          personaKey: a.personaKey ?? null,
          avatarSeed: a.avatarSeed || a.id,
          layer: a.layer,
          agentType: a.agentType,
          colourToken: a.departments[0]?.colourToken ?? null,
          departmentId: a.departments[0]?.id ?? null,
          isChiefOfStaff: a.chiefOfStaff,
        })),
    [agentsQ.data],
  );
  const defaults = useMemo(() => defaultCallSelection(agentsQ.data?.agents ?? []), [agentsQ.data]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? defaults;
  const [topic, setTopic] = useState("");
  const canStart = access.canWrite("team");

  // --- past calls ----------------------------------------------------------------------------------------------------
  const agentById = useMemo(() => new Map((agentsQ.data?.agents ?? []).map((a) => [a.id, a] as const)), [agentsQ.data]);
  const savedViews = useTableViews("teamCall.list", CALL_VIEWS, { businessId, defaultViewId: "all" });
  const open = (c: TeamCallSummaryView) => router.push(routes.call(businessId, c.id));
  const columns = useMemo<DataTableColumn<TeamCallSummaryView>[]>(
    () => [
      { id: "startedAt", accessorKey: "startedAt", header: "Started", size: 120, meta: { locked: true, filter: "date" }, cell: ({ getValue }) => <span className="font-mono text-mono text-secondary">{formatRelative(getValue() as string)}</span> },
      { id: "kind", accessorKey: "kind", header: "Kind", size: 120, meta: { filter: "select", filterOptions: [{ value: "team", label: "Team call" }, { value: "one_to_one", label: "One-to-one" }] }, cell: ({ row }) => <Chip tone="neutral" icon={row.original.kind === "team" ? Video : Phone}>{row.original.kind === "team" ? "Team call" : "One-to-one"}</Chip> },
      {
        id: "agent",
        accessorFn: (c) => (c.kind === "one_to_one" ? (agentById.get(c.agentIds[0] ?? "")?.name ?? "") : `${c.agentIds.length} agents`),
        header: "With",
        size: 150,
        cell: ({ row }) => {
          const c = row.original;
          const a = c.kind === "one_to_one" ? agentById.get(c.agentIds[0] ?? "") : undefined;
          if (!a) return <span className="text-secondary">{c.agentIds.length} agents</span>;
          return (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {c.visibility === "private" ? <Lock className="size-3.5 shrink-0 text-tertiary" aria-label={TEAM_CALL_WORDS.privateCall} data-testid="call-row-private" /> : null}
              <EntityLink entity={{ id: a.id, kind: "agent", name: a.name, href: routes.agent(businessId, a.id) }} hoverCard={false} className="min-w-0 truncate" />
            </span>
          );
        },
      },
      { id: "topic", accessorFn: (c) => c.topic ?? "", header: "Topic", size: 180, cell: ({ getValue }) => ((getValue() as string) ? <span className="truncate">{getValue() as string}</span> : <span className="text-tertiary">None</span>) },
      { id: "summaryLine", accessorFn: (c) => c.summaryLine ?? "", header: "What was discussed", size: 320, meta: { grow: 1 }, cell: ({ row }) => (row.original.summaryLine ? <span className="truncate">{row.original.summaryLine}</span> : <span className="text-tertiary">{row.original.status === "ended" ? "No summary" : row.original.status === "live" ? "In progress" : "Writing up"}</span>) },
      { id: "actions", accessorFn: (c) => callRowActionsLine(c), header: "Actions", size: 220, cell: ({ row }) => (row.original.status === "ended" ? <span data-testid="call-row-actions">{callRowActionsLine(row.original)}</span> : <span className="text-tertiary">None yet</span>) },
      { id: "turnCount", accessorKey: "turnCount", header: "Turns", size: 72, meta: { numeric: true } },
    ],
    [agentById, businessId],
  );
  const rowActions = (c: TeamCallSummaryView): RowAction<TeamCallSummaryView>[] => [
    { id: "open", label: c.status === "live" ? "Rejoin call" : "Open call", onSelect: () => open(c) },
    ...(c.kind === "one_to_one" && c.agentIds[0] && canStart ? [{ id: "again", label: "Call again", icon: Phone, onSelect: () => start({ kind: "one_to_one", agentIds: [c.agentIds[0]!] }) }] : []),
  ];

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="call-lobby">
      <Panel title={TEAM_CALL_WORDS.startTeam} span={4} className="self-start" data-testid="call-start-panel">
        <div className="flex flex-col gap-4">
          <p className="max-w-[var(--reading-measure)] text-body text-secondary">{TEAM_CALL_WORDS.lobbyLine}</p>
          <Field htmlFor="call-topic" label="Topic" hint="Optional. What you want to talk through.">
            <Input id="call-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={TEAM_CALL_LIMITS.maxTopicChars} placeholder="Launch week, pricing, the next hire" autoComplete="off" disabled={!canStart} data-testid="call-topic" />
          </Field>
          {agentsQ.isError ? (
            <p className="text-small text-status-bad" role="alert">
              {errorMessage(agentsQ.error)}
            </p>
          ) : (
            <CallLobbyPicker agents={candidates} selected={selected} onChange={setPicked} disabled={!canStart} />
          )}
          <div className="flex items-center gap-3">
            <Button variant="primary" icon={Video} loading={pending} disabled={!canStart || selected.length === 0} onClick={() => start({ kind: "team", agentIds: selected, topic })} data-testid="call-start">
              {TEAM_CALL_WORDS.startTeam}
            </Button>
            {!canStart ? <span className="text-small text-secondary">Starting a call needs write access to Team.</span> : null}
          </div>
        </div>
      </Panel>
      <Panel
        title="Past calls"
        span={8}
        flush
        loading={callsQ.isLoading}
        error={callsQ.isError ? errorMessage(callsQ.error) : undefined}
        onRetry={() => void callsQ.refetch()}
        empty={callsQ.data && callsQ.data.length === 0 ? { icon: Video, children: TEAM_CALL_WORDS.emptyHistory } : undefined}
        data-testid="call-history"
      >
        {callsQ.data && callsQ.data.length > 0 ? <DataTable<TeamCallSummaryView> aria-label="Past calls" data={callsQ.data} columns={columns} {...savedViews} rowActions={rowActions} onRowOpen={open} height={Math.max(240, Math.min(560, 40 + callsQ.data.length * 36))} exportFileName="team-calls" className="border-0" hideFilter /> : null}
      </Panel>
    </div>
  );
}
