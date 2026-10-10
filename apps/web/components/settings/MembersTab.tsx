"use client";
/** Settings › Members: the human staff of the business (team.humans.*): roles, section permissions, removal, invites. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus, UserX } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, Chip, Field, IconButton, Input, SimpleSelect } from "@foundmill/dugout";
import { MEMBERSHIP_ROLES, type MembershipRole } from "@foundmill/shared/constants";
import { formatDate, plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

const ROLE_HELP: Record<MembershipRole, string> = {
  owner: "Everything, including tier changes and permanent actions.",
  admin: "Modes, holiday, the stop switch, staff, keys, billing, integrations and structure.",
  member: "Day-to-day work: inbox decisions, tasks, channels and departments.",
  viewer: "Read only.",
  advisor: "Read only, invited for advice.",
};

/** "owner" → "Owner": roles are shown as words, never as stored values. */
export const ROLE_WORD: Record<MembershipRole, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer", advisor: "Advisor" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A long account id, short enough to read on one line ("3f2a91c0…c91e"); the full id is in the tooltip. */
export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function MembersTab() {
  const { businessId, data, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const members = useQuery(trpc.team.humans.list.queryOptions({ businessId }));
  const setRole = useMutation(trpc.team.humans.role.mutationOptions({ onSuccess: () => (void invalidate(["team"]), t.saved("Role updated")), onError: (e) => t.failed(e) }));
  const remove = useMutation(trpc.team.humans.remove.mutationOptions({ onSuccess: () => (void invalidate(["team"]), t.saved("Member removed")), onError: (e) => t.failed(e) }));
  const invite = useMutation(trpc.team.humans.invite.mutationOptions({ onSuccess: () => (void invalidate(["team"]), t.saved("Member added"), setInviteId(""), setInviteEmail("")), onError: (e) => t.failed(e) }));
  const [inviteId, setInviteId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("member");
  // The founder's own name, as the team calls them (the founder profile); the "You" chip only beside a real name.
  const founder = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
  const viewerName = founder.data?.profile?.displayName?.trim() || null;

  if (members.error) return <ErrorPanel title="Members" message={errorMessage(members.error)} onRetry={() => void members.refetch()} />;

  return (
    <AdminOnly>
      <SettingsSection wide title="Staff" meta={members.data ? plural(members.data.length, "person", "people") : undefined} loading={members.isLoading}>
        <ul className="flex flex-col" data-testid="member-list">
          {(members.data ?? []).map((m) => {
            const isSelf = m.userId === data.membership.userId;
            return (
              <li key={m.id} className="flex min-h-row-comfortable items-center gap-3 border-b border-line-faint py-2 last:border-b-0">
                <Avatar size={28} name={isSelf ? (viewerName ?? "You") : ROLE_WORD[m.role as MembershipRole] ?? "Member"} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-body-strong text-primary">
                    {isSelf ? (viewerName ?? "You") : `${ROLE_WORD[m.role as MembershipRole] ?? "Member"} on the team`}
                    {isSelf && viewerName ? <Chip tone="kit">You</Chip> : null}
                  </span>
                  <span className="font-mono text-mono text-tertiary" title={m.userId}>
                    Account {shortId(m.userId)} · since {formatDate(m.createdAt)}
                  </span>
                </span>
                <SimpleSelect aria-label={`Role of ${isSelf ? "you" : shortId(m.userId)}`} controlSize="sm" className="w-32" value={m.role} disabled={m.role === "owner" || (!isOwner && m.role === "admin")} onValueChange={(v) => setRole.mutate({ businessId, userId: m.userId, role: v as MembershipRole })} options={MEMBERSHIP_ROLES.map((r) => ({ value: r, label: ROLE_WORD[r], disabled: r === "owner" }))} />
                <IconButton label={`Remove ${isSelf ? "yourself" : shortId(m.userId)}`} icon={UserX} size="sm" disabled={m.role === "owner" || isSelf} onClick={() => remove.mutate({ businessId, userId: m.userId })} />
              </li>
            );
          })}
        </ul>
        <dl className="grid grid-cols-12 gap-x-3 gap-y-1 text-small" aria-label="What each role can do">
          {MEMBERSHIP_ROLES.map((r) => (
            <div key={r} className="contents">
              <dt className="col-span-2 font-medium text-secondary">{ROLE_WORD[r]}</dt>
              <dd className="col-span-10 text-tertiary">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>
      <SettingsSection title="Add a member">
        <Hint>Add a co-founder or advisor who already has an account, by the account ID shown on their profile. They sign in with their own email. Email invitations are not available yet.</Hint>
        <div className="grid grid-cols-12 gap-3">
          <Field htmlFor="invite-id" label="Account ID" required className="col-span-5">
            <Input id="invite-id" mono value={inviteId} onChange={(e) => setInviteId(e.target.value.trim())} placeholder="00000000-0000-…" invalid={inviteId.length > 0 && !UUID_RE.test(inviteId)} />
          </Field>
          <Field htmlFor="invite-email" label="Email (optional)" className="col-span-4">
            <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field htmlFor="invite-role" label="Role" className="col-span-3">
            <SimpleSelect id="invite-role" value={inviteRole} onValueChange={(v) => setInviteRole(v as MembershipRole)} options={MEMBERSHIP_ROLES.filter((r) => r !== "owner").map((r) => ({ value: r, label: ROLE_WORD[r] }))} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" icon={UserPlus} loading={invite.isPending} disabled={!UUID_RE.test(inviteId)} onClick={() => invite.mutate({ businessId, userId: inviteId, role: inviteRole, email: inviteEmail.trim() || undefined })}>
            Add member
          </Button>
        </div>
      </SettingsSection>
    </AdminOnly>
  );
}
