/**
 * Product › Changes (BUILD §11.5): the change proposals the Source Watcher and the Product lead raised, as a DataTable
 * with saved views and right-click verbs, and the selected proposal with its per-hunk three-way diffs
 * (changes/ProposalDetail.tsx). `?proposal=<id>` selects one (the Inbox decision links here).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, FileDiff, FolderOpen, X } from "lucide-react";
import { Chip, DataTable, EntityLink, Panel, StatusPill, formatDate, useEntityLinkContext, type DataTableColumn, type SavedView } from "@foundmill/dugout";
import { PROPOSAL_STATUSES, SEVERITIES } from "@foundmill/shared";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { ProposalDetail } from "./changes/ProposalDetail";
import { PROPOSAL_STATUS_PILL, SEVERITY_CHIP, decisionProgress, impactLines } from "./changes/hunks";
import { InlineError, Screen, useAction } from "./shared";
import type { ProposalRow, ProposalWithHunks, ProposalsListResponse, RoadmapResponse, SourceRow, SourcesListResponse, SpecGetResponse, SpecVersionRow } from "./types";

export const PROPOSAL_VIEWS: SavedView[] = [
  { id: "open", name: "Open", builtIn: true, columns: ["title", "severity", "proposedBy", "evidence", "impact", "createdAt"], sort: [{ id: "createdAt", desc: true }], filters: [{ id: "f-open", field: "status", op: "eq", value: "open" }] },
  { id: "all", name: "All", builtIn: true, columns: ["title", "status", "severity", "proposedBy", "evidence", "impact", "createdAt", "resolvedAt"], sort: [{ id: "createdAt", desc: true }], filters: [] },
  { id: "decided", name: "Decided", builtIn: true, columns: ["title", "status", "severity", "proposedBy", "resolvedAt"], sort: [{ id: "resolvedAt", desc: true }], filters: [{ id: "f-decided", field: "status", op: "neq", value: "open" }] },
];

function proposalFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("proposal");
  } catch {
    return null;
  }
}

function ProposerCell({ id }: { id: string | null }) {
  const ctx = useEntityLinkContext();
  if (!id) return <span className="text-secondary">System</span>;
  return <EntityLink entity={{ id, kind: "agent", name: ctx.resolve?.(id)?.name ?? "Agent" }} hoverCard={false} />;
}

export function proposalColumns(currency: string): DataTableColumn<ProposalRow>[] {
  return [
    { accessorKey: "title", header: "Proposal", size: 260, cell: ({ row }) => <span className="text-body-strong text-primary">{row.original.title || "Untitled proposal"}</span>, meta: { locked: true } },
    {
      accessorKey: "status",
      header: "Status",
      size: 130,
      cell: ({ row }) => {
        const p = PROPOSAL_STATUS_PILL[row.original.status];
        return (
          <StatusPill tone={p.tone} icon={p.icon}>
            {p.word}
          </StatusPill>
        );
      },
      meta: { filter: "select", filterOptions: PROPOSAL_STATUSES.map((s) => ({ value: s, label: PROPOSAL_STATUS_PILL[s].word })) },
    },
    {
      accessorKey: "severity",
      header: "Severity",
      size: 150,
      cell: ({ row }) => {
        const s = SEVERITY_CHIP[row.original.severity];
        return (
          <Chip tone={s.tone} icon={s.icon}>
            {s.word}
          </Chip>
        );
      },
      meta: { filter: "select", filterOptions: SEVERITIES.map((s) => ({ value: s, label: SEVERITY_CHIP[s].word })) },
    },
    { id: "proposedBy", accessorFn: (r) => r.proposedByAgentId ?? "", header: "Proposed by", size: 150, cell: ({ row }) => <ProposerCell id={row.original.proposedByAgentId} />, meta: { filter: false } },
    { id: "evidence", accessorFn: (r) => r.evidence.length, header: "Evidence", size: 90, meta: { numeric: true } },
    { id: "impact", accessorFn: (r) => r.impact?.summary ?? impactLines(r.impact, currency).map((l) => `${l.label} ${l.value}`).join(" · "), header: "Impact", size: 220, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "")}</span> },
    { accessorKey: "createdAt", header: "Raised", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue() as string)}</span>, meta: { filter: "date" } },
    { id: "resolvedAt", accessorFn: (r) => r.resolvedAt ?? "", header: "Resolved", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatDate(getValue() as string) : "—"}</span>, meta: { filter: "date" } },
  ];
}

export function ChangesScreen({ businessId }: ModuleScreenProps) {
  const { navigate, currency } = useWidgetData();
  const list = useWidgetQuery<ProposalsListResponse>("product.proposals.list", { limit: 200 });
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const roadmap = useWidgetQuery<RoadmapResponse>("product.roadmap.list", {});
  const sources = useWidgetQuery<SourcesListResponse>("product.sources.list", { limit: 200 });
  const versions = useWidgetQuery<SpecVersionRow[]>("product.spec.versions", undefined);
  const departments = useDepartments();
  const action = useAction();
  const [selectedId, setSelectedId] = useState<string | null>(() => proposalFromLocation());
  const [views, setViews] = useState<SavedView[]>(PROPOSAL_VIEWS);
  const detail = useWidgetQuery<ProposalWithHunks>("product.proposals.get", selectedId ? { proposalId: selectedId } : undefined, { enabled: selectedId !== null });

  const refetchAll = useCallback(() => {
    list.refetch();
    detail.refetch();
    spec.refetch();
    versions.refetch();
  }, [list, detail, spec, versions]);
  useBusinessEvents(refetchAll, ["spec.proposal_created", "spec.version_published"]);

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  useEffect(() => {
    if (!list.data) return;
    if (selectedId && rows.some((r) => r.id === selectedId)) return;
    setSelectedId(rows.find((r) => r.status === "open")?.id ?? rows[0]?.id ?? null);
  }, [list.data, rows, selectedId]);

  const columns = useMemo(() => proposalColumns(currency ?? "EUR"), [currency]);
  const href = (moduleKey: "product", tab: string, query?: string) => `${moduleHref(businessId, departments.data, moduleKey, tab) ?? routes.department(businessId, moduleKey, tab)}${query ?? ""}`;
  const openBlock = (blockId: string) => navigate(href("product", "specification", `?block=${blockId}`));
  const openRoadmapItem = (itemId: string) => navigate(href("product", "roadmap", `?item=${itemId}`));
  const openSource = (s: SourceRow) => {
    if (s.uri && typeof window !== "undefined") window.open(s.uri, "_blank", "noopener,noreferrer");
    else navigate(href("product", "sources", `?source=${s.id}`));
  };
  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <Screen name="product/changes">
      <Panel
        title="Change proposals"
        span={4}
        loading={list.isLoading}
        error={list.error ? list.error.message : undefined}
        onRetry={list.refetch}
        empty={list.data && rows.length === 0 ? { icon: FileDiff, title: "No proposals yet", children: "The Source Watcher raises a proposal when a new interview, issue, competitor move or legal note touches the spec. Each arrives as a red Inbox decision and lands here with its diff." } : undefined}
        footer={
          <>
            <span className="tabular-nums">{openCount} open · low-severity proposals are batched daily; legal, safety and security ones arrive at once</span>
            <span className="flex-1" />
            <InlineError error={action.error} />
          </>
        }
        flush
      >
        <DataTable<ProposalRow>
          aria-label="Change proposals"
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="open"
          height={520}
          defaultDensity="comfortable"
          exportFileName="change-proposals"
          onRowClick={(row) => setSelectedId(row.id)}
          onRowOpen={(row) => setSelectedId(row.id)}
          rowClassName={(row) => (row.id === selectedId ? "bg-panel-alt" : undefined)}
          rowActions={(row) => [
            { id: "open", label: "Open proposal", icon: FolderOpen, onSelect: (r) => setSelectedId(r.id) },
            { id: "accept", label: "Accept all hunks", icon: CheckCheck, disabled: row.status !== "open", separatorBefore: true, onSelect: (r) => void action.run("product.proposals.acceptAll", { proposalId: r.id }, { key: "acceptAll", then: refetchAll }) },
            { id: "reject", label: "Reject proposal", icon: X, variant: "danger", disabled: row.status !== "open", onSelect: (r) => void action.run("product.proposals.reject", { proposalId: r.id }, { key: "reject", then: refetchAll }) },
          ]}
        />
      </Panel>

      <Panel
        title="Proposal"
        span={8}
        loading={selectedId !== null && detail.isLoading}
        error={detail.error ? detail.error.message : undefined}
        onRetry={detail.refetch}
        empty={!selectedId ? { icon: FileDiff, children: "Pick a proposal to read its rationale, evidence and diffs." } : undefined}
        bodyClassName="min-h-96"
      >
        {detail.data ? (
          <ProposalDetail
            proposal={detail.data}
            blocks={spec.data?.blocks ?? []}
            roadmapItems={roadmap.data?.items ?? []}
            sources={sources.data?.items ?? []}
            latestVersion={versions.data?.[0] ?? spec.data?.latestVersion ?? null}
            currency={currency ?? "EUR"}
            onChanged={refetchAll}
            onOpenBlock={openBlock}
            onOpenRoadmapItem={openRoadmapItem}
            onOpenSource={openSource}
          />
        ) : null}
      </Panel>
      <span className="sr-only" aria-live="polite">
        {detail.data ? `${decisionProgress(detail.data.hunks).decided} of ${detail.data.hunks.length} hunks decided` : ""}
      </span>
    </Screen>
  );
}
