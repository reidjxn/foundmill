"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Play, Trophy } from "lucide-react";
import { CHANNEL_META, type ChannelKey, type ConversionKind, type EntityKind, type MatchdayLevel } from "@foundmill/shared/constants";
import { cn } from "../../lib/cn";
import { formatDate, formatMoney, formatTime } from "../../lib/format";
import { Button } from "../foundation/Button";
import { Chip, type ChipTone } from "../foundation/Chip";
import { EmptyState } from "../foundation/EmptyState";
import { Icon } from "../foundation/Icon";
import { EntityText } from "./EntityText";

export interface RoundupRow {
  conversionId: string;
  kind: ConversionKind;
  level: MatchdayLevel;
  customerName: string | null;
  entityId?: string | null;
  /** Captain channel (heaviest touch). */
  channelKey: ChannelKey | null;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  touchCount?: number;
  /** False when the journey has no replay yet (still building). */
  replayAvailable?: boolean;
  /** Above the 75th percentile or a flagged account: got a full Customer Update, listed here for completeness. */
  fullMatchDay?: boolean;
}

export interface MatchdayRoundupTableProps {
  rows: RoundupRow[];
  /** The day of the round-up (BUILD §11.4: wins that did not get a full Customer Update roll into a daily table). */
  day?: string;
  onOpenReplay: (conversionId: string) => void;
  onOpenEntity?: (id: string) => void;
  entityKinds?: Record<string, EntityKind>;
  className?: string;
}

type SortKey = "time" | "value" | "kind";

const KIND_WORD: Record<ConversionKind, string> = { signup: "Signup", activation: "Activation", payment: "Payment" };
const LEVEL: Record<MatchdayLevel, { word: string; tone: ChipTone }> = { friendly: { word: "Brief", tone: "neutral" }, league: { word: "Standard", tone: "info" }, cup: { word: "Featured", tone: "gold" } };
const KIND_RANK: Record<ConversionKind, number> = { payment: 0, activation: 1, signup: 2 };

export function sortRoundupRows(rows: readonly RoundupRow[], key: SortKey, dir: "asc" | "desc"): RoundupRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let d: number;
    if (key === "time") d = a.occurredAt.localeCompare(b.occurredAt);
    else if (key === "value") d = a.amountMinor - b.amountMinor;
    else d = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return d * sign || a.occurredAt.localeCompare(b.occurredAt);
  });
}

/** The daily results table (DESIGN §3 rows: 28 px, label headers, zebra, hover). Each row opens its replay. */
export function MatchdayRoundupTable({ rows, day, onOpenReplay, onOpenEntity, entityKinds, className }: MatchdayRoundupTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "time", dir: "desc" });
  const sorted = useMemo(() => sortRoundupRows(rows, sort.key, sort.dir), [rows, sort]);
  // First click: newest first, biggest first, payments first.
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "kind" ? "asc" : "desc" }));
  const totals = rows.reduce((acc, r) => ((acc[r.kind] = (acc[r.kind] ?? 0) + 1), acc), {} as Record<ConversionKind, number>);
  const currency = rows[0]?.currency ?? "EUR";
  const revenue = rows.filter((r) => r.kind === "payment").reduce((s, r) => s + r.amountMinor, 0);
  if (rows.length === 0) {
    return (
      <EmptyState icon={Trophy} className={className}>
        Wins that do not get a full Customer Update appear here each day once there are more than a hundred of a kind.
      </EmptyState>
    );
  }
  const Header = ({ k, children, align = "left" }: { k: SortKey; children: React.ReactNode; align?: "left" | "right" }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("h-row-compact px-2", align === "right" && "text-right")}>
      <button type="button" onClick={() => toggle(k)} className={cn("inline-flex items-center gap-1 t-data transition-colors hover:text-primary focus-visible:shadow-ring", align === "right" && "flex-row-reverse")}>
        {children}
        {sort.key === k ? <Icon icon={sort.dir === "asc" ? ArrowUp : ArrowDown} size={12} /> : null}
      </button>
    </th>
  );
  return (
    <div className={cn("flex flex-col", className)} data-roundup>
      <div className="flex items-center gap-3 px-2 py-1.5 text-small text-secondary">
        <span className="t-display-sm text-primary">Customer update round-up{day ? ` · ${formatDate(day)}` : ""}</span>
        <span className="tabular-nums">
          {totals.payment ?? 0} payments · {totals.activation ?? 0} activations · {totals.signup ?? 0} signups
        </span>
        {revenue > 0 ? <span className="ml-auto tabular-nums">{formatMoney({ amountMinor: revenue, currency })}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body">
          <thead className="table-head sticky top-0">
            <tr>
              <Header k="time">Time</Header>
              <Header k="kind">Win</Header>
              <th scope="col" className="h-control-sm px-2.5 text-left t-data">
                Customer
              </th>
              <th scope="col" className="h-control-sm px-2.5 text-left t-data">
                Lead channel
              </th>
              <th scope="col" className="h-control-sm px-2.5 text-right t-data">
                Touches
              </th>
              <Header k="value" align="right">
                Value
              </Header>
              <th scope="col" className="h-control-sm px-2.5 text-right t-data">
                Replay
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.conversionId} className={cn("h-row-compact border-b border-line-faint transition-colors odd:bg-white/1.5 hover:bg-white/4", r.kind === "payment" && "row-edge-gold")} data-roundup-row={r.conversionId}>
                <td className="whitespace-nowrap px-2 font-mono text-mono text-secondary tabular-nums">{formatTime(r.occurredAt)}</td>
                <td className="px-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-body-strong">{KIND_WORD[r.kind]}</span>
                    <Chip tone={LEVEL[r.level].tone}>{LEVEL[r.level].word}</Chip>
                    {r.fullMatchDay ? <Chip tone="kit">Full update</Chip> : null}
                  </span>
                </td>
                <td className="max-w-56 truncate px-2">{r.customerName ? <EntityText text={r.entityId ? `[[ent:${r.entityId}|${r.customerName}]]` : r.customerName} kinds={entityKinds} onOpenEntity={onOpenEntity} /> : <span className="text-secondary">Anonymous</span>}</td>
                <td className="px-2 text-secondary">{r.channelKey ? CHANNEL_META[r.channelKey].label : "Direct"}</td>
                <td className="px-2 text-right tabular-nums">{r.touchCount ?? "—"}</td>
                <td className="px-2 text-right tabular-nums">{r.kind === "payment" && r.amountMinor > 0 ? formatMoney({ amountMinor: r.amountMinor, currency: r.currency }) : "—"}</td>
                <td className="px-2 text-right">
                  <Button size="sm" variant="ghost" icon={Play} className="px-1.5" disabled={r.replayAvailable === false} onClick={() => onOpenReplay(r.conversionId)} aria-label={`Replay ${KIND_WORD[r.kind].toLowerCase()}${r.customerName ? ` for ${r.customerName}` : ""}`}>
                    Replay
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
