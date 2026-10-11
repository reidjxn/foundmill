"use client";
/**
 * Legal › IP (BUILD §11.11, §11.1 "USPTO/EUIPO quick screen"): word-mark screening labelled "screen, not legal
 * clearance" (distinctiveness, obvious objections, Nice classes for the archetype, official databases the founder
 * searches personally), the list of marks screened as a DataTable, and the IP assets the connected integrations
 * imply (source code, domains, content). Nothing here files an application.
 */
import { useId, useMemo, useState } from "react";
import { Code2, ExternalLink, Globe, RefreshCw, ScanSearch, Stamp, Trash2 } from "lucide-react";
import { Button, Chip, DataTable, Field, Input, KeyValueList, Panel, StarRating, StatusPill, formatDate, type DataTableColumn, type RowAction, type SavedView, type StatusTone } from "@foundmill/dugout";
import { useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { DISTINCTIVENESS_WORD, screenTrademark, type TrademarkScreen } from "./legal-data";
import { InformationNotice, Screen, archetypeLabel, useLegalStatus, useNow, useOpenExternal } from "./shared";
import type { BusinessGetResponse, IntegrationsListResponse } from "./types";

const BUSINESS_INPUT: Record<string, unknown> = {};
const INTEGRATIONS_INPUT: Record<string, unknown> = {};

export interface ScreenedMark extends TrademarkScreen {
  id: string;
  screenedAt: string;
}

export const MARK_VIEWS: SavedView[] = [
  { id: "all", name: "All marks", builtIn: true, columns: ["mark", "distinctiveness", "strength", "issues", "screenedAt"], sort: [{ id: "screenedAt", desc: true }], filters: [] },
  { id: "strong", name: "Strong candidates", builtIn: true, columns: ["mark", "distinctiveness", "strength", "screenedAt"], sort: [{ id: "strength", desc: true }], filters: [{ id: "f-strong", field: "strength", op: "gte", value: 4 }] },
  { id: "problems", name: "With objections", builtIn: true, columns: ["mark", "distinctiveness", "issues", "screenedAt"], sort: [{ id: "issues", desc: true }], filters: [{ id: "f-prob", field: "issues", op: "gt", value: 0 }] },
];

const SEVERITY_TONE: Record<TrademarkScreen["issues"][number]["severity"], { tone: StatusTone; word: string }> = { info: { tone: "info", word: "Note" }, warn: { tone: "warn", word: "Objection likely" }, bad: { tone: "bad", word: "Refusal likely" } };

export function markColumns(): DataTableColumn<ScreenedMark>[] {
  return [
    { id: "mark", accessorKey: "mark", header: "Mark", size: 220, cell: ({ row }) => <span className="t-body-strong text-primary">{row.original.mark}</span>, meta: { locked: true } },
    { id: "distinctiveness", accessorKey: "distinctiveness", header: "Distinctiveness", size: 220, cell: ({ row }) => <Chip tone={row.original.distinctiveness === "generic" ? "bad" : row.original.distinctiveness === "descriptive" ? "warn" : "neutral"}>{DISTINCTIVENESS_WORD[row.original.distinctiveness]}</Chip>, meta: { filter: "select", filterOptions: Object.entries(DISTINCTIVENESS_WORD).map(([value, label]) => ({ value, label })) } },
    { id: "strength", accessorKey: "strength", header: "Strength", size: 140, cell: ({ row }) => <StarRating value={row.original.strength} label="Strength" showValue />, meta: { numeric: true, filter: "number" } },
    { id: "issues", accessorFn: (r) => r.issues.length, header: "Objections", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>, meta: { numeric: true, filter: "number" } },
    { id: "screenedAt", accessorKey: "screenedAt", header: "Screened", size: 120, cell: ({ getValue }) => <span className="tabular-nums">{formatDate(String(getValue()))}</span>, meta: { filter: "date" } },
  ];
}

export function IPScreen({ businessId: _businessId }: ModuleScreenProps) {
  const now = useNow();
  const id = useId();
  const openExternal = useOpenExternal();
  const business = useWidgetQuery<BusinessGetResponse>("business.get", BUSINESS_INPUT);
  const status = useLegalStatus();
  const integrations = useWidgetQuery<IntegrationsListResponse>("integrations.list", INTEGRATIONS_INPUT);
  const [views, setViews] = useState<SavedView[]>(MARK_VIEWS);
  const [input, setInput] = useState("");
  const [marks, setMarks] = useState<ScreenedMark[]>([]);
  const [current, setCurrent] = useState<ScreenedMark | null>(null);

  const archetype = business.data?.business.archetype ?? null;
  const businessName = business.data?.business.name ?? "";
  const legalName = status.data?.entity?.legalName ?? null;
  const knownMarks = useMemo(() => [...new Set([businessName, legalName ?? "", ...marks.map((m) => m.mark)].filter(Boolean).map((m) => m.trim()))], [businessName, legalName, marks]);
  const columns = useMemo(() => markColumns(), []);

  const runScreen = (mark: string) => {
    const result = screenTrademark(mark, { archetype, knownMarks: knownMarks.filter((k) => k.toLowerCase() !== mark.trim().toLowerCase()) });
    if (!result.mark) return;
    const row: ScreenedMark = { ...result, id: `${result.mark.toLowerCase()}`, screenedAt: now.toISOString() };
    setMarks((list) => [row, ...list.filter((m) => m.id !== row.id)]);
    setCurrent(row);
    setInput("");
  };

  const rowActions = (): RowAction<ScreenedMark>[] => [
    { id: "open", label: "Show screen", icon: ScanSearch, onSelect: (r) => setCurrent(r) },
    { id: "again", label: "Screen again", icon: RefreshCw, onSelect: (r) => runScreen(r.mark) },
    { id: "uspto", label: "Search USPTO", icon: ExternalLink, separatorBefore: true, onSelect: (r) => r.lookups[0] && openExternal(r.lookups[0].href) },
    { id: "euipo", label: "Search EUIPO", icon: ExternalLink, onSelect: (r) => r.lookups[1] && openExternal(r.lookups[1].href) },
    { id: "remove", label: "Remove from list", icon: Trash2, variant: "danger", separatorBefore: true, onSelect: (r) => { setMarks((list) => list.filter((m) => m.id !== r.id)); if (current?.id === r.id) setCurrent(null); } },
  ];

  const connected = (integrations.data?.integrations ?? []).filter((i) => i.status === "connected" || i.status === "mock" || i.status === "degraded");
  const assets = [
    { label: "Word mark", value: businessName || "—", hint: legalName && legalName !== businessName ? `Legal name ${legalName}` : "The trading name; screen it above before spending on brand" },
    { label: "Source code", value: connected.some((i) => i.connectorKey === "github") ? <span className="inline-flex items-center gap-1"><Code2 size={14} aria-hidden /> GitHub connected</span> : "No repository connected", hint: "Copyright is yours when written by employees; contractors and agents need an assignment clause (see Contracts)" },
    { label: "Domains", value: connected.some((i) => i.connectorKey === "cloudflare_dns") ? <span className="inline-flex items-center gap-1"><Globe size={14} aria-hidden /> Cloudflare DNS connected</span> : "No DNS connected", hint: "Register the mark in the classes you trade in before buying more domains" },
    { label: "Content", value: connected.some((i) => i.connectorKey === "notion" || i.connectorKey === "google_drive") ? "Documents connected" : "—", hint: "Templates, copy and designs the team produces are owned by the company; keep the license terms of fonts and stock assets" },
  ];

  return (
    <Screen name="legal/ip">
      <Panel title="Trademark screen" span={8} actions={<InformationNotice kind="screen" />} footer={<span>A heuristic look at the word on its face plus links to the official databases. It does not search registers or clear a mark; a trademark attorney does that before you file.</span>}>
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Screen a mark"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) runScreen(input);
          }}
        >
          {/* The hint sits under the whole row, so both buttons line up with the field rather than with its hint. */}
          <Field htmlFor={`${id}-mark`} label="Word mark" className="w-80">
            <Input id={`${id}-mark`} value={input} onChange={(e) => setInput(e.target.value)} placeholder={businessName || "Northwind"} maxLength={80} aria-describedby={`${id}-mark-hint`} />
          </Field>
          <Button type="submit" variant="primary" icon={ScanSearch} disabled={!input.trim()}>
            Screen
          </Button>
          {businessName && !marks.some((m) => m.id === businessName.toLowerCase()) ? (
            <Button type="button" variant="ghost" onClick={() => runScreen(businessName)}>
              Screen “{businessName}”
            </Button>
          ) : null}
          <p id={`${id}-mark-hint`} className="basis-full text-small text-secondary">
            The name as you would use it as a brand.
          </p>
        </form>
        {current ? (
          <section aria-label={`Screen of ${current.mark}`} className="mt-3 flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-3">
              <h2 className="t-display-md text-primary">{current.mark}</h2>
              <Chip tone={current.distinctiveness === "generic" ? "bad" : current.distinctiveness === "descriptive" ? "warn" : "good"}>{DISTINCTIVENESS_WORD[current.distinctiveness]}</Chip>
              <StarRating value={current.strength} label="Strength on its face" showValue />
            </header>
            <div>
              <p className="t-label mb-1">Likely objections</p>
              {current.issues.length === 0 ? (
                <p className="t-body text-primary">Nothing obvious on the face of the word. Identical and similar earlier marks are what the official searches are for.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {current.issues.map((i) => (
                    <li key={i.id} className="flex items-start gap-2">
                      <StatusPill tone={SEVERITY_TONE[i.severity].tone}>{SEVERITY_TONE[i.severity].word}</StatusPill>
                      <span className="t-body text-primary">{i.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="t-label mb-1">Classes to consider{archetype ? ` for ${archetypeLabel(archetype)}` : ""}</p>
              <div className="flex flex-wrap gap-1">
                {current.classes.map((c) => (
                  <Chip key={c.number} tone="neutral" icon={Stamp}>
                    Class {c.number} · {c.title}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="t-label mb-1">Search the registers yourself</p>
              <div className="flex flex-wrap gap-1">
                {current.lookups.map((l) => (
                  <Button key={l.office} size="sm" icon={ExternalLink} onClick={() => openExternal(l.href)} data-href={l.href}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
            <InformationNotice kind="screen">a trademark attorney clears a mark; filing is yours</InformationNotice>
          </section>
        ) : (
          <p className="mt-3 flex items-center gap-2 t-small text-secondary">
            <ScanSearch size={14} aria-hidden /> Enter a word mark to see its distinctiveness, likely objections and the classes to file in.
          </p>
        )}
      </Panel>

      <Panel title="IP assets" span={4} loading={business.isLoading || integrations.isLoading} error={business.error ? business.error.message : integrations.error ? integrations.error.message : undefined} onRetry={business.error ? business.refetch : integrations.refetch} footer={<span>Derived from the business profile and the connected integrations.</span>}>
        <KeyValueList aria-label="IP assets" layout="stacked" items={assets} />
      </Panel>

      <Panel title="Marks screened" span={12} flush empty={marks.length === 0 ? { icon: Stamp, children: "Marks you screen are listed here with their strength and objections, so you can compare candidates." } : undefined} footer={<span className="tabular-nums">{marks.length} mark{marks.length === 1 ? "" : "s"} · right-click to search the registers · this list lives in this window</span>}>
        <DataTable<ScreenedMark> aria-label="Marks screened" data={marks} columns={columns} views={views} onViewsChange={setViews} defaultViewId="all" height={240} exportFileName="trademark-screen" rowActions={rowActions} onRowOpen={(r) => setCurrent(r)} rowClassName={(r) => (r.id === current?.id ? "bg-panel-alt" : undefined)} />
      </Panel>
    </Screen>
  );
}
