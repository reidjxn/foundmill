"use client";
/**
 * Custom metric widget (BUILD §11.2): a named query id or a sentence the server compiles (Haiku) into a read-only
 * query against business-scoped views. The widget itself only renders a number; compiling, previewing and saving
 * happen in its settings editor, and AC-11.2.5 (RLS + SELECT-only) is enforced by `dashboard.compileMetric` and
 * `dashboard.customMetric.get` on the server, never here.
 *
 * Host contract (apps/api):
 *   query    dashboard.customMetric.get   { queryId } | { sql }   → CustomMetricResult
 *   query    dashboard.customMetric.list  {}                      → MetricCatalogEntry[] (the metrics the caller may read)
 *   mutation dashboard.compileMetric      { sentence }            → CompileMetricResponse (compiled + preview)
 *
 * A named query is picked from the server's catalog (`dashboard.customMetric.list`), never typed: an id the server does
 * not know can only fail.
 */
import { useId, useState } from "react";
import { z } from "zod";
import { Calculator, Sigma } from "lucide-react";
import { Button, Field, Input, MetricTile, RadioGroup, RadioOption, SimpleSelect, Textarea, formatCompact, formatNumber, formatPercent, type MetricTileProps, type SelectOption } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps, type WidgetSettingsProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import type { CompileMetricResponse, CompiledMetric, CustomMetricFormat, CustomMetricResult, MetricCatalogEntry } from "../shared/types";

const CustomMetricFormatSchema = z.enum(["compact", "integer", "decimal", "percent", "money"]);

export const CompiledMetricSchema = z.object({
  queryId: z.string().nullable(),
  sql: z.string().min(1),
  label: z.string().min(1).max(80),
  format: CustomMetricFormatSchema,
  provenance: z.string().max(400).optional(),
  estimate: z.enum(["forecast", "estimate"]).nullable().optional(),
});

export const CustomMetricSettings = z.object({
  mode: z.enum(["query", "sentence"]).default("query"),
  /** Named, server-defined query from the catalog (`dashboard.customMetric.list`, e.g. "revenue_30d", "customers_30d"). */
  queryId: z.string().max(80).nullable().default(null),
  sentence: z.string().max(400).nullable().default(null),
  /** The compiled, previewed query the founder accepted. Never edited by hand. */
  compiled: CompiledMetricSchema.nullable().default(null),
  label: z.string().max(80).nullable().default(null),
  format: CustomMetricFormatSchema.nullable().default(null),
});
export type CustomMetricSettings = z.infer<typeof CustomMetricSettings>;

const QUERY_WORDS: Record<string, string> = { mrr: "MRR", arr: "ARR", cpa: "CPA", ltv: "LTV" };

/** A named query in words: "active_customers" → "active customers", "mrr" → "MRR". */
export function queryWords(queryId: string): string {
  return queryId
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => QUERY_WORDS[w.toLowerCase()] ?? w.toLowerCase())
    .join(" ");
}

/**
 * The catalog as Select options, in the server's order. A stored id the catalog no longer lists (or that the caller may
 * not read) stays visible as "… (not in the catalog)" so the editor never shows an empty field for a saved choice.
 */
export function catalogOptions(catalog: readonly MetricCatalogEntry[] | undefined, current: string | null): SelectOption[] {
  const options: SelectOption[] = (catalog ?? []).map((m) => ({ value: m.id, label: m.label, textValue: m.label }));
  if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: `${queryWords(current)} (not in the catalog)`, disabled: true });
  return options;
}

/** The query input the widget sends; null when the widget is not configured yet. */
export function metricQueryInput(s: CustomMetricSettings): Record<string, unknown> | null {
  if (s.mode === "query") return s.queryId ? { queryId: s.queryId } : null;
  return s.compiled ? { sql: s.compiled.sql, queryId: s.compiled.queryId ?? undefined } : null;
}

/** `currency`: the figure's own (the API names it), else the business's. */
export function formatMetric(value: number | null | undefined, format: CustomMetricFormat | null | undefined, currency: string): MetricTileProps["value"] {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "money":
      return { amountMinor: Math.round(value), currency };
    case "percent":
      return formatPercent(value, { digits: 1 });
    case "integer":
      return formatNumber(value, { maxDigits: 0 });
    case "decimal":
      return formatNumber(value, { maxDigits: 2 });
    default:
      return formatCompact(value);
  }
}

function tileFor(result: CustomMetricResult | undefined, settings: Pick<CustomMetricSettings, "label" | "format" | "compiled">, currency: string): MetricTileProps {
  const format = settings.format ?? result?.format ?? settings.compiled?.format ?? "compact";
  const estimate = result?.estimate ?? settings.compiled?.estimate ?? undefined;
  return {
    label: settings.label ?? result?.label ?? settings.compiled?.label ?? "Custom metric",
    value: formatMetric(result?.value, format, result?.currency ?? currency),
    estimate: estimate ?? undefined,
    spark: result?.series,
    provenance: result?.provenance || settings.compiled?.provenance ? { source: result?.provenance ?? settings.compiled?.provenance ?? "", asOf: result?.asOf ?? undefined, query: settings.compiled?.queryId ?? undefined } : undefined,
    size: "lg",
  };
}

function CustomMetricWidget({ settings }: WidgetProps<CustomMetricSettings>) {
  const { currency } = useWidgetData();
  const input = metricQueryInput(settings);
  const metric = useWidgetQuery<CustomMetricResult>("dashboard.customMetric.get", input ?? undefined, { enabled: !!input, refetchIntervalMs: 60_000 });
  const catalog = useWidgetQuery<MetricCatalogEntry[]>("dashboard.customMetric.list", {}, { enabled: settings.mode === "query" && !!settings.queryId });
  const named = settings.queryId ? (catalog.data?.find((m) => m.id === settings.queryId)?.label ?? queryWords(settings.queryId)) : null;
  return (
    <WidgetFrame
      title={settings.label ?? settings.compiled?.label ?? "Custom metric"}
      data-widget="custom_metric"
      queries={input ? [metric] : []}
      flush
      empty={!input ? { icon: Sigma, text: "Pick a metric from the catalog or describe the number you want in the widget settings." } : null}
      footer={settings.mode === "sentence" && settings.compiled ? <span className="truncate">Compiled from: “{settings.sentence}”</span> : named ? <span className="truncate">From the metric catalog: {named}</span> : undefined}
    >
      <MetricTile {...tileFor(metric.data, settings, currency)} className="h-full" />
    </WidgetFrame>
  );
}

/** Settings editor: named query OR sentence → compile → preview → "Use this metric" (BUILD §11.2 preview before save). */
export function CustomMetricSettingsEditor({ value, onChange }: WidgetSettingsProps<CustomMetricSettings>) {
  const { mutate, currency } = useWidgetData();
  const id = useId();
  const [sentence, setSentence] = useState(value.sentence ?? "");
  const [previewQueryId, setPreviewQueryId] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompileMetricResponse | null>(null);
  const named = useWidgetQuery<CustomMetricResult>("dashboard.customMetric.get", { queryId: previewQueryId ?? undefined }, { enabled: !!previewQueryId });
  const catalog = useWidgetQuery<MetricCatalogEntry[]>("dashboard.customMetric.list", {}, { enabled: value.mode === "query" });
  const options = catalogOptions(catalog.data, value.queryId);

  const compile = async () => {
    setCompiling(true);
    setCompileError(null);
    try {
      const res = await mutate<CompileMetricResponse>("dashboard.compileMetric", { sentence });
      setDraft(res);
    } catch (e) {
      setDraft(null);
      setCompileError(e instanceof Error ? e.message : "The sentence could not be compiled.");
    } finally {
      setCompiling(false);
    }
  };
  const accept = () => {
    if (!draft) return;
    const compiled: CompiledMetric = { queryId: draft.queryId, sql: draft.sql, label: draft.label, format: draft.format, provenance: draft.provenance, estimate: draft.estimate ?? null };
    onChange({ ...value, mode: "sentence", sentence, compiled, label: value.label ?? draft.label, format: value.format ?? draft.format });
  };
  return (
    <div className="flex flex-col gap-3" data-custom-metric-settings>
      <RadioGroup value={value.mode} onValueChange={(mode) => onChange({ ...value, mode: mode as CustomMetricSettings["mode"] })} aria-label="Metric source" className="flex flex-col gap-2">
        <RadioOption id={`${id}-query`} value="query" label="From the catalog" description="A metric the business already measures: cash, runway, revenue, customers, signups and more." />
        <RadioOption id={`${id}-sentence`} value="sentence" label="Describe it" description="A sentence; the assistant compiles a read-only query you preview before saving." />
      </RadioGroup>
      {value.mode === "query" ? (
        <Field htmlFor={`${id}-qid`} label="Metric" hint={catalog.error ? `The metric catalog could not be loaded: ${catalog.error.message}` : "From the business's metric catalog (only the sections you can read)."}>
          <div className="flex gap-2">
            <SimpleSelect
              id={`${id}-qid`}
              options={options}
              value={value.queryId ?? undefined}
              onValueChange={(queryId) => {
                onChange({ ...value, queryId });
                setPreviewQueryId(queryId);
              }}
              placeholder={catalog.isLoading ? "Loading the catalog…" : "Pick a metric"}
              disabled={!catalog.data?.length}
              className="min-w-0 flex-1"
            />
            <Button size="md" onClick={() => setPreviewQueryId(value.queryId)} disabled={!value.queryId}>
              Preview
            </Button>
          </div>
        </Field>
      ) : (
        <Field htmlFor={`${id}-sentence`} label="Sentence" hint="Read-only. The server rejects anything that is not a SELECT over this business's views.">
          <Textarea id={`${id}-sentence`} value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="Paying customers who signed up through SEO this quarter" rows={3} />
          <div className="flex items-center gap-2">
            <Button size="md" icon={Calculator} onClick={compile} loading={compiling} disabled={sentence.trim().length < 4}>
              Compile and preview
            </Button>
            {compileError ? (
              <span role="alert" className="text-small text-status-bad">
                {compileError}
              </span>
            ) : null}
          </div>
        </Field>
      )}
      <Field htmlFor={`${id}-label`} label="Label">
        <Input id={`${id}-label`} value={value.label ?? ""} onChange={(e) => onChange({ ...value, label: e.target.value || null })} placeholder={draft?.label ?? "Shown as the tile caption"} />
      </Field>
      {value.mode === "query" && previewQueryId ? (
        <div className="surface-panel" data-metric-preview>
          <MetricTile {...tileFor(named.data, { label: value.label, format: value.format, compiled: null }, currency)} loading={named.isLoading} caption={named.error ? named.error.message : "Preview"} />
        </div>
      ) : null}
      {value.mode === "sentence" && draft ? (
        <div className="flex flex-col gap-2 surface-panel p-panel-pad" data-metric-preview>
          <MetricTile {...tileFor(draft.preview, { label: value.label ?? draft.label, format: value.format ?? draft.format, compiled: draft }, currency)} caption="Preview" />
          <pre className="max-h-32 overflow-auto rounded-chip bg-ink p-2 font-mono text-mono text-secondary" aria-label="Compiled query">
            {draft.sql}
          </pre>
          <div className="flex justify-end">
            <Button size="md" variant="primary" onClick={accept}>
              Use this metric
            </Button>
          </div>
        </div>
      ) : null}
      {value.mode === "sentence" && value.compiled && !draft ? <p className="text-small text-secondary">Saved query: {value.compiled.label}. Compile again to replace it.</p> : null}
    </div>
  );
}

export const customMetricWidget = registerWidget<CustomMetricSettings>({
  key: "custom_metric",
  title: "Custom metric",
  description: "One number from the metric catalog or a sentence, compiled into a read-only query you preview first.",
  icon: "sigma",
  surfaces: ["home", "department"],
  defaultSize: { w: 3, h: 6, minW: 2, minH: 5 },
  settingsSchema: CustomMetricSettings,
  defaultSettings: CustomMetricSettings.parse({}),
  Component: CustomMetricWidget,
  SettingsComponent: CustomMetricSettingsEditor,
});
