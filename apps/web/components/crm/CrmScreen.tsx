"use client";
/**
 * CRM list (BUILD §11.12, DESIGN §8 DataTable): a universal search box with typeahead grouped by kind and the
 * operators kind:/role:/stage:/owner:/department:, natural-language phrases turned into editable chips, a DataTable
 * with grouped saved views (All · By kind · By role · By stage · Data duties) and a group summary strip, importer entry
 * points, the data-duties panel, a new-record dialog and a merge flow from any row's right-click menu.
 */
import { useQuery } from "@tanstack/react-query";
import { Building2, Database, Download, GitMerge, Search, Shield, Sparkles, UserRound, UserRoundPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Chip, DataTable, ENTITY_KIND_ICONS, EntityLink, FilterChips, Icon, Input, Kbd, Panel, Popover, PopoverAnchor, PopoverContent, StatusPill, formatRelative, type DataTableColumn, type FilterChipValue, type RowAction, type SavedView } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useTRPC } from "@/lib/trpc-react";
import { errorMessage } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { MergeDialog, NewEntityDialog } from "./dialogs";
import { CRM_VIEWS, LAWFUL_BASIS_LABEL, RETENTION_COPY, STAGE_TONE, groupByForView, groupCounts, groupLabel, stageWord, type CrmRow, type OwnerRef } from "./logic";
import { KIND_LABELS, chip, chipsToOperators, crmFilterFields, mergeChips, parseCrmQuery, type CrmFilterField } from "./search";
import { useEntityIndex } from "./useEntityIndex";

const IMPORTERS = [
  { key: "affinity", name: "Affinity" },
  { key: "hubspot", name: "HubSpot" },
  { key: "salesforce", name: "Salesforce" },
  { key: "pipedrive", name: "Pipedrive" },
  { key: "attio", name: "Attio" },
] as const;
const SYNCS = ["Gmail", "Outlook", "Google Calendar"];
const DEBOUNCE_MS = 150;

export function CrmScreen() {
  const { businessId, departments, data } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  useShellChrome({ title: "CRM" });

  // --- search box state ---------------------------------------------------------------------------------------------
  const [raw, setRaw] = useState("");
  const [chips, setChips] = useState<FilterChipValue[]>([]);
  const [text, setText] = useState("");
  const [typeahead, setTypeahead] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const departmentNames = useMemo(() => departments.map((d) => d.name), [departments]);
  useEffect(() => {
    const t = window.setTimeout(() => setTypeahead(raw.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [raw]);

  const squadQ = useQuery(trpc.team.agents.list.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
  const agentName = useCallback((id: string) => squadQ.data?.agents.find((a) => a.id === id)?.name, [squadQ.data]);
  const resolvers = useMemo(
    () => ({
      ownerId: (v: string) => squadQ.data?.agents.find((a) => a.name.toLowerCase() === v.toLowerCase() || a.id === v)?.id ?? departments.find((d) => d.name.toLowerCase() === v.toLowerCase())?.id,
      departmentId: (v: string) => departments.find((d) => d.name.toLowerCase() === v.toLowerCase() || d.slug === v.toLowerCase())?.id,
      ownerName: (ref: OwnerRef) => (ref.kind === "agent" ? agentName(ref.id) : ref.kind === "department" ? departments.find((d) => d.id === ref.id)?.name : "You"),
      departmentName: (id: string) => departments.find((d) => d.id === id)?.name,
    }),
    [squadQ.data, departments, agentName],
  );

  // Typeahead: raw text (operators stripped) against crm.search, grouped by kind.
  const parsedLive = useMemo(() => parseCrmQuery(typeahead, { departments: departmentNames }), [typeahead, departmentNames]);
  const typeaheadQ = useQuery(trpc.crm.search.queryOptions({ businessId, q: parsedLive.text || "-", limit: 12 }, { enabled: open && parsedLive.text.length > 0, staleTime: 10_000, retry: false, placeholderData: (p) => p }));

  const commit = () => {
    const parsed = parseCrmQuery(raw, { departments: departmentNames });
    setChips((c) => mergeChips(c, parsed.chips));
    setText(parsed.text);
    setRaw(parsed.text);
    setOpen(false);
  };
  const clear = () => {
    setRaw("");
    setText("");
    setChips([]);
  };

  const index = useEntityIndex(businessId, text, chips, resolvers);
  const fields = useMemo(() => crmFilterFields({ roles: index.roles, departments, owners: squadQ.data?.agents.map((a) => ({ id: a.id, name: a.name })) }), [index.roles, departments, squadQ.data]);

  // --- table ---------------------------------------------------------------------------------------------------------
  const [views, setViews] = useState<SavedView[]>(CRM_VIEWS);
  const [activeViewId, setActiveViewId] = useState<string | null>("all");
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const groupBy = groupByForView(activeView);
  const groups = useMemo(() => (groupBy ? groupCounts(index.rows, groupBy) : []), [index.rows, groupBy]);
  const [mergeSource, setMergeSource] = useState<CrmRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const open_ = useCallback((id: string) => router.push(routes.crm(businessId, id)), [router, businessId]);

  const columns = useMemo<DataTableColumn<CrmRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        size: 260,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar size={24} name={row.original.name} />
            <EntityLink entity={{ id: row.original.id, kind: row.original.kind, name: row.original.name, href: routes.crm(businessId, row.original.id) }} hoverCard={false} className="text-body-strong" onOpen={(e) => open_(e.id)} onVerb={(verb, e) => verb === "open_profile" && open_(e.id)} />
          </span>
        ),
      },
      { id: "kind", accessorKey: "kind", header: "Kind", size: 120, cell: ({ row }) => <Chip tone="neutral" icon={ENTITY_KIND_ICONS[row.original.kind]}>{KIND_LABELS[row.original.kind]}</Chip>, meta: { filter: "select", filterOptions: (Object.keys(KIND_LABELS) as EntityKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] })) } },
      { id: "roles", accessorFn: (r) => r.roles.join(", "), header: "Roles", size: 180, cell: ({ row }) => (row.original.roles.length ? <span className="flex flex-wrap gap-1">{row.original.roles.map((r) => <Chip key={r}>{r.replace(/_/g, " ")}</Chip>)}</span> : <span className="text-secondary">—</span>) },
      { id: "stage", accessorFn: (r) => r.stage ?? "", header: "Stage", size: 130, cell: ({ row }) => (row.original.stage ? <StatusPill tone={STAGE_TONE[row.original.stage] ?? "neutral"}>{stageWord(row.original.stage)}</StatusPill> : <span className="text-secondary">—</span>) },
      { id: "owner", accessorFn: (r) => (r.owner ? (resolvers.ownerName(r.owner) ?? r.owner.id) : ""), header: "Owner", size: 150, cell: ({ row }) => (row.original.owner ? <span className="truncate">{resolvers.ownerName(row.original.owner) ?? row.original.owner.kind}</span> : <span className="text-secondary">Unassigned</span>) },
      { id: "email", accessorFn: (r) => r.email ?? r.domain ?? "", header: "Email / domain", size: 220, cell: ({ getValue }) => <span className="truncate font-mono text-mono text-secondary">{(getValue() as string) || "—"}</span> },
      { id: "lawfulBasis", accessorFn: (r) => r.lawfulBasis ?? "", header: "Lawful basis", size: 150, cell: ({ getValue }) => ((getValue() as string) ? LAWFUL_BASIS_LABEL[getValue() as string] ?? (getValue() as string) : <Chip tone="warn">Not recorded</Chip>), meta: { filter: "select", filterOptions: Object.entries(LAWFUL_BASIS_LABEL).map(([value, label]) => ({ value, label })) } },
      { id: "source", accessorFn: (r) => r.source ?? "", header: "Source", size: 120, cell: ({ getValue }) => <span className="text-secondary">{(getValue() as string) || "—"}</span> },
      { id: "createdAt", accessorKey: "createdAt", header: "Added", size: 120, cell: ({ getValue }) => <span className="text-secondary">{formatRelative(getValue() as string)}</span>, meta: { filter: "date" } },
      { id: "updatedAt", accessorKey: "updatedAt", header: "Updated", size: 120, cell: ({ getValue }) => <span className="text-secondary">{formatRelative(getValue() as string)}</span>, meta: { filter: "date" } },
    ],
    [businessId, open_, resolvers],
  );
  const rowActions = (row: CrmRow): RowAction<CrmRow>[] => [
    { id: "open", label: "Open profile", onSelect: () => open_(row.id) },
    { id: "merge", label: "Merge…", icon: GitMerge, separatorBefore: true, onSelect: () => setMergeSource(row) },
    { id: "export", label: "Export data", icon: Download, onSelect: () => router.push(`${routes.crm(businessId, row.id)}?export=1`) },
  ];

  const typeaheadGroups = typeaheadQ.data?.groups ?? [];
  const live = data.business.gameMode === "live";

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="crm-screen" data-mode={index.mode}>
      {/* search ------------------------------------------------------------------------------------------------------ */}
      <div className="col-span-12 flex flex-col gap-2" data-testid="crm-search">
        <Popover open={open && parsedLive.text.length > 0} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                icon={Search}
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    if (!raw) clear();
                  }
                }}
                placeholder='Search people and organisations · try "churned customers owned by Mara" or kind:organisation role:supplier'
                aria-label="Search the CRM"
                wrapperClassName="flex-1"
                trailing={
                  <span className="inline-flex items-center gap-1">
                    <Kbd>Enter</Kbd>
                  </span>
                }
                data-testid="crm-search-input"
              />
              <Button variant="primary" icon={UserRoundPlus} onClick={() => setNewOpen(true)} data-testid="crm-new">
                New record
              </Button>
            </div>
          </PopoverAnchor>
          <PopoverContent className="w-[640px] p-0" onOpenAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => (e.target === inputRef.current ? e.preventDefault() : undefined)} data-testid="crm-typeahead">
            <div className="flex items-center gap-2 border-b border-subtle px-3 py-1.5 text-small text-secondary">
              <Icon icon={Sparkles} size="inline" />
              {parsedLive.chips.length ? (
                <span>
                  Press Enter to filter by {parsedLive.chips.map((c) => `${c.field}: ${String(c.value)}`).join(", ")}
                  {parsedLive.text ? ` and search "${parsedLive.text}"` : ""}
                </span>
              ) : (
                <span>Press Enter to list every match · operators kind: role: stage: owner: department:</span>
              )}
            </div>
            {typeaheadQ.isLoading && !typeaheadQ.data ? <p className="p-3 text-small text-secondary">Searching…</p> : null}
            {typeaheadQ.data && typeaheadGroups.length === 0 ? <p className="p-3 text-small text-secondary">No records match “{parsedLive.text}”. Press Enter to add it as a search.</p> : null}
            {typeaheadGroups.map((g) => (
              <section key={g.kind} aria-label={KIND_LABELS[g.kind]}>
                <h3 className="t-label flex items-center gap-1 bg-panel-alt px-3 py-1">
                  <Icon icon={ENTITY_KIND_ICONS[g.kind]} size={12} /> {KIND_LABELS[g.kind]} <span className="text-secondary">· {g.hits.length}</span>
                </h3>
                <ul>
                  {g.hits.slice(0, 5).map((h) => (
                    <li key={h.entity.id}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-primary hover:bg-white/4" onClick={() => open_(h.entity.id)}>
                        <Avatar size={20} name={h.entity.displayName} />
                        <span className="flex-1 truncate">{h.entity.displayName}</span>
                        <span className="text-small text-secondary">{typeof h.entity.identifiers.email === "string" ? h.entity.identifiers.email : typeof h.entity.identifiers.domain === "string" ? h.entity.identifiers.domain : h.matchedOn}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {live ? <p className="border-t border-subtle px-3 py-1.5 text-small text-secondary">Public profiles on the network appear here labelled "On Foundmill".</p> : null}
          </PopoverContent>
        </Popover>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            fields={fields}
            chips={chips}
            onChange={(next) => {
              setChips(next);
              setRaw(text);
            }}
            addLabel="Filter"
          />
          {text ? (
            <Chip tone="info" onRemove={() => { setText(""); setRaw(""); }} removeLabel="Clear search text">
              “{text}”
            </Chip>
          ) : null}
          {chips.length || text ? (
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear all
            </Button>
          ) : null}
          {chips.length ? <span className="font-mono text-mono text-secondary">{chipsToOperators(chips)}</span> : null}
        </div>
      </div>

      {/* table ------------------------------------------------------------------------------------------------------- */}
      <div className="col-span-9 min-w-0">
      <Panel
        title={index.mode === "search" ? `Results for “${text}”` : "Records"}
        flush
        loading={index.loading && index.rows.length === 0}
        error={index.error ? errorMessage(index.error) : undefined}
        onRetry={index.refetch}
        empty={!index.loading && !index.error && index.rows.length === 0 ? { icon: Database, children: index.mode === "search" ? "Nothing matches. Try fewer words, an email or a domain, or clear the filters." : "People and organisations arrive from imports, integrations and agents' work. Add one by hand or connect an importer.", action: { label: "New record", icon: UserRoundPlus, onClick: () => setNewOpen(true) } } : undefined}
        actions={<span className="text-small text-secondary tabular-nums">{index.rows.length} {index.rows.length === 1 ? "record" : "records"}</span>}
        footer={index.mode === "search" ? "Hybrid search: identifiers, name prefix and similarity, notes and documents, meaning. Scores shown on hover." : "Role listings; type to search across names, identifiers, notes and documents."}
        data-testid="crm-table-panel"
      >
        {groupBy && groups.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-subtle bg-panel-alt px-panel-pad py-1.5" data-testid="crm-groups">
            <span className="t-label">By {groupBy}</span>
            {groups.map((g) => (
              <Chip key={g.key} tone="neutral" onClick={() => setChips((c) => mergeChips(c, [chip(groupBy as CrmFilterField, g.key)]))} selected={chips.some((c) => c.field === groupBy && String(c.value) === g.key)}>
                {groupLabel(groupBy, g.key)} <span className="ml-1 tabular-nums text-secondary">{g.count}</span>
              </Chip>
            ))}
          </div>
        ) : null}
        <DataTable<CrmRow> aria-label="CRM records" data={index.rows} columns={columns} views={views} onViewsChange={setViews} activeViewId={activeViewId} onActiveViewChange={setActiveViewId} rowActions={rowActions} onRowOpen={(r) => open_(r.id)} height={typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 360)} exportFileName="crm" className="border-0" />
      </Panel>
      </div>

      {/* side panels ------------------------------------------------------------------------------------------------- */}
      <div className="col-span-3 flex flex-col gap-gutter">
        <Panel title="Importers" data-testid="crm-importers" footer="Imports resolve identities by email, domain, LinkedIn URL, registration number and Stripe id before fuzzy name matching.">
          <ul className="flex flex-col gap-1">
            {IMPORTERS.map((i) => (
              <li key={i.key}>
                <a href={`${routes.settings(businessId, "integrations")}#${i.key}`} className="flex items-center gap-2 rounded-panel px-1 py-1 text-body text-primary hover:bg-panel-alt hover:no-underline">
                  <Icon icon={Building2} size="inline" className="text-secondary" />
                  <span className="flex-1">{i.name}</span>
                  <span className="text-small text-secondary">Connect</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-small text-secondary">
            Mailbox and calendar sync ({SYNCS.join(", ")}) files interactions on profiles; bodies are encrypted.
          </p>
        </Panel>
        <Panel title="Data duties" data-testid="crm-data-duties" footer={RETENTION_COPY}>
          <ul className="flex flex-col gap-2 text-body text-primary">
            <li className="flex items-start gap-2">
              <Icon icon={Shield} size="inline" className="mt-0.5 text-secondary" />
              <span>
                Lawful basis and source per person. <button type="button" className="text-link hover:underline" onClick={() => setActiveViewId("data-duties")}>Review people without one</button>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Icon icon={Download} size="inline" className="mt-0.5 text-secondary" />
              <span>Export everything held on a person from their profile.</span>
            </li>
            <li className="flex items-start gap-2">
              <Icon icon={UserRound} size="inline" className="mt-0.5 text-secondary" />
              <span>Deletion requests queue for the scheduled job the founder approved; the global suppression list stops re-import.</span>
            </li>
          </ul>
        </Panel>
      </div>

      <NewEntityDialog businessId={businessId} open={newOpen} onOpenChange={setNewOpen} onCreated={(e) => open_(e.id)} />
      {mergeSource ? <MergeDialog businessId={businessId} source={{ id: mergeSource.id, displayName: mergeSource.name, kind: mergeSource.kind }} open onOpenChange={(o) => !o && setMergeSource(null)} onMerged={(keptId) => open_(keptId)} /> : null}
    </div>
  );
}
