"use client";
/** Settings › Members: the human staff of the business (team.humans.*): roles, section permissions, removal, invites. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus, UserX } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, Chip, Field, IconButton, Input, SimpleSelect } from "@foundmill/dugout";
import { MEMBERSHIP_ROLES, type MembershipRole } from "@foundmill/shared/constants";
import { formatDate } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

const ROLE_HELP: Record<MembershipRole, string> = {
  owner: "Everything, including tier changes and permanent actions.",
  admin: "Modes, holiday, kill switch, staff, keys, billing, integrations, structure.",
  member: "Day-to-day work: inbox decisions, tasks, channels, departments.",
  viewer: "Read only.",
  advisor: "Read only, invited for advice.",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (members.error) return <ErrorPanel title="Members" message={errorMessage(members.error)} onRetry={() => void members.refetch()} />;

  return (
    <AdminOnly>
      <SettingsSection title="Staff" loading={members.isLoading}>
        <ul className="flex flex-col divide-y divide-subtle" data-testid="member-list">
          {(members.data ?? []).map((m) => {
            const isSelf = m.userId === data.membership.userId;
            return (
              <li key={m.id} className="flex h-row-comfortable items-center gap-3">
                <Avatar size={24} name={m.userId.slice(0, 8)} />
                <span className="flex-1 font-mono text-mono">{m.userId}</span>
                {isSelf ? <Chip tone="kit">You</Chip> : null}
                <span className="text-small text-secondary">since {formatDate(m.createdAt)}</span>
                <SimpleSelect aria-label={`Role of ${m.userId}`} controlSize="sm" value={m.role} disabled={m.role === "owner" || (!isOwner && m.role === "admin")} onValueChange={(v) => setRole.mutate({ businessId, userId: m.userId, role: v as MembershipRole })} options={MEMBERSHIP_ROLES.map((r) => ({ value: r, label: r, disabled: r === "owner" }))} />
                <IconButton label={`Remove ${m.userId}`} icon={UserX} size="sm" disabled={m.role === "owner" || isSelf} onClick={() => remove.mutate({ businessId, userId: m.userId })} />
              </li>
            );
          })}
        </ul>
        <Hint>{Object.entries(ROLE_HELP).map(([r, h]) => `${r}: ${h}`).join(" ")}</Hint>
      </SettingsSection>
      <SettingsSection title="Add a member">
        <Hint>E-mail invitations arrive with the auth build; today a member is added by their account id (they sign in with the same e-mail they will use here).</Hint>
        <div className="grid grid-cols-[1fr_1fr_140px] gap-3">
          <Field htmlFor="invite-id" label="Account id" required>
            <Input id="invite-id" mono value={inviteId} onChange={(e) => setInviteId(e.target.value.trim())} placeholder="00000000-0000-…" invalid={inviteId.length > 0 && !UUID_RE.test(inviteId)} />
          </Field>
          <Field htmlFor="invite-email" label="E-mail (optional)">
            <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field htmlFor="invite-role" label="Role">
            <SimpleSelect id="invite-role" value={inviteRole} onValueChange={(v) => setInviteRole(v as MembershipRole)} options={MEMBERSHIP_ROLES.filter((r) => r !== "owner").map((r) => ({ value: r, label: r }))} />
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
