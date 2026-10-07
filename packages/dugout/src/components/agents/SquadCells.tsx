/**
 * Squad table cells (BUILD §11.9, DESIGN §9 Team): Form as five 8 px cells, Rating as display-sm, Model as a mono
 * chip, Tools as icons, Wage tabular, Status as a pill with the injured return time. Each cell is a plain component
 * usable in any table; `squadColumns()` wires them into DataTable column definitions.
 */
import type { ReactNode } from "react";
import { Bot, Calendar, Code2, Cpu, CreditCard, FileText, HardDrive, Mail, PenLine, Search, ShoppingBag, Wrench } from "lucide-react";
import type { AgentStatus, ModelKey } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { formatMoney, formatNumber, formatRelative } from "../../lib/format";
import { ratingClass } from "../../lib/rating";
import type { DataTableColumn } from "../data/DataTable";
import type { SavedView } from "../data/types";
import { Avatar } from "../foundation/Avatar";
import { Chip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { AgentStatusPill } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import type { FormResult, SquadRow } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------------------------------------------------

const FORM_CLASS: Record<FormResult, string> = { success: "bg-status-good", partial: "bg-status-warn", failure: "bg-status-bad" };
export const FORM_RESULT_WORD: Record<FormResult, string> = { success: "success", partial: "partial", failure: "failure" };

export interface FormCellsProps {
  form: readonly FormResult[];
  name?: string;
  className?: string;
}

/** Five 8 px cells (good / warn / bad), oldest left; empty slots are bg-panel-alt. */
export function FormCells({ form, name = "Form", className }: FormCellsProps) {
  const cells = Array.from({ length: 5 }, (_, i) => form[form.length - 5 + i] ?? null);
  const words = cells.map((c) => (c ? FORM_RESULT_WORD[c] : "none"));
  return (
    <ol aria-label={`${name}, last five: ${words.join(", ")}`} className={cn("inline-flex gap-px align-middle", className)}>
      {cells.map((c, i) => (
        <li key={i} aria-hidden data-result={c ?? "none"} className={cn("size-2 rounded-xs", c ? FORM_CLASS[c] : "bg-panel-alt")} />
      ))}
    </ol>
  );
}

/** Form points: success 1, partial 0.5, failure 0; used for sorting. */
export function formScore(form: readonly FormResult[]): number {
  return form.reduce((s, r) => s + (r === "success" ? 1 : r === "partial" ? 0.5 : 0), 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rating (1–10 average)
// ---------------------------------------------------------------------------------------------------------------------

export function RatingCell({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(10, value));
  return (
    <span className={cn("t-display-sm", ratingClass(v * 2), className)} aria-label={`Rating ${formatNumber(v, { digits: 1 })} of 10`}>
      {formatNumber(v, { digits: 1 })}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------------

export const MODEL_LABELS: Record<ModelKey, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

export interface ModelChipProps {
  model: ModelKey;
  /** Locked (e.g. the Inbox Composer is Opus-only): a lock word is appended. */
  locked?: boolean;
  /** Clicking opens the model picker (the app shows ApplyScopeDialog after a change). */
  onClick?: () => void;
  className?: string;
}

/** Mono chip on bg-panel-alt with the model name (BUILD §11.10 "model chip in header, squad table, hover cards"). */
export function ModelChip({ model, locked, onClick, className }: ModelChipProps) {
  return (
    <Chip tone="neutral" mono icon={Cpu} onClick={onClick} className={className} title={locked ? `${MODEL_LABELS[model]} (locked)` : `Model: ${MODEL_LABELS[model]}`}>
      {MODEL_LABELS[model]}
      {locked ? <span className="ml-1 text-secondary">· locked</span> : null}
    </Chip>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------------------------------

export const TOOL_ICONS: Record<string, { icon: IconComponent; label: string }> = {
  github: { icon: Code2, label: "GitHub" },
  e2b: { icon: HardDrive, label: "Sandbox" },
  gmail: { icon: Mail, label: "Gmail" },
  sendgrid: { icon: Mail, label: "SendGrid" },
  notion: { icon: FileText, label: "Notion" },
  google_drive: { icon: FileText, label: "Google Drive" },
  stripe: { icon: CreditCard, label: "Stripe" },
  shopify: { icon: ShoppingBag, label: "Shopify" },
  google_calendar: { icon: Calendar, label: "Google Calendar" },
  anthropic: { icon: Bot, label: "Anthropic" },
  voyage: { icon: Search, label: "Voyage" },
  dropbox_sign: { icon: PenLine, label: "Dropbox Sign" },
};

export interface ToolIconsProps {
  tools: readonly string[];
  max?: number;
  className?: string;
}

/** Connector icons with tooltips; beyond `max` a "+N" count. The full list is in the accessible name. */
export function ToolIcons({ tools, max = 5, className }: ToolIconsProps) {
  const shown = tools.slice(0, max);
  const extra = tools.length - shown.length;
  const names = tools.map((t) => TOOL_ICONS[t]?.label ?? t);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={names.length ? `Tools: ${names.join(", ")}` : "No tools"}>
      {shown.map((t) => {
        const meta = TOOL_ICONS[t] ?? { icon: Wrench, label: t };
        return (
          <Tooltip key={t} content={meta.label}>
            <span className="inline-flex size-5 items-center justify-center rounded-chip bg-panel-alt text-secondary" tabIndex={-1}>
              <Icon icon={meta.icon} size={12} />
            </span>
          </Tooltip>
        );
      })}
      {extra > 0 ? <span className="ml-0.5 font-mono text-mono text-secondary">+{extra}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Wage and status
// ---------------------------------------------------------------------------------------------------------------------

export function WageCell({ wage, className }: { wage: SquadRow["wage"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 tabular-nums", className)} title="Monthly cost estimate: tokens, sandbox minutes and tool costs">
      {formatMoney(wage)}
      <span className="text-small text-secondary">/mo</span>
    </span>
  );
}

export interface StatusCellProps {
  status: AgentStatus;
  expectedReturnAt?: string | null;
  now?: Date;
  className?: string;
}

/** Agent status pill; Injured shows the expected return once reconnected (BUILD §11.9). */
export function StatusCell({ status, expectedReturnAt, now = new Date(), className }: StatusCellProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <AgentStatusPill status={status} />
      {status === "injured" && expectedReturnAt ? <span className="text-small text-secondary">back {formatRelative(expectedReturnAt, now)}</span> : null}
    </span>
  );
}

export function AgentNameCell({ row }: { row: Pick<SquadRow, "name" | "seed" | "dept" | "status"> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar size={24} name={row.name} agent={{ seed: row.seed, dept: row.dept }} status={row.status} />
      <span className="truncate text-body-strong">{row.name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// DataTable wiring
// ---------------------------------------------------------------------------------------------------------------------

export interface SquadColumnOptions {
  now?: Date;
  onModelClick?: (row: SquadRow) => void;
  renderTask?: (row: SquadRow) => ReactNode;
}

/** The squad table columns (BUILD §11.9) as DataTable column definitions. */
export function squadColumns(opts: SquadColumnOptions = {}): DataTableColumn<SquadRow>[] {
  const now = opts.now ?? new Date();
  return [
    { id: "name", accessorKey: "name", header: "Agent", size: 200, cell: ({ row }) => <AgentNameCell row={row.original} />, meta: { locked: true } },
    { id: "role", accessorKey: "role", header: "Role", size: 160 },
    { id: "departments", accessorFn: (r) => r.departments.join(", "), header: "Departments", size: 140 },
    { id: "status", accessorKey: "status", header: "Status", size: 150, cell: ({ row }) => <StatusCell status={row.original.status} expectedReturnAt={row.original.expectedReturnAt} now={now} />, meta: { filter: "select", filterOptions: ["healthy", "degraded", "failing", "injured", "paused", "idle"].map((v) => ({ value: v, label: v })) } },
    { id: "currentTask", accessorFn: (r) => r.currentTask?.title ?? "", header: "Current task", size: 240, cell: ({ row }) => (opts.renderTask ? opts.renderTask(row.original) : <span className="truncate text-secondary">{row.original.currentTask?.title ?? "—"}</span>) },
    { id: "form", accessorFn: (r) => formScore(r.form), header: "Form", size: 80, cell: ({ row }) => <FormCells form={row.original.form} name={`${row.original.name} form`} />, meta: { numeric: true } },
    { id: "rating", accessorKey: "rating", header: "Rating", size: 80, cell: ({ getValue }) => <RatingCell value={getValue() as number} />, meta: { numeric: true } },
    { id: "tools", accessorFn: (r) => r.tools.length, header: "Tools", size: 140, cell: ({ row }) => <ToolIcons tools={row.original.tools} />, meta: { numeric: true } },
    { id: "model", accessorKey: "model", header: "Model", size: 110, cell: ({ row }) => <ModelChip model={row.original.model} onClick={opts.onModelClick ? () => opts.onModelClick?.(row.original) : undefined} />, meta: { filter: "select", filterOptions: (["opus", "sonnet", "haiku"] as const).map((v) => ({ value: v, label: MODEL_LABELS[v] })) } },
    { id: "wage", accessorFn: (r) => r.wage.amountMinor, header: "Wage", size: 110, cell: ({ row }) => <WageCell wage={row.original.wage} />, meta: { numeric: true, csv: (r) => r.wage.amountMinor / 100 } },
    { id: "latestUpdate", accessorFn: (r) => r.latestUpdate?.at ?? "", header: "Latest update", size: 260, cell: ({ row }) => (row.original.latestUpdate ? <span className="truncate text-secondary" title={row.original.latestUpdate.text}>{formatRelative(row.original.latestUpdate.at, now)} · {row.original.latestUpdate.text}</span> : "—") },
  ];
}

/** Saved views BUILD §11.9 names: General, Health, Tools, Cost, Performance. */
export const SQUAD_VIEWS: SavedView[] = [
  { id: "general", name: "General", builtIn: true, columns: ["name", "role", "departments", "status", "currentTask", "form", "rating", "model", "latestUpdate"], sort: [{ id: "rating", desc: true }], filters: [] },
  { id: "health", name: "Health", builtIn: true, columns: ["name", "role", "status", "form", "latestUpdate"], sort: [{ id: "status", desc: false }], filters: [] },
  { id: "tools", name: "Tools", builtIn: true, columns: ["name", "role", "tools", "model"], sort: [{ id: "tools", desc: true }], filters: [] },
  { id: "cost", name: "Cost", builtIn: true, columns: ["name", "role", "model", "wage", "rating"], sort: [{ id: "wage", desc: true }], filters: [] },
  { id: "performance", name: "Performance", builtIn: true, columns: ["name", "role", "form", "rating", "currentTask"], sort: [{ id: "rating", desc: true }], filters: [] },
];
