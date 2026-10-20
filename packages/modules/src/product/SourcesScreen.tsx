"use client";
/**
 * Product › Sources (BUILD §11.5): everything the Source Watcher reads — interviews, feedback, issues, documents,
 * competitor pages, legal and finance notes — as a DataTable with kind filters, saved views, right-click verbs (open
 * the link, open the linked block, remove the source after a confirmation) and an "Add source" dialog. Adding and
 * removing need write access to Product. `?source=<id>` highlights one (the Changes tab links evidence here). Sources an
 * import (Door B) created say whether the gateway has read them; one that was not read (not connected yet, refused,
 * failed) has Read now, which reads it again through `import.readAgain` once the founder has connected it.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Inbox, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button, Chip, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Panel, ProvenanceChip, formatRelative, type DataTableColumn, type SavedView } from "@foundmill/dugout";
import { SOURCE_KINDS, type SourceKind } from "@foundmill/shared";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { useCanWrite } from "../env";
import { plural } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { InlineError, Screen, blockTitle, useAction } from "./shared";
import { AddSourceDialog } from "./sources/AddSourceDialog";
import { IMPORT_STATE_META, SOURCE_KIND_META, hostOf, importState, isSimulatedSummary, isSourceKind, isWebUri, linkedBlocks, readState, relevance, summaryLine, topics } from "./sources/kinds";
import type { SourceRow, SourcesListResponse, SpecBlockRow, SpecGetResponse } from "./types";
import { DateText } from "../dates";

/** How often the list refreshes while an import is still reading some of its sources ("Not read yet"). */
export const IMPORT_POLL_MS = 5_000;

export const SOURCE_VIEWS: SavedView[] = [
  // The default view fits the panel at 1280 without a cut column; topics and fetch times live in the column menu.
  { id: "all", name: "All sources", builtIn: true, columns: ["title", "kind", "summary", "blocks", "createdAt"], sort: [{ id: "createdAt", desc: true }], filters: [] },
  { id: "customers", name: "Customer voice", builtIn: true, columns: ["title", "kind", "summary", "blocks", "createdAt"], sort: [{ id: "createdAt", desc: true }], filters: [{ id: "f-cv", field: "kind", op: "in", value: ["transcript", "feedback"] }] },
  { id: "competitors", name: "Competitors", builtIn: true, columns: ["title", "host", "summary", "fetchedAt"], sort: [{ id: "fetchedAt", desc: true }], filters: [{ id: "f-comp", field: "kind", op: "eq", value: "competitor" }] },
  { id: "unlinked", name: "Not linked to the spec", builtIn: true, columns: ["title", "kind", "summary", "createdAt"], sort: [{ id: "createdAt", desc: true }], filters: [{ id: "f-unl", field: "blocks", op: "eq", value: 0 }] },
];

function sourceFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("source");
  } catch {
    return null;
  }
}

export function openExternal(uri: string | null): boolean {
  if (!isWebUri(uri) || typeof window === "undefined") return false;
  window.open(uri.trim(), "_blank", "noopener,noreferrer");
  return true;
}

export function sourceColumns(blocks: readonly SpecBlockRow[], onOpenBlock: (id: string) => void): DataTableColumn<SourceRow>[] {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  return [
    {
      accessorKey: "title",
      header: "Source",
      size: 240,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-body-strong text-primary">{row.original.title || row.original.uri || "Untitled"}</span>
          {row.original.uri ? <ExternalLink size={12} className="shrink-0 text-secondary" aria-label="Has a link" /> : null}
        </span>
      ),
      meta: { locked: true },
    },
    {
      accessorKey: "kind",
      header: "Kind",
      size: 120,
      cell: ({ getValue }) => {
        const k = getValue() as SourceKind;
        const m = SOURCE_KIND_META[k] ?? SOURCE_KIND_META.doc;
        return (
          <Chip tone={m.tone} icon={m.icon}>
            {m.word}
          </Chip>
        );
      },
      meta: { filter: "select", filterOptions: SOURCE_KINDS.map((k) => ({ value: k, label: SOURCE_KIND_META[k].word })) },
    },
    { id: "host", accessorFn: (r) => hostOf(r.uri) ?? "", header: "Site", size: 150, cell: ({ getValue }) => <span className="font-mono text-mono text-secondary">{String(getValue() ?? "")}</span> },
    {
      id: "summary",
      accessorFn: (r) => summaryLine(r),
      header: "What it says",
      size: 290,
      // An imported source says whether the import has read it; a summary nobody read is labeled Estimate. A watched
      // source says where the Source Watcher is with it (summaryLine).
      cell: ({ row, getValue }) => {
        const imported = importState(row.original);
        return (
          <span className="flex min-w-0 items-center gap-1">
            {imported ? (
              <Chip tone={IMPORT_STATE_META[imported.state].tone} title={imported.note} data-import-state={imported.state} className="shrink-0">
                {IMPORT_STATE_META[imported.state].word}
              </Chip>
            ) : null}
            <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span>
            {relevance(row.original).summary && isSimulatedSummary(row.original) ? <ProvenanceChip kind="estimate" className="shrink-0" /> : null}
          </span>
        );
      },
    },
    {
      id: "blocks",
      accessorFn: (r) => linkedBlocks(r).length,
      header: "Spec paragraphs",
      size: 180,
      cell: ({ row }) => {
        const linked = linkedBlocks(row.original)
          .map((l) => ({ ...l, block: blockById.get(l.blockId) }))
          .filter((l) => l.block);
        if (!linked.length) return <span className="text-secondary">—</span>;
        return (
          // A count, not the titles: a long block title would widen the table past its panel. The titles are the tooltip,
          // and the chip opens the best match.
          <Chip
            tone="neutral"
            icon={FileText}
            onClick={() => onOpenBlock(linked[0]!.blockId)}
            title={linked.map((l) => `${blockTitle(l.block!)} · relevance ${Math.round(l.score * 100)}%`).join("\n")}
          >
            {linked.length === 1 ? "1 paragraph" : `${linked.length} paragraphs`}
          </Chip>
        );
      },
      meta: { numeric: true, label: "Spec blocks", csv: (r) => linkedBlocks(r).length },
    },
    { id: "topics", accessorFn: (r) => topics(r).join(", "), header: "Topics", size: 180, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    {
      accessorKey: "fetchedAt",
      header: "Fetched",
      size: 110,
      cell: ({ row, getValue }) => {
        const { state, reason } = readState(row.original);
        const text = getValue() ? formatRelative(getValue() as string) : state === "unreachable" ? "Could not read" : state === "failed" ? "Read failed" : state === "read" ? "Read" : "Not read yet";
        return (
          <span className="tabular-nums" title={reason ?? undefined}>
            {text}
          </span>
        );
      },
      meta: { filter: "date" },
    },
    { accessorKey: "createdAt", header: "Added", size: 110, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() as string} />, meta: { filter: "date" } },
  ];
}

export function SourcesScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useWidgetQuery<SourcesListResponse>("product.sources.list", kind ? { kind, limit: 200 } : { limit: 200 }, { refetchIntervalMs: importing ? IMPORT_POLL_MS : undefined });
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const departments = useDepartments();
  // Saved per person, business and table (audit #204): they come back after a reload.
  const savedViews = useSavedViews("product.sources", SOURCE_VIEWS, { defaultViewId: "all" });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SourceRow | null>(null);
  const [highlight] = useState<string | null>(() => sourceFromLocation());
  const canWrite = useCanWrite("product");
  const action = useAction();
  useBusinessEvents(() => list.refetch(), ["source.added", "source.scored", "spec.proposal_created"]);
  const reading = useAction();
  // Removing archives the source (product.sources.remove): it leaves the list and the Source Watcher stops reading it;
  // proposals that cite it keep their evidence.
  const remove = async () => {
    if (!removing) return;
    await action.run("product.sources.remove", { sourceId: removing.id }, {
      key: "remove",
      then: () => {
        setRemoving(null);
        list.refetch();
      },
    });
  };

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  // Import sources the gateway could not read (not connected yet, refused, failed): Read now tries them again.
  const unread = useMemo(() => rows.filter((r) => importState(r)?.state === "not_read"), [rows]);
  // While the import is reading (a row still "Not read yet"), the list refreshes itself until every row has an outcome.
  const pending = rows.some((r) => importState(r)?.state === "pending");
  useEffect(() => setImporting(pending), [pending]);
  const readNow = (ids: string[]) => void reading.run("import.readAgain", { sourceIds: ids }, { key: "read-now", then: () => list.refetch() });
  const blocks = spec.data?.blocks ?? [];
  const openBlock = (blockId: string) => navigate(`${moduleHref(businessId, departments.data, "product", "specification") ?? routes.department(businessId, "product", "specification")}?block=${blockId}`);
  const columns = useMemo(() => sourceColumns(blocks, openBlock), [blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const countByKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
    return m;
  }, [rows]);

  return (
    <Screen name="product/sources">
      <Panel
        title="Sources"
        span={12}
        loading={list.isLoading}
        error={list.error ? list.error.message : undefined}
        onRetry={list.refetch}
        empty={
          list.data && rows.length === 0 && !kind
            ? { icon: Inbox, title: "No sources yet", children: "Connected tools (GitHub issues, Drive, Notion, support mail) feed this list automatically; you can also add a link or a note by hand.", action: canWrite ? { label: "Add source", icon: Plus, onClick: () => setAdding(true) } : undefined }
            : undefined
        }
        actions={
          canWrite ? (
            <span className="flex items-center gap-2">
              {unread.length ? (
                <Button size="sm" variant="secondary" icon={RefreshCw} loading={reading.pending === "read-now"} onClick={() => readNow(unread.map((r) => r.id))} title={`Read the ${unread.length} imported source${unread.length === 1 ? "" : "s"} that ${unread.length === 1 ? "was" : "were"} not read, read only, once connected in Settings › Integrations`} data-testid="read-imports-now">
                  Read now · {unread.length}
                </Button>
              ) : null}
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                Add source
              </Button>
            </span>
          ) : null
        }
        footer={<span className="tabular-nums">{plural(rows.length, "source")}{kind ? ` of kind ${SOURCE_KIND_META[kind].word}` : ""} · the Source Watcher scores relevance against every specification paragraph and raises proposals from the Changes tab</span>}
        flush
      >
        <div role="group" aria-label="Filter by kind" className="flex flex-wrap items-center gap-1 border-b border-subtle px-panel-pad py-2">
          <Chip tone={kind === null ? "kit" : "neutral"} selected={kind === null} onClick={() => setKind(null)}>
            All
          </Chip>
          {SOURCE_KINDS.map((k) => {
            const m = SOURCE_KIND_META[k];
            return (
              <Chip key={k} tone={kind === k ? m.tone : "neutral"} icon={m.icon} selected={kind === k} onClick={() => setKind(kind === k ? null : k)} title={m.hint}>
                {m.word}
                {countByKind.get(k) ? <span className="ml-1 text-secondary tabular-nums">{countByKind.get(k)}</span> : null}
              </Chip>
            );
          })}
        </div>
        <InlineError error={reading.error} className="px-panel-pad pt-2" />
        <DataTable<SourceRow>
          aria-label="Sources"
          data={rows}
          columns={columns}
          {...savedViews}
          defaultViewId="all"
          height={560}
          exportFileName="sources"
          rowClassName={(row) => (row.id === highlight ? "bg-panel-alt" : undefined)}
          onRowOpen={(row) => (openExternal(row.uri) ? undefined : linkedBlocks(row)[0] && openBlock(linkedBlocks(row)[0]!.blockId))}
          empty={kind ? { icon: SOURCE_KIND_META[kind].icon, children: `No ${SOURCE_KIND_META[kind].word.toLowerCase()} sources yet.`, action: canWrite ? { label: `Add ${SOURCE_KIND_META[kind].word.toLowerCase()}`, icon: Plus, onClick: () => setAdding(true) } : undefined } : undefined}
          rowActions={(row) => {
            const linked = linkedBlocks(row);
            const imported = importState(row);
            return [
              { id: "open-link", label: "Open link", icon: ExternalLink, disabled: !isWebUri(row.uri), onSelect: (r) => void openExternal(r.uri) },
              { id: "open-block", label: linked.length ? "Open linked spec block" : "No linked spec block", icon: FileText, disabled: linked.length === 0, onSelect: () => linked[0] && openBlock(linked[0].blockId) },
              ...(canWrite && imported && imported.state !== "read" ? [{ id: "read-now", label: "Read now", icon: RefreshCw, disabled: reading.pending === "read-now", onSelect: (r: SourceRow) => readNow([r.id]) }] : []),
              ...(canWrite ? [{ id: "remove", label: "Remove source", icon: Trash2, onSelect: (r: SourceRow) => setRemoving(r) }] : []),
            ];
          }}
        />
      </Panel>
      <AddSourceDialog open={adding} kind={kind && isSourceKind(kind) ? kind : undefined} onClose={() => setAdding(false)} onSaved={() => list.refetch()} />
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            action.clearError();
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove this source?</DialogTitle>
            <DialogDescription>
              {removing ? `"${removing.title || removing.uri || "Untitled"}" leaves the list and the Source Watcher stops reading it. Change proposals that cite it keep it as evidence.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <InlineError error={action.error} />
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} onClick={() => void remove()} loading={action.pending === "remove"}>
              Remove source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
