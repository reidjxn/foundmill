"use client";
/**
 * Team › Staff (BUILD §6.3, §11.9): the humans of the business (Owner, Admin, Member, Viewer, Advisor) with their
 * per-section permissions and the decision types they approve. Invite, change role or permissions, remove
 * (team.humans.invite / role / remove). Humans are CRM entities: a member with an entity id links to its profile.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { ExternalLink, ShieldCheck, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Avatar, Button, Chip, DataTable, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, EntityLink, Field, Input, Panel, SimpleSelect, formatRelative, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { MEMBERSHIP_ROLES, type MembershipRole } from "@foundmill/shared/constants";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { fitColumns, plural, useTableWidth, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { DECISION_LABELS, InlineError, ROLE_LABELS, STAFF_SECTIONS, Screen, memberEntity, memberName, permissionSummary, readMe, sectionLabel, useAction, useHumans, useMe, useNow, type Me } from "./shared";
import type { MembershipRow, ResponsibilitiesResponse, SectionPermission } from "./types";

export interface StaffRow {
  id: string;
  userId: string;
  name: string;
  role: MembershipRole;
  roleLabel: string;
  writes: string[];
  reads: string[];
  approves: string[];
  joinedAt: string | null;
  isMe: boolean;
  membership: MembershipRow;
}

export const STAFF_VIEWS: SavedView[] = [
  { id: "all", name: "All staff", builtIn: true, columns: ["name", "role", "sections", "approves", "joined"], sort: [{ id: "role", desc: false }], filters: [] },
  { id: "admins", name: "Owners and admins", builtIn: true, columns: ["name", "role", "sections", "approves"], sort: [{ id: "role", desc: false }], filters: [{ id: "role-admins", field: "role", op: "in", value: ["owner", "admin"] }] },
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

const ROLE_ORDER: Record<MembershipRole, number> = { owner: 0, admin: 1, member: 2, advisor: 3, viewer: 4 };
const INVITABLE_ROLES = MEMBERSHIP_ROLES.filter((r) => r !== "owner");
const PERMISSION_OPTIONS: { value: SectionPermission; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
];

export function toStaffRows(members: readonly MembershipRow[] | undefined, responsibilities: ResponsibilitiesResponse | undefined, me: Me): StaffRow[] {
  return (members ?? [])
    .map((m) => {
      const perms = permissionSummary(m.sectionPermissions);
      const approves = (responsibilities?.matrix ?? []).filter((r) => r.handler.kind === "user" && r.handler.id === m.userId).map((r) => DECISION_LABELS[r.decisionType]);
      return { id: m.userId, userId: m.userId, name: memberName(m, me), role: m.role, roleLabel: ROLE_LABELS[m.role], writes: perms.write, reads: perms.read, approves, joinedAt: m.createdAt ? new Date(m.createdAt).toISOString() : null, isMe: me.userId === m.userId, membership: m };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- Dialogs ---------- */

interface PermissionGridProps {
  id: string;
  value: Record<string, SectionPermission>;
  onChange: (next: Record<string, SectionPermission>) => void;
}

/** One select per section (modules plus the fixed surfaces). A section left out inherits the role's default. */
function PermissionGrid({ id, value, onChange }: PermissionGridProps) {
  return (
    <fieldset className="grid grid-cols-2 gap-x-4 gap-y-2">
      <legend className="t-label mb-1 col-span-2">Section permissions</legend>
      {STAFF_SECTIONS.map((section) => {
        const sid = `${id}-perm-${section}`;
        return (
          <div key={section} className="flex items-center justify-between gap-2">
            <label htmlFor={sid} className="min-w-0 text-body text-primary">
              {sectionLabel(section)}
            </label>
            <SimpleSelect id={sid} aria-label={`${sectionLabel(section)} permission`} controlSize="sm" className="w-40 shrink-0" options={[{ value: "inherit", label: "Role default" }, ...PERMISSION_OPTIONS]} value={value[section] ?? "inherit"} onValueChange={(v) => {
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

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (membership: MembershipRow) => void;
}

/** Invite by Supabase user id (the e-mail invitation itself is sent by the web app's auth flow). */
export function InviteDialog({ open, onOpenChange, onInvited }: InviteDialogProps) {
  const id = useId();
  const action = useAction();
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("member");
  const [perms, setPerms] = useState<Record<string, SectionPermission>>({});
  useEffect(() => {
    if (open) {
      setUserId("");
      setEmail("");
      setRole("member");
      setPerms({});
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per opening
  }, [open]);
  const validId = UUID.test(userId.trim());
  const confirm = async () => {
    const input: Record<string, unknown> = { userId: userId.trim(), role, sectionPermissions: perms };
    if (email.trim()) input.email = email.trim();
    const m = await action.run<MembershipRow>("team.humans.invite", input, { key: "invite" });
    if (m) {
      onInvited(m);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wide enough for the two columns of section permissions with "Role default" in full. */}
      <DialogContent size="lg" aria-describedby={`${id}-desc`} data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>Invite staff</DialogTitle>
          <DialogDescription id={`${id}-desc`}>A person with a Foundmill account joins this business with a role and, where needed, per-section permissions. Ownership is transferred from Settings, not granted here.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-user`} label="Account id" required hint="Find it in Settings › Members or on the person's profile." error={userId && !validId ? "That is not an account id; it has 36 letters, digits and dashes." : undefined}>
            <Input id={`${id}-user`} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Paste the account id" className="font-mono text-mono" aria-invalid={!!userId && !validId} />
          </Field>
          <Field htmlFor={`${id}-email`} label="E-mail" hint="Shown next to the name until the CRM entity is linked.">
            <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field htmlFor={`${id}-role`} label="Role" required>
            <SimpleSelect id={`${id}-role`} aria-label="Role" options={INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} value={role} onValueChange={(v) => setRole(v as MembershipRole)} />
          </Field>
          <PermissionGrid id={id} value={perms} onChange={setPerms} />
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserRoundPlus} disabled={!validId} loading={action.pending !== null} onClick={() => void confirm()} data-testid="invite-confirm">
            Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface RoleDialogProps {
  row: StaffRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (membership: MembershipRow) => void;
}

/** Change a member's role and section permissions (team.humans.role). Your own role cannot be changed here. */
export function RoleDialog({ row, onOpenChange, onSaved }: RoleDialogProps) {
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
  const roleLocked = !!row && (row.isMe || row.role === "owner");
  const confirm = async () => {
    if (!row) return;
    const input: Record<string, unknown> = { userId: row.userId, sectionPermissions: perms };
    if (!roleLocked && role !== row.role) input.role = role;
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
          <DialogDescription id={`${id}-desc`}>{roleLocked ? (row?.isMe ? "You cannot change your own role; permissions still apply." : "The owner's role is fixed; transfer ownership from Settings.") : "Changes apply on the member's next request and are logged."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-role`} label="Role">
            <SimpleSelect id={`${id}-role`} aria-label="Role" options={(roleLocked ? MEMBERSHIP_ROLES : INVITABLE_ROLES).map((r) => ({ value: r, label: ROLE_LABELS[r] }))} value={role} onValueChange={(v) => setRole(v as MembershipRole)} disabled={roleLocked} />
          </Field>
          <PermissionGrid id={id} value={perms} onChange={setPerms} />
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={ShieldCheck} loading={action.pending !== null} onClick={() => void confirm()} data-testid="role-confirm">
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
  const blocked = row ? (row.isMe ? "Leave the business from Settings instead of removing yourself." : row.role === "owner" ? "The owner cannot be removed." : null) : null;
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
  const [views, setViews] = useState<SavedView[]>(STAFF_VIEWS);
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<StaffRow | null>(null);
  const [remove, setRemove] = useState<StaffRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canAdmin = rows.find((r) => r.isMe)?.role === "owner" || rows.find((r) => r.isMe)?.role === "admin" || !me.userId;
  const [tableRef, tableWidth] = useTableWidth();
  const sizes = useMemo(() => fitColumns(tableWidth, STAFF_FIT, STAFF_VIEWS[0]!.columns as string[]), [tableWidth]);
  const onlyMe = rows.length > 0 && rows.every((r) => r.isMe);

  const columns = useMemo<DataTableColumn<StaffRow>[]>(
    () => [
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
      { id: "role", accessorKey: "role", header: "Role", size: sizes.role, cell: ({ row }) => <Chip tone={row.original.role === "owner" ? "kit" : row.original.role === "admin" ? "info" : "neutral"}>{row.original.roleLabel}</Chip>, meta: { filter: "select", filterOptions: MEMBERSHIP_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) }, sortingFn: (a, b) => ROLE_ORDER[a.original.role] - ROLE_ORDER[b.original.role] },
      {
        id: "sections",
        accessorFn: (r) => [...r.writes.map((s) => `${s}: write`), ...r.reads.map((s) => `${s}: read`)].join(", "),
        header: "Sections",
        size: sizes.sections,
        cell: ({ row }) => {
          const { writes, reads } = row.original;
          if (!writes.length && !reads.length) return <span className="text-secondary">Role default</span>;
          // One line of plain words (writes first, in the primary colour), so a long list ends in an ellipsis with the
          // whole list in the tooltip instead of chips cut at the cell edge.
          const all = [...writes.map((s) => ({ s, level: "write" })), ...reads.map((s) => ({ s, level: "read" }))];
          return (
            <span className="block min-w-0 truncate" title={all.map((a) => `${a.s} · ${a.level}`).join(", ")}>
              {all.map((a, i) => (
                <span key={`${a.level}-${a.s}`}>
                  {i > 0 ? <span className="text-tertiary">, </span> : null}
                  <span className={a.level === "write" ? "text-primary" : "text-secondary"}>{`${a.s} · ${a.level}`}</span>
                </span>
              ))}
            </span>
          );
        },
      },
      { id: "approves", accessorFn: (r) => r.approves.length, header: "Approves", size: sizes.approves, meta: { filter: "number", csv: (r) => r.approves.join("; ") }, cell: ({ row }) => (row.original.approves.length ? <span className="block min-w-0 truncate" title={row.original.approves.join(", ")}>{row.original.approves.join(", ")}</span> : <span className="text-tertiary">—</span>) },
      { id: "joined", accessorKey: "joinedAt", header: "Joined", size: sizes.joined, cell: ({ row }) => (row.original.joinedAt ? <span className="text-secondary">{formatRelative(row.original.joinedAt, now)}</span> : "—") },
    ],
    [businessId, me, navigate, now, sizes],
  );

  const rowActions = (row: StaffRow): RowAction<StaffRow>[] => [
    { id: "profile", label: "Open profile", icon: ExternalLink, disabled: !row.membership.entityId, onSelect: () => row.membership.entityId && navigate(`/b/${businessId}/crm/${row.membership.entityId}/overview`) },
    { id: "role", label: "Role and permissions…", icon: ShieldCheck, separatorBefore: true, onSelect: () => setEdit(row) },
    { id: "remove", label: "Remove", icon: UserRoundMinus, variant: "danger", disabled: row.isMe || row.role === "owner", onSelect: () => setRemove(row) },
  ];

  const refetch = () => {
    humans.refetch();
    responsibilities.refetch();
  };

  return (
    <Screen name="team/staff">
      <Panel
        span={12}
        title="Staff"
        flush
        loading={humans.isLoading && !humans.data}
        error={humans.error ? humans.error.message : undefined}
        onRetry={refetch}
        empty={humans.data && rows.length === 0 ? { icon: Users, title: "Only you so far", children: "Staff are the humans of the business: co-founders, advisors, contractors. Each gets a role, section permissions and can approve decision types.", action: { label: "Invite staff", icon: UserRoundPlus, onClick: () => setInvite(true) } } : undefined}
        meta={
          rows.length ? (
            <span data-testid="staff-summary">
              {plural(rows.length, "person", "people")} · {rows.filter((r) => r.approves.length).length} approving
            </span>
          ) : undefined
        }
        actions={
          <Button size="sm" icon={UserRoundPlus} onClick={() => setInvite(true)} disabled={!canAdmin} title={canAdmin ? undefined : "Only owners and admins invite staff"}>
            Invite
          </Button>
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
        <div ref={tableRef} className="min-w-0">
          {/* The table is as tall as its rows (up to the window), so one person is not a screen of empty rows. */}
          <DataTable<StaffRow> aria-label="Staff" data={rows} columns={columns} views={views} onViewsChange={setViews} defaultViewId="all" rowActions={rowActions} onRowOpen={(row) => setEdit(row)} height={Math.min(typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 264), Math.max(1, rows.length) * ROW_PX + 42)} exportFileName="staff" className="border-0" />
        </div>
        {onlyMe ? (
          <EmptyState icon={Users} title="Only you so far" tone="kit" className="border-t border-line-faint" action={canAdmin ? { label: "Invite staff", icon: UserRoundPlus, onClick: () => setInvite(true) } : undefined}>
            Staff are the humans of the business: co-founders, advisors, contractors. Each gets a role and section permissions, and can approve decision types.
          </EmptyState>
        ) : null}
      </Panel>

      <InviteDialog
        open={invite}
        onOpenChange={setInvite}
        onInvited={(m) => {
          setNotice(`${memberName(m, me)} invited as ${ROLE_LABELS[m.role]}.`);
          refetch();
        }}
      />
      <RoleDialog
        row={edit}
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
