"use client";
/**
 * A department tab (BUILD §6.1, §11.13): loads `screen.get`, shows the department's tabs in the TabBar and renders
 * either a module full-screen widget (`module:<key>/<tab>` through @foundmill/modules `getModuleScreen`) or a
 * WidgetGrid of gallery widgets (@foundmill/widgets) with Edit mode on `E`, persisted through `screen.update`.
 * Module packs load on demand (`useModulePacks`): only the current tab's module gates the screen, and the department's
 * other modules are fetched alongside, so a department tab never downloads the other departments' screens. A widget
 * layout (WidgetScreen: the gallery widgets and the grid) is its own chunk too, loaded only by tabs that have one.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, House, LayoutGrid, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, EmptyState, Kbd, Panel, useToast, type TabItem } from "@foundmill/dugout";
import { useModulePacks } from "@foundmill/modules/lazy";
import { getModuleScreen, type ModuleScreen } from "@foundmill/modules/registry";
import type { ModuleKey } from "@foundmill/shared";
import { MODULE_KEYS } from "@foundmill/shared/constants";
import { routes } from "@foundmill/widgets/shared/routes";
import { usePageShortcuts } from "@/lib/keys";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

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

export function DepartmentScreen({ deptSlug, tabSlug, subView }: DepartmentScreenProps) {
  const { businessId, departmentBySlug, data } = useBusiness();
  const department = departmentBySlug(deptSlug);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const live = data.business.gameMode === "live";

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

  // Tabs for the shell's TabBar, with the module screen's sub-views in the caret menu.
  const tabs = useMemo<TabItem[]>(() => {
    if (!department) return [];
    const rows = (screenQ.data?.tabs ?? department.tabs).slice().sort((a, b) => a.position - b.position);
    return rows.map((t) => {
      const slug = "slug" in t ? t.slug : (t as { tabSlug: string }).tabSlug;
      const href = routes.department(businessId, department.slug, slug);
      const screen = slug === tabSlug ? moduleScreen : null;
      return { id: slug, label: t.title, href, subViews: screen?.subViews?.map((v) => ({ id: v.slug, label: v.title, href: `${href}?view=${v.slug}` })) };
    });
  }, [department, screenQ.data?.tabs, businessId, tabSlug, moduleScreen]);

  // --- Edit mode (E) for widget layouts ---------------------------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const editable = Boolean(screenRow) && !moduleScreen && !modulePending;
  usePageShortcuts({ onEditLayout: editable ? () => setEditing((e) => !e) : undefined, onEscape: editing ? () => setEditing(false) : undefined });

  useShellChrome(
    {
      title: department?.name ?? "Department",
      tabs: tabs.length ? { tabs, activeId: tabSlug, activeSubViewId: subView, onChange: (id, sub) => router.push(sub ? `${routes.department(businessId, deptSlug, id)}?view=${sub}` : routes.department(businessId, deptSlug, id)), trailing: editable ? <EditToggle editing={editing} onToggle={() => setEditing((e) => !e)} /> : undefined } : undefined,
    },
    [department?.name, tabs, tabSlug, subView, editable, editing],
  );

  if (!department) {
    return (
      <div className="p-gutter">
        <Panel title="Department" span={12}>
          <EmptyState icon={LayoutGrid} title="No such department" action={{ label: "Go to Home", icon: House, onClick: () => router.push(routes.home(businessId)) }}>
            Nothing is called “{deptSlug}” in this business.
          </EmptyState>
        </Panel>
      </div>
    );
  }
  if (screenQ.error) return <ErrorPanel title={department.name} message={errorMessage(screenQ.error)} onRetry={() => void screenQ.refetch()} />;
  if (!screenQ.data) return <ScreenSkeleton />;
  if (!screenRow) {
    return (
      <div className="p-gutter">
        <Panel title={department.name} span={12}>
          <EmptyState icon={LayoutGrid} title="No such tab" action={tabs[0] ? { label: `Open ${tabs[0].label}`, icon: ArrowRight, onClick: () => router.push(tabs[0]!.href!) } : undefined}>
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
    return (
      // Each module screen pads itself (its own Screen wrapper, p-gutter), so the content gutter is 16 px as on Home.
      <div className="min-h-full" data-testid="module-screen" data-module={`${moduleScreen.moduleKey}/${moduleScreen.tabSlug}`}>
        <Component businessId={businessId} departmentId={department.id} subView={subView} />
      </div>
    );
  }

  return (
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
  );
}

function EditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <Button size="sm" variant={editing ? "primary" : "ghost"} icon={Pencil} onClick={onToggle} aria-pressed={editing} data-testid="edit-layout">
      {editing ? "Done" : "Edit"}
      <Kbd>E</Kbd>
    </Button>
  );
}
