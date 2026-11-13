"use client";
/**
 * Team › People (BUILD §6.3, §11.9; the tab's slug stays `staff`): the project's people (Owner, Cofounder, Admin, Member, Collaborator, Viewer,
 * Advisor) with their per-section permissions and the decision types they approve. Change role or permissions, remove
 * (team.humans.role / remove). Inviting someone is Settings › People's alone (`invitation.create`; THESIS_REVIEW 3.1:
 * the silent add by email or account id is gone, and the solo guard keeps the control in one place). Humans are CRM
 * entities: a member with an entity id links to its profile.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { ExternalLink, ShieldCheck, UserRoundMinus, Users } from "lucide-react";
import { Avatar, Button, Chip, DataTable, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Field, Panel, SimpleSelect, formatRelative, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { isAdminRole, isOwnerRole, MEMBERSHIP_ROLES, type MembershipRole } from "@foundmill/shared/constants";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { fitColumns, fitToGrow, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { DECISION_LABELS, InlineError, ROLE_LABELS, STAFF_SECTIONS, Screen, memberEntity, memberName, permissionSummary, readMe, sectionLabel, SIMPLE_VIEW_ID, useAction, useDefaultViewId, useHumans, useMe, useNow, type Me } from "./shared";
import type { MembershipRow, ResponsibilitiesResponse, SectionPermission } from "./types";

export interface StaffRow {
  id: string;
  userId: string;
  name: string;
  role: MembershipRole;
  roleLabel: string;
  writes: string[];
  reads: string[];
  /** Sections walled off from this member ("No access"), by label. */
  none: string[];
  approves: string[];
  joinedAt: string | null;
  isMe: boolean;
  membership: MembershipRow;
}

export const STAFF_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): who they are, their role, what they can open and what they approve; first while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["name", "role", "sections", "approves"], sort: [{ id: "role", desc: false }], filters: [] },
  { id: "all", name: "Everyone", builtIn: true, columns: ["name", "role", "sections", "approves", "joined"], sort: [{ id: "role", desc: false }], filters: [] },
  { id: "admins", name: "Founders and admins", builtIn: true, columns: ["name", "role", "sections", "approves"], sort: [{ id: "role", desc: false }], filters: [{ id: "role-admins", field: "role", op: "in", value: ["owner", "cofounder", "admin"] }] },
  { id: "approvers", name: "Approvers", builtIn: true, columns: ["name", "role", "approves"], sort: [{ id: "approves", desc: true }], filters: [{ id: "approves-any", field: "approves", op: "gt", value: 0 }] },
];

/** Column minimums and how the extra width is shared (see fit.ts). */
export const STAFF_FIT: Record<string, ColumnFit> = {
  name: { min: 240, grow: 3 },
  role: { min: 112 },
  sections: { min: 280, grow: 4 },
  approves: { min: 200, grow: 2 },
  joined: { min: 112 },
};

const ROW_PX = 28;

const ROLE_ORDER: Record<MembershipRole, number> = { owner: 0, cofounder: 1, admin: 2, member: 3, collaborator: 4, advisor: 5, viewer: 6 };
/** The roles someone without an owner's standing may give: never an owner's or a cofounder's (team.humans.role, 0090). */
const INVITABLE_ROLES = MEMBERSHIP_ROLES.filter((r) => !isOwnerRole(r));

/**
 * Why the viewer may not change this member's role and permissions (team.humans.role, 0026_membership_guards, 0090), or
 * null: nobody edits their own row, and only an owner or a cofounder changes an owner's or a cofounder's.
 */
export function roleLockReason(row: Pick<StaffRow, "isMe" | "role">, viewerRole: MembershipRole | null): string | null {
  if (row.isMe) return "You cannot change your own role or permissions; another owner or admin can.";
  if (isOwnerRole(row.role) && !isOwnerRole(viewerRole)) return "Only an owner or a cofounder can change an owner's or a cofounder's role or permissions.";
  return null;
}
const PERMISSION_OPTIONS: { value: SectionPermission; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
];

/**
 * A member's per-section overrides in the words the Sections cell shows: "Finance · no access" first (a wall is what
 * the owner most needs to see), then writes and reads. Empty when the role's defaults apply everywhere.
 */
export function sectionOverrides(row: Pick<StaffRow, "writes" | "reads" | "none">): { section: string; level: "none" | "write" | "read"; word: string }[] {
  return [...row.none.map((section) => ({ section, level: "none" as const, word: "no access" })), ...row.writes.map((section) => ({ section, level: "write" as const, word: "write" })), ...row.reads.map((section) => ({ section, level: "read" as const, word: "read" }))];
}

export function toStaffRows(members: readonly MembershipRow[] | undefined, responsibilities: ResponsibilitiesResponse | undefined, me: Me): StaffRow[] {
  return (members ?? [])
    .map((m) => {
      const perms = permissionSummary(m.sectionPermissions);
      const approves = (responsibilities?.matrix ?? []).filter((r) => r.handler.kind === "user" && r.handler.id === m.userId).map((r) => DECISION_LABELS[r.decisionType]);
      return { id: m.userId, userId: m.userId, name: memberName(m, me), role: m.role, roleLabel: ROLE_LABELS[m.role], writes: perms.write, reads: perms.read, none: perms.none, approves, joinedAt: m.createdAt ? new Date(m.createdAt).toISOString() : null, isMe: me.userId === m.userId, membership: m };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

/* ---------- Dialogs ---------- */

interface PermissionGridProps {
  id: string;
  value: Record<string, SectionPermission>;
  onChange: (next: Record<string, SectionPermission>) => void;
  disabled?: boolean;
}

/** One select per section (modules plus the fixed surfaces). A section left out inherits the role's default. */
function PermissionGrid({ id, value, onChange, disabled }: PermissionGridProps) {
  return (
    <fieldset className="grid grid-cols-2 gap-x-4 gap-y-2" disabled={disabled}>
      <legend className="t-label mb-1 col-span-2">Section permissions</legend>
      {STAFF_SECTIONS.map((section) => {
        const sid = `${id}-perm-${section}`;
        return (
          <div key={section} className="flex items-center justify-between gap-2">
            <label htmlFor={sid} className="min-w-0 text-body text-primary">
              {sectionLabel(section)}
            </label>
            <SimpleSelect id={sid} aria-label={`${sectionLabel(section)} permission`} controlSize="sm" className="w-40 shrink-0" options={[{ value: "inherit", label: "Role default" }, ...PERMISSION_OPTIONS]} value={value[section] ?? "inherit"} disabled={disabled} onValueChange={(v) => {
              const next = { ...value };
              if (v === "inherit") delete next[section];
              else next[section] = v as SectionPermission;
              onChange(next);
            }} />
          </div>
        );
      })}
    </fieldset>
  );
}

export interface RoleDialogProps {
  row: StaffRow | null;
  /** The signed-in person's role here (null while unknown): only an owner sees Owner in the list. */
  viewerRole: MembershipRole | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (membership: MembershipRow) => void;
}

/**
 * Change another member's role and section permissions (team.humans.role). Nobody edits their own row; only an owner
 * edits an owner's or grants ownership (the role list offers Owner to owners only).
 */
export function RoleDialog({ row, viewerRole, onOpenChange, onSaved }: RoleDialogProps) {
  const id = useId();
  const action = useAction();
  const [role, setRole] = useState<MembershipRole>("member");
  const [perms, setPerms] = useState<Record<string, SectionPermission>>({});
  useEffect(() => {
    if (row) {
      setRole(row.role);
      setPerms({ ...row.membership.sectionPermissions });
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per member
  }, [row?.userId]);
  const locked = row ? roleLockReason(row, viewerRole) : null;
  const roleOptions = isOwnerRole(viewerRole) ? MEMBERSHIP_ROLES : INVITABLE_ROLES;
  const confirm = async () => {
    if (!row || locked) return;
    const input: Record<string, unknown> = { userId: row.userId, sectionPermissions: perms };
    if (role !== row.role) input.role = role;
    const m = await action.run<MembershipRow>("team.humans.role", input, { key: `role:${row.userId}` });
    if (m) {
      onSaved(m);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby={`${id}-desc`} data-testid="role-dialog">
        <DialogHeader>
          <DialogTitle>Role and permissions for {row?.name}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{locked ?? (isOwnerRole(row?.role) ? "A business always keeps at least one owner or cofounder; changes are logged." : "Changes apply on the member's next request and are logged.")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-role`} label="Role">
            <SimpleSelect id={`${id}-role`} aria-label="Role" options={(locked ? MEMBERSHIP_ROLES : roleOptions).map((r) => ({ value: r, label: ROLE_LABELS[r] }))} value={role} onValueChange={(v) => setRole(v as MembershipRole)} disabled={!!locked} />
          </Field>
          <PermissionGrid id={id} value={perms} onChange={setPerms} disabled={!!locked} />
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={ShieldCheck} disabled={!!locked} loading={action.pending !== null} onClick={() => void confirm()} data-testid="role-confirm">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface RemoveDialogProps {
  row: StaffRow | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: (row: StaffRow) => void;
}

export function RemoveDialog({ row, onOpenChange, onRemoved }: RemoveDialogProps) {
  const id = useId();
  const action = useAction();
  const blocked = row ? (row.isMe ? "Leave the business from Settings instead of removing yourself." : row.role === "owner" ? "The owner cannot be removed." : row.role === "cofounder" ? "A cofounder cannot be removed; change their role first." : null) : null;
  const confirm = async () => {
    if (!row) return;
    const r = await action.run("team.humans.remove", { userId: row.userId }, { key: `remove:${row.userId}` });
    if (r !== undefined) {
      onRemoved(row);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`} data-testid="remove-dialog">
        <DialogHeader>
          <DialogTitle>Remove {row?.name}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>{blocked ?? `${row?.name} loses access to this business now. Decisions they approve go back to you. Their CRM entity and history stay.`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {row?.approves.length ? <p className="text-small text-status-warn">Approves: {row.approves.join(", ")}.</p> : null}
          <InlineError error={action.error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep
          </Button>
          <Button variant="danger" icon={UserRoundMinus} disabled={!!blocked} loading={action.pending !== null} onClick={() => void confirm()} data-testid="remove-confirm">
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Screen ---------- */

export function StaffScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const now = useNow();
  const humans = useHumans();
  const meQuery = useMe();
  const responsibilities = useWidgetQuery<ResponsibilitiesResponse>("team.responsibilities.get", undefined);
  const me = useMemo(() => readMe(meQuery.data, businessId), [meQuery.data, businessId]);
  const rows = useMemo(() => toStaffRows(humans.data, responsibilities.data, me), [humans.data, responsibilities.data, me]);
  // Saved per person, business and table (audit #204): they come back after a reload.
  const defaultViewId = useDefaultViewId("all");
  const savedViews = useSavedViews("team.staff", STAFF_VIEWS, { defaultViewId });
  const [edit, setEdit] = useState<StaffRow | null>(null);
  const [remove, setRemove] = useState<StaffRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const myRole = rows.find((r) => r.isMe)?.role ?? null;
  const canAdmin = isAdminRole(myRole) || !me.userId;
  // Each column at its minimum; the table shares the spare width by STAFF_FIT's weights itself (DataTable `meta.grow`).
  const sizes = useMemo(() => fitColumns(null, STAFF_FIT, []), []);

  const columns = useMemo<DataTableColumn<StaffRow>[]>(
    () => fitToGrow<StaffRow>([
      {
        id: "name",
        accessorKey: "name",
        header: "Member",
        size: sizes.name,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar size={24} name={row.original.name} />
            <EntityLink entity={{ id: row.original.membership.entityId ?? row.original.userId, kind: "team_member", name: row.original.name, href: row.original.membership.entityId ? `/b/${businessId}/crm/${row.original.membership.entityId}/overview` : undefined }} details={memberEntity(businessId, row.original.membership, me)} hideIcon className="min-w-0 truncate text-body-strong" onOpen={(e) => e.href && navigate(e.href)} onVerb={(verb, e) => verb === "open_profile" && e.href && navigate(e.href)} />
            {row.original.isMe ? (
              <Chip tone="info" className="shrink-0">
                You
              </Chip>
            ) : null}
          </span>
        ),
      },
      { id: "role", accessorKey: "role", header: "Role", size: sizes.role, cell: ({ row }) => <Chip tone={isOwnerRole(row.original.role) ? "kit" : row.original.role === "admin" ? "info" : "neutral"}>{row.original.roleLabel}</Chip>, meta: { filter: "select", filterOptions: MEMBERSHIP_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) }, sortingFn: (a, b) => ROLE_ORDER[a.original.role] - ROLE_ORDER[b.original.role] },
      {
        id: "sections",
        accessorFn: (r) => sectionOverrides(r).map((a) => `${a.section} · ${a.word}`).join(", "),
        header: "Sections",
        size: sizes.sections,
        cell: ({ row }) => {
          const all = sectionOverrides(row.original);
          if (!all.length) return <span className="text-secondary">Role default</span>;
          // One line of plain words (walls first, in the warning colour; then writes in the primary colour), so a long
          // list ends in an ellipsis with the whole list in the tooltip instead of chips cut at the cell edge.
          return (
            <span className="block min-w-0 truncate" title={all.map((a) => `${a.section} · ${a.word}`).join(", ")}>
              {all.map((a, i) => (
                <span key={`${a.level}-${a.section}`}>
                  {i > 0 ? <span className="text-tertiary">, </span> : null}
                  <span className={a.level === "none" ? "text-status-warn" : a.level === "write" ? "text-primary" : "text-secondary"}>{`${a.section} · ${a.word}`}</span>
                </span>
              ))}
            </span>
          );
        },
      },
      { id: "approves", accessorFn: (r) => r.approves.length, header: "Approves", size: sizes.approves, meta: { filter: "number", csv: (r) => r.approves.join("; ") }, cell: ({ row }) => (row.original.approves.length ? <span className="block min-w-0 truncate" title={row.original.approves.join(", ")}>{row.original.approves.join(", ")}</span> : <span className="text-tertiary">—</span>) },
      { id: "joined", accessorKey: "joinedAt", header: "Joined", size: sizes.joined, cell: ({ row }) => (row.original.joinedAt ? <span className="text-secondary">{formatRelative(row.original.joinedAt, now)}</span> : "—") },
    ], STAFF_FIT),
    [businessId, me, navigate, now, sizes],
  );

  const rowActions = (row: StaffRow): RowAction<StaffRow>[] => [
    { id: "profile", label: "Open profile", icon: ExternalLink, disabled: !row.membership.entityId, onSelect: () => row.membership.entityId && navigate(`/b/${businessId}/crm/${row.membership.entityId}/overview`) },
    { id: "role", label: "Role and permissions…", icon: ShieldCheck, separatorBefore: true, disabled: !canAdmin || roleLockReason(row, myRole) !== null, onSelect: () => setEdit(row) },
    { id: "remove", label: "Remove", icon: UserRoundMinus, variant: "danger", disabled: row.isMe || isOwnerRole(row.role), onSelect: () => setRemove(row) },
  ];

  const refetch = () => {
    humans.refetch();
    responsibilities.refetch();
  };

  return (
    <Screen name="team/staff">
      <Panel
        span={12}
        title="People"
        flush
        loading={humans.isLoading && !humans.data}
        error={humans.error ? humans.error.message : undefined}
        onRetry={refetch}
        empty={humans.data && rows.length === 0 ? { icon: Users, title: "No one to show", children: "The people of the project appear here with their role and what they can open." } : undefined}
        meta={
          rows.length ? (
            <span data-testid="staff-summary">
              {plural(rows.length, "person", "people")} · {rows.filter((r) => r.approves.length).length} approving
            </span>
          ) : undefined
        }
        footer={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Humans are CRM entities; a member with a linked entity opens its profile. Every role change is logged.</span>
            {notice ? (
              <span data-testid="staff-notice" className="text-secondary">
                {notice}
              </span>
            ) : null}
          </span>
        }
      >
        <div className="min-w-0">
          {/* The table is as tall as its rows (up to the window), so one person is not a screen of empty rows. */}
          <DataTable<StaffRow> aria-label="People" data={rows} columns={columns} {...savedViews} defaultViewId={defaultViewId} rowActions={rowActions} onRowOpen={(row) => setEdit(row)} height={Math.min(typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 264), Math.max(1, rows.length) * ROW_PX + 42)} exportFileName="staff" className="border-0" />
        </div>
      </Panel>

      <RoleDialog
        row={edit}
        viewerRole={myRole}
        onOpenChange={(o) => !o && setEdit(null)}
        onSaved={(m) => {
          setNotice(`${memberName(m, me)} is now ${ROLE_LABELS[m.role]}.`);
          refetch();
        }}
      />
      <RemoveDialog
        row={remove}
        onOpenChange={(o) => !o && setRemove(null)}
        onRemoved={(r) => {
          setNotice(`${r.name} removed.`);
          refetch();
        }}
      />
    </Screen>
  );
}
