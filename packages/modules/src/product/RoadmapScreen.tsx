"use client";
/**
 * Product › Roadmap (BUILD §11.5): the Now / Next / Later board with drag between columns, the timeline view, items
 * linked to spec blocks and tasks, and a status that is computed from tasks and acceptance criteria (AC-11.5.4).
 * Sub-views `board` and `timeline` come from the tab's caret dropdown; `?item=<id>` opens an item.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Columns3, Map as MapIcon, Plus } from "lucide-react";
import { Button, Panel, StatusPill, cn } from "@foundmill/dugout";
import type { RoadmapHorizon } from "@foundmill/shared";
import { moduleHref, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { usePinToHomeMenu } from "@foundmill/widgets/shared/pin";
import type { ModuleScreenProps } from "../registry";
import { useCanWrite } from "../env";
import { FoundationsBanner, useFoundations } from "./foundations";
import { computeRoadmapStatus, type RoadmapStatus } from "./roadmap-status";
import { SignoffBanner, useSignoffs } from "./signoff";
import { groupByHorizon, indexDependencies, isMove, moveInput } from "./roadmap/board";
import { Board } from "./roadmap/Board";
import { ItemDialog } from "./roadmap/ItemDialog";
import { Timeline } from "./roadmap/Timeline";
import { Fact, InlineError, Screen, useAction } from "./shared";
import type { RoadmapResponse, RoadmapRow, SpecGetResponse } from "./types";

export const ROADMAP_SUB_VIEWS = [
  { slug: "board", title: "Board" },
  { slug: "timeline", title: "Timeline" },
] as const;
type SubView = (typeof ROADMAP_SUB_VIEWS)[number]["slug"];

function itemFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("item");
  } catch {
    return null;
  }
}

/** Items per computed status, for the summary strip. */
export function statusCounts(items: readonly RoadmapRow[], today = new Date()): { status: RoadmapStatus; count: number }[] {
  const map = new Map<string, { status: RoadmapStatus; count: number }>();
  for (const i of items) {
    const s = computeRoadmapStatus(i, today);
    const cur = map.get(s.key);
    if (cur) cur.count += 1;
    else map.set(s.key, { status: s, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function RoadmapScreen({ businessId, subView }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const roadmap = useWidgetQuery<RoadmapResponse>("product.roadmap.list", {});
  // Pin to Home (audit #394): the roadmap is the gallery's Roadmap widget.
  const pinMenu = usePinToHomeMenu({ key: "roadmap_timeline" });
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const departments = useDepartments();
  const action = useAction();
  const [view, setView] = useState<SubView>(subView === "timeline" ? "timeline" : "board");
  const [dialog, setDialog] = useState<{ open: boolean; item: RoadmapRow | null; horizon?: RoadmapHorizon }>({ open: false, item: null });
  const [pendingItemId, setPendingItemId] = useState<string | null>(() => itemFromLocation());

  useEffect(() => {
    if (subView === "timeline" || subView === "board") setView(subView);
  }, [subView]);
  useBusinessEvents(() => roadmap.refetch(), ["task.completed", "pr.merged", "spec.version_published", "spec.proposal_created"]);
  // The first roadmap is drafted on the first open; show the drafting and load the items when they are ready.
  const foundations = useFoundations(() => {
    roadmap.refetch();
    spec.refetch();
  });
  // The founder's sign-off of the roadmap (founder, 2026-10-18): approving it starts the first build.
  const signoffs = useSignoffs();
  const canWrite = useCanWrite("product");

  const items = useMemo(() => roadmap.data?.items ?? [], [roadmap.data]);
  const columns = useMemo(() => groupByHorizon(items), [items]);
  const dependencies = useMemo(() => indexDependencies(roadmap.data?.dependencies), [roadmap.data]);
  const counts = useMemo(() => statusCounts(items), [items]);
  const blocks = spec.data?.blocks ?? [];

  // Deep link: open the item named in the URL once the list has loaded.
  useEffect(() => {
    if (!pendingItemId || !roadmap.data) return;
    const item = items.find((i) => i.id === pendingItemId);
    setPendingItemId(null);
    if (item) setDialog({ open: true, item });
  }, [pendingItemId, roadmap.data, items]);

  const href = (moduleKey: "product" | "development", tab: string, query?: string) => `${moduleHref(businessId, departments.data, moduleKey, tab) ?? routes.department(businessId, moduleKey, tab)}${query ?? ""}`;
  const openBlock = useCallback((blockId: string) => navigate(href("product", "specification", `?block=${blockId}`)), [navigate, departments.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const openTasks = (item: RoadmapRow) => navigate(href("development", "plan", `?item=${item.id}`));
  // `index` is the place among the target column's other items, so a move inside a column reorders it.
  const move = async (item: RoadmapRow, horizon: RoadmapHorizon, index: number) => {
    if (!isMove(columns, item, horizon, index)) return;
    await action.run("product.roadmap.move", moveInput(item, horizon, index), { key: `move:${item.id}`, then: () => roadmap.refetch() });
  };
  const movingId = action.pending?.startsWith("move:") ? action.pending.slice(5) : null;
  const empty = roadmap.data && items.length === 0;

  return (
    <Screen name="product/roadmap">
      <FoundationsBanner foundations={foundations} detail={{ roadmap: true }} />
      <SignoffBanner kind="roadmap" signoffs={signoffs} canWrite={canWrite} onDecided={() => roadmap.refetch()} />
      <Panel
        title="Roadmap"
        menu={pinMenu}
        span={12}
        loading={roadmap.isLoading}
        error={roadmap.error ? roadmap.error.message : undefined}
        onRetry={roadmap.refetch}
        empty={empty ? { icon: MapIcon, title: "Nothing on the roadmap yet", children: "Items appear when the Product lead turns the spec into Now, Next and Later, or when you add one.", action: { label: "New item", icon: Plus, onClick: () => setDialog({ open: true, item: null, horizon: "now" }) } } : undefined}
        actions={
          <>
            <div role="tablist" aria-label="Roadmap view" className="flex items-center gap-0.5 rounded-panel bg-base p-0.5">
              {ROADMAP_SUB_VIEWS.map((v) => (
                <button
                  key={v.slug}
                  type="button"
                  role="tab"
                  aria-selected={view === v.slug}
                  onClick={() => setView(v.slug)}
                  className={cn("inline-flex h-6 items-center gap-1 rounded-chip px-2 text-tab transition-colors duration-micro ease-dugout focus-visible:outline-2 focus-visible:outline-link", view === v.slug ? "bg-panel-alt text-primary" : "text-secondary hover:text-primary")}
                >
                  {v.slug === "board" ? <Columns3 size={12} aria-hidden /> : <CalendarRange size={12} aria-hidden />}
                  {v.title}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setDialog({ open: true, item: null, horizon: "now" })}>
              New item
            </Button>
          </>
        }
        footer={
          <>
            <span className="tabular-nums">{items.length} {items.length === 1 ? "item" : "items"} · drag a card, or press Alt+← / Alt+→ to change column and Alt+↑ / Alt+↓ to reorder · status flips to Done only when linked acceptance criteria pass</span>
            <span className="flex-1" />
            <InlineError error={action.error} />
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Roadmap summary">
          {counts.map(({ status, count }) => (
            <StatusPill key={status.key} tone={status.tone} icon={status.icon}>
              {status.word} <span className="tabular-nums">{count}</span>
            </StatusPill>
          ))}
          <span className="flex-1" />
          <div className="flex gap-4">
            <Fact label="Now" numeric>
              {columns.now.length}
            </Fact>
            <Fact label="Next" numeric>
              {columns.next.length}
            </Fact>
            <Fact label="Later" numeric>
              {columns.later.length}
            </Fact>
          </div>
        </div>
        {view === "board" ? (
          <Board columns={columns} blocks={blocks} dependencies={dependencies} movingId={movingId} onMove={(item, h, pos) => void move(item, h, pos)} onEdit={(item) => setDialog({ open: true, item })} onOpenBlock={openBlock} onOpenTasks={openTasks} />
        ) : (
          <Timeline items={items} onOpen={(item) => setDialog({ open: true, item })} />
        )}
      </Panel>
      <ItemDialog open={dialog.open} item={dialog.item} horizon={dialog.horizon} blocks={blocks} onClose={() => setDialog((d) => ({ ...d, open: false }))} onSaved={() => roadmap.refetch()} />
    </Screen>
  );
}
