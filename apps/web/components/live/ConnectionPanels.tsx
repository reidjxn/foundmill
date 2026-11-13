"use client";
/**
 * The connection lists on /network: requests waiting for the founder (accept, ignore or block), requests the founder
 * sent (withdraw), community invitations (join or decline), and the connections themselves in a DataTable with saved
 * views and a right-click menu.
 */
import { Ban, Check, Clock, LogIn, MailOpen, MessageSquare, UserCheck, UserMinus, UserRound, Users, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, Button, DataTable, Panel, StatusPill, formatRelative, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { useTableViews } from "@/lib/table-views";
import { PeopleList, type PeopleListItem } from "./PeopleList";
import type { People } from "./shared";

export interface ConnectionRow {
  id: string;
  fromUser: string;
  toUser: string;
  status: "requested" | "accepted" | "blocked";
  message: string | null;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface ConnectionHandlers {
  onAccept: (row: ConnectionRow) => void;
  onBlock: (row: ConnectionRow) => void;
  /** Withdraws a request, removes a connection or lifts a block: the row is deleted. */
  onRemove: (row: ConnectionRow) => void;
  onMessage: (row: ConnectionRow) => void;
}

interface CommonProps extends Partial<ConnectionHandlers> {
  rows: readonly ConnectionRow[];
  viewerId: string;
  people: People;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** The connection a mutation is working on: its buttons wait. */
  busyId?: string | null;
  /** The one way on from an empty list (founders are met in communities). */
  onFind?: () => void;
  /** The page is narrower than `page-wide`: Connections is a list, not a table. */
  narrow?: boolean;
}

/** A control on these pages is a 44 px tap target on a small screen, and keeps its dense size from `page-wide` up. */
const TAP = "min-h-tap @page-wide:min-h-0";

const findAction = (onFind?: () => void) => (onFind ? { label: "Browse communities", icon: UsersRound, onClick: onFind } : undefined);

const otherUser = (row: ConnectionRow, viewerId: string) => (row.fromUser === viewerId ? row.toUser : row.fromUser);

/** Requests waiting for the founder: Accept, Ignore (the request goes, nobody is told) or Block. */
export function RequestsPanel({ rows, viewerId, people, loading, error, onRetry, busyId, onAccept, onRemove, onBlock, onFind }: CommonProps) {
  return (
    <Panel
      title="Requests"
      flush
      loading={loading}
      error={error}
      onRetry={onRetry}
      actions={rows.length ? <StatusPill tone="info" icon={Clock}>{rows.length} waiting</StatusPill> : undefined}
      empty={rows.length === 0 ? { icon: UserCheck, children: "No requests waiting. When someone asks to connect, it waits here for you.", action: findAction(onFind) } : undefined}
      data-testid="requests-panel"
    >
      <ul>
        {rows.map((row) => {
          const name = people.name(otherUser(row, viewerId));
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-faint px-panel-pad py-2 last:border-b-0" data-testid="request-row">
              <Avatar size={32} name={name} />
              <div className="min-w-0 flex-1 basis-40">
                <p className="t-body-strong truncate text-primary">{name}</p>
                <p className="truncate text-small text-secondary" title={row.message ?? undefined}>
                  {row.message ? `“${row.message}”` : `Asked ${formatRelative(row.createdAt)}`}
                </p>
              </div>
<div className="flex w-full flex-wrap gap-2 @page-wide:w-auto @page-wide:flex-nowrap">
              <Button size="sm" className={TAP} icon={Check} aria-label={`Accept ${name}`} disabled={busyId === row.id} onClick={() => onAccept?.(row)}>
                Accept
              </Button>
              <Button size="sm" className={TAP} variant="ghost" icon={X} aria-label={`Ignore ${name}`} disabled={busyId === row.id} onClick={() => onRemove?.(row)}>
                Ignore
              </Button>
              <Button size="sm" className={TAP} variant="ghost" icon={Ban} aria-label={`Block ${name}`} disabled={busyId === row.id} onClick={() => onBlock?.(row)}>
                Block
              </Button>
            </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function SentRequestsPanel({ rows, viewerId, people, loading, error, onRetry, busyId, onRemove, onFind }: CommonProps) {
  return (
    <Panel
      title="Sent requests"
      flush
      loading={loading}
      error={error}
      onRetry={onRetry}
      actions={rows.length ? <StatusPill tone="neutral" icon={Clock}>{rows.length} waiting</StatusPill> : undefined}
      empty={rows.length === 0 ? { icon: Clock, children: "Requests you send wait here until the other person answers.", action: findAction(onFind) } : undefined}
      data-testid="sent-requests-panel"
    >
      <ul>
        {rows.map((row) => {
          const name = people.name(otherUser(row, viewerId));
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-faint px-panel-pad py-2 last:border-b-0" data-testid="sent-request-row">
              <Avatar size={32} name={name} />
              <div className="min-w-0 flex-1 basis-40">
                <p className="t-body-strong truncate text-primary">{name}</p>
                <p className="truncate text-small text-secondary">Sent {formatRelative(row.createdAt)}</p>
              </div>
<div className="flex w-full flex-wrap gap-2 @page-wide:w-auto @page-wide:flex-nowrap">
              <Button size="sm" className={TAP} variant="ghost" icon={UserMinus} aria-label={`Withdraw request to ${name}`} disabled={busyId === row.id} onClick={() => onRemove?.(row)}>
                Withdraw
              </Button>
            </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Community invitations
// ---------------------------------------------------------------------------------------------------------------------

export interface InvitationRow {
  community: { id: string; name: string; visibility: string };
  invitedBy: string | null;
  invitedAt: Date;
}

/** Invitations to communities (the only way into one that is not public): join it, or decline. */
export function InvitationsPanel({ rows, people, loading, error, onRetry, busyId, onJoin, onDecline }: { rows: readonly InvitationRow[]; people: People; loading?: boolean; error?: string; onRetry?: () => void; busyId?: string | null; onJoin: (row: InvitationRow) => void; onDecline: (row: InvitationRow) => void }) {
  if (!loading && !error && rows.length === 0) return null;
  return (
    <Panel
      title="Invitations"
      flush
      loading={loading}
      error={error}
      onRetry={onRetry}
      actions={rows.length ? <StatusPill tone="info" icon={MailOpen}>{rows.length} waiting</StatusPill> : undefined}
      data-testid="invitations-panel"
    >
      <ul>
        {rows.map((row) => (
          <li key={row.community.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-faint px-panel-pad py-2 last:border-b-0" data-testid="invitation-row">
            <Avatar size={32} name={row.community.name} />
            <div className="min-w-0 flex-1 basis-40">
              <p className="t-body-strong truncate text-primary">{row.community.name}</p>
              <p className="truncate text-small text-secondary">
                {row.invitedBy ? `From ${people.name(row.invitedBy)}, ` : ""}
                {formatRelative(row.invitedAt)}
              </p>
            </div>
<div className="flex w-full flex-wrap gap-2 @page-wide:w-auto @page-wide:flex-nowrap">
            <Button size="sm" className={TAP} icon={LogIn} aria-label={`Join ${row.community.name}`} disabled={busyId === row.community.id} onClick={() => onJoin(row)}>
              Join
            </Button>
            <Button size="sm" className={TAP} variant="ghost" icon={X} aria-label={`Decline ${row.community.name}`} disabled={busyId === row.community.id} onClick={() => onDecline(row)}>
              Decline
            </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------------------------------------------------

interface ConnectionTableRow {
  id: string;
  name: string;
  status: "accepted" | "blocked";
  /** ISO time the connection was answered. */
  since: string;
  note: string;
  source: ConnectionRow;
}

const STATUS_OPTIONS = [
  { value: "accepted", label: "Connected" },
  { value: "blocked", label: "Blocked" },
];
const COLUMNS = ["name", "status", "since", "note"];
const ONLY = (id: string, value: string) => [{ id, field: "status", op: "eq" as const, value }];

export const CONNECTION_VIEWS: SavedView[] = [
  { id: "connected", name: "Connected", builtIn: true, columns: COLUMNS, sort: [{ id: "name", desc: false }], filters: ONLY("f-connected", "accepted") },
  { id: "recent", name: "Recently connected", builtIn: true, columns: COLUMNS, sort: [{ id: "since", desc: true }], filters: ONLY("f-recent", "accepted") },
  { id: "blocked", name: "Blocked", builtIn: true, columns: COLUMNS, sort: [{ id: "name", desc: false }], filters: ONLY("f-blocked", "blocked") },
];

export function ConnectionsPanel({ rows, viewerId, people, loading, error, onRetry, onBlock, onRemove, onMessage, onFind, narrow }: CommonProps) {
  // Saved per person across their businesses: the LIVE pages are the account's, not one business's (audit #204).
  const savedViews = useTableViews("live.network.connections", CONNECTION_VIEWS, { defaultViewId: "connected" });
  const data = useMemo<ConnectionTableRow[]>(
    () =>
      rows.flatMap((row) =>
        row.status === "requested" ? [] : [{ id: row.id, name: people.name(otherUser(row, viewerId)), status: row.status, since: (row.respondedAt ?? row.createdAt).toISOString(), note: row.message ?? "", source: row }],
      ),
    [rows, viewerId, people],
  );
  const connected = data.filter((r) => r.status === "accepted").length;

  const columns = useMemo<DataTableColumn<ConnectionTableRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        size: 260,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar size={24} name={row.original.name} />
            <span className="t-body-strong truncate text-primary">{row.original.name}</span>
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 140,
        cell: ({ row }) => (row.original.status === "accepted" ? <StatusPill tone="good" icon={UserCheck}>Connected</StatusPill> : <StatusPill tone="bad" icon={Ban}>Blocked</StatusPill>),
        meta: { filter: "select", filterOptions: STATUS_OPTIONS },
      },
      { id: "since", accessorKey: "since", header: "Since", size: 130, cell: ({ row }) => <span className="text-secondary">{formatRelative(row.original.since)}</span>, meta: { filter: "date" } },
      { id: "note", accessorKey: "note", header: "Note with the request", size: 360, cell: ({ row }) => <span className="truncate text-secondary">{row.original.note || "—"}</span> },
    ],
    [],
  );

  const rowActions = (row: ConnectionTableRow): RowAction<ConnectionTableRow>[] =>
    row.status === "accepted"
      ? [
          { id: "message", label: "Message", icon: MessageSquare, onSelect: (r) => onMessage?.(r.source) },
          { id: "block", label: "Block", icon: Ban, separatorBefore: true, onSelect: (r) => onBlock?.(r.source) },
          { id: "remove", label: "Remove connection", icon: UserMinus, variant: "danger", onSelect: (r) => onRemove?.(r.source) },
        ]
      : [{ id: "unblock", label: "Unblock", icon: UserCheck, onSelect: (r) => onRemove?.(r.source) }];

  // Below `page-wide` the table is a list: the name and since when, Message as the main action, the rest in a menu.
  // Saved views stay on the table; the list shows connected people first, then anyone blocked.
  const listItems: PeopleListItem[] = [...data]
    .sort((a, b) => Number(a.status === "blocked") - Number(b.status === "blocked") || a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      fact: r.status === "accepted" ? `Connected ${formatRelative(r.since)}` : `Blocked ${formatRelative(r.since)}`,
      onOpen: r.status === "accepted" ? () => onMessage?.(r.source) : undefined,
      primary:
        r.status === "accepted"
          ? { label: "Message", icon: MessageSquare, onSelect: () => onMessage?.(r.source), ariaLabel: `Message ${r.name}` }
          : { label: "Unblock", icon: UserCheck, ghost: true, onSelect: () => onRemove?.(r.source), ariaLabel: `Unblock ${r.name}` },
      more:
        r.status === "accepted"
          ? [
              { label: "Block", icon: Ban, onSelect: () => onBlock?.(r.source) },
              { label: "Remove connection", icon: UserMinus, variant: "danger" as const, onSelect: () => onRemove?.(r.source) },
            ]
          : undefined,
    }));

  return (
    <Panel
      title="Connections"
      flush
      loading={loading}
      error={error}
      onRetry={onRetry}
      meta={connected ? `${connected} ${connected === 1 ? "connection" : "connections"}` : undefined}
      empty={data.length === 0 ? { icon: Users, children: "No connections yet. Founders mostly meet in communities.", action: findAction(onFind) } : undefined}
      data-testid="connections-panel"
    >
      {narrow ? (
        <PeopleList label="Connections" data-testid="connections-list" items={listItems} />
      ) : (
      <DataTable<ConnectionTableRow>
        aria-label="Connections"
        data={data}
        columns={columns}
        {...savedViews}
        defaultViewId="connected"
        rowActions={rowActions}
        onRowOpen={(r) => r.status === "accepted" && onMessage?.(r.source)}
        height={Math.min(360, Math.max(176, data.length * 28 + 64))}
        exportFileName="connections"
        empty={{ icon: UserRound, children: "Nobody in this view." }}
        className="border-0"
      />
      )}
    </Panel>
  );
}
