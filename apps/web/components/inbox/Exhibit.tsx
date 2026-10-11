"use client";
/**
 * The exhibit panel of a note (BUILD §11.3, AC-11.3.6): chart / diagram / table from a named query, an entity card,
 * a diff preview of a change proposal, or an agent progress tile. Data comes from the tRPC queries behind each named
 * query (see exhibits.ts); the model only ever named the query.
 */
import { useQuery } from "@tanstack/react-query";
import { Bot, ImageOff } from "lucide-react";
import { useMemo } from "react";
import { AgentStatusPill, Avatar, BarChart, Chip, DiffView, EmptyState, EntityCard, FunnelChart, LineChart, MiniTable, Panel, ProgressRing, ProvenanceChip, formatMoney, formatNumber, type EntityDetails, type MiniTableColumn } from "@foundmill/dugout";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { EXHIBIT_TITLES, UUID_RE, barColumn, chartShape, isNamedQueryId, labelColumn, readExhibit, sourceFor, transform, type ExhibitData } from "./exhibits";

export interface ExhibitProps {
  exhibit: unknown;
  /** Entities the note mentions (entity_card uses the first). */
  entityIds: readonly string[];
  fromAgentId: string | null;
  currency: string;
}

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export function Exhibit({ exhibit, entityIds, fromAgentId, currency }: ExhibitProps) {
  const ref = useMemo(() => readExhibit(exhibit), [exhibit]);
  if (ref.kind === "none") return null;
  if (ref.kind === "entity_card") return <EntityExhibit entityId={entityIds[0] ?? (ref.specRef && UUID_RE.test(ref.specRef) ? ref.specRef : null)} />;
  if (ref.kind === "diff") return <DiffExhibit proposalId={ref.specRef && UUID_RE.test(ref.specRef) ? ref.specRef : null} />;
  if (ref.kind === "agent_tile") return <AgentExhibit agentId={ref.specRef && UUID_RE.test(ref.specRef) ? ref.specRef : fromAgentId} />;
  if (!isNamedQueryId(ref.specRef)) return <Unavailable title="Exhibit" reason="This note references a query that is not in the catalog." />;
  return <NamedQueryExhibit id={ref.specRef} kind={ref.kind} currency={currency} />;
}

function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <Panel title={title} span={12} data-testid="exhibit" data-exhibit="unavailable">
      <EmptyState icon={ImageOff} title="Exhibit unavailable">
        {reason}
      </EmptyState>
    </Panel>
  );
}

/* ---------- named queries ---------- */

function NamedQueryExhibit({ id, kind, currency }: { id: Exclude<ReturnType<typeof readExhibit>["specRef"], null>; kind: "chart" | "diagram" | "table"; currency: string }) {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const src = useMemo(() => (isNamedQueryId(id) ? sourceFor(id) : null), [id]);
  const from = src?.path === "journey.ribbon" ? src.input.from : dayKey(new Date(Date.now() - 30 * DAY_MS));
  const to = src?.path === "journey.ribbon" ? src.input.to : dayKey(new Date());
  const tasksQ = useQuery(trpc.dev.tasks.list.queryOptions({ businessId, limit: 500 }, { enabled: src?.path === "dev.tasks.list", staleTime: 30_000 }));
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, from, to }, { enabled: src?.path === "journey.ribbon", staleTime: 60_000 }));
  const channelsQ = useQuery(trpc.distribution.channels.list.queryOptions({ businessId }, { enabled: src?.path === "distribution.channels.list", staleTime: 60_000 }));
  const financeQ = useQuery(trpc.finance.overview.queryOptions({ businessId }, { enabled: src?.path === "finance.overview", staleTime: 60_000 }));
  const roadmapQ = useQuery(trpc.product.roadmap.list.queryOptions({ businessId }, { enabled: src?.path === "product.roadmap.list", staleTime: 60_000 }));
  const active = src?.path === "dev.tasks.list" ? tasksQ : src?.path === "journey.ribbon" ? ribbonQ : src?.path === "distribution.channels.list" ? channelsQ : src?.path === "finance.overview" ? financeQ : roadmapQ;
  const data = useMemo(() => (isNamedQueryId(id) && active.data ? transform(id, active.data, { currency, from, to }) : null), [id, active.data, currency, from, to]);
  const title = isNamedQueryId(id) ? EXHIBIT_TITLES[id] : "Exhibit";
  const shape = data ? chartShape(kind, data) : "empty";
  return (
    <Panel
      title={title}
      span={12}
      loading={active.isLoading}
      error={active.error ? "The exhibit's query failed." : undefined}
      onRetry={() => void active.refetch()}
      empty={data && shape === "empty" ? { children: "No rows yet for this exhibit." } : undefined}
      actions={data?.label ? data.label === "Estimate" || data.label === "Forecast" ? <ProvenanceChip kind={data.label === "Forecast" ? "forecast" : "estimate"} /> : <Chip tone="neutral">{data.label}</Chip> : undefined}
      footer={data ? <span title={data.source}>Source: {data.source}</span> : undefined}
      data-testid="exhibit"
      data-exhibit={kind}
      data-query={id}
      data-shape={shape}
    >
      {data ? <ExhibitBody data={data} shape={shape} currency={currency} /> : null}
    </Panel>
  );
}

function fmtCell(value: string | number | null, unit: string | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  // A true minus sign, never a hyphen, in front of a negative figure (DESIGN §4 figures).
  const minus = (text: string) => text.replace(/^-/, "\u2212");
  if (unit === "minor") return minus(formatMoney({ amountMinor: value, currency }));
  if (unit === "percent") return minus(`${formatNumber(value * 100, { maxDigits: 1 })}%`);
  if (unit === "months") return minus(`${formatNumber(value, { maxDigits: 1 })} mo`);
  return minus(formatNumber(value, { maxDigits: 1 }));
}

function ExhibitBody({ data, shape, currency }: { data: ExhibitData; shape: ReturnType<typeof chartShape>; currency: string }) {
  const cur = data.currency ?? currency;
  if (shape === "line" && data.series) {
    const tones = ["kit", "info", "gold", "good", "warn"] as const;
    const money = data.id === "runway_forecast";
    return (
      <LineChart
        label={data.title}
        height={180}
        xType="time"
        provenance={data.label === "Forecast" ? "forecast" : data.label === "Estimate" ? "estimate" : undefined}
        yFormat={money ? (v) => formatMoney({ amountMinor: v, currency: cur }, { compact: true }) : undefined}
        series={data.series.map((s, i) => ({ id: s.key, label: s.label, tone: tones[i % tones.length]!, data: s.points.map((p) => ({ x: new Date(p.x.length === 7 ? `${p.x}-01` : p.x), y: p.y ?? 0 })) }))}
      />
    );
  }
  if (shape === "table" && data.columns && data.rows) {
    const rowUnit = (row: Record<string, string | number | null>) => (typeof row.unit === "string" ? row.unit : undefined);
    const columns: MiniTableColumn<Record<string, string | number | null>>[] = data.columns
      .filter((c) => c.key !== "unit")
      // A text column that holds figures with a per-row unit (Metric / Value) is numeric too: figures right-align.
      .map((c) => ({ id: c.key, header: c.label, numeric: c.unit !== "day" && (c.unit !== "text" || data.rows!.some((r) => typeof r[c.key] === "number")), cell: (row) => fmtCell(row[c.key] ?? null, c.unit === "text" && typeof row[c.key] === "number" ? rowUnit(row) : c.unit, cur) }));
    return <MiniTable columns={columns} rows={data.rows} getRowKey={(_, i) => String(i)} maxRows={12} />;
  }
  const col = barColumn(data);
  const lab = labelColumn(data);
  if ((shape === "bar" || shape === "funnel") && col && data.rows) {
    const rows = data.rows.filter((r) => typeof r[col.key] === "number");
    const format = (v: number) => fmtCell(v, col.unit, cur);
    if (shape === "funnel") return <FunnelChart label={data.title} stages={rows.map((r) => ({ label: String(lab ? r[lab.key] : ""), value: r[col.key] as number }))} format={format} provenance={data.label === "Estimate" ? "estimate" : undefined} />;
    return <BarChart label={data.title} height={Math.max(120, rows.length * 28)} horizontal data={rows.map((r) => ({ label: String(lab ? r[lab.key] : ""), value: r[col.key] as number }))} format={format} showValues provenance={data.label === "Estimate" ? "estimate" : undefined} />;
  }
  return null;
}

/* ---------- entity card ---------- */

function EntityExhibit({ entityId }: { entityId: string | null }) {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const q = useQuery(trpc.crm.entity.get.queryOptions({ businessId, entityId: entityId ?? businessId }, { enabled: !!entityId, staleTime: 60_000, retry: false }));
  if (!entityId) return <Unavailable title="Entity" reason="The note mentions no entity to show." />;
  const details: EntityDetails | null = q.data
    ? {
        id: q.data.entity.id,
        kind: q.data.entity.kind as EntityKind,
        name: q.data.entity.displayName,
        href: routes.crm(businessId, q.data.entity.id),
        subtitle: typeof q.data.entity.identifiers.domain === "string" ? q.data.entity.identifiers.domain : typeof q.data.entity.identifiers.email === "string" ? q.data.entity.identifiers.email : undefined,
        chips: q.data.roles.slice(0, 2).map((r) => ({ label: String((r as { role?: string }).role ?? "role") })),
        facts: [
          { label: "Conversions", value: String(q.data.conversions.length) },
          { label: "Interactions", value: String(q.data.interactions.length) },
          { label: "Mentions", value: String(q.data.mentions.length) },
        ],
      }
    : null;
  return (
    <Panel title="Entity" span={12} loading={q.isLoading} error={q.error ? "Could not load the entity." : undefined} onRetry={() => void q.refetch()} data-testid="exhibit" data-exhibit="entity_card">
      {details ? <EntityCard details={details} /> : null}
    </Panel>
  );
}

/* ---------- diff preview ---------- */

function hunkText(v: Record<string, unknown> | null | undefined): string {
  if (!v) return "";
  for (const k of ["text", "body", "content", "markdown"]) if (typeof v[k] === "string") return v[k] as string;
  return JSON.stringify(v, null, 2);
}

function DiffExhibit({ proposalId }: { proposalId: string | null }) {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const q = useQuery(trpc.product.proposals.get.queryOptions({ businessId, proposalId: proposalId ?? businessId }, { enabled: !!proposalId, staleTime: 30_000, retry: false }));
  if (!proposalId) return <Unavailable title="Change proposal" reason="The note references no change proposal." />;
  const hunk = q.data?.hunks[0];
  return (
    <Panel title="Change proposal" span={12} loading={q.isLoading} error={q.error ? "Could not load the proposal." : undefined} onRetry={() => void q.refetch()} empty={q.data && !hunk ? { children: "The proposal has no hunks." } : undefined} footer={q.data ? <span>{q.data.hunks.length} hunk{q.data.hunks.length === 1 ? "" : "s"} · decide them in Product › Changes</span> : undefined} data-testid="exhibit" data-exhibit="diff">
      {hunk ? <DiffView original={hunkText(hunk.ours)} proposed={hunkText(hunk.theirs)} base={hunk.base ? hunkText(hunk.base) : undefined} readOnly maxHeight={320} labels={{ original: "Current", proposed: "Proposed", base: "Base" }} /> : null}
    </Panel>
  );
}

/* ---------- agent tile ---------- */

function AgentExhibit({ agentId }: { agentId: string | null }) {
  const { businessId, departments } = useBusiness();
  const trpc = useTRPC();
  const tasksQ = useQuery(trpc.dev.tasks.list.queryOptions({ businessId, limit: 200 }, { enabled: !!agentId, staleTime: 15_000 }));
  const found = useMemo(() => {
    if (!agentId) return null;
    for (const d of departments) {
      const a = d.squad.find((x) => x.id === agentId);
      if (a) return { ...a, dept: d.colourToken as DeptColourToken, department: d.name };
    }
    return null;
  }, [agentId, departments]);
  if (!agentId) return <Unavailable title="Agent" reason="The note names no agent." />;
  if (!found) return <Unavailable title="Agent" reason="That agent is not in the team any more." />;
  const task = (tasksQ.data?.items ?? []).filter((t) => t.assigneeAgentId === agentId).sort((a, b) => (a.status === "running" ? -1 : 1) - (b.status === "running" ? -1 : 1))[0];
  const progress = task ? Number(task.progress) : 0;
  return (
    <Panel title="Agent" span={12} data-testid="exhibit" data-exhibit="agent_tile">
      <div className="flex items-center gap-3">
        <Avatar size={32} name={found.name} agent={{ seed: found.avatarSeed || found.id, dept: found.dept }} status={found.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a href={routes.agent(businessId, found.id)} className="entity-link truncate text-body-strong text-primary">
              {found.name}
            </a>
            <AgentStatusPill status={found.status} />
          </div>
          <p className="truncate text-small text-secondary">
            {found.role} · {found.department} · <span className="font-mono">{found.modelKey}</span>
          </p>
          <p className="truncate text-small text-secondary">{task ? `${task.status.replace(/_/g, " ")}: ${task.title}` : "No task assigned"}</p>
        </div>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ProgressRing value={Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0} size={16} tone="kit" label="Task progress" />
          <Bot className="size-3.5 text-secondary" aria-hidden />
        </span>
      </div>
    </Panel>
  );
}
