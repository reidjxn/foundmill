"use client";
/**
 * The 380 px Inbox list (DESIGN §9 Inbox, DIRECTION #8): avatar 32, the subject in body-strong wrapping to as many
 * lines as it needs (never ellipsised), the time right (relative; the moment in the person's date format on hover), then one status tag (icon + word: "Respond", "Customer",
 * "Milestone", "Update"…) before a one-line preview. A won customer keeps the gold left edge.
 */
import { Inbox } from "lucide-react";
import { NETWORK_SENDER, NOTE_TAG_ICONS, noteTagLegend } from "@foundmill/widgets/shared/note-tags";
import { useEffect, useRef, type ReactNode } from "react";
import { APP_NAME } from "@foundmill/config";
import { Avatar, Button, Chip, EmptyState, Skeleton, Tooltip, VirtualList, formatRelative, useFormatters, type ChipTone, type IconComponent, type VirtualListHandle } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { useHydrated } from "@/lib/today";
import type { InboxRowModel, NoteTag, TagIcon } from "./logic";

/** Lucide glyph per tag (the word carries the meaning; the icon and the tone repeat it). Shared with Home's preview. */
export const TAG_ICONS: Record<TagIcon, IconComponent> = NOTE_TAG_ICONS;

/**
 * The tag as a chip: icon + word, the tone a second signal, never the only one. Its tooltip is the legend sentence for
 * the kind ("Customer: A new paying customer, with its Customer Update"; UX plan B21), so no tag is a bare word.
 * The tooltip's trigger is a plain span around the chip: the trigger hands its child an onClick, which turns a Chip
 * into a button, and the row around it is already a button (a button inside a button is invalid HTML).
 */
export function NoteTagChip({ tag, size = "row", testId }: { tag: NoteTag; size?: "row" | "header"; testId?: string }) {
  const tone: ChipTone = tag.tone;
  return (
    <Tooltip content={noteTagLegend(tag)}>
      <span className="inline-flex max-w-full shrink-0">
        <Chip tone={tone} icon={TAG_ICONS[tag.icon]} className={size === "row" ? "h-badge shrink-0" : "shrink-0"} data-row-tag={tag.word} data-tag-legend={noteTagLegend(tag)} data-testid={testId}>
          {tag.word}
        </Chip>
      </span>
    </Tooltip>
  );
}

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  seed: string;
  dept: DeptColourToken;
  departmentId: string;
  departmentName: string;
}

export interface InboxListRow extends InboxRowModel {
  agent: AgentMeta | undefined;
  /** The founder's own note: it carries their initials. */
  fromUser: boolean;
  /** Another person's note (not the viewer's own). Network traffic is never filed in a business's Inbox (FU-S-2). */
  fromPerson?: boolean;
}

export interface InboxListProps {
  rows: readonly InboxListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A row the pointer or the keyboard focus reached: its note can load before the click. */
  onPrefetch?: (id: string) => void;
  loading: boolean;
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  /** The empty line: what will appear and how to make it happen (DESIGN §10); the screen adds key caps for operators. */
  emptyText: ReactNode;
  /** The founder's name, for the initials on the founder's own notes. */
  founderName?: string;
}

export function InboxList({ rows, selectedId, onSelect, onPrefetch, loading, hasMore, loadingMore, onLoadMore, emptyText, founderName }: InboxListProps) {
  const listRef = useRef<VirtualListHandle>(null);
  // The row time stays relative ("3 min ago"); its tooltip is the moment in the person's own date format, printed only
  // once the browser knows the reader's time zone (the server renders in UTC).
  const { formatDateTime } = useFormatters();
  const hydrated = useHydrated();
  // J/K and a click keep the selected row in view, drawn or not (a long list only draws the rows near the viewport).
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.scrollToIndex(rows.findIndex((r) => r.id === selectedId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the selection, not every new page of rows
  }, [selectedId]);

  if (loading) {
    return (
      <div className="flex flex-col gap-px p-panel-pad" aria-busy="true" aria-label="Loading inbox" data-testid="inbox-list-loading">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-16 items-center gap-3">
            <Skeleton shape="circle" className="size-8" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState icon={Inbox} title="Nothing here" className="py-10">
        {emptyText}
      </EmptyState>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VirtualList
        ref={listRef}
        role="listbox"
        aria-label="Inbox items"
        className="flex min-h-0 flex-1 flex-col"
        items={rows}
        getKey={(row) => row.id}
        rowClassName="border-b hairline-50 last:border-b-0"
        estimateSize={76}
        data-testid="inbox-list"
        renderItem={(row, index, setSize) => {
          const selected = row.id === selectedId;
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              aria-posinset={index + 1}
              aria-setsize={setSize}
              onClick={() => onSelect(row.id)}
              onPointerEnter={onPrefetch ? () => onPrefetch(row.id) : undefined}
              onFocus={onPrefetch ? () => onPrefetch(row.id) : undefined}
              data-inbox-row={row.id}
              data-type={row.typeWord}
              data-unread={row.unread || undefined}
              data-needs-answer={row.needsAnswer || undefined}
              className={[
                "flex w-full items-start gap-3 px-panel-pad py-2.5 text-left transition-colors duration-micro ease-dugout hover:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
                row.won ? "row-edge-gold" : "",
                selected ? (row.won ? "bg-panel-alt" : "row-selected") : "",
              ].join(" ")}
              aria-label={`${row.subject}. ${row.tag.word}${row.needsAnswer && row.tag.word !== "Respond" ? ", needs your answer" : ""}${row.won ? ", customer won" : ""}`}
            >
              <span className="shrink-0 pt-0.5">
                {row.agent ? <Avatar size={32} name={row.agent.name} agent={{ seed: row.agent.seed, dept: row.agent.dept }} /> : <Avatar size={32} name={row.fromUser ? (founderName ?? "You") : row.fromPerson ? NETWORK_SENDER : APP_NAME} />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start gap-2">
                  <span className={`min-w-0 flex-1 text-pretty break-words text-body-strong ${row.unread ? "text-primary" : "text-secondary"}`} data-testid="row-subject">
                    {row.subject}
                  </span>
                  <time className="shrink-0 pt-px text-small text-secondary tabular-nums" dateTime={new Date(row.createdAt).toISOString()} title={hydrated ? formatDateTime(row.createdAt) : undefined} data-testid="row-time">
                    {formatRelative(row.createdAt)}
                  </time>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <NoteTagChip tag={row.tag} testId="row-tag" />
                  {/* A note preview may end in "…" (a list convention, no-clip.spec.ts); the full line is the title. */}
                  <span className="line-clamp-1 min-w-0 flex-1 break-all text-small text-secondary" title={row.preview}>
                    {row.preview}
                  </span>
                </span>
              </span>
            </button>
          );
        }}
      />
      {hasMore ? (
        <div className="border-t border-subtle p-2">
          <Button size="sm" variant="ghost" className="w-full" onClick={onLoadMore} loading={loadingMore} data-testid="inbox-load-more">
            Load older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
