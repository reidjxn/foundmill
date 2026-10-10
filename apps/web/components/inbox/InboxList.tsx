"use client";
/**
 * The 380 px Inbox list (DESIGN §9 Inbox, DIRECTION #8): avatar 32, the subject in body-strong wrapping to as many
 * lines as it needs (never ellipsised), the time right, then one status tag (icon + word: "Respond", "Win",
 * "Milestone", "Update"…) before a one-line preview. A won customer keeps the gold left edge.
 */
import { Check, FileText, Flag, Inbox, MessageSquareReply, Mail, RefreshCw, TriangleAlert, UserCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { APP_NAME } from "@foundmill/config";
import { Avatar, Button, Chip, EmptyState, Skeleton, formatRelative, type ChipTone, type IconComponent } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import type { InboxRowModel, NoteTag, TagIcon } from "./logic";

/** Lucide glyph per tag (the word carries the meaning; the icon and the tone repeat it). */
export const TAG_ICONS: Record<TagIcon, IconComponent> = {
  respond: MessageSquareReply,
  win: UserCheck,
  milestone: Flag,
  warning: TriangleAlert,
  update: RefreshCw,
  report: FileText,
  message: Mail,
  decided: Check,
};

/** The tag as a chip: icon + word, the tone a second signal, never the only one. */
export function NoteTagChip({ tag, size = "row", testId }: { tag: NoteTag; size?: "row" | "header"; testId?: string }) {
  const tone: ChipTone = tag.tone;
  return (
    <Chip tone={tone} icon={TAG_ICONS[tag.icon]} className={size === "row" ? "h-badge shrink-0" : "shrink-0"} data-row-tag={tag.word} data-testid={testId}>
      {tag.word}
    </Chip>
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
  fromUser: boolean;
}

export interface InboxListProps {
  rows: readonly InboxListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  emptyText: string;
}

export function InboxList({ rows, selectedId, onSelect, loading, hasMore, loadingMore, onLoadMore, emptyText }: InboxListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-inbox-row="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
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
      <ul ref={listRef} role="listbox" aria-label="Inbox items" className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="inbox-list">
        {rows.map((row) => {
          const selected = row.id === selectedId;
          return (
            <li key={row.id} role="presentation" className="border-b hairline-50 last:border-b-0">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(row.id)}
                data-inbox-row={row.id}
                data-type={row.typeWord}
                data-unread={row.unread || undefined}
                data-needs-answer={row.needsAnswer || undefined}
                className={[
                  "flex w-full items-start gap-3 px-panel-pad py-2.5 text-left outline-none transition-colors duration-micro ease-dugout hover:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
                  row.won ? "row-edge-gold" : "",
                  selected ? (row.won ? "bg-panel-alt" : "row-selected") : "",
                ].join(" ")}
                aria-label={`${row.subject}. ${row.tag.word}${row.needsAnswer && row.tag.word !== "Respond" ? ", needs an answer" : ""}${row.won ? ", customer won" : ""}`}
              >
                <span className="shrink-0 pt-0.5">
                  {row.agent ? <Avatar size={32} name={row.agent.name} agent={{ seed: row.agent.seed, dept: row.agent.dept }} /> : <Avatar size={32} name={row.fromUser ? "You" : APP_NAME} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-start gap-2">
                    <span className={`min-w-0 flex-1 text-pretty break-words text-body-strong ${row.unread ? "text-primary" : "text-secondary"}`} data-testid="row-subject">
                      {row.subject}
                    </span>
                    <time className="shrink-0 pt-px text-small text-secondary tabular-nums" dateTime={new Date(row.createdAt).toISOString()}>
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
            </li>
          );
        })}
      </ul>
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
