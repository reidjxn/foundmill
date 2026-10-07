"use client";
/**
 * A department tab (BUILD §6.1, §11.13): loads `screen.get`, shows the department's tabs in the TabBar and renders
 * either a module full-screen widget (`module:<key>/<tab>` through @foundmill/modules `getModuleScreen`) or a
 * WidgetGrid of gallery widgets (@foundmill/widgets) with Edit mode on `E`, persisted through `screen.update`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Kbd, Panel, WidgetGrid, useToast, type TabItem, type WidgetLayout } from "@foundmill/dugout";
import { getModuleScreen, type ModuleScreen } from "@foundmill/modules";
import type { ModuleKey } from "@foundmill/shared";
import { MODULE_KEYS } from "@foundmill/shared";
import { fromGridLayout, prepareLayout, routes, toGridLayout, toScreenLayout } from "@foundmill/widgets";
import { usePageShortcuts } from "@/lib/keys";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { gridRegistry } from "@/lib/widget-registry";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

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

/** A layout whose only widget is a module screen renders that module full-screen. */
export function moduleScreenFor(layout: { widgets: readonly { key: string }[] } | null | undefined): ModuleScreen | null {
  if (!layout || layout.widgets.length !== 1) return null;
  const parsed = parseModuleWidgetKey(layout.widgets[0]!.key);
  return parsed ? (getModuleScreen(parsed.moduleKey, parsed.tabSlug) ?? null) : null;
}

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
  const moduleScreen = useMemo(() => moduleScreenFor(screenRow?.layout as { widgets: { key: string }[] } | undefined), [screenRow?.layout]);

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
  const editable = Boolean(screenRow) && !moduleScreen;
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
          <EmptyState icon={LayoutGrid} title="No such department">
            Nothing is called “{deptSlug}” in this business. Pick a department from the sidebar.
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
          <EmptyState icon={LayoutGrid} title="No such tab">
            “{tabSlug}” is not a tab of {department.name}. Pick one from the tab bar.
          </EmptyState>
        </Panel>
      </div>
    );
  }

  if (moduleScreen) {
    const Component = moduleScreen.Component;
    return (
      <div className="min-h-full p-gutter" data-testid="module-screen" data-module={`${moduleScreen.moduleKey}/${moduleScreen.tabSlug}`}>
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

interface WidgetScreenProps {
  businessId: string;
  screenId: string;
  rawLayout: unknown;
  live: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

function WidgetScreen({ businessId, screenId, rawLayout, live, editing, onEditingChange, onSaved, onError }: WidgetScreenProps) {
  const trpc = useTRPC();
  const registry = useMemo(() => gridRegistry("department", businessId, live), [businessId, live]);
  const prepared = useMemo(() => prepareLayout(rawLayout, { live }), [rawLayout, live]);
  const [layout, setLayout] = useState<WidgetLayout>(() => toGridLayout(prepared.layout));
  useEffect(() => setLayout(toGridLayout(prepared.layout)), [prepared.layout]);

  const update = useMutation(trpc.screen.update.mutationOptions({ onSuccess: onSaved, onError: (err) => onError(errorMessage(err)) }));
  const pending = useRef<WidgetLayout | null>(null);
  const timer = useRef<number | null>(null);
  const persist = useCallback(
    (next: WidgetLayout) => {
      setLayout(next);
      pending.current = next;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (!pending.current) return;
        update.mutate({ businessId, screenId, layout: toScreenLayout(fromGridLayout(pending.current)) });
        pending.current = null;
      }, 400);
    },
    [businessId, screenId, update],
  );
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  if (layout.length === 0 && !editing) {
    return (
      <div className="p-gutter">
        <Panel title="Empty screen" span={12}>
          <EmptyState icon={LayoutGrid} title="Nothing on this tab yet" action={{ label: "Add widgets", icon: Pencil, onClick: () => onEditingChange(true) }}>
            Press E or Edit to add widgets from the gallery; the layout saves as you go.
          </EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="p-gutter" data-testid="widget-screen">
      <WidgetGrid layout={layout} registry={registry} onChange={persist} editing={editing} onEditingChange={onEditingChange} hideToolbar={!editing} defaultLayout={toGridLayout(prepared.layout)} aria-label="Screen widgets" />
    </div>
  );
}
