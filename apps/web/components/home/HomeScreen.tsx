"use client";
/**
 * Home (BUILD §11.2, DESIGN §9): dashboards as tabs (`dashboard.list/get/create/delete/applyPreset`), a WidgetGrid of
 * gallery widgets from @foundmill/widgets, Edit mode on `E` (add, remove, resize, per-widget settings), presets,
 * reset, share with co-founders, layout persistence with a version (AC-11.2.4), and the day-one state with ghosted
 * milestones.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LayoutDashboard, Link2, Pencil, Plus, Share2, Star, Trash2, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Panel,
  TrophyCabinet,
  WidgetGrid,
  useToast,
  type WidgetLayout,
  type WidgetPreset,
} from "@foundmill/dugout";
import { FoundationsBanner, useFoundations } from "@foundmill/modules/product/foundations";
import { DASHBOARD_PRESET_LIST, fromGridLayout, prepareLayout, routes, toGridLayout, toScreenLayout, type DashboardPresetId } from "@foundmill/widgets";
import { useToday } from "@foundmill/widgets/data";
import { WRITE_ROLES } from "@foundmill/shared/constants";
import { recentRibbonInput } from "@foundmill/widgets/shared/ribbon";
import { usePageShortcuts } from "@/lib/keys";
import { shellQueryInputs } from "@/lib/shell-queries";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { gridRegistry } from "@/lib/widget-registry";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { NotFoundPanel, RefreshFailedNotice, isMissing, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { HomeAutopilot } from "./HomeAutopilot";
import { dashboardActions, dashboardTabs, dayOneLine, editedElsewhere, ghostedMilestones, gridPresets, isDayOne, isOwnDashboard, nextDashboardName, pickDashboardId, resetPresetFor, sameLayout, shareHref, versionConflict } from "./dashboards";
import { isGuid } from "@/lib/ids";

type DashboardRow = RouterOutputs["dashboard"]["get"];

const SAVE_DEBOUNCE_MS = 400;

export interface HomeScreenProps {
  dashboardId?: string;
}

export function HomeScreen({ dashboardId: routeId }: HomeScreenProps) {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const live = data.business.gameMode === "live";
  const currency = useBusinessCurrency();

  const listQ = useQuery(trpc.dashboard.list.queryOptions({ businessId }, { staleTime: 30_000 }));
  const list = useMemo(() => listQ.data ?? [], [listQ.data]);
  // An address that is not a dashboard id (a typo, a truncated link) never reaches the API: Home shows the default
  // dashboard and the address is corrected (audit WEB-14).
  const dashboardId = pickDashboardId(routeId, list);
  const badRouteId = routeId !== undefined && !isGuid(routeId);
  useEffect(() => {
    if (badRouteId) router.replace(routes.home(businessId));
  }, [badRouteId, router, businessId]);
  const dashboardQ = useQuery(trpc.dashboard.get.queryOptions({ businessId, dashboardId }, { enabled: listQ.isSuccess, staleTime: 15_000 }));
  const row = dashboardQ.data ?? null;
  // Mine by owner, not by membership of the cached list: a first visit's Home is created by `dashboard.get` after the
  // (empty) list was read, and must open as the person's own, editable dashboard (audit RUI-12).
  const viewerId = data.membership?.userId ?? null;
  const mine = !!row && isOwnDashboard(row, list, viewerId);
  // Viewers and advisors read Home and never write it: no edit mode, no New, no copies (the api refuses them too).
  const actions = dashboardActions(row, { canWrite: (WRITE_ROLES as readonly string[]).includes(data.role), mine });
  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("dashboard") as unknown[] }), [queryClient]);
  // The default Home was just created by `dashboard.get`: the list read before it does not have it yet.
  const missingFromList = !!row && listQ.isSuccess && mine && !list.some((d) => d.id === row.id);
  useEffect(() => {
    if (missingFromList) void queryClient.invalidateQueries({ queryKey: trpc.dashboard.list.queryKey({ businessId }) });
  }, [missingFromList, queryClient, trpc, businessId]);

  // --- Edit mode (E) ----------------------------------------------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const editable = actions.edit;
  usePageShortcuts({ onEditLayout: editable ? () => setEditing((e) => !e) : undefined, onEscape: editing ? () => setEditing(false) : undefined });
  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);

  // --- dashboard mutations ----------------------------------------------------------------------------------------
  const create = useMutation(
    trpc.dashboard.create.mutationOptions({
      onSuccess: (created) => {
        void invalidate();
        router.push(routes.home(businessId, created.id));
        toast({ title: "Dashboard created", description: created.name, tone: "good" });
      },
      onError: (err) => toast({ title: "Could not create the dashboard", description: errorMessage(err), tone: "bad" }),
    }),
  );
  // Every save puts the saved row into the cache: a return to Home within the 15 s freshness window must show the saved
  // layout, never the copy from before the edit (which the grid would then save back over it, audit WEB-09).
  const update = useMutation(
    trpc.dashboard.update.mutationOptions({
      onSuccess: (saved) => {
        queryClient.setQueriesData<DashboardRow>({ queryKey: trpcPathPrefix("dashboard.get") as unknown[] }, (old) => (old && old.id === saved.id && saved.version >= old.version ? { ...saved, stored: true, editable: true } : old));
        queryClient.setQueryData(trpc.dashboard.get.queryKey({ businessId, dashboardId: saved.id }), (old: DashboardRow | undefined) => (old && old.version > saved.version ? old : { ...saved, stored: true, editable: true }));
        void queryClient.invalidateQueries({ queryKey: trpc.dashboard.list.queryKey({ businessId }) });
      },
      onError: (err) => toast({ title: "Dashboard not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const remove = useMutation(
    trpc.dashboard.delete.mutationOptions({
      onSuccess: () => {
        void invalidate();
        router.push(routes.home(businessId));
        toast({ title: "Dashboard deleted", tone: "warn" });
      },
      onError: (err) => toast({ title: "Could not delete", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const applyPreset = useMutation(
    trpc.dashboard.applyPreset.mutationOptions({
      onSuccess: (saved, vars) => {
        queryClient.setQueryData(trpc.dashboard.get.queryKey({ businessId, dashboardId: vars.dashboardId }), { ...saved, stored: true, editable: true });
        void invalidate();
        toast({ title: "Preset applied", description: DASHBOARD_PRESET_LIST.find((p) => p.id === vars.preset)?.name, tone: "info" });
      },
      onError: (err) => toast({ title: "Preset not applied", description: errorMessage(err), tone: "bad" }),
    }),
  );

  // --- dialogs ------------------------------------------------------------------------------------------------------
  const [renameOpen, setRenameOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const onNew = useCallback(
    (preset: DashboardPresetId) => {
      const def = DASHBOARD_PRESET_LIST.find((p) => p.id === preset);
      create.mutate({ businessId, name: nextDashboardName(list.map((d) => d.name), def?.name ?? "Dashboard"), preset });
    },
    [businessId, create, list],
  );
  const onCopyShared = useCallback(async () => {
    if (!row) return;
    try {
      const created = await create.mutateAsync({ businessId, name: nextDashboardName(list.map((d) => d.name), row.name), preset: resetPresetFor(row.preset) });
      await update.mutateAsync({ businessId, dashboardId: created.id, layout: toScreenLayout(fromGridLayout(toGridLayout(prepareLayout(row.layout, { live }).layout))) });
      void invalidate();
      router.push(routes.home(businessId, created.id));
    } catch {
      /* toasts come from the mutations */
    }
  }, [row, create, businessId, list, update, live, invalidate, router]);

  // --- chrome ---------------------------------------------------------------------------------------------------------
  const tabs = useMemo(() => dashboardTabs(list, businessId, row, viewerId), [list, businessId, row, viewerId]);
  const trailing = useMemo(
    () => (
      <div className="flex items-center gap-1" data-testid="home-toolbar">
        {editable ? (
          <Button size="sm" variant={editing ? "primary" : "ghost"} icon={Pencil} onClick={() => setEditing((e) => !e)} aria-pressed={editing} data-testid="edit-layout">
            {editing ? "Done" : "Edit"}
            <Kbd>E</Kbd>
          </Button>
        ) : actions.copy ? (
          <Button size="sm" variant="ghost" icon={Copy} onClick={() => void onCopyShared()} loading={create.isPending || update.isPending} data-testid="copy-dashboard">
            Copy to my dashboards
          </Button>
        ) : null}
        {actions.create ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" icon={Plus} data-testid="new-dashboard">
                New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Start from a preset</DropdownMenuLabel>
              {DASHBOARD_PRESET_LIST.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => onNew(p.id)} data-preset={p.id}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {row && editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={LayoutDashboard} label="Dashboard menu" size="sm" variant="ghost" data-testid="dashboard-menu" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{row.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>Rename</DropdownMenuItem>
              <DropdownMenuItem disabled={row.isActive} onSelect={() => update.mutate({ businessId, dashboardId: row.id, setActive: true }, { onSuccess: () => void invalidate() })}>
                <Star className="mr-1.5 size-3.5" aria-hidden /> Make default
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="mr-1.5 size-3.5" aria-hidden /> Share with co-founders
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" disabled={list.length <= 1} onSelect={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1.5 size-3.5" aria-hidden /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    ),
    [editable, editing, row, actions.copy, actions.create, list.length, create.isPending, onCopyShared, onNew, update, businessId, invalidate],
  );
  useShellChrome({ title: "Home", tabs: tabs.length ? { tabs, activeId: row?.id ?? dashboardId ?? "", onChange: (id) => router.push(routes.home(businessId, id)), trailing, "aria-label": "Dashboards" } : undefined }, [tabs, row?.id, dashboardId, trailing]);

  if (loadFailed(listQ)) return <ErrorPanel title="Home" message={errorMessage(listQ.error)} onRetry={() => void listQ.refetch()} />;
  if (loadFailed(dashboardQ) && isMissing(dashboardQ.error)) {
    return (
      <NotFoundPanel title="Home" heading="No such dashboard" back={{ label: "Open your Home", href: routes.home(businessId) }}>
        This dashboard was deleted, or the link points to one you cannot open.
      </NotFoundPanel>
    );
  }
  if (loadFailed(dashboardQ)) return <ErrorPanel title="Home" message={errorMessage(dashboardQ.error)} onRetry={() => void dashboardQ.refetch()} />;
  if (!row) return <ScreenSkeleton />;

  return (
    <div className="flex min-h-full flex-col gap-gutter p-gutter" data-testid="home-screen" data-dashboard-id={row.id} data-dashboard-version={row.version} data-editing={editing || undefined}>
      {refreshFailed(listQ) || refreshFailed(dashboardQ) ? <RefreshFailedNotice query={refreshFailed(dashboardQ) ? dashboardQ : listQ} className="flex items-center gap-2" /> : null}
      <HomeFoundations />
      <HomeAutopilot />
      <DayOne businessId={businessId} currency={currency} />
      <DashboardGrid
        key={row.id}
        businessId={businessId}
        row={row}
        live={live}
        editable={editable}
        editing={editing}
        onEditingChange={setEditing}
        onApplyPreset={(preset) => applyPreset.mutate({ businessId, dashboardId: row.id, preset })}
        onReset={() => applyPreset.mutate({ businessId, dashboardId: row.id, preset: resetPresetFor(row.preset) })}
        save={(layout) => update.mutateAsync({ businessId, dashboardId: row.id, layout })}
        onConflict={() => {
          toast({ title: "Layout updated elsewhere", description: "Another tab or device saved this dashboard first; showing the latest version.", tone: "warn" });
          void dashboardQ.refetch();
        }}
      />
      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} name={row.name} onSave={(name) => update.mutate({ businessId, dashboardId: row.id, name }, { onSuccess: () => void invalidate() })} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} href={shareHref(typeof window === "undefined" ? "" : window.location.origin, businessId, row.id)} name={row.name} />
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete “{row.name}”?</DialogTitle>
            <DialogDescription>The layout is archived; widgets keep their data. Co-founders who copied it keep their copies.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Keep
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ businessId, dashboardId: row.id }, { onSuccess: () => setDeleteOpen(false) })} data-testid="confirm-delete-dashboard">
              Delete dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Grid with debounced, versioned persistence ---------- */

interface DashboardGridProps {
  businessId: string;
  row: DashboardRow;
  live: boolean;
  editable: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onApplyPreset: (preset: DashboardPresetId) => void;
  onReset: () => void;
  save: (layout: ReturnType<typeof toScreenLayout>) => Promise<Pick<DashboardRow, "version">>;
  onConflict: () => void;
}

function DashboardGrid({ businessId, row, live, editable, editing, onEditingChange, onApplyPreset, onReset, save, onConflict }: DashboardGridProps) {
  const registry = useMemo(() => gridRegistry("home", businessId, live), [businessId, live]);
  const departmentCount = useBusiness().departments.length;
  const presets = useMemo(() => gridPresets(departmentCount), [departmentCount]);
  const prepared = useMemo(() => prepareLayout(row.layout, { live }), [row.layout, live]);
  const [layout, setLayout] = useState<WidgetLayout>(() => toGridLayout(prepared.layout));
  const known = useRef(row.version);
  const saving = useRef(false);

  // The layout the server holds, or will hold once the save in flight lands: an edit that leaves the grid exactly there
  // (or a re-report of it) saves nothing.
  const serverLayout = useRef<WidgetLayout | null>(layout);

  // Server copy changed (a preset, a reset, or another device): adopt it unless we are mid-save.
  useEffect(() => {
    if (editedElsewhere(known.current, row.version, saving.current)) {
      known.current = row.version;
      serverLayout.current = toGridLayout(prepared.layout);
      setLayout(serverLayout.current);
    } else if (row.version === known.current && !saving.current) {
      serverLayout.current = toGridLayout(prepared.layout);
      setLayout(serverLayout.current);
    }
  }, [row.version, prepared.layout]);

  const editingRef = useRef(editable && editing);
  useEffect(() => {
    editingRef.current = editable && editing;
  }, [editable, editing]);
  const pending = useRef<WidgetLayout | null>(null);
  const timer = useRef<number | null>(null);
  const flush = useCallback(async () => {
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    saving.current = true;
    serverLayout.current = next;
    try {
      const saved = await save(toScreenLayout(fromGridLayout(next)));
      if (versionConflict(known.current, saved.version)) {
        known.current = saved.version;
        onConflict();
      } else known.current = saved.version;
    } catch {
      // Not saved (the mutation toasts): the next edit saves whatever is on screen.
      serverLayout.current = null;
    } finally {
      saving.current = false;
    }
  }, [save, onConflict]);
  const persist = useCallback(
    (next: WidgetLayout) => {
      setLayout(next);
      // Only the founder's own edits save. Outside Edit mode the grid only re-reports the layout it was given (its first
      // measure, a compaction): saving that wrote whatever row it was seeded with, a stale one included, back to the
      // server as a new version (audit WEB-09).
      if (!editingRef.current) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      if (serverLayout.current && sameLayout(next, serverLayout.current)) {
        pending.current = null;
        return;
      }
      pending.current = next;
      timer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (layout.length === 0 && !editing) {
    return (
      <Panel title={row.name} span={12}>
        <EmptyState icon={LayoutDashboard} title="An empty dashboard" action={editable ? { label: "Add widgets", icon: Pencil, onClick: () => onEditingChange(true) } : undefined}>
          {editable ? "Press E or Edit to add the Journey Ribbon, department cards, the team pulse and more; the layout saves as you go." : "This shared dashboard has no widgets yet."}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <WidgetGrid
      layout={layout}
      registry={registry}
      onChange={persist}
      editing={editable && editing}
      onEditingChange={onEditingChange}
      hideToolbar={!editing}
      presets={presets}
      onApplyPreset={(p: WidgetPreset) => onApplyPreset(p.id as DashboardPresetId)}
      defaultLayout={toGridLayout(prepared.layout)}
      onReset={onReset}
      aria-label="Home widgets"
      data-testid="home-grid"
    />
  );
}

/* ---------- Foundations ---------- */

/**
 * The vision, specification and roadmap a new business drafts on its first open (BUILD §11.1, §11.5): drafting (the
 * vision, the sections and the roadmap items as they are written, audit P3), failed with Try again, or just ready with
 * the way to the Vision tab. Nothing once they are settled, or for a business that has none (committed before
 * foundations existed, or seeded). Ready brings the Product lead's note to the Inbox.
 */
function HomeFoundations() {
  const queryClient = useQueryClient();
  const foundations = useFoundations(() => void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("inbox") as unknown[] }));
  return <FoundationsBanner foundations={foundations} showReady detail={{ vision: true, roadmap: true }} />;
}

/* ---------- Day one ---------- */

function DayOne({ businessId, currency }: { businessId: string; currency: string }) {
  const trpc = useTRPC();
  const glossary = useBusiness().data.business.glossary;
  const inputs = useMemo(() => shellQueryInputs(businessId), [businessId]);
  // The last 30 days, slim: the same query as the status strip and the department cards (one request for all of them).
  // In the business time zone (audit #196), so the key is the one the widgets ask for.
  const ribbon = useQuery(trpc.journey.ribbon.queryOptions({ businessId, ...recentRibbonInput(useToday()) }, { staleTime: 60_000, retry: false }));
  // The shell's own cycle and inbox reads (same keys, so no extra request): commit already starts cycle 1, and the
  // opening Board decision blocks Continue, so the copy says what is actually true (audit FR-19, IAE-19, OL-23).
  const cycleQ = useQuery(trpc.cycle.status.queryOptions(inputs.cycle, { staleTime: 10_000, retry: false }));
  const inboxQ = useQuery(trpc.inbox.list.queryOptions(inputs.inbox, { staleTime: 10_000 }));
  const dayOne = ribbon.data && cycleQ.data ? isDayOne({ conversions: ribbon.data.conversionCount, milestones: ribbon.data.milestones.length, cyclesCompleted: cycleQ.data.completedCount }) : false;
  const cards = useMemo(() => ghostedMilestones(currency), [currency]);
  if (!dayOne || !cycleQ.data) return null;
  const line = dayOneLine({ running: cycleQ.data.running, cycleNumber: cycleQ.data.cycleNumber ?? null, blocking: inboxQ.data?.blocking ?? 0 });
  return (
    <Panel title="Day one" span={12} data-testid="day-one" footer={<span>Milestones light up as customers and revenue arrive; department cards show the staffed team and its first tasks.</span>}>
      <div className="flex flex-col gap-3">
        <p className="text-body text-secondary" data-testid="day-one-line">
          <Trophy className="mr-1 inline size-3.5 text-gold" aria-hidden />
          {line}
        </p>
        <TrophyCabinet trophies={cards} columns={4} />
      </div>
    </Panel>
  );
}

/* ---------- Dialogs ---------- */

function RenameDialog({ open, onOpenChange, name, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);
  const trimmed = value.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Rename dashboard</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor="dashboard-name" label="Name">
            <Input id="dashboard-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} autoFocus data-testid="dashboard-name" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!trimmed || trimmed === name}
            onClick={() => {
              onSave(trimmed);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ open, onOpenChange, href, name }: { open: boolean; onOpenChange: (o: boolean) => void; href: string; name: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      toast({ title: "Link copied", tone: "good" });
    } catch {
      toast({ title: "Select the link and copy it", tone: "info" });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share “{name}” with co-founders</DialogTitle>
          <DialogDescription>Every member of this business can open the link, see the layout read-only and copy it to their own dashboards. Widgets always show the viewer&apos;s own permissions.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor="share-link" label="Link">
            <Input id="share-link" readOnly value={href} icon={Link2} mono onFocus={(e) => e.currentTarget.select()} data-testid="share-link" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="primary" icon={Copy} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
