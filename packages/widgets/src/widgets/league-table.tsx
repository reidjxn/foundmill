"use client";
/**
 * Leaderboard widget (LIVE only, BUILD §11.14; registry key `league_table`): one leaderboard with this club's row highlighted. Positions come
 * from verified integration metrics only (AC-11.14.1); the widget never computes rank itself.
 */
import { useMemo } from "react";
import { z } from "zod";
import { ListOrdered, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Button, EmptyState, MiniTable, formatCompact, type MiniTableColumn } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import type { LeaderboardEntryRow, LeaderboardRow } from "../shared/types";

export const LeagueTableSettings = z.object({
  /** Board kind (e.g. "mrr_growth"); null → the first board listed. */
  boardKind: z.string().nullable().default(null),
  rows: z.number().int().min(5).max(50).default(10),
});
export type LeagueTableSettings = z.infer<typeof LeagueTableSettings>;

export function pickBoard(boards: readonly LeaderboardRow[] | undefined, boardKind: string | null): LeaderboardRow | undefined {
  if (!boards?.length) return undefined;
  return (boardKind && boards.find((b) => b.boardKind === boardKind)) || boards[0];
}

/** The rows around this club: top N, and this club's neighbourhood when it sits below the cut. */
export function windowRows(entries: readonly LeaderboardEntryRow[], businessId: string, rows: number): LeaderboardEntryRow[] {
  const sorted = entries.slice().sort((a, b) => a.position - b.position);
  const mine = sorted.findIndex((e) => e.businessId === businessId);
  if (mine < 0 || mine < rows) return sorted.slice(0, rows);
  const head = sorted.slice(0, Math.max(1, rows - 3));
  const around = sorted.slice(Math.max(head.length, mine - 1), mine + 2);
  return [...head, ...around];
}

function Movement({ n }: { n: number }) {
  const Icon = n > 0 ? TrendingUp : n < 0 ? TrendingDown : Minus;
  const cls = n > 0 ? "text-status-good" : n < 0 ? "text-status-bad" : "text-secondary";
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${cls}`} aria-label={n === 0 ? "no change" : n > 0 ? `up ${n}` : `down ${-n}`}>
      <Icon size={12} aria-hidden /> {n === 0 ? "—" : Math.abs(n)}
    </span>
  );
}

function LeagueTableWidget({ settings }: WidgetProps<LeagueTableSettings>) {
  const { businessId, navigate, gameMode = "personal" } = useWidgetData();
  const live = gameMode === "live";
  const boards = useWidgetQuery<LeaderboardRow[]>("live.leaderboards.list", {}, { enabled: live });
  const board = pickBoard(boards.data, settings.boardKind);
  const entries = useWidgetQuery<LeaderboardEntryRow[]>("live.leaderboards.entries", { leaderboardId: board?.id, limit: 100 }, { enabled: live && !!board });
  const rows = useMemo(() => windowRows(entries.data ?? [], businessId, settings.rows), [entries.data, businessId, settings.rows]);
  const columns: MiniTableColumn<LeaderboardEntryRow>[] = [
    { id: "pos", header: "#", numeric: true, width: 36, cell: (r) => r.position },
    { id: "club", header: "Business", cell: (r) => <span className={r.businessId === businessId ? "text-body-strong" : undefined}>{r.businessName ?? (r.businessId === businessId ? "Your business" : `Business ${r.businessId.slice(0, 6)}`)}</span> },
    { id: "move", header: "Move", width: 56, cell: (r) => <Movement n={r.movement} /> },
    { id: "metric", header: board?.metricLabel ?? "Metric", numeric: true, width: 90, cell: (r) => formatCompact(Number(r.metricValue)) },
  ];
  if (!live) {
    return (
      <WidgetFrame title="Leaderboard" data-widget="league_table">
        <EmptyState icon={ListOrdered} className="py-4">
          Leaderboards are part of LIVE. Switch the game mode in Settings to join one.
        </EmptyState>
      </WidgetFrame>
    );
  }
  const mine = entries.data?.find((e) => e.businessId === businessId);
  return (
    <WidgetFrame
      title={board?.title ? `Leaderboard · ${board.title}` : "Leaderboard"}
      data-widget="league_table"
      queries={board ? [boards, entries] : [boards]}
      flush
      empty={boards.data && !board ? { icon: ListOrdered, text: "No leaderboard is open this period." } : entries.data && rows.length === 0 ? { icon: ListOrdered, text: "No verified businesses on this board yet. Connect Stripe or Shopify to be ranked." } : null}
      actions={board ? <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => navigate(routes.leaderboard(board.id))}>Open</Button> : null}
      footer={<span>{board ? `${board.period}${board.division ? ` · ${board.division}` : ""}` : "LIVE"} · {mine ? `You are #${mine.position}` : "Not ranked yet"} · verified metrics only</span>}
    >
      <MiniTable columns={columns} rows={rows} getRowKey={(r) => r.businessId} highlight={(r) => r.businessId === businessId} onRowClick={() => board && navigate(routes.leaderboard(board.id))} aria-label="Leaderboard" emptyText="No entries." />
    </WidgetFrame>
  );
}

export const leagueTableWidget = registerWidget<LeagueTableSettings>({
  key: "league_table",
  title: "Leaderboard",
  description: "Where your business stands this period (LIVE).",
  icon: "list-ordered",
  surfaces: ["home"],
  defaultSize: { w: 4, h: 12, minW: 3, minH: 8 },
  settingsSchema: LeagueTableSettings,
  defaultSettings: LeagueTableSettings.parse({}),
  liveOnly: true,
  Component: LeagueTableWidget,
});
