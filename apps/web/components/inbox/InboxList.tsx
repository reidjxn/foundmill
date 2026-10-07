"use client";
/**
 * The 380 px Inbox list (DESIGN §9 Inbox): rows 56 px with avatar 24, subject in body-strong, preview in small
 * secondary, time right, a red 6 px dot when an answer is required and a gold left edge for a won customer.
 */
import { Inbox } from "lucide-react";
import { useEffect, useRef } from "react";
import { APP_NAME } from "@foundmill/config";
import { Avatar, Button, EmptyState, Skeleton, formatRelative } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import type { InboxRowModel } from "./logic";

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
          <div key={i} className="flex h-14 items-center gap-3">
            <Skeleton shape="circle" className="size-6" />
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
                  "flex h-14 w-full items-center gap-3 border-l-[3px] px-panel-pad text-left outline-none transition-colors duration-micro ease-dugout hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-link",
                  row.won ? "border-l-gold" : selected ? "border-l-kit-primary" : "border-l-transparent",
                  selected ? "bg-panel-alt" : "",
                ].join(" ")}
                aria-label={`${row.subject}${row.needsAnswer ? ", needs an answer" : ""}${row.won ? ", customer won" : ""}`}
              >
                {row.agent ? <Avatar size={24} name={row.agent.name} agent={{ seed: row.agent.seed, dept: row.agent.dept }} /> : <Avatar size={24} name={row.fromUser ? "You" : APP_NAME} />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-body-strong ${row.unread ? "text-primary" : "text-secondary"}`}>{row.subject}</span>
                  <span className="truncate text-small text-secondary">{row.preview}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-small text-secondary tabular-nums">
                  {row.needsAnswer ? <span aria-hidden className="inline-block size-1.5 rounded-full bg-status-bad" data-testid="needs-answer-dot" /> : null}
                  <time dateTime={new Date(row.createdAt).toISOString()}>{formatRelative(row.createdAt)}</time>
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
