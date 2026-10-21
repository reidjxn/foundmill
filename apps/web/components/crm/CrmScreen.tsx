"use client";
/**
 * CRM list (BUILD §11.12, DESIGN §8 DataTable): a universal search box with typeahead grouped by kind and the
 * operators kind:/role:/stage:/owner:/department:, natural-language phrases turned into editable chips, a DataTable
 * with grouped saved views (All · By kind · By role · By stage · Data duties) and a group summary strip, importer entry
 * points, the data-duties panel, a new-record dialog and a merge flow from any row's right-click menu.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Database, Download, GitMerge, Search, Shield, Sparkles, UserRound, UserRoundPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar, Button, Chip, DataTable, ENTITY_KIND_ICONS, EntityLink, FilterChips, Icon, Input, Kbd, Panel, Popover, PopoverAnchor, PopoverContent, StatusPill, Term, formatRelative, type DataTableColumn, type FilterChipValue, type RowAction, type SavedView } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useTRPC } from "@/lib/trpc-react";
import { useTableViews } from "@/lib/table-views";
import { errorMessage } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { MergeDialog, NewEntityDialog } from "./dialogs";
import { CRM_VIEWS, KIND_WORD, LAWFUL_BASIS_LABEL, RETENTION_COPY, STAGE_TONE, groupByForView, groupCounts, groupLabel, loadedSummary, nextActiveHit, roleWord, sourceWord, stageWord, type CrmRow, type OwnerRef } from "./logic";
import { formatNumber, plainWords } from "@/lib/format";
import { KIND_LABELS, chip, chipsToOperators, crmFilterFields, matchOwner, mergeChips, operatorValueWord, parseCrmQuery, type CrmFilterField } from "./search";
import { useEntityIndex } from "./useEntityIndex";
import { OnNetworkResults } from "@/components/live/public-search";

const IMPORTERS = [
  { key: "affinity", name: "Affinity" },
  { key: "hubspot", name: "HubSpot" },
  { key: "salesforce", name: "Salesforce" },
  { key: "pipedrive", name: "Pipedrive" },
  { key: "attio", name: "Attio" },
] as const;
const SYNCS = ["Gmail", "Outlook", "Google Calendar"];
const DEBOUNCE_MS = 150;
/** Group keys for records without a role or stage (`groupCounts`). */
const NO_GROUP_KEYS = new Set(["no role", "no stage"]);

/** Hits listed per kind in the typeahead. */
const TYPEAHEAD_PER_KIND = 5;

export function CrmScreen() {
  const { businessId, departments, data, access } = useBusiness();
  // Creating a record needs write access to the CRM (a viewer, an advisor or a member with the CRM read-only only reads).
  const canCreate = access.canWrite("crm");
  const trpc = useTRPC();
  const router = useRouter();
  // "Contacts" is the word a first-timer expects (founder decision 2026-10-20, item 1); operators find CRM in the palette.
  useShellChrome({ title: "Contacts" });

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
  const owners = useMemo(() => [...(squadQ.data?.agents ?? []).map((a) => ({ id: a.id, name: a.name })), ...departments.map((d) => ({ id: d.id, name: d.name }))], [squadQ.data, departments]);
  const resolvers = useMemo(
    () => ({
      ownerId: (v: string) => matchOwner(v, owners),
      departmentId: (v: string) => departments.find((d) => d.name.toLowerCase() === v.toLowerCase() || d.slug === v.toLowerCase())?.id,
      ownerName: (ref: OwnerRef) => (ref.kind === "agent" ? agentName(ref.id) : ref.kind === "department" ? departments.find((d) => d.id === ref.id)?.name : "You"),
      departmentName: (id: string) => departments.find((d) => d.id === id)?.name,
    }),
    [owners, departments, agentName],
  );

  // Typeahead: raw text (operators stripped) against crm.search, grouped by kind.
  const parsedLive = useMemo(() => parseCrmQuery(typeahead, { departments: departmentNames }), [typeahead, departmentNames]);
  const typeaheadQ = useQuery(trpc.crm.search.queryOptions({ businessId, q: parsedLive.text || "-", limit: 12 }, { enabled: open && parsedLive.text.length > 0, staleTime: 10_000, retry: false, placeholderData: (p) => p }));
  // The typeahead is a combobox: the input keeps focus, ArrowUp/ArrowDown move the active hit (aria-activedescendant),
  // Enter opens it (or commits the search when none is active).
  const listboxId = useId();
  const typeaheadGroups = useMemo(() => typeaheadQ.data?.groups ?? [], [typeaheadQ.data]);
  const typeaheadHits = useMemo(() => typeaheadGroups.flatMap((g) => g.hits.slice(0, TYPEAHEAD_PER_KIND)), [typeaheadGroups]);
  const [activeHit, setActiveHit] = useState(-1);
  const popoverOpen = open && parsedLive.text.length > 0;
  const activeHitId = popoverOpen && activeHit >= 0 && activeHit < typeaheadHits.length ? `${listboxId}-${typeaheadHits[activeHit]!.entity.id}` : undefined;
  useEffect(() => setActiveHit(-1), [typeahead, popoverOpen]);
  useEffect(() => {
    if (activeHitId) document.getElementById(activeHitId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeHitId]);

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
  // Saved per person and business (audit #204): the views and the open one come back after a reload.
  const savedViews = useTableViews("crm.list", CRM_VIEWS, { businessId, defaultViewId: "all" });
  const { views, activeViewId, onActiveViewChange: setActiveViewId } = savedViews;
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
        size: 200,
        meta: { locked: true },
        // One portrait per row (the link carries no icon of its own; the Kind column says what the record is).
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <Avatar size={24} name={row.original.name} />
            <EntityLink entity={{ id: row.original.id, kind: row.original.kind, name: row.original.name, href: routes.crm(businessId, row.original.id) }} hoverCard={false} className="min-w-0 truncate text-body-strong" onOpen={(e) => open_(e.id)} onVerb={(verb, e) => verb === "open_profile" && open_(e.id)} />
          </span>
        ),
      },
      { id: "kind", accessorKey: "kind", header: "Kind", size: 124, cell: ({ row }) => <Chip tone="neutral" icon={ENTITY_KIND_ICONS[row.original.kind]}>{KIND_WORD[row.original.kind]}</Chip>, meta: { filter: "select", filterOptions: (Object.keys(KIND_LABELS) as EntityKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] })) } },
      { id: "roles", accessorFn: (r) => r.roles.join(", "), header: "Roles", size: 144, cell: ({ row }) => (row.original.roles.length ? <span className="flex flex-wrap gap-1">{row.original.roles.map((r) => <Chip key={r}>{roleWord(r)}</Chip>)}</span> : <span className="text-tertiary">None</span>) },
      { id: "stage", accessorFn: (r) => r.stage ?? "", header: "Stage", size: 162, cell: ({ row }) => (row.original.stage ? <StatusPill tone={STAGE_TONE[row.original.stage] ?? "neutral"}>{stageWord(row.original.stage)}</StatusPill> : <span className="text-tertiary">None</span>) },
      { id: "owner", accessorFn: (r) => (r.owner ? (resolvers.ownerName(r.owner) ?? r.owner.id) : ""), header: "Owner", size: 112, cell: ({ row }) => (row.original.owner ? <span className="truncate">{resolvers.ownerName(row.original.owner) ?? "An agent"}</span> : <span className="text-tertiary">Unassigned</span>) },
      // The table has the full width; sized so the default view fits at 1280 with nothing behind a sideways scroll. Email takes the spare width (emails show in full at 1440); the other columns keep theirs.
      { id: "email", accessorFn: (r) => r.email ?? r.domain ?? "", header: "Email or domain", size: 160, meta: { grow: 1 }, cell: ({ getValue }) => ((getValue() as string) ? <span className="truncate font-mono text-mono text-secondary">{getValue() as string}</span> : <span className="text-tertiary">None</span>) },
      { id: "lawfulBasis", accessorFn: (r) => r.lawfulBasis ?? "", header: "Lawful basis", size: 160, cell: ({ getValue }) => ((getValue() as string) ? LAWFUL_BASIS_LABEL[getValue() as string] ?? plainWords(getValue() as string) : <Chip tone="warn">Not recorded</Chip>), meta: { filter: "select", filterOptions: Object.entries(LAWFUL_BASIS_LABEL).map(([value, label]) => ({ value, label })) } },
      { id: "source", accessorFn: (r) => sourceWord(r.source), header: "Source", size: 140, cell: ({ getValue }) => ((getValue() as string) ? <span className="text-secondary">{getValue() as string}</span> : <span className="text-tertiary">Unknown</span>) },
      { id: "createdAt", accessorKey: "createdAt", header: "Added", size: 120, cell: ({ getValue }) => <span className="font-mono text-mono text-secondary">{formatRelative(getValue() as string)}</span>, meta: { filter: "date" } },
      { id: "updatedAt", accessorKey: "updatedAt", header: "Updated", size: 96, cell: ({ getValue }) => <span className="font-mono text-mono text-secondary">{formatRelative(getValue() as string)}</span>, meta: { filter: "date" } },
    ],
    [businessId, open_, resolvers],
  );
  const rowActions = (row: CrmRow): RowAction<CrmRow>[] => [
    { id: "open", label: "Open profile", onSelect: () => open_(row.id) },
    { id: "merge", label: "Merge…", icon: GitMerge, separatorBefore: true, onSelect: () => setMergeSource(row) },
    { id: "export", label: "Export data", icon: Download, onSelect: () => router.push(`${routes.crm(businessId, row.id)}?export=1`) },
  ];

  const live = data.business.gameMode === "live";

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="crm-screen" data-mode={index.mode}>
      {/* search ------------------------------------------------------------------------------------------------------ */}
      <div className="col-span-12 flex flex-col gap-2" data-testid="crm-search">
        <Popover open={popoverOpen} onOpenChange={setOpen}>
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
                  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && popoverOpen && typeaheadHits.length > 0) {
                    e.preventDefault();
                    setActiveHit((i) => nextActiveHit(i, e.key === "ArrowDown" ? 1 : -1, typeaheadHits.length));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const hit = activeHit >= 0 ? typeaheadHits[activeHit] : undefined;
                    if (hit) open_(hit.entity.id);
                    else commit();
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    if (!raw) clear();
                  }
                }}
                placeholder='Search people and organizations · try "churned customers owned by Mara" or kind:organization role:supplier'
                aria-label="Search the CRM"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={popoverOpen}
                aria-controls={popoverOpen ? listboxId : undefined}
                aria-activedescendant={activeHitId}
                wrapperClassName="flex-1"
                trailing={
                  <span className="inline-flex items-center gap-1">
                    <Kbd>Enter</Kbd>
                  </span>
                }
                data-testid="crm-search-input"
              />
              <Button variant="primary" icon={UserRoundPlus} onClick={() => setNewOpen(true)} disabled={!canCreate} title={canCreate ? undefined : "You can read the CRM but not add to it."} data-testid="crm-new">
                New record
              </Button>
            </div>
          </PopoverAnchor>
          <PopoverContent className="w-reading p-0" onOpenAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => (e.target === inputRef.current ? e.preventDefault() : undefined)} data-testid="crm-typeahead">
            <div className="flex items-center gap-2 border-b border-subtle px-3 py-1.5 text-small text-secondary">
              <Icon icon={Sparkles} size="inline" />
              {parsedLive.chips.length ? (
                <span>
                  Press Enter to filter by {parsedLive.chips.map((c) => `${c.field}: ${operatorValueWord(c.field, String(c.value))}`).join(", ")}
                  {parsedLive.text ? ` and search "${parsedLive.text}"` : ""}
                </span>
              ) : (
                <span>Press Enter to list every match. Narrow with kind:, role:, stage:, owner: or department:</span>
              )}
            </div>
            {typeaheadQ.isLoading && !typeaheadQ.data ? <p className="p-3 text-small text-secondary">Searching…</p> : null}
            {typeaheadQ.data && typeaheadGroups.length === 0 ? <p className="p-3 text-small text-secondary">No records match “{parsedLive.text}”. Press Enter to add it as a search.</p> : null}
            <div role="listbox" id={listboxId} aria-label="Matching records">
              {typeaheadGroups.map((g) => (
                <div key={g.kind} role="group" aria-label={KIND_LABELS[g.kind]}>
                  <h3 className="t-label flex items-center gap-1 bg-panel-alt px-3 py-1" aria-hidden="true">
                    <Icon icon={ENTITY_KIND_ICONS[g.kind]} size={12} /> {KIND_LABELS[g.kind]} <span className="text-secondary">· {g.hits.length}</span>
                  </h3>
                  {g.hits.slice(0, TYPEAHEAD_PER_KIND).map((h) => {
                    const index = typeaheadHits.findIndex((x) => x.entity.id === h.entity.id);
                    const active = index === activeHit;
                    return (
                      <button
                        key={h.entity.id}
                        id={`${listboxId}-${h.entity.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        tabIndex={-1}
                        data-active={active || undefined}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-primary hover:bg-white/4 ${active ? "bg-white/8" : ""}`}
                        onMouseMove={() => !active && setActiveHit(index)}
                        onClick={() => open_(h.entity.id)}
                      >
                        <Avatar size={20} name={h.entity.displayName} />
                        <span className="flex-1 truncate">{h.entity.displayName}</span>
                        <span className="text-small text-secondary">{typeof h.entity.identifiers.email === "string" ? h.entity.identifiers.email : typeof h.entity.identifiers.domain === "string" ? h.entity.identifiers.domain : h.matchedOn}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {live ? <OnNetworkResults text={parsedLive.text} /> : null}
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
      <div className="col-span-12 min-w-0">
      <Panel
        title={index.mode === "search" ? `Results for “${text}”` : "Records"}
        flush
        loading={index.loading && index.rows.length === 0}
        error={index.error ? errorMessage(index.error) : undefined}
        onRetry={index.refetch}
        empty={!index.loading && !index.error && index.rows.length === 0 ? { icon: Database, children: index.mode === "search" ? "Nothing matches. Try fewer words, an email or a domain, or clear the filters." : "People and organizations arrive from imports, integrations and agents' work. Add one by hand or connect an importer.", action: canCreate ? { label: "New record", icon: UserRoundPlus, onClick: () => setNewOpen(true) } : undefined } : undefined}
        footer={
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums text-primary" data-testid="crm-loaded">
              {loadedSummary({ mode: index.mode, loaded: index.rows.length, total: index.total, hasMore: index.hasMore })}
            </span>
            {index.hasMore ? (
              index.loadingMore && !index.loadMoreFailed ? (
                <span role="status">Loading more…</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={index.loadMore} data-testid="crm-load-more">
                  {index.loadMoreFailed ? "Try loading more again" : "Load more"}
                </Button>
              )
            ) : null}
            <span>{index.mode === "search" ? "Matches names, emails and domains, notes and documents, and meaning." : "Everyone the business works with. Type above to search names, emails, notes and documents."}</span>
          </span>
        }
        data-testid="crm-table-panel"
      >
        {groupBy && groups.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-subtle bg-panel-alt px-panel-pad py-1.5" data-testid="crm-groups">
            <span className="t-label">By {groupBy}</span>
            {groups.map((g) => (
              // "No role" and "No stage" are not values a filter can hold, so those counts are not clickable.
              <Chip key={g.key} tone="neutral" onClick={NO_GROUP_KEYS.has(g.key) ? undefined : () => setChips((c) => mergeChips(c, [chip(groupBy as CrmFilterField, g.key)]))} selected={chips.some((c) => c.field === groupBy && String(c.value) === g.key)}>
                {groupLabel(groupBy, g.key)} <span className="ml-1 tabular-nums text-secondary">{formatNumber(g.count)}</span>
              </Chip>
            ))}
            {index.hasMore ? <span className="ml-auto text-small text-tertiary">Counts cover the {formatNumber(index.rows.length)} records loaded.</span> : null}
          </div>
        ) : null}
        <DataTable<CrmRow> aria-label="CRM records" data={index.rows} columns={columns} {...savedViews} rowActions={rowActions} onRowOpen={(r) => open_(r.id)} height={typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 360)} exportFileName="crm" className="border-0" hideEmptyColumns hideFilter />
      </Panel>
      </div>

      {/* side panels ------------------------------------------------------------------------------------------------- */}
      <div className="col-span-12 grid grid-cols-2 items-start gap-gutter">
        <Panel title="Importers" data-testid="crm-importers" footer="Imports match people by email, domain, LinkedIn, company number and Stripe customer before they compare names.">
          <ul className="flex flex-col gap-1">
            {IMPORTERS.map((i) => (
              <li key={i.key}>
                <a href={`${routes.settings(businessId, "integrations")}#${i.key}`} className="group flex min-h-control-md items-center gap-2 rounded-sm px-1.5 text-body text-primary transition-colors duration-hover hover:bg-white/4 hover:no-underline focus-visible:shadow-ring">
                  <Icon icon={Building2} size="inline" className="text-tertiary" />
                  <span className="flex-1">{i.name}</span>
                  <span className="inline-flex items-center gap-1 text-small text-secondary group-hover:text-primary">
                    Connect <Icon icon={ArrowRight} size={12} />
                  </span>
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
                <Term id="lawful_basis">Lawful basis</Term> and source per person. <button type="button" className="text-link hover:underline" onClick={() => setActiveViewId("data-duties")}>Review people without one</button>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Icon icon={Download} size="inline" className="mt-0.5 text-secondary" />
              <span>Export everything held on a person from their profile.</span>
            </li>
            <li className="flex items-start gap-2">
              <Icon icon={UserRound} size="inline" className="mt-0.5 text-secondary" />
              <span>A deletion request stops outreach at once; the nightly, logged deletion job removes the record after 7 days, and the person is never imported again.</span>
            </li>
          </ul>
        </Panel>
      </div>

      <NewEntityDialog businessId={businessId} open={newOpen} onOpenChange={setNewOpen} onCreated={(e) => open_(e.id)} onOpenExisting={open_} />
      {mergeSource ? <MergeDialog businessId={businessId} source={{ id: mergeSource.id, displayName: mergeSource.name, kind: mergeSource.kind }} open onOpenChange={(o) => !o && setMergeSource(null)} onMerged={(keptId) => open_(keptId)} /> : null}
    </div>
  );
}
