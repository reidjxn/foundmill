"use client";
/**
 * The Now / Next / Later board (BUILD §11.5). Cards drag between columns (HTML5 drag and drop) and move with the
 * keyboard (Alt+←/→ on a focused card, or the right-click verbs); each move is a `product.roadmap.upsert` with the new
 * horizon. Status is computed (roadmap-status.ts), never set here.
 */
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowLeftRight, Bot, FileText, Link2, Pencil, Workflow } from "lucide-react";
import { Chip, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger, DeptChip, EntityLink, Icon, StatusPill, cn, formatDate, useEntityLinkContext } from "@foundmill/dugout";
import { useDepartments } from "@foundmill/widgets";
import { ROADMAP_HORIZONS, type RoadmapHorizon } from "@foundmill/shared";
import { HORIZON_LABEL, computeRoadmapStatus, taskSummary } from "../roadmap-status";
import { blockTitle, useAgentNames } from "../shared";
import type { RoadmapRow, SpecBlockRow } from "../types";
import { adjacentHorizon, type Columns, type DependencyIndex } from "./board";

export interface BoardProps {
  columns: Columns;
  blocks: readonly SpecBlockRow[];
  dependencies: DependencyIndex;
  /** The item being moved (its id) while the mutation runs. */
  movingId: string | null;
  onMove: (item: RoadmapRow, horizon: RoadmapHorizon, position: number) => void;
  onEdit: (item: RoadmapRow) => void;
  onOpenBlock: (blockId: string) => void;
  onOpenTasks: (item: RoadmapRow) => void;
}

const HORIZON_HINT: Record<RoadmapHorizon, string> = {
  now: "The team works on these this cycle.",
  next: "Queued; the Chief of Staff pulls from here when Now empties.",
  later: "Direction, not commitment. Dates here are estimates.",
};

/** The owner by name: the department's own chip, the agent's name, or nothing when it cannot be named (never a placeholder). */
function Owner({ ownerRef }: { ownerRef: RoadmapRow["ownerRef"] }) {
  const ctx = useEntityLinkContext();
  const departments = useDepartments();
  const agents = useAgentNames();
  if (!ownerRef) return null;
  if (ownerRef.kind === "department") {
    const d = departments.data?.find((x) => x.id === ownerRef.id);
    const name = d?.name ?? ctx.resolve?.(ownerRef.id)?.name;
    if (!name) return null;
    return d ? <DeptChip dept={d.colourToken}>{name}</DeptChip> : <Chip tone="neutral">{name}</Chip>;
  }
  const kind = ownerRef.kind === "agent" ? "agent" : "team_member";
  const name = (kind === "agent" ? agents.get(ownerRef.id) : undefined) ?? ctx.resolve?.(ownerRef.id)?.name;
  if (!name) return null;
  return <EntityLink entity={{ id: ownerRef.id, kind, name }} className="text-small" />;
}

function Card({ item, blocks, dependencies, titleById, moving, onMove, onEdit, onOpenBlock, onOpenTasks }: { item: RoadmapRow; blocks: readonly SpecBlockRow[]; dependencies: DependencyIndex; titleById: Map<string, string>; moving: boolean; onMove: (h: RoadmapHorizon) => void; onEdit: () => void; onOpenBlock: (id: string) => void; onOpenTasks: () => void }) {
  const status = computeRoadmapStatus(item);
  const tasks = taskSummary(item);
  const linked = (item.specBlockIds ?? []).map((id) => blocks.find((b) => b.id === id)).filter((b): b is SpecBlockRow => b !== undefined);
  const after = (dependencies.after.get(item.id) ?? []).map((id) => titleById.get(id) ?? "another item");
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const target = adjacentHorizon(item.horizon, e.key === "ArrowLeft" ? -1 : 1);
      if (target) {
        e.preventDefault();
        onMove(target);
      }
    } else if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onEdit();
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="listitem"
          tabIndex={0}
          draggable={!moving}
          data-roadmap-item={item.id}
          data-horizon={item.horizon}
          aria-label={`${item.title}, ${status.word}, in ${HORIZON_LABEL[item.horizon]}`}
          aria-busy={moving || undefined}
          onKeyDown={onKeyDown}
          onDragStart={(e: DragEvent<HTMLDivElement>) => {
            e.dataTransfer.setData("text/plain", item.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDoubleClick={onEdit}
          className={cn(
            "group flex cursor-grab flex-col gap-1.5 rounded-panel border border-subtle bg-panel-alt p-2 outline-none transition-colors duration-micro ease-dugout hover:border-secondary/60 focus-visible:outline-2 focus-visible:outline-link active:cursor-grabbing",
            moving && "opacity-60",
          )}
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-body-strong text-primary">{item.title}</span>
            <StatusPill tone={status.tone} icon={status.icon}>
              {status.word}
            </StatusPill>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-secondary tabular-nums">
            {item.targetEnd ? <span title={item.targetStart ? `${formatDate(item.targetStart)} → ${formatDate(item.targetEnd)}` : undefined}>by {formatDate(item.targetEnd, "d MMM")}</span> : <span>No date</span>}
            <span>· confidence {item.confidence}/5</span>
            {tasks.total ? (
              <span className="inline-flex items-center gap-1" title={`${tasks.done} of ${tasks.total} tasks done`}>
                · {tasks.done}/{tasks.total} tasks
                <span className="inline-block h-1 w-12 overflow-hidden rounded-chip bg-base" aria-hidden>
                  <span className="block h-full bg-kit-primary" style={{ width: `${Math.round(tasks.progress * 100)}%` }} />
                </span>
              </span>
            ) : (
              <span>· no tasks</span>
            )}
            <Owner ownerRef={item.ownerRef} />
          </div>
          {linked.length || after.length ? (
            <div className="flex min-w-0 flex-col gap-1">
              {/* Linked spec blocks read as quiet references (section, then two lines of the block), inside the card. */}
              {linked.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpenBlock(b.id)}
                  title={`Open "${blockTitle(b)}" in the Specification`}
                  data-linked-block={b.id}
                  className="flex w-full min-w-0 items-start gap-1.5 rounded-sm px-1 py-0.5 text-left text-small text-secondary outline-none transition-colors duration-micro ease-dugout hover:bg-white/4 hover:text-primary focus-visible:outline-2 focus-visible:outline-link"
                >
                  <Icon icon={FileText} size="inline" className="mt-0.5 shrink-0" />
                  <span className="line-clamp-2 min-w-0 flex-1 break-words">
                    {blockTitle(b).toLowerCase().startsWith(b.section.toLowerCase()) ? (
                      blockTitle(b)
                    ) : (
                      <>
                        <span className="font-medium text-primary">{b.section}:</span> {blockTitle(b)}
                      </>
                    )}
                  </span>
                </button>
              ))}
              {after.length ? (
                <span className="flex min-w-0 items-start gap-1.5 px-1 text-small text-status-info" title="Depends on">
                  <Icon icon={Link2} size="inline" className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">After {after.join(", ")}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`Actions for ${item.title}`}>
        <ContextMenuItem onSelect={onEdit}>
          <Icon icon={Pencil} size="inline" /> Edit
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>
        {ROADMAP_HORIZONS.filter((h) => h !== item.horizon).map((h) => (
          <ContextMenuItem key={h} onSelect={() => onMove(h)}>
            <Icon icon={ArrowLeftRight} size="inline" /> Move to {HORIZON_LABEL[h]}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={linked.length === 0} onSelect={() => linked[0] && onOpenBlock(linked[0].id)}>
          <Icon icon={FileText} size="inline" /> Open spec block
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenTasks}>
          <Icon icon={Workflow} size="inline" /> Open tasks in Development
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function Board({ columns, blocks, dependencies, movingId, onMove, onEdit, onOpenBlock, onOpenTasks }: BoardProps) {
  const [over, setOver] = useState<RoadmapHorizon | null>(null);
  const dragging = useRef<string | null>(null);
  const all = ROADMAP_HORIZONS.flatMap((h) => columns[h]);
  const titleById = new Map(all.map((i) => [i.id, i.title]));
  const find = (id: string | null) => (id ? all.find((i) => i.id === id) : undefined);

  const drop = (h: RoadmapHorizon, e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const id = e.dataTransfer?.getData("text/plain") || dragging.current;
    setOver(null);
    dragging.current = null;
    const item = find(id);
    if (!item || item.horizon === h) return;
    onMove(item, h, columns[h].length);
  };

  return (
    <div className="grid grid-cols-3 gap-4" data-roadmap-board>
      {ROADMAP_HORIZONS.map((h) => (
        <section
          key={h}
          aria-label={HORIZON_LABEL[h]}
          data-column={h}
          data-drop-active={over === h || undefined}
          className={cn("flex min-h-64 flex-col rounded-panel border border-subtle bg-panel transition-colors duration-micro ease-dugout", over === h && "border-kit-primary bg-panel-alt")}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== h) setOver(h);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setOver(h);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === h ? null : o));
          }}
          onDrop={(e) => drop(h, e)}
        >
          <header className="flex h-panel-header items-center gap-2 border-b border-subtle bg-panel-alt px-panel-pad">
            <h3 className="t-label">{HORIZON_LABEL[h]}</h3>
            <span className="t-label text-secondary tabular-nums">{columns[h].length}</span>
            <span className="flex-1" />
            <Icon icon={Bot} size="inline" className="text-secondary" label={HORIZON_HINT[h]} />
          </header>
          <div role="list" aria-label={`${HORIZON_LABEL[h]} items`} className="flex flex-1 flex-col gap-2 p-2">
            {columns[h].length === 0 ? <p className="px-1 py-4 text-center text-small text-secondary">{HORIZON_HINT[h]} Drop an item here.</p> : null}
            {columns[h].map((item) => (
              <Card
                key={item.id}
                item={item}
                blocks={blocks}
                dependencies={dependencies}
                titleById={titleById}
                moving={movingId === item.id}
                onMove={(target) => onMove(item, target, columns[target].length)}
                onEdit={() => onEdit(item)}
                onOpenBlock={onOpenBlock}
                onOpenTasks={() => onOpenTasks(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
