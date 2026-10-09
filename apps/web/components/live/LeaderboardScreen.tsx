"use client";
/**
 * /leaderboards/[boardId] (BUILD §6.2, §11.14): one board. A strip with the current business's position, how many
 * businesses are ranked and when it was last computed, then a DataTable of the entries: position, movement, logo and
 * business, the metric the board ranks on, and form. The current business's row is raised and marked "You".
 */
import { useQuery } from "@tanstack/react-query";
import { Copy, Home, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Chip, DataTable, DeltaBadge, FormCells, Panel, StatusStrip, formatRelative, useToast, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets";
import { boardKindLabel, boardScope, boardTitle, describeMetric, formResults, formatMetricValue, periodLabel, positionLabel } from "@/lib/live";
import { errorMessage, trpcErrorCode } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { BusinessLogo, PersonalNotice, type BusinessCard } from "./shared";

interface EntryRow {
  id: string;
  businessId: string;
  position: number;
  movement: number;
  name: string;
  /** The business's public card (name and logo inputs), when it is listed. */
  card: BusinessCard | null;
  metricValue: number;
  form: string;
  you: boolean;
}

export const ENTRY_VIEWS: SavedView[] = [
  { id: "ranking", name: "Ranking", builtIn: true, columns: ["position", "movement", "name", "metricValue", "form"], sort: [{ id: "position", desc: false }], filters: [] },
  { id: "movers", name: "Biggest movers", builtIn: true, columns: ["movement", "position", "name", "metricValue", "form"], sort: [{ id: "movement", desc: true }], filters: [] },
];

export function LeaderboardScreen({ boardId }: { boardId: string }) {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const { toast } = useToast();
  const live = data.business.gameMode === "live";

  const boardQ = useQuery(trpc.live.leaderboards.get.queryOptions({ leaderboardId: boardId }, { retry: false, staleTime: 30_000 }));
  const entriesQ = useQuery(trpc.live.leaderboards.entries.queryOptions({ leaderboardId: boardId, limit: 200 }, { enabled: !!boardQ.data, staleTime: 30_000 }));
  const board = boardQ.data;
  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const [views, setViews] = useState<SavedView[]>(ENTRY_VIEWS);

  const title = board ? boardTitle(board) : "Leaderboard";
  useShellChrome({ title, breadcrumbs: [{ label: "Leaderboards", href: "/leaderboards", icon: Trophy }, ...(board ? [{ label: title }] : [])] }, [title]);

  const metric = describeMetric(board?.metric ?? "");
  const rows = useMemo<EntryRow[]>(
    () =>
      entries.map((e) => ({
        id: e.id,
        businessId: e.businessId,
        position: e.position,
        movement: e.movement,
        name: e.businessId === businessId ? data.business.name : (e.businessName ?? "Unlisted business"),
        card: e.business,
        metricValue: Number(e.metricValue),
        form: e.form,
        you: e.businessId === businessId,
      })),
    [entries, businessId, data.business.name],
  );
  const mine = rows.find((r) => r.you);

  const columns = useMemo<DataTableColumn<EntryRow>[]>(
    () => [
      { id: "position", accessorKey: "position", header: "Position", size: 100, meta: { numeric: true }, cell: ({ row }) => <span className="t-body-strong tabular-nums text-primary">{positionLabel(row.original.position)}</span> },
      { id: "movement", accessorKey: "movement", header: "Movement", size: 120, meta: { numeric: true }, cell: ({ row }) => <DeltaBadge delta={{ value: row.original.movement }} /> },
      {
        id: "name",
        accessorKey: "name",
        header: "Business",
        size: 320,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-2">
            <BusinessLogo card={row.original.card ?? undefined} name={row.original.name} size={20} />
            <span className="t-body-strong truncate text-primary">{row.original.name}</span>
            {row.original.you ? <Chip tone="neutral">You</Chip> : null}
          </span>
        ),
      },
      { id: "metricValue", accessorKey: "metricValue", header: metric.label, size: 160, meta: { numeric: true, label: metric.label }, cell: ({ row }) => <span className="tabular-nums">{formatMetricValue(row.original.metricValue, metric.format)}</span> },
      { id: "form", accessorKey: "form", header: "Form", size: 110, meta: { filter: false }, cell: ({ row }) => <FormCells form={formResults(row.original.form)} name="Form" /> },
    ],
    [metric.label, metric.format],
  );

  const rowActions = (row: EntryRow): RowAction<EntryRow>[] => [
    ...(row.you ? [{ id: "home", label: "Open Home", icon: Home, onSelect: () => router.push(routes.home(businessId)) } satisfies RowAction<EntryRow>] : []),
    {
      id: "copy",
      label: "Copy name and position",
      icon: Copy,
      onSelect: (r) => {
        void navigator.clipboard?.writeText(`${positionLabel(r.position)} ${r.name}`).then(() => toast({ title: "Copied", tone: "info" }));
      },
    },
  ];

  if (boardQ.isLoading) return <div className="grid grid-cols-12 gap-gutter p-gutter"><Panel title="Leaderboard" span={12} loading data-testid="leaderboard-loading" /></div>;
  if (boardQ.error || !board) {
    const code = trpcErrorCode(boardQ.error);
    const missing = code === "NOT_FOUND" || code === "BAD_REQUEST";
    return (
      <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="leaderboard-screen" data-state="unavailable">
        <Panel
          title="Leaderboard"
          span={12}
          error={missing ? undefined : errorMessage(boardQ.error)}
          onRetry={() => void boardQ.refetch()}
          empty={missing ? { icon: Trophy, title: "No such leaderboard", children: "It may have been replaced by a newer one.", action: { label: "All leaderboards", icon: Trophy, onClick: () => router.push("/leaderboards") } } : undefined}
        />
      </div>
    );
  }

  const tiles: MetricTileProps[] = [
    { label: "Your position", value: mine ? positionLabel(mine.position) : "Not ranked", caption: mine ? `${data.business.name}, ${metric.label} ${formatMetricValue(mine.metricValue, metric.format)}` : live ? `${data.business.name} is not on this board` : "Personal businesses are not ranked" },
    { label: "Businesses ranked", value: entries.length, format: "integer", caption: `${periodLabel(board.period)} · ${boardScope(board)}` },
    { label: "Updated", value: board.computedAt ? formatRelative(board.computedAt) : "Not yet", caption: `Ranked on ${metric.label}` },
  ];

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="leaderboard-screen" data-board-id={board.id}>
      <PersonalNotice className="col-span-12" />
      <StatusStrip className="col-span-12" tiles={tiles} aria-label={`${boardKindLabel(board.boardKind)} at a glance`} />
      <Panel
        title={`${title} · ${periodLabel(board.period)}`}
        span={12}
        flush
        loading={entriesQ.isLoading}
        error={entriesQ.error ? errorMessage(entriesQ.error) : undefined}
        onRetry={() => void entriesQ.refetch()}
        empty={!entriesQ.isLoading && !entriesQ.error && rows.length === 0 ? { icon: Trophy, children: "Nobody is ranked on this board yet. Entries appear when verified metrics are computed." } : undefined}
        actions={<span className="text-small tabular-nums text-secondary">{rows.length} {rows.length === 1 ? "business" : "businesses"}</span>}
        footer="Verified integration metrics only. Numbers a founder types in never rank."
        data-testid="leaderboard-entries"
      >
        <DataTable<EntryRow>
          aria-label={`${title} entries`}
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="ranking"
          rowActions={rowActions}
          selectedIds={mine ? [mine.id] : []}
          footer={null}
          height={Math.min(560, Math.max(200, rows.length * 34 + 80))}
          density="comfortable"
          exportFileName={`leaderboard-${board.boardKind}-${board.period}`}
          className="border-0"
        />
      </Panel>
    </div>
  );
}
