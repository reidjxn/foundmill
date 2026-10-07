import type { HTMLAttributes, ReactNode } from "react";
import { Circle } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatDateTime, formatRelative } from "../../lib/format";
import { Avatar, type AvatarProps } from "../foundation/Avatar";
import { Icon, type IconComponent } from "../foundation/Icon";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";

// ---------------------------------------------------------------------------------------------------------------------
// KeyValueList
// ---------------------------------------------------------------------------------------------------------------------

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Mono value (ids, keys, amounts). */
  mono?: boolean;
  /** Right-aligned tabular value. */
  numeric?: boolean;
  /** Small-style hint under the value. */
  hint?: ReactNode;
}

export interface KeyValueListProps extends HTMLAttributes<HTMLDListElement> {
  items: readonly KeyValueItem[];
  /** 1 column (label over value) or 2 (label left, value right in rows). Default "rows". */
  layout?: "rows" | "stacked" | "grid";
  /** Label column width class for "rows". Default w-32. */
  labelClassName?: string;
  dense?: boolean;
}

/** Label + value pairs in the DESIGN §8 "key facts in label + body pairs" style. */
export function KeyValueList({
  items,
  layout = "rows",
  labelClassName = "w-32",
  dense,
  className,
  ...rest
}: KeyValueListProps) {
  if (layout === "grid") {
    return (
      <dl className={cn("grid grid-cols-3 gap-x-gutter gap-y-2", className)} {...rest}>
        {items.map((it, i) => (
          <div key={i} className="min-w-0">
            <dt className="t-label truncate">{it.label}</dt>
            <dd
              className={cn(
                "truncate text-body text-primary",
                it.mono && "font-mono text-mono",
                it.numeric && "tabular-nums",
              )}
            >
              {it.value}
            </dd>
            {it.hint ? <dd className="truncate text-small text-secondary">{it.hint}</dd> : null}
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      className={cn(
        "flex flex-col",
        layout === "rows" ? "divide-y divide-subtle/50" : "gap-2",
        className,
      )}
      {...rest}
    >
      {items.map((it, i) => (
        <div
          key={i}
          className={cn(
            "flex min-w-0",
            layout === "rows"
              ? cn("items-baseline gap-3", dense ? "py-1" : "py-1.5")
              : "flex-col gap-0.5",
          )}
        >
          <dt className={cn("t-label shrink-0", layout === "rows" && labelClassName)}>
            {it.label}
          </dt>
          <dd
            className={cn(
              "min-w-0 flex-1 text-body text-primary",
              it.mono && "font-mono text-mono",
              it.numeric && "text-right tabular-nums",
              layout === "rows" && "truncate",
            )}
          >
            {it.value}
            {it.hint ? <span className="ml-1.5 text-small text-secondary">{it.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  at: Date | string;
  title: ReactNode;
  description?: ReactNode;
  icon?: IconComponent;
  tone?: StatusTone;
  /** Word for the tone pill; without it no pill is shown (the icon + title still carry the meaning). */
  statusWord?: string;
  actor?: Pick<AvatarProps, "name" | "agent" | "status" | "src">;
  /** Extra chips, links or an exhibit under the description. */
  children?: ReactNode;
}

export interface TimelineProps extends HTMLAttributes<HTMLOListElement> {
  events: readonly TimelineEvent[];
  /** For relative times; pass in tests and stories. */
  now?: Date;
  /** Show absolute times instead of relative. */
  absolute?: boolean;
  /** Newest first (default) or oldest first. */
  order?: "desc" | "asc";
  emptyText?: string;
}

const DOT_CLASS: Record<StatusTone, string> = {
  good: "text-status-good",
  warn: "text-status-warn",
  bad: "text-status-bad",
  info: "text-status-info",
  neutral: "text-secondary",
};

/** A vertical event list on a hairline stem: dot or icon, time in small style, title in body-strong. */
export function Timeline({
  events,
  now = new Date(),
  absolute,
  order = "desc",
  emptyText = "Nothing has happened yet.",
  className,
  ...rest
}: TimelineProps) {
  const sorted = [...events].sort((a, b) => {
    const d = new Date(a.at).getTime() - new Date(b.at).getTime();
    return order === "desc" ? -d : d;
  });
  if (sorted.length === 0)
    return <p className={cn("text-body text-secondary", className)}>{emptyText}</p>;
  return (
    <ol className={cn("relative flex flex-col", className)} data-timeline {...rest}>
      <span aria-hidden className="absolute inset-y-2 left-2 w-px bg-subtle" />
      {sorted.map((e) => {
        const tone = e.tone ?? "neutral";
        const time = new Date(e.at);
        return (
          <li key={e.id} className="relative flex gap-3 py-1.5 pl-6" data-tone={tone}>
            <span
              className={cn(
                "absolute left-0 top-2 inline-flex size-4 items-center justify-center rounded-full bg-panel",
                DOT_CLASS[tone],
              )}
            >
              <Icon
                icon={e.icon ?? Circle}
                size={e.icon ? 12 : 8}
                fill={e.icon ? "none" : "currentColor"}
              />
            </span>
            {e.actor ? <Avatar size={20} {...e.actor} className="mt-0.5" /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="t-body-strong min-w-0 flex-1 truncate text-primary">
                  {e.title}
                </span>
                {e.statusWord ? <StatusPill tone={tone}>{e.statusWord}</StatusPill> : null}
                <time
                  dateTime={time.toISOString()}
                  title={formatDateTime(time)}
                  className="shrink-0 text-small text-secondary tabular-nums"
                >
                  {absolute ? formatDateTime(time) : formatRelative(time, now)}
                </time>
              </div>
              {e.description ? <p className="text-body text-secondary">{e.description}</p> : null}
              {e.children ? <div className="mt-1">{e.children}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// MiniTable
// ---------------------------------------------------------------------------------------------------------------------

export interface MiniTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  numeric?: boolean;
  /** Width class or px. */
  width?: string | number;
}

export interface MiniTableProps<T> {
  columns: readonly MiniTableColumn<T>[];
  rows: readonly T[];
  getRowKey?: (row: T, index: number) => string;
  /** Rows beyond this collapse into "+N more". */
  maxRows?: number;
  /** Small-style caption under the table (source, "Estimate"). */
  caption?: ReactNode;
  /** Highlight a row (the customer in a round-up). */
  highlight?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  className?: string;
  "aria-label"?: string;
}

/** A small, non-virtualised 28 px table for Inbox exhibits, hover cards and rails. No sorting, no selection. */
export function MiniTable<T>({
  columns,
  rows,
  getRowKey,
  maxRows,
  caption,
  highlight,
  onRowClick,
  emptyText = "No rows.",
  className,
  ...rest
}: MiniTableProps<T>) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const extra = rows.length - shown.length;
  return (
    <div
      className={cn("overflow-hidden rounded-panel border border-subtle", className)}
      data-mini-table
    >
      <table className="w-full border-collapse text-body" aria-label={rest["aria-label"]}>
        <thead className="bg-panel-alt">
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cn(
                  "t-label h-6 border-b border-subtle px-2 text-left font-semibold",
                  c.numeric && "text-right",
                )}
                style={typeof c.width === "number" ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="h-row-compact px-2 text-small text-secondary">
                {emptyText}
              </td>
            </tr>
          ) : null}
          {shown.map((row, i) => {
            const hl = highlight?.(row) ?? false;
            return (
              <tr
                key={getRowKey ? getRowKey(row, i) : i}
                data-highlight={hl || undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "relative border-b hairline-50 last:border-b-0",
                  i % 2 === 1 && "bg-white/2",
                  onRowClick && "cursor-pointer hover:bg-white/4",
                  hl && "bg-kit-primary/8",
                )}
              >
                {columns.map((c, ci) => (
                  <td
                    key={c.id}
                    className={cn(
                      "relative h-row-compact max-w-0 truncate px-2 align-middle text-primary",
                      c.numeric && "text-right tabular-nums",
                      ci === 0 &&
                        hl &&
                        "before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:bg-kit-primary",
                    )}
                    style={
                      typeof c.width === "string"
                        ? undefined
                        : typeof c.width === "number"
                          ? { width: c.width }
                          : undefined
                    }
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {extra > 0 || caption ? (
        <div className="flex items-center justify-between gap-2 border-t border-subtle bg-panel px-2 py-1 text-small text-secondary">
          <span>{caption}</span>
          {extra > 0 ? <span className="tabular-nums">+{extra} more</span> : null}
        </div>
      ) : null}
    </div>
  );
}
