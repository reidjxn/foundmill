"use client";
/**
 * Product › Sources (BUILD §11.5): everything the Source Watcher reads — interviews, feedback, issues, documents,
 * competitor pages, legal and finance notes — as a DataTable with kind filters, saved views, right-click verbs (open
 * the link, open the linked block, remove the source after a confirmation) and an "Add source" dialog. Adding and
 * removing need write access to Product. `?source=<id>` highlights one (the Changes tab links evidence here).
 */
import { useMemo, useState } from "react";
import { ExternalLink, FileText, Inbox, Plus, Trash2 } from "lucide-react";
import { Button, Chip, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Panel, formatRelative, type DataTableColumn, type SavedView } from "@foundmill/dugout";
import { SOURCE_KINDS, type SourceKind } from "@foundmill/shared";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { useCanWrite } from "../env";
import { plural } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { InlineError, Screen, blockTitle, useAction } from "./shared";
import { AddSourceDialog } from "./sources/AddSourceDialog";
import { SOURCE_KIND_META, hostOf, isSourceKind, isWebUri, linkedBlocks, readState, summaryLine, topics } from "./sources/kinds";
import type { SourceRow, SourcesListResponse, SpecBlockRow, SpecGetResponse } from "./types";
import { DateText } from "../dates";

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
    { id: "summary", accessorFn: (r) => summaryLine(r), header: "What it says", size: 290, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    {
      id: "blocks",
      accessorFn: (r) => linkedBlocks(r).length,
      header: "Spec blocks",
      size: 180,
      cell: ({ row }) => {
        const linked = linkedBlocks(row.original)
          .map((l) => ({ ...l, block: blockById.get(l.blockId) }))
          .filter((l) => l.block);
        if (!linked.length) return <span className="text-secondary">—</span>;
        return (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {linked.slice(0, 2).map((l) => (
              <Chip key={l.blockId} tone="neutral" icon={FileText} onClick={() => onOpenBlock(l.blockId)} title={`${blockTitle(l.block!)} · relevance ${Math.round(l.score * 100)}%`}>
                {blockTitle(l.block!)}
              </Chip>
            ))}
            {linked.length > 2 ? <span className="text-small text-secondary tabular-nums">+{linked.length - 2}</span> : null}
          </span>
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
  const list = useWidgetQuery<SourcesListResponse>("product.sources.list", kind ? { kind, limit: 200 } : { limit: 200 });
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const departments = useDepartments();
  const [views, setViews] = useState<SavedView[]>(SOURCE_VIEWS);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SourceRow | null>(null);
  const [highlight] = useState<string | null>(() => sourceFromLocation());
  const canWrite = useCanWrite("product");
  const action = useAction();
  useBusinessEvents(() => list.refetch(), ["source.added", "source.scored", "spec.proposal_created"]);
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
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add source
            </Button>
          ) : null
        }
        footer={<span className="tabular-nums">{plural(rows.length, "source")}{kind ? ` of kind ${SOURCE_KIND_META[kind].word}` : ""} · the Source Watcher scores relevance against every spec block and raises proposals from the Changes tab</span>}
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
        <DataTable<SourceRow>
          aria-label="Sources"
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="all"
          height={560}
          exportFileName="sources"
          rowClassName={(row) => (row.id === highlight ? "bg-panel-alt" : undefined)}
          onRowOpen={(row) => (openExternal(row.uri) ? undefined : linkedBlocks(row)[0] && openBlock(linkedBlocks(row)[0]!.blockId))}
          empty={kind ? { icon: SOURCE_KIND_META[kind].icon, children: `No ${SOURCE_KIND_META[kind].word.toLowerCase()} sources yet.`, action: canWrite ? { label: `Add ${SOURCE_KIND_META[kind].word.toLowerCase()}`, icon: Plus, onClick: () => setAdding(true) } : undefined } : undefined}
          rowActions={(row) => {
            const linked = linkedBlocks(row);
            return [
              { id: "open-link", label: "Open link", icon: ExternalLink, disabled: !isWebUri(row.uri), onSelect: (r) => void openExternal(r.uri) },
              { id: "open-block", label: linked.length ? "Open linked spec block" : "No linked spec block", icon: FileText, disabled: linked.length === 0, onSelect: () => linked[0] && openBlock(linked[0].blockId) },
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
