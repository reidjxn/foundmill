"use client";
/**
 * Team table cells (BUILD §11.9, DESIGN §9 Team): Form as five 8 px cells with a hover key, Rating as the 1–20 mean in
 * display-sm with its band word, Model as a mono chip, Tools as icons, AI cost tabular, Status as a pill with the
 * expected-back time when an agent is down. Each cell is a plain component usable in any table; `squadColumns()` wires
 * them into DataTable column definitions.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { Bot, Calendar, Clapperboard, Code2, Cpu, CreditCard, FileText, HardDrive, Mail, Mic, PenLine, Search, ShoppingBag, Wrench } from "lucide-react";
import type { AgentStatus, ModelKey } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { formatMoney, formatNumber, formatRelative } from "../../lib/format";
import { RATING_MAX, ratingBandLabel, ratingClass } from "../../lib/rating";
import type { DataTableColumn } from "../data/DataTable";
import type { SavedView } from "../data/types";
import { useAgentPersona } from "../foundation/AgentPersona";
import { Avatar } from "../foundation/Avatar";
import { Chip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { AgentStatusPill } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { useBuilderView } from "../guidance/BuilderView";
import { useTerm } from "../guidance/GuidanceProvider";
import { FormKey, ScaleLabel, formKeySentence } from "../guidance/ScaleLabel";
import type { FormResult, SquadRow } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------------------------------------------------

const FORM_CLASS: Record<FormResult, string> = { success: "cell-lit bg-status-good tone-status-good", partial: "cell-lit bg-status-warn tone-status-warn", failure: "cell-lit bg-status-bad tone-status-bad" };
export const FORM_RESULT_WORD: Record<FormResult, string> = { success: "went well", partial: "partly", failure: "failed" };

/** The column head's one-line meaning, for the caption under it when guidance is on. */
export const FORM_CAPTION = "Form: the last five tasks";

/**
 * The hover key for five form cells: "Last 5 tasks: 4 went well, 1 partly, 0 failed" (fewer than five: "Last 3 tasks:
 * …"; none: "No tasks yet"). The guidance group's `formKeySentence`, over the last five results.
 */
export function formKey(form: readonly FormResult[]): string {
  return formKeySentence(form.slice(-5));
}

export interface FormCellsProps {
  form: readonly FormResult[];
  name?: string;
  className?: string;
}

/**
 * Five 8 px cells (good / warn / bad) lit in their tone, oldest left; empty slots are a faint plate. Hover or focus shows
 * the key (`FormKey`: "Last 5 tasks: 4 went well, 1 partly, 0 failed"), which is also the accessible name, so color is
 * never the only signal.
 */
export function FormCells({ form, name = "Form", className }: FormCellsProps) {
  const cells = Array.from({ length: 5 }, (_, i) => form[form.length - 5 + i] ?? null);
  const key = formKey(form);
  return (
    <Tooltip content={<FormKey cells={cells} />}>
      <ol aria-label={`${name}: ${key}`} tabIndex={-1} className={cn("inline-flex gap-0.5 align-middle outline-none", className)} data-form-cells>
        {cells.map((c, i) => (
          <li key={i} aria-hidden data-result={c ?? "none"} className={cn("size-2.5 rounded-xs", c ? FORM_CLASS[c] : "cell-empty")} />
        ))}
      </ol>
    </Tooltip>
  );
}

/** Form points: success 1, partial 0.5, failure 0; used for sorting. */
export function formScore(form: readonly FormResult[]): number {
  return form.reduce((s, r) => s + (r === "success" ? 1 : r === "partial" ? 0.5 : 0), 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rating (the 1–20 mean of the agent's skills, the one scale the profile uses too)
// ---------------------------------------------------------------------------------------------------------------------

export const RATING_COLUMN_LABEL = `Rating /${RATING_MAX}`;
export const RATING_COLUMN_TOOLTIP = `The average of this agent's skills, 1–${RATING_MAX}`;

export interface RatingCellProps {
  /** The 1–20 mean of the agent's skills; 0, negative or not a number reads "—" (no training run yet). */
  value: number | null | undefined;
  /** Hide the band word (the figure's accessible name and tooltip still carry it). */
  compact?: boolean;
  className?: string;
}

/**
 * The 1–20 mean to one decimal in display-sm, in the ramp tone, with the band word beside it (Poor / Average / Good /
 * Excellent) as the guidance group's ScaleLabel, compact for the table's 28 px rows, so a number never stands alone
 * (UX plan §5 principle 4). `compact` here folds the word into the tooltip and the accessible name instead.
 */
export function RatingCell({ value, compact, className }: RatingCellProps) {
  const builder = useBuilderView();
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return (
      <span className={cn("text-small text-tertiary", className)} aria-label="Not rated yet" title="Rated after the first training run">
        —
      </span>
    );
  }
  const v = Math.max(1, Math.min(RATING_MAX, value));
  const figure = formatNumber(v, { digits: 1 });
  const band = ratingBandLabel(v);
  // Builder view off (docs/DESIGN.md): the band word only, never the figure out of 20.
  if (!builder) return <ScaleLabel value={v} scale={RATING_MAX} compact className={cn("whitespace-nowrap", className)} aria-label={`Rating ${band}`} data-rating-cell="" data-rating-band="" />;
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap", className)} aria-label={`Rating ${figure} of ${RATING_MAX}, ${band}`} title={compact ? `${figure} of ${RATING_MAX} · ${band}` : undefined} data-rating-cell>
      <span className={cn("t-display-sm", ratingClass(v))} aria-hidden>
        {figure}
      </span>
      {compact ? null : <ScaleLabel value={v} scale={RATING_MAX} compact aria-hidden />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------------

export const MODEL_LABELS: Record<ModelKey, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", glm: "GLM-5.3 Flash" };

export interface ModelChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "onClick" | "children"> {
  model: ModelKey;
  /** Locked (e.g. the Inbox Composer is Opus-only): a lock word is appended. */
  locked?: boolean;
  /** Clicking opens the model picker (the app shows ApplyScopeDialog after a change). */
  onClick?: () => void;
  className?: string;
}

/**
 * Mono chip on bg-panel-alt with the model name (BUILD §11.10 "model chip in header, squad table, hover cards").
 * Forwards every other span attribute (data-testid, aria-*, title) so hosts can hook e2e selectors onto it.
 */
export function ModelChip({ model, locked, onClick, className, ...rest }: ModelChipProps) {
  return (
    <Chip tone="neutral" mono icon={Cpu} onClick={onClick} className={className} title={locked ? `${MODEL_LABELS[model]} (locked)` : `Model: ${MODEL_LABELS[model]}`} {...rest}>
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
  openai: { icon: Bot, label: "OpenAI" },
  gemini: { icon: Bot, label: "Google Gemini" },
  perplexity: { icon: Bot, label: "Perplexity" },
  serpapi: { icon: Search, label: "SerpApi" },
  firecrawl: { icon: FileText, label: "Firecrawl" },
  indexnow: { icon: Search, label: "IndexNow" },
  apollo: { icon: Search, label: "Apollo" },
  vercel: { icon: Code2, label: "Vercel" },
  posthog: { icon: Search, label: "PostHog" },
  resend: { icon: Mail, label: "Resend" },
  runway: { icon: Clapperboard, label: "Runway" },
  elevenlabs_voice: { icon: Mic, label: "ElevenLabs" },
  buffer: { icon: PenLine, label: "Buffer" },
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
  // The sandbox icon's tooltip says what a sandbox is (the definitions map's own sentence when there is one).
  const sandbox = useTerm("sandbox");
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={names.length ? `Tools: ${names.join(", ")}` : "No tools"}>
      {shown.map((t) => {
        const meta = TOOL_ICONS[t] ?? { icon: Wrench, label: t };
        return (
          <Tooltip key={t} content={t === "e2b" && sandbox ? `${meta.label}: ${sandbox.short}` : meta.label}>
            <span className="inline-flex size-control-xs items-center justify-center rounded-sm bg-white/5 text-secondary ring-1 ring-inset ring-line" tabIndex={-1}>
              <Icon icon={meta.icon} size={12} />
            </span>
          </Tooltip>
        );
      })}
      {extra > 0 ? <span className="ml-0.5 font-mono text-micro text-tertiary">+{extra}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// AI cost and status
// ---------------------------------------------------------------------------------------------------------------------

/** The column head for an agent's metered cost: model, sandbox and tool spend, in US dollars (never the business's currency). */
export const WAGE_COLUMN_LABEL = "AI cost (USD)";

export function WageCell({ wage, className }: { wage: SquadRow["wage"]; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 tabular-nums", className)} title="This month's AI cost so far, in US dollars: AI usage, sandbox minutes and tool calls. An estimate, not a measurement.">
      {formatMoney(wage)}
      <span className="t-unit">/mo</span>
    </span>
  );
}

export interface StatusCellProps {
  status: AgentStatus;
  expectedReturnAt?: string | null;
  now?: Date;
  className?: string;
}

/** Agent status pill; Down shows the expected return once reconnected (BUILD §11.9). */
export function StatusCell({ status, expectedReturnAt, now = new Date(), className }: StatusCellProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <AgentStatusPill status={status} />
      {status === "injured" && expectedReturnAt ? <span className="text-small text-secondary">back {formatRelative(expectedReturnAt, now)}</span> : null}
    </span>
  );
}

/**
 * The Agent column's cell. With anthropomorphic agents on it shows the persona's first name and face; the position is
 * the Role column beside it (and the hover title), so "Bob" never stands without what he does.
 */
export function AgentNameCell({ row }: { row: Pick<SquadRow, "name" | "seed" | "dept" | "status"> & Partial<Pick<SquadRow, "role" | "personaKey">> }) {
  const persona = useAgentPersona();
  const name = persona.nameFor(row);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar size={24} name={name} agent={{ seed: row.seed, dept: row.dept, personaKey: row.personaKey }} status={row.status} />
      <span className="truncate font-medium" title={persona.labelFor(row)}>{name}</span>
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
  /** The name the Agent column sorts and searches by (anthropomorphic agents: the persona's first name). Default: the row's name. */
  displayName?: (row: SquadRow) => string;
}

/** The team table columns (BUILD §11.9) as DataTable column definitions. */
export function squadColumns(opts: SquadColumnOptions = {}): DataTableColumn<SquadRow>[] {
  const now = opts.now ?? new Date();
  return [
    { id: "name", accessorFn: (r) => opts.displayName?.(r) ?? r.name, header: "Agent", size: 200, cell: ({ row }) => <AgentNameCell row={row.original} />, meta: { locked: true } },
    { id: "role", accessorKey: "role", header: "Role", size: 160 },
    { id: "departments", accessorFn: (r) => r.departments.join(", "), header: "Departments", size: 140 },
    { id: "status", accessorKey: "status", header: "Status", size: 150, cell: ({ row }) => <StatusCell status={row.original.status} expectedReturnAt={row.original.expectedReturnAt} now={now} />, meta: { filter: "select", filterOptions: ["healthy", "degraded", "failing", "injured", "paused", "idle"].map((v) => ({ value: v, label: v })) } },
    { id: "currentTask", accessorFn: (r) => r.currentTask?.title ?? "", header: "Current task", size: 240, cell: ({ row }) => (opts.renderTask ? opts.renderTask(row.original) : <span className="truncate text-secondary">{row.original.currentTask?.title ?? "—"}</span>) },
    // Form, Rating, Tools and Model are Builder view's (`meta.builderOnly`): off, the table has none of them.
    // The column head carries the key once; every row's cells carry it on hover. Form, Rating, Model and AI cost are
    // defined words (`meta.term`): the word opens its definition card, the arrow beside it sorts (DataTable).
    { id: "form", accessorFn: (r) => formScore(r.form), header: () => <span title="The last five tasks, oldest left: green went well, amber partly, red failed">Form</span>, size: 80, cell: ({ row }) => <FormCells form={row.original.form} name={`${row.original.name} form`} />, meta: { numeric: true, label: "Form", term: "form", builderOnly: true } },
    { id: "rating", accessorKey: "rating", header: () => <span title={RATING_COLUMN_TOOLTIP}>{RATING_COLUMN_LABEL}</span>, size: 112, cell: ({ getValue }) => <RatingCell value={getValue() as number} />, meta: { numeric: true, label: RATING_COLUMN_LABEL, term: "rating", builderOnly: true } },
    { id: "tools", accessorFn: (r) => r.tools.length, header: "Tools", size: 140, cell: ({ row }) => <ToolIcons tools={row.original.tools} />, meta: { numeric: true, builderOnly: true } },
    { id: "model", accessorKey: "model", header: "Model", size: 110, cell: ({ row }) => <ModelChip model={row.original.model} onClick={opts.onModelClick ? () => opts.onModelClick?.(row.original) : undefined} />, meta: { filter: "select", filterOptions: (["opus", "sonnet", "haiku", "glm"] as const).map((v) => ({ value: v, label: MODEL_LABELS[v] })), term: "model", builderOnly: true } },
    { id: "wage", accessorFn: (r) => r.wage.amountMinor, header: WAGE_COLUMN_LABEL, size: 120, cell: ({ row }) => <WageCell wage={row.original.wage} />, meta: { numeric: true, csv: (r) => r.wage.amountMinor / 100, term: "wage" } },
    { id: "latestUpdate", accessorFn: (r) => r.latestUpdate?.at ?? "", header: "Latest update", size: 260, cell: ({ row }) => (row.original.latestUpdate ? <span className="truncate text-secondary" title={row.original.latestUpdate.text} data-allow-truncate="">{formatRelative(row.original.latestUpdate.at, now)} · {row.original.latestUpdate.text}</span> : "—") },
  ];
}

/** Saved views BUILD §11.9 names: General, Health, Tools, Cost, Performance (Health, Tools and Performance are Builder view's). */
export const SQUAD_VIEWS: SavedView[] = [
  { id: "general", name: "General", builtIn: true, columns: ["name", "role", "departments", "status", "currentTask", "form", "rating", "model", "latestUpdate"], sort: [{ id: "rating", desc: true }], filters: [] },
  { id: "health", name: "Health", builtIn: true, builderOnly: true, columns: ["name", "role", "status", "form", "latestUpdate"], sort: [{ id: "status", desc: false }], filters: [] },
  { id: "tools", name: "Tools", builtIn: true, builderOnly: true, columns: ["name", "role", "tools", "model"], sort: [{ id: "tools", desc: true }], filters: [] },
  { id: "cost", name: "Cost", builtIn: true, columns: ["name", "role", "model", "wage", "rating"], sort: [{ id: "wage", desc: true }], filters: [] },
  { id: "performance", name: "Performance", builtIn: true, builderOnly: true, columns: ["name", "role", "form", "rating", "currentTask"], sort: [{ id: "rating", desc: true }], filters: [] },
];
