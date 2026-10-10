"use client";
/**
 * The widget grid of a department tab whose layout is gallery widgets rather than one module screen (BUILD §6.1,
 * §11.13): Edit mode on `E`, changes persisted through `screen.update` (debounced). Split from DepartmentScreen so the
 * gallery widgets, their registrations and the grid load only on tabs that show them.
 */
import { useMutation } from "@tanstack/react-query";
import { LayoutGrid, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Panel, WidgetGrid, type WidgetLayout } from "@foundmill/dugout";
import { fromGridLayout, prepareLayout, toGridLayout, toScreenLayout } from "@foundmill/widgets";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { gridRegistry } from "@/lib/widget-registry";

export interface WidgetScreenProps {
  businessId: string;
  screenId: string;
  rawLayout: unknown;
  live: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

export function WidgetScreen({ businessId, screenId, rawLayout, live, editing, onEditingChange, onSaved, onError }: WidgetScreenProps) {
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
        <Panel title="Widgets" span={12}>
          <EmptyState icon={LayoutGrid} title="Nothing on this tab yet" action={{ label: "Add widgets", icon: Pencil, onClick: () => onEditingChange(true) }}>
            Pick widgets from the gallery; the layout saves as you go.
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
