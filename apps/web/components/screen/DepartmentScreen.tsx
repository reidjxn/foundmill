"use client";
/**
 * A department tab (BUILD §6.1, §11.13): loads `screen.get`, shows its founder area's tabs in the TabBar (every
 * department's tabs of that area, defaults inline and the rest behind "More detail"; docs/DESIGN.md §9; a department
 * with no modules shows its own), breadcrumbs "<Area> › <department>", and renders
 * either a module full-screen widget (`module:<key>/<tab>` through @foundmill/modules `getModuleScreen`) or a
 * WidgetGrid of gallery widgets (@foundmill/widgets) with Edit mode on `E`, persisted through `screen.update`.
 * Module packs load on demand (`useModulePacks`): only the current tab's module gates the screen, and the department's
 * other modules are fetched alongside, so a department tab never downloads the other departments' screens. A widget
 * layout (WidgetScreen: the gallery widgets and the grid) is its own chunk too, loaded only by tabs that have one.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, House, LayoutGrid, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Explainer, Kbd, Panel, isViewportTooSmall, useGuided, useToast, useViewportWidth, type TabItem } from "@foundmill/dugout";
import { LinkButton } from "@/components/new/LinkButton";
import { worksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { useModulePacks } from "@foundmill/modules/lazy";
import { getModuleScreen, type ModuleScreen } from "@foundmill/modules/registry";
import type { ModuleKey } from "@foundmill/shared";
import { MODULE_KEYS, isBuilderOnlyTab, visibleTabs } from "@foundmill/shared/constants";
import { AREA_LABELS } from "@foundmill/shared/areas";
import { AreaOpening } from "@foundmill/modules/areas";
import { EXPLAINERS, HOST_MOUNTED } from "@foundmill/modules/explainers";
import { areaBreadcrumbs, areaOfRoute, areaOpeningOf, areaTabId, areaTabItems } from "@/lib/areas";
import { useAreaNav } from "@/components/shell/useAreaNav";
import { moduleHref } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { usePageShortcuts } from "@/lib/keys";
import { NO_ACCESS_PREFIX, errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { canOpenDepartment, type Access } from "@/lib/access";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { useBuilderViewPreference } from "@/components/providers/guidance-context";
import { BuilderGate } from "./BuilderGate";
import { DepartmentTour } from "./DepartmentTour";

const WidgetScreen = dynamic(() => import("./WidgetScreen").then((m) => m.WidgetScreen), { loading: () => <ScreenSkeleton /> });

export interface DepartmentScreenProps {
  deptSlug: string;
  tabSlug: string;
  subView?: string;
}

export const MODULE_WIDGET_PREFIX = "module:";

/** `module:<moduleKey>/<tabSlug>` → the module screen, or null for anything else. */
export function parseModuleWidgetKey(key: string): { moduleKey: ModuleKey; tabSlug: string } | null {
  if (!key.startsWith(MODULE_WIDGET_PREFIX)) return null;
  const [moduleKey, tabSlug] = key.slice(MODULE_WIDGET_PREFIX.length).split("/");
  if (!moduleKey || !tabSlug || !(MODULE_KEYS as readonly string[]).includes(moduleKey)) return null;
  return { moduleKey: moduleKey as ModuleKey, tabSlug };
}

/** The module a layout would render full-screen (its only widget is `module:<key>/<tab>`), or null. */
export function moduleKeyFor(layout: { widgets: readonly { key: string }[] } | null | undefined): ModuleKey | null {
  if (!layout || layout.widgets.length !== 1) return null;
  return parseModuleWidgetKey(layout.widgets[0]!.key)?.moduleKey ?? null;
}

/** A layout whose only widget is a module screen renders that module full-screen (once its pack has loaded). */
export function moduleScreenFor(layout: { widgets: readonly { key: string }[] } | null | undefined): ModuleScreen | null {
  if (!layout || layout.widgets.length !== 1) return null;
  const parsed = parseModuleWidgetKey(layout.widgets[0]!.key);
  return parsed ? (getModuleScreen(parsed.moduleKey, parsed.tabSlug) ?? null) : null;
}

const isModuleKey = (key: string): key is ModuleKey => (MODULE_KEYS as readonly string[]).includes(key);

/**
 * Where a link to a department slug that no longer exists should go when the slug names a module ("legal", "finance"):
 * the department that holds that module now (after a merge, a split or an archive), at the same tab when it has one.
 * Null when the slug is not a module key or no department holds the module.
 */
export function relocatedModuleHref(businessId: string, departments: Parameters<typeof moduleHref>[1], deptSlug: string, tabSlug: string): string | null {
  return isModuleKey(deptSlug) ? moduleHref(businessId, departments, deptSlug, tabSlug) : null;
}

/**
 * Whether the widget-layout editor (the Edit toggle and its E shortcut) is offered: a widget layout (not a module
 * screen, loaded or loading) and a person who may change things. Viewers, advisors and example viewers never get it,
 * since `screen.update` is a write the server refuses for them.
 */
export function canEditLayout(state: { hasScreen: boolean; isModuleScreen: boolean; modulePending: boolean; access: Pick<Access, "canChange"> }): boolean {
  return state.hasScreen && !state.isModuleScreen && !state.modulePending && state.access.canChange;
}

export function DepartmentScreen({ deptSlug, tabSlug, subView }: DepartmentScreenProps) {
  const { businessId, departmentBySlug, departments, data, access } = useBusiness();
  const department = departmentBySlug(deptSlug);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  // An old link (or a bookmark) to a module's original department after it was merged or split: follow the module.
  const relocated = department ? null : relocatedModuleHref(businessId, departments, deptSlug, tabSlug);
  useEffect(() => {
    if (relocated) router.replace(`${relocated}${typeof window === "undefined" ? "" : window.location.search}`);
  }, [relocated, router]);
  const { toast } = useToast();
  const live = data.business.gameMode === "live";
  const builder = useBuilderViewPreference().on;

  const screenQ = useQuery(trpc.screen.get.queryOptions({ businessId, departmentId: department?.id ?? businessId, tabSlug }, { enabled: Boolean(department), staleTime: 30_000 }));
  const screenRow = screenQ.data?.screen ?? null;
  const layoutForModule = screenRow?.layout as { widgets: { key: string }[] } | undefined;
  // The current tab's module pack gates the screen; the department's other modules load alongside (also while
  // `screen.get` is in flight, so the chunk and the data arrive together).
  const tabModule = moduleKeyFor(layoutForModule);
  const neededPacks = useMemo(() => (tabModule ? [tabModule] : []), [tabModule]);
  const departmentPacks = useMemo(() => (department?.moduleKeys ?? []).filter(isModuleKey), [department?.moduleKeys]);
  const packs = useModulePacks(neededPacks, departmentPacks);
  const modulePending = Boolean(tabModule) && !packs.ready;
  const moduleScreen = useMemo(() => (packs.ready ? moduleScreenFor(layoutForModule) : null), [layoutForModule, packs.ready]);

  // The founder area this tab belongs to (by its module, docs/DESIGN.md §9): its tab bar spans every department in the
  // area. A department with no modules keeps its own tab bar, and so does one the area does not list (hidden, opened by
  // its URL).
  const area = areaOfRoute(department, tabSlug);
  const nav = useAreaNav();
  const areaTabs = area ? nav.get(area) : undefined;
  const inArea = Boolean(department && areaTabs?.some((t) => t.department?.id === department.id));
  const activeTabId = inArea ? areaTabId(deptSlug, tabSlug) : tabSlug;

  // Tabs for the shell's TabBar, with the module screen's sub-views in the caret menu.
  const tabs = useMemo<TabItem[]>(() => {
    if (!department) return [];
    const withViews = (t: TabItem): TabItem => (t.id === activeTabId && moduleScreen?.subViews && t.href ? { ...t, subViews: moduleScreen.subViews.map((v) => ({ id: v.slug, label: v.title, href: `${t.href}?view=${v.slug}` })) } : t);
    if (inArea) return areaTabItems(businessId, areaTabs ?? []).map(withViews);
    const rows = (screenQ.data?.tabs ?? department.tabs).map((t) => ({ slug: "slug" in t ? t.slug : (t as { tabSlug: string }).tabSlug, title: t.title, position: t.position }));
    // Builder view's tabs are not offered while it is off, and engine tabs carry the founder's names (shared registry).
    return visibleTabs({ moduleKeys: department.moduleKeys, tabs: rows }, builder).map((t) => withViews({ id: t.slug, label: t.title, href: routes.department(businessId, department.slug, t.slug) }));
  }, [department, inArea, areaTabs, activeTabId, screenQ.data?.tabs, businessId, moduleScreen, builder]);
  // Where "Open …" sends someone from a gate or a missing tab: this department's first inline tab.
  const ownTabs = tabs.filter((t) => !inArea || t.id.startsWith(`${deptSlug}/`));
  const firstTab = ownTabs.find((t) => t.tier !== "detail") ?? ownTabs[0] ?? tabs[0];
  const breadcrumbs = area && department ? areaBreadcrumbs(businessId, area, areaTabs ?? [], department.name) : undefined;
  // The area's opening line, first on every tab of the area (docs/DESIGN.md §9 "Opening line"); a department with no
  // modules (no area) has none. The kind line names the department when its name is not the area's.
  const openingOf = areaOpeningOf(department, tabSlug, area, inArea);
  const opening = openingOf ? <AreaOpening {...openingOf} className="px-gutter pt-gutter" /> : null;

  // A department tab that works from 390 px (Product › Public page, WP-04 T6) in the shell's phone layout: no tab bar,
  // since every other tab asks for a larger window; the tab's own name as the title; and a way back to Today.
  const pathname = usePathname();
  const phone = isViewportTooSmall(useViewportWidth()) && worksOnSmallScreens(pathname);
  const phoneTitle = tabs.find((t) => t.id === activeTabId)?.label;

  // --- Edit mode (E) for widget layouts ---------------------------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const editable = canEditLayout({ hasScreen: Boolean(screenRow), isModuleScreen: Boolean(moduleScreen), modulePending, access });
  usePageShortcuts({ onEditLayout: editable ? () => setEditing((e) => !e) : undefined, onEscape: editing ? () => setEditing(false) : undefined });

  useShellChrome(
    {
      title: (phone ? phoneTitle : undefined) ?? department?.name ?? "Department",
      breadcrumbs,
      tabs: tabs.length && !phone
        ? {
            tabs,
            activeId: activeTabId,
            activeSubViewId: subView,
            "aria-label": inArea && area ? `${AREA_LABELS[area]} tabs` : undefined,
            onChange: (id, sub) => {
              const href = tabs.find((t) => t.id === id)?.href;
              if (href) router.push(sub ? `${href}?view=${sub}` : href);
            },
            trailing: editable ? <EditToggle editing={editing} onToggle={() => setEditing((e) => !e)} /> : undefined,
          }
        : undefined,
    },
    [department?.name, area, breadcrumbs?.[0]?.href, tabs, activeTabId, subView, editable, editing, phone, phoneTitle],
  );

  if (!department) {
    if (relocated) return <ScreenSkeleton />;
    return (
      <div className="p-gutter">
        <Panel title="Department" span={12}>
          <EmptyState icon={LayoutGrid} title="No such department" action={{ label: "Go to Today", icon: House, onClick: () => router.push(routes.today(businessId)) }}>
            Nothing is called “{deptSlug}” in this business.
          </EmptyState>
        </Panel>
      </div>
    );
  }
  // A department whose every module is walled for this person is not theirs to open (the sidebar does not list it): say
  // so plainly instead of a failed load (audit RUI-05).
  if (!canOpenDepartment(access, department)) {
    return <ErrorPanel title={department.name} message={`${NO_ACCESS_PREFIX}${department.name}. Ask an owner or admin if you need it.`} />;
  }
  // A Builder view tab opened by URL (a bookmark, a shared link) while the switch is off: say what it is and offer both
  // ways on. Until the account's answer arrives, a skeleton, so the gate never flashes for someone who has it on.
  if (!builder && isBuilderOnlyTab(department.moduleKeys, tabSlug)) {
    const first = firstTab;
    return <BuilderGate title={department.name} open={first?.href ? { label: String(first.label), href: first.href } : null} />;
  }
  // A failed refetch keeps the loaded screen (with a quiet notice); only a first load that failed shows the panel.
  if (loadFailed(screenQ)) return <ErrorPanel title={department.name} message={errorMessage(screenQ.error)} onRetry={() => void screenQ.refetch()} />;
  if (!screenQ.data) return <ScreenSkeleton />;
  const stale = refreshFailed(screenQ) ? <RefreshFailedNotice query={screenQ} /> : null;
  if (!screenRow) {
    return (
      <div className="p-gutter">
        <Panel title={department.name} span={12}>
          <EmptyState icon={LayoutGrid} title="No such tab" action={firstTab ? { label: `Open ${firstTab.label}`, icon: ArrowRight, onClick: () => router.push(firstTab.href!) } : undefined}>
            “{tabSlug}” is not a tab of {department.name}.
          </EmptyState>
        </Panel>
      </div>
    );
  }

  if (modulePending) {
    return packs.error ? <ErrorPanel title={department.name} message="This screen did not load. Check your connection and try again." onRetry={packs.retry} /> : <ScreenSkeleton />;
  }

  if (moduleScreen) {
    const Component = moduleScreen.Component;
    const explainerKey = (HOST_MOUNTED as readonly string[]).find((k) => k === `${moduleScreen.moduleKey}/${moduleScreen.tabSlug}`);
    return (
      // Each module screen pads itself (its own Screen wrapper, p-gutter), so the content gutter is 16 px as on Home.
      <div className="min-h-full" data-testid="module-screen" data-module={`${moduleScreen.moduleKey}/${moduleScreen.tabSlug}`}>
        {phone ? (
          <div className="px-gutter pt-gutter">
            <LinkButton variant="ghost" size="lg" href={routes.today(businessId)} icon={ArrowLeft} className="min-h-tap" data-testid="phone-back-to-today">
              Back to Today
            </LinkButton>
          </div>
        ) : null}
        {opening}
        {stale}
        {/* "Explain this page" for the tabs whose screens carry none of their own (WP-10 T3); the shell draws it. */}
        {explainerKey ? <Explainer {...EXPLAINERS[explainerKey]!} /> : null}
        <Component businessId={businessId} departmentId={department.id} subView={subView} />
        {/* The first-visit tour (once per account, guidance on), on whichever department tab is opened first; its
            callouts point at the tab bar, which a phone does not draw. */}
        {phone ? null : <DepartmentTour />}
      </div>
    );
  }

  return (
    <>
      {opening}
      {stale}
      <DepartmentTour />
      <WidgetScreen
        businessId={businessId}
        screenId={screenRow.id}
        rawLayout={screenRow.layout}
        live={live}
        editing={editing}
        onEditingChange={setEditing}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("screen") as unknown[] })}
        onError={(message) => toast({ title: "Layout not saved", description: message, tone: "bad" })}
      />
    </>
  );
}

/** The Edit/Done toggle; its E key cap shows only with guidance off (DESIGN §5.9, §7.7), as on Home. */
export function EditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  const guided = useGuided();
  return (
    <Button size="sm" variant={editing ? "primary" : "ghost"} icon={Pencil} onClick={onToggle} aria-pressed={editing} aria-keyshortcuts="E" data-testid="edit-layout">
      {editing ? "Done" : "Edit"}
      {guided ? null : <Kbd>E</Kbd>}
    </Button>
  );
}
