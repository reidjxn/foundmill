"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import ReactGridLayout, {
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type LayoutItem,
  type ResizeHandleAxis,
} from "react-grid-layout";
import {
  Check,
  GripVertical,
  LayoutTemplate,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { uniqueId } from "../../lib/seed";
import { Button } from "../foundation/Button";
import { Checkbox } from "../foundation/Checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../foundation/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../foundation/DropdownMenu";
import { EmptyState } from "../foundation/EmptyState";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Input } from "../foundation/Input";
import { Label } from "../foundation/Label";
import { SimpleSelect } from "../foundation/Select";
import type {
  WidgetLayout,
  WidgetLayoutItem,
  WidgetPreset,
  WidgetRegistryEntry,
  WidgetSettingField,
} from "./types";

export const WIDGET_GRID_COLS = 12;
export const WIDGET_GRID_ROW_HEIGHT = 8;
export const WIDGET_GRID_GUTTER = 16;
const DRAG_HANDLE_CLASS = "fm-widget-drag";

/**
 * Every other root `<div>` attribute (`data-testid`, `aria-describedby`, `id`, `title`…) is forwarded so hosts can hook
 * e2e selectors onto the grid. `onChange`/`onReset` are the grid's own callbacks, not the DOM form events.
 */
export interface WidgetGridProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "onReset" | "children"> {
  layout: WidgetLayout;
  registry: readonly WidgetRegistryEntry[];
  /** Persist: called with the full layout after every move, resize, add, remove, settings change or preset. */
  onChange: (layout: WidgetLayout) => void;
  editing?: boolean;
  defaultEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  presets?: readonly WidgetPreset[];
  /** Default: `onChange(preset.layout)`. */
  onApplyPreset?: (preset: WidgetPreset) => void;
  /** "Reset" restores this layout (or calls `onReset`). */
  defaultLayout?: WidgetLayout;
  onReset?: () => void;
  /** Fixed width in px (stories, tests, SSR). Measured from the container when omitted. */
  width?: number;
  cols?: number;
  rowHeight?: number;
  gutter?: number;
  /** Hide the built-in toolbar (the shell binds `E` and shows its own Edit control). */
  hideToolbar?: boolean;
  /** Custom frame around a widget; default is a Panel-like frame with the registry title. */
  renderFrame?: (args: {
    item: WidgetLayoutItem;
    entry: WidgetRegistryEntry | undefined;
    editing: boolean;
    header: ReactNode;
    body: ReactNode;
  }) => ReactNode;
  emptyText?: string;
  className?: string;
  "aria-label"?: string;
}

/** Our layout items → RGL layout (strips widget/settings). */
export function toRglLayout(
  layout: WidgetLayout,
  registry: readonly WidgetRegistryEntry[],
): Layout {
  return layout.map((it) => {
    const entry = registry.find((e) => e.key === it.widget);
    const item: LayoutItem = {
      i: it.i,
      x: it.x,
      y: it.y,
      w: it.w,
      h: it.h,
      minW: it.minW ?? entry?.minSize?.w,
      minH: it.minH ?? entry?.minSize?.h,
      maxW: it.maxW ?? entry?.maxSize?.w,
      maxH: it.maxH ?? entry?.maxSize?.h,
      static: it.static,
    };
    return item;
  });
}

/** RGL positions merged back into our items (keeps widget keys and settings). Items RGL dropped are kept as they were. */
export function mergeRglLayout(layout: WidgetLayout, rgl: Layout): WidgetLayout {
  const byId = new Map(rgl.map((l) => [l.i, l]));
  return layout.map((it) => {
    const l = byId.get(it.i);
    return l ? { ...it, x: l.x, y: l.y, w: l.w, h: l.h } : it;
  });
}

function positionsKey(layout: WidgetLayout): string {
  return layout.map((it) => `${it.i}:${it.x},${it.y},${it.w},${it.h}`).join("|");
}

/** The first free y below everything (where a new widget goes). */
export function nextRow(layout: WidgetLayout): number {
  return layout.reduce((max, it) => Math.max(max, it.y + it.h), 0);
}

/** Add a registry widget at the bottom-left. */
export function addWidget(
  layout: WidgetLayout,
  entry: WidgetRegistryEntry,
  cols = WIDGET_GRID_COLS,
): WidgetLayout {
  const w = Math.min(cols, entry.defaultSize.w);
  const item: WidgetLayoutItem = {
    i: uniqueId(`w-${entry.key}`),
    widget: entry.key,
    x: 0,
    y: nextRow(layout),
    w,
    h: entry.defaultSize.h,
    minW: entry.minSize?.w,
    minH: entry.minSize?.h,
    settings: entry.defaultSettings ? { ...entry.defaultSettings } : undefined,
  };
  return [...layout, item];
}

/** Keyboard move/resize of one item by one unit; clamps to the grid and the item's limits. */
export function nudgeItem(
  layout: WidgetLayout,
  id: string,
  action: "left" | "right" | "up" | "down" | "wider" | "narrower" | "taller" | "shorter",
  cols = WIDGET_GRID_COLS,
): WidgetLayout {
  return layout.map((it) => {
    if (it.i !== id) return it;
    const minW = it.minW ?? 1;
    const minH = it.minH ?? 1;
    const maxW = it.maxW ?? cols;
    const maxH = it.maxH ?? Number.POSITIVE_INFINITY;
    switch (action) {
      case "left":
        return { ...it, x: Math.max(0, it.x - 1) };
      case "right":
        return { ...it, x: Math.min(cols - it.w, it.x + 1) };
      case "up":
        return { ...it, y: Math.max(0, it.y - 1) };
      case "down":
        return { ...it, y: it.y + 1 };
      case "wider":
        return { ...it, w: Math.min(maxW, cols - it.x, it.w + 1) };
      case "narrower":
        return { ...it, w: Math.max(minW, it.w - 1) };
      case "taller":
        return { ...it, h: Math.min(maxH, it.h + 1) };
      case "shorter":
        return { ...it, h: Math.max(minH, it.h - 1) };
    }
  });
}

const ResizeHandle = forwardRef<HTMLElement, { axis: ResizeHandleAxis; editing?: boolean }>(function ResizeHandle(
  { axis, editing = true },
  ref,
) {
  return (
    <span
      ref={ref as never}
      className={cn(
        `react-resizable-handle react-resizable-handle-${axis}`,
        "absolute bottom-0 right-0 z-10 flex size-6 cursor-se-resize items-end justify-end p-1.5 text-tertiary transition-colors duration-hover hover:text-kit-lift",
        // Only while editing: at rest a widget has no handles drawn on it.
        !editing && "hidden",
      )}
      aria-hidden
    >
      <span className="block size-2.5 rounded-br-xs border-b-2 border-r-2 border-current" />
    </span>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------------------------------------------------

function SettingField({
  field,
  value,
  onChange,
  id,
}: {
  field: WidgetSettingField;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
}) {
  switch (field.kind) {
    case "boolean":
      return (
        <label htmlFor={id} className="flex h-8 cursor-pointer items-center gap-2 text-body">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
          />
          {field.label}
        </label>
      );
    case "select":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          <SimpleSelect
            id={id}
            value={typeof value === "string" ? value : undefined}
            onValueChange={onChange}
            options={field.options.map((o) => ({ value: o.value, label: o.label }))}
          />
          {field.hint ? <p className="text-small text-secondary">{field.hint}</p> : null}
        </div>
      );
    case "number":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          <Input
            id={id}
            type="number"
            numeric
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          {field.hint ? <p className="text-small text-secondary">{field.hint}</p> : null}
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          <Input
            id={id}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.hint ? <p className="text-small text-secondary">{field.hint}</p> : null}
        </div>
      );
  }
}

export interface WidgetSettingsDialogProps {
  item: WidgetLayoutItem | null;
  entry: WidgetRegistryEntry | undefined;
  onClose: () => void;
  onSave: (settings: Record<string, unknown>) => void;
}

export function WidgetSettingsDialog({ item, entry, onClose, onSave }: WidgetSettingsDialogProps) {
  const id = useId();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setDraft({ ...(entry?.defaultSettings ?? {}), ...(item?.settings ?? {}) });
  }, [item, entry]);
  const fields = entry?.settings ?? [];
  return (
    <Dialog open={item !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <DialogHeader>
            <DialogTitle>{entry?.title ?? "Widget"} settings</DialogTitle>
            {entry?.description ? <DialogDescription>{entry.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {fields.length === 0 ? (
              <p className="text-body text-secondary">This widget has no settings.</p>
            ) : null}
            {fields.map((f) => (
              <SettingField
                key={f.key}
                field={f}
                id={`${id}-${f.key}`}
                value={draft[f.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              />
            ))}
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" icon={Check}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Add-widget drawer
// ---------------------------------------------------------------------------------------------------------------------

export interface AddWidgetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registry: readonly WidgetRegistryEntry[];
  layout: WidgetLayout;
  onAdd: (entry: WidgetRegistryEntry) => void;
}

/** A right-side sheet listing the widget registry (BUILD §11.2 "Widget gallery"). */
export function AddWidgetDrawer({
  open,
  onOpenChange,
  registry,
  layout,
  onAdd,
}: AddWidgetDrawerProps) {
  const [query, setQuery] = useState("");
  const entries = registry.filter(
    (e) =>
      !e.hidden &&
      (query.trim() === "" ||
        `${e.title} ${e.description ?? ""}`.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        className="left-auto right-0 top-0 h-full max-h-full w-96 translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Add widget</DialogTitle>
          <DialogDescription>
            Widgets land at the bottom of the grid; drag them into place.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          <Input
            aria-label="Search widgets"
            placeholder="Search widgets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            controlSize="sm"
          />
          <ul className="flex flex-col gap-1">
            {entries.map((e) => {
              const present = layout.some((it) => it.widget === e.key);
              const disabled = !!e.single && present;
              return (
                <li
                  key={e.key}
                  className="flex items-start gap-2 rounded-panel border border-subtle bg-panel-alt p-2"
                >
                  {e.icon ? (
                    <Icon icon={e.icon} className="mt-0.5 text-secondary" />
                  ) : (
                    <Icon icon={LayoutTemplate} className="mt-0.5 text-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="t-body-strong text-primary">{e.title}</p>
                    {e.description ? (
                      <p className="text-small text-secondary">{e.description}</p>
                    ) : null}
                    <p className="text-small text-secondary tabular-nums">
                      {e.defaultSize.w} × {e.defaultSize.h}
                      {present ? " · on this dashboard" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    icon={Plus}
                    disabled={disabled}
                    onClick={() => onAdd(e)}
                    aria-label={`Add ${e.title}`}
                  >
                    Add
                  </Button>
                </li>
              );
            })}
            {entries.length === 0 ? (
              <li className="py-4 text-center text-small text-secondary">No widgets match.</li>
            ) : null}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// WidgetGrid
// ---------------------------------------------------------------------------------------------------------------------

/**
 * WidgetGrid (BUILD §5.4, §11.2 Customisation, DESIGN §8): react-grid-layout 2 with 12 columns, 8 px rows and 16 px
 * gutters. Edit mode shows dotted outlines, a drag handle in each header, a resize corner, remove and settings
 * controls, a dotted canvas grid, an add-widget drawer driven by the registry, presets and reset. Keyboard: with a
 * drag handle focused, arrows move the widget and Shift+arrows resize it. Every change goes through `onChange`.
 */
export function WidgetGrid({
  layout,
  registry,
  onChange,
  editing: editingProp,
  defaultEditing = false,
  onEditingChange,
  presets,
  onApplyPreset,
  defaultLayout,
  onReset,
  width: widthProp,
  cols = WIDGET_GRID_COLS,
  rowHeight = WIDGET_GRID_ROW_HEIGHT,
  gutter = WIDGET_GRID_GUTTER,
  hideToolbar,
  renderFrame,
  emptyText = "No widgets yet. Edit the layout to add some.",
  className,
  ...rest
}: WidgetGridProps) {
  const [editingState, setEditingState] = useState(defaultEditing);
  const editing = editingProp ?? editingState;
  const setEditing = (v: boolean) => {
    setEditingState(v);
    onEditingChange?.(v);
  };
  const {
    width: measured,
    containerRef,
    mounted,
  } = useContainerWidth({ initialWidth: widthProp ?? 1280 });
  const width = widthProp ?? measured;
  const ready = widthProp !== undefined || mounted;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<WidgetLayoutItem | null>(null);
  const lastKey = useRef(positionsKey(layout));
  useEffect(() => {
    lastKey.current = positionsKey(layout);
  }, [layout]);

  const rgl = useMemo(() => toRglLayout(layout, registry), [layout, registry]);
  const colWidth = (width - gutter * (cols - 1)) / cols;
  const pxSize = (it: WidgetLayoutItem) => ({
    width: Math.max(0, it.w * colWidth + (it.w - 1) * gutter),
    height: it.h * rowHeight + (it.h - 1) * gutter,
  });

  const onLayoutChange = useCallback(
    (next: Layout) => {
      const merged = mergeRglLayout(layout, next);
      const key = positionsKey(merged);
      if (key === lastKey.current) return;
      lastKey.current = key;
      onChange(merged);
    },
    [layout, onChange],
  );

  const remove = (id: string) => onChange(layout.filter((it) => it.i !== id));
  const saveSettings = (settings: Record<string, unknown>) => {
    if (!settingsFor) return;
    onChange(layout.map((it) => (it.i === settingsFor.i ? { ...it, settings } : it)));
    setSettingsFor(null);
  };
  const applyPreset = (p: WidgetPreset) =>
    onApplyPreset ? onApplyPreset(p) : onChange(p.layout.map((it) => ({ ...it })));
  const reset = () => {
    if (onReset) onReset();
    else if (defaultLayout) onChange(defaultLayout.map((it) => ({ ...it })));
  };

  const onHandleKeyDown = (e: KeyboardEvent, id: string) => {
    const map: Record<string, Parameters<typeof nudgeItem>[2]> = e.shiftKey
      ? { ArrowLeft: "narrower", ArrowRight: "wider", ArrowUp: "shorter", ArrowDown: "taller" }
      : { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    const action = map[e.key];
    if (!action) return;
    e.preventDefault();
    onChange(nudgeItem(layout, id, action, cols));
  };

  const canvasStyle: CSSProperties | undefined = editing
    ? {
        backgroundImage: "radial-gradient(circle, var(--line-subtle) 1px, transparent 1px)",
        backgroundSize: `${colWidth + gutter}px ${rowHeight + gutter}px`,
        backgroundPosition: `${colWidth}px ${rowHeight}px`,
      }
    : undefined;

  return (
    <div
      {...rest}
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-widget-grid
      data-editing={editing || undefined}
    >
      {hideToolbar ? null : (
        <div className="flex items-center gap-1.5">
          {presets && presets.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" icon={LayoutTemplate}>
                  Presets
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Apply a preset</DropdownMenuLabel>
                {presets.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => applyPreset(p)}>
                    <span className="flex flex-col">
                      <span>{p.name}</span>
                      {p.description ? (
                        <span className="text-small text-secondary">{p.description}</span>
                      ) : null}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <span className="flex-1" />
          {editing ? (
            <>
              <Button size="sm" icon={Plus} onClick={() => setDrawerOpen(true)}>
                Add widget
              </Button>
              {defaultLayout || onReset ? (
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>
                  Reset
                </Button>
              ) : null}
              <Button size="sm" variant="primary" icon={Check} onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={Pencil}
              onClick={() => setEditing(true)}
              aria-keyshortcuts="E"
            >
              Edit layout
            </Button>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          "relative min-h-24 rounded-panel",
          editing && "outline-1 outline-dotted outline-subtle",
        )}
        style={canvasStyle}
        data-canvas
      >
        {layout.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            action={
              editing
                ? { label: "Add widget", icon: Plus, onClick: () => setDrawerOpen(true) }
                : undefined
            }
          >
            {emptyText}
          </EmptyState>
        ) : null}
        {ready ? (
          <ReactGridLayout
            layout={rgl}
            width={width}
            gridConfig={{ cols, rowHeight, margin: [gutter, gutter], containerPadding: [0, 0] }}
            dragConfig={{ enabled: editing, handle: `.${DRAG_HANDLE_CLASS}`, bounded: false }}
            resizeConfig={{
              enabled: editing,
              handles: ["se"],
              handleComponent: (axis, ref) => <ResizeHandle axis={axis} editing={editing} ref={ref} />,
            }}
            compactor={verticalCompactor}
            onLayoutChange={onLayoutChange}
            className={cn(
              "react-grid-layout relative",
              "[&_.react-grid-item]:transition-[transform,width,height] [&_.react-grid-item]:duration-panel [&_.react-grid-item]:ease-dugout",
              "[&_.react-grid-item.react-draggable-dragging]:z-30 [&_.react-grid-item.react-draggable-dragging]:transition-none [&_.react-grid-item.resizing]:z-20 [&_.react-grid-item.resizing]:transition-none",
              "[&_.react-grid-placeholder]:z-10 [&_.react-grid-placeholder]:rounded-panel [&_.react-grid-placeholder]:bg-kit-primary/15 [&_.react-grid-placeholder]:outline-1 [&_.react-grid-placeholder]:outline-dashed [&_.react-grid-placeholder]:outline-kit-primary",
              "motion-reduce:[&_.react-grid-item]:transition-none",
            )}
          >
            {layout.map((it) => {
              const entry = registry.find((e) => e.key === it.widget);
              const size = pxSize(it);
              const framed = !!entry?.framed;
              const dragHandle =
                editing && !it.static ? (
                  <button
                    type="button"
                    className={cn(
                      DRAG_HANDLE_CLASS,
                      "inline-flex size-control-sm cursor-grab items-center justify-center rounded-sm text-secondary hover:bg-white/6 hover:text-primary active:cursor-grabbing focus-visible:shadow-ring",
                    )}
                    aria-label={`Move ${entry?.title ?? it.widget}. Arrow keys move, Shift+arrows resize.`}
                    onKeyDown={(e) => onHandleKeyDown(e, it.i)}
                  >
                    <Icon icon={GripVertical} size="inline" />
                  </button>
                ) : null;
              const editButtons = editing ? (
                <>
                  {entry?.settings && entry.settings.length > 0 ? (
                    <IconButton size="sm" icon={Settings2} label={`${entry.title} settings`} onClick={() => setSettingsFor(it)} />
                  ) : null}
                  {!it.static ? <IconButton size="sm" icon={X} label={`Remove ${entry?.title ?? it.widget}`} onClick={() => remove(it.i)} /> : null}
                </>
              ) : null;
              // A framed widget draws its own panel and header; the grid adds none, so each widget has one title.
              const header = framed ? null : (
                <header className="flex h-panel-header shrink-0 items-center gap-1 pl-1.5 pr-1.5 rule-fade">
                  {dragHandle}
                  <h3 className="t-title min-w-0 flex-1 truncate pl-1.5 text-primary" title={entry?.title ?? it.widget}>{entry?.title ?? it.widget}</h3>
                  {editButtons}
                </header>
              );
              const body = (
                <div className={cn("min-h-0 flex-1 overflow-hidden", framed && "flex flex-col")}>
                  {entry ? (
                    entry.render({
                      item: it,
                      settings: { ...(entry.defaultSettings ?? {}), ...(it.settings ?? {}) },
                      editing,
                      size: { width: size.width, height: Math.max(0, size.height - (framed ? 0 : 32)) },
                    })
                  ) : (
                    <EmptyState className="py-4">
                      Unknown widget “{it.widget}”. Remove it or update the registry.
                    </EmptyState>
                  )}
                </div>
              );
              return (
                <div
                  key={it.i}
                  data-widget={it.widget}
                  data-widget-id={it.i}
                  data-framed={framed || undefined}
                  className={cn(
                    "group/widget",
                    framed && "relative",
                    editing && "rounded-md outline-1 outline-dashed outline-kit-lift/40 outline-offset-4",
                  )}
                >
                  {renderFrame ? (
                    renderFrame({ item: it, entry, editing, header, body })
                  ) : framed ? (
                    <div className="flex h-full min-w-0 flex-col">{body}</div>
                  ) : (
                    <section
                      aria-label={entry?.title ?? it.widget}
                      className="surface-panel flex h-full min-w-0 flex-col overflow-hidden"
                    >
                      {header}
                      {body}
                    </section>
                  )}
                  {/* A framed widget's own header actions sit at its top right, so the edit controls float on the frame's
                      top edge, centred, where a header has no controls: they never cover the widget's actions. */}
                  {framed && editing ? (
                    <div className="surface-overlay absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-pill p-0.5 px-1" data-widget-controls>
                      {dragHandle}
                      {editButtons}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </ReactGridLayout>
        ) : null}
      </div>

      <AddWidgetDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        registry={registry}
        layout={layout}
        onAdd={(entry) => {
          onChange(addWidget(layout, entry, cols));
          if (entry.single) setDrawerOpen(false);
        }}
      />
      <WidgetSettingsDialog
        item={settingsFor}
        entry={settingsFor ? registry.find((e) => e.key === settingsFor.widget) : undefined}
        onClose={() => setSettingsFor(null)}
        onSave={saveSettings}
      />
    </div>
  );
}
