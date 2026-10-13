"use client";
/**
 * /communities (BUILD §6.2, §11.14): the communities the founder can see (public ones and their own), in a DataTable with
 * saved views (All, Joined, To join) and a right-click menu, with Join and Leave on every row. A row opens
 * /communities/[id], where the feed is.
 */
import { useQuery } from "@tanstack/react-query";
import { Check, DoorOpen, LogIn, LogOut, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button, Chip, DataTable, Panel, StatusPill, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useTableViews } from "@/lib/table-views";
import { useShellChrome } from "@/components/shell/chrome";
import { COMMUNITY_ROLE_WORD, COMMUNITY_VISIBILITY, useCommunityMembership } from "./communities";
import { PersonalNotice } from "./shared";

export type CommunityRow = RouterOutputs["live"]["communities"]["list"][number];
interface TableRow extends CommunityRow {
  membership: "joined" | "not_joined";
}

const MEMBERSHIP_OPTIONS = [
  { value: "joined", label: "Joined" },
  { value: "not_joined", label: "Not joined" },
];
const COLUMNS = ["name", "visibility", "memberCount", "membership", "action"];

export const COMMUNITY_VIEWS: SavedView[] = [
  { id: "all", name: "All communities", builtIn: true, columns: COLUMNS, sort: [{ id: "memberCount", desc: true }], filters: [] },
  { id: "joined", name: "Joined", builtIn: true, columns: COLUMNS, sort: [{ id: "name", desc: false }], filters: [{ id: "f-joined", field: "membership", op: "eq", value: "joined" }] },
  { id: "to-join", name: "To join", builtIn: true, columns: COLUMNS, sort: [{ id: "memberCount", desc: true }], filters: [{ id: "f-to-join", field: "membership", op: "eq", value: "not_joined" }] },
];

export function CommunitiesScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  useShellChrome({ title: "Communities" });
  const q = useQuery(trpc.live.communities.list.queryOptions(undefined, { staleTime: 15_000 }));
  const membership = useCommunityMembership();
  // Saved per person across their businesses: the LIVE pages are the account's, not one business's (audit #204).
  const savedViews = useTableViews("live.communities", COMMUNITY_VIEWS, { defaultViewId: "all" });

  const rows = useMemo<TableRow[]>(() => (q.data ?? []).map((c) => ({ ...c, membership: c.role ? "joined" : "not_joined" })), [q.data]);
  const open = (id: string) => router.push(routes.community(id));
  const toggle = (c: TableRow) => (c.role ? membership.leave(c.id, c.name) : membership.join(c.id, c.name));

  const columns = useMemo<DataTableColumn<TableRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Community",
        size: 420,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="t-body-strong shrink-0 text-primary">{row.original.name}</span>
            {row.original.descriptionMd ? <span className="truncate text-small text-secondary">{row.original.descriptionMd}</span> : null}
          </span>
        ),
      },
      {
        id: "visibility",
        accessorKey: "visibility",
        header: "Visibility",
        size: 140,
        cell: ({ row }) => {
          const v = COMMUNITY_VISIBILITY[row.original.visibility];
          return <Chip tone="neutral" icon={v?.icon}>{v?.label ?? row.original.visibility}</Chip>;
        },
        meta: { filter: "select", filterOptions: Object.entries(COMMUNITY_VISIBILITY).map(([value, v]) => ({ value, label: v.label })) },
      },
      { id: "memberCount", accessorKey: "memberCount", header: "Members", size: 100, meta: { numeric: true } },
      {
        id: "membership",
        accessorKey: "membership",
        header: "You",
        size: 140,
        cell: ({ row }) => (row.original.role ? <StatusPill tone="good" icon={Check}>{COMMUNITY_ROLE_WORD[row.original.role] ?? "Member"}</StatusPill> : <StatusPill tone="neutral">Not joined</StatusPill>),
        meta: { filter: "select", filterOptions: MEMBERSHIP_OPTIONS },
      },
      {
        id: "action",
        header: "",
        size: 120,
        enableSorting: false,
        meta: { label: "Join or leave", filter: false, locked: true },
        cell: ({ row }) => {
          const c = row.original;
          const joined = !!c.role;
          return (
            <Button
              size="sm"
              variant={joined ? "ghost" : "default"}
              icon={joined ? LogOut : LogIn}
              disabled={membership.pending && membership.pendingId === c.id}
              aria-label={`${joined ? "Leave" : "Join"} ${c.name}`}
              data-testid={joined ? "community-leave" : "community-join"}
              data-community={c.id}
              // The table opens the focused row on Enter and Space selects it; the button keeps those keys for itself.
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggle(c);
              }}
            >
              {joined ? "Leave" : "Join"}
            </Button>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `toggle` only closes over the stable mutation helpers
    [membership.pending, membership.pendingId],
  );

  const rowActions = (c: TableRow): RowAction<TableRow>[] => [
    { id: "open", label: "Open feed", icon: DoorOpen, onSelect: (r) => open(r.id) },
    c.role ? { id: "leave", label: "Leave", icon: LogOut, variant: "danger", separatorBefore: true, onSelect: toggle } : { id: "join", label: "Join", icon: LogIn, separatorBefore: true, onSelect: toggle },
  ];

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="communities-screen">
      <PersonalNotice className="col-span-12" />
      <Panel
        title="Communities"
        span={12}
        flush
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : undefined}
        onRetry={() => void q.refetch()}
        empty={!q.isLoading && !q.error && rows.length === 0 ? { icon: UsersRound, children: "No communities yet. Public communities, and any you are invited to, are listed here once founders start them." } : undefined}
        actions={<span className="text-small tabular-nums text-secondary">{rows.length} {rows.length === 1 ? "community" : "communities"}</span>}
        footer="Joining lets you read the feed and post. Posts are written and sent by you; agents can draft one, never post it."
        data-testid="communities-panel"
      >
        <DataTable<TableRow>
          aria-label="Communities"
          data={rows}
          columns={columns}
          {...savedViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => open(r.id)}
          height={Math.min(520, Math.max(200, rows.length * 34 + 80))}
          density="comfortable"
          exportFileName="communities"
          empty={{ icon: UsersRound, children: "No communities in this view." }}
          className="border-0"
        />
      </Panel>
    </div>
  );
}
