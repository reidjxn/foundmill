"use client";
/**
 * /leaderboards (BUILD §6.2, §11.14): every leaderboard in a DataTable with saved views (All boards, My positions) and
 * the current business's position on each, plus a "Your positions" panel. Boards rank verified integration metrics only
 * (AC-11.14.1); a business that is not LIVE, or has nothing verified, is told how to get on one.
 */
import { useQuery } from "@tanstack/react-query";
import { ListOrdered, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, DeltaBadge, Panel, ShellLink, formatRelative, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { boardKindLabel, boardScope, boardTitle, describeMetric, formatMetricValue, periodLabel, positionLabel } from "@/lib/live";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { PersonalNotice } from "./shared";

type Board = RouterOutputs["live"]["leaderboards"]["list"][number];
type Position = RouterOutputs["live"]["leaderboards"]["positions"][number];

interface BoardRow extends Board {
  title: string;
  scope: string;
  metricLabel: string;
  position: number | null;
  movement: number;
  /** ISO time or "", so the column sorts and filters as text. */
  computed: string;
}

const COLUMNS = ["title", "period", "metricLabel", "computed", "position"];

export const BOARD_VIEWS: SavedView[] = [
  { id: "all", name: "All boards", builtIn: true, columns: COLUMNS, sort: [{ id: "period", desc: true }, { id: "title", desc: false }], filters: [] },
  { id: "mine", name: "My positions", builtIn: true, columns: COLUMNS, sort: [{ id: "position", desc: false }], filters: [{ id: "f-mine", field: "position", op: "not_empty" }] },
];

export function LeaderboardsScreen() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  useShellChrome({ title: "Leaderboards" });
  const live = data.business.gameMode === "live";

  const boardsQ = useQuery(trpc.live.leaderboards.list.queryOptions(undefined, { staleTime: 30_000 }));
  const positionsQ = useQuery(trpc.live.leaderboards.positions.queryOptions({ businessId }, { staleTime: 30_000 }));
  const [views, setViews] = useState<SavedView[]>(BOARD_VIEWS);

  const positions = useMemo(() => positionsQ.data ?? [], [positionsQ.data]);
  const mine = useMemo(() => new Map(positions.map((p) => [p.leaderboardId, p])), [positions]);
  const rows = useMemo<BoardRow[]>(
    () =>
      (boardsQ.data ?? []).map((b) => ({
        ...b,
        title: boardTitle(b),
        scope: boardScope(b),
        metricLabel: describeMetric(b.metric).label,
        position: mine.get(b.id)?.position ?? null,
        movement: mine.get(b.id)?.movement ?? 0,
        computed: b.computedAt ? b.computedAt.toISOString() : "",
      })),
    [boardsQ.data, mine],
  );
  const open = (id: string) => router.push(routes.leaderboard(id));

  const columns = useMemo<DataTableColumn<BoardRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Leaderboard",
        size: 340,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="t-body-strong shrink-0 text-primary">{boardKindLabel(row.original.boardKind)}</span>
            <span className="truncate text-small text-secondary">{row.original.scope}</span>
          </span>
        ),
      },
      { id: "period", accessorKey: "period", header: "Period", size: 110, cell: ({ row }) => <span>{periodLabel(row.original.period)}</span> },
      { id: "metricLabel", accessorKey: "metricLabel", header: "Ranked on", size: 160 },
      { id: "computed", accessorKey: "computed", header: "Updated", size: 130, cell: ({ row }) => <span className="text-secondary">{row.original.computed ? formatRelative(row.original.computed) : "Not yet"}</span>, meta: { filter: "date" } },
      {
        id: "position",
        accessorKey: "position",
        header: "Your position",
        size: 150,
        meta: { numeric: true },
        cell: ({ row }) =>
          row.original.position === null ? (
            <span className="text-secondary">—</span>
          ) : (
            <span className="inline-flex items-center justify-end gap-2">
              <span className="t-body-strong tabular-nums text-primary">{positionLabel(row.original.position)}</span>
              <DeltaBadge delta={{ value: row.original.movement }} />
            </span>
          ),
      },
    ],
    [],
  );
  const rowActions = (): RowAction<BoardRow>[] => [{ id: "open", label: "Open leaderboard", icon: ListOrdered, onSelect: (r) => open(r.id) }];

  const settingsHref = live ? routes.settings(businessId, "integrations") : routes.settings(businessId, "mode");
  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="leaderboards-screen">
      <PersonalNotice className="col-span-12" />
      <Panel
        title="Leaderboards"
        span={8}
        flush
        loading={boardsQ.isLoading}
        error={boardsQ.error ? errorMessage(boardsQ.error) : undefined}
        onRetry={() => void boardsQ.refetch()}
        empty={!boardsQ.isLoading && !boardsQ.error && rows.length === 0 ? { icon: Trophy, children: "No leaderboards yet. They are built from verified metrics of LIVE businesses and appear here once the first one is computed." } : undefined}
        actions={<span className="text-small tabular-nums text-secondary">{rows.length} {rows.length === 1 ? "leaderboard" : "leaderboards"}</span>}
        footer="Boards rank verified integration metrics only. Numbers a founder types in never rank."
        data-testid="leaderboards-panel"
      >
        <DataTable<BoardRow>
          aria-label="Leaderboards"
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => open(r.id)}
          height={Math.min(520, Math.max(200, rows.length * 34 + 80))}
          density="comfortable"
          exportFileName="leaderboards"
          empty={{ icon: Trophy, children: "No leaderboard in this view." }}
          className="border-0"
        />
      </Panel>
      <Panel
        title="Your positions"
        span={4}
        flush
        loading={positionsQ.isLoading}
        error={positionsQ.error ? errorMessage(positionsQ.error) : undefined}
        onRetry={() => void positionsQ.refetch()}
        empty={
          positions.length === 0
            ? {
                icon: Trophy,
                children: live
                  ? `${data.business.name} is not on a leaderboard yet. A business ranks once an integration supplies a verified metric.`
                  : `${data.business.name} is a Personal business, so it is not ranked. Switch it to LIVE to take part.`,
                action: { label: live ? "Open integrations" : "Open Settings › Mode", onClick: () => router.push(settingsHref) },
              }
            : undefined
        }
        footer={positions.length ? `${data.business.name}` : undefined}
        data-testid="positions-panel"
      >
        <ul>
          {positions.map((p) => (
            <PositionRow key={p.id} position={p} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function PositionRow({ position }: { position: Position }) {
  const { board } = position;
  const metric = describeMetric(board.metric);
  return (
    <li className="border-b border-subtle/50 last:border-b-0">
      <ShellLink href={routes.leaderboard(board.id)} className="flex items-center gap-3 px-panel-pad py-2 text-body text-primary hover:bg-panel-alt hover:no-underline" data-testid="position-row">
        <span className="t-display-sm w-10 shrink-0 tabular-nums text-primary">{positionLabel(position.position)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="t-body-strong truncate">{boardKindLabel(board.boardKind)}</span>
          <span className="truncate text-small text-secondary">
            {periodLabel(board.period)} · {metric.label} {formatMetricValue(position.metricValue, metric.format)}
          </span>
        </span>
        <DeltaBadge delta={{ value: position.movement }} />
      </ShellLink>
    </li>
  );
}
