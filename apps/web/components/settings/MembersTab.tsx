"use client";
/**
 * Settings › People (the slug stays `members`): the project's people (team.humans.*: roles, section permissions,
 * removal) and inviting someone (THESIS_REVIEW 3.1; invitation.*). The one place in the product with an "invite"
 * control (the solo guard, docs/NETWORK.md §10): nothing here or anywhere else asks a founder to invite anyone, and a
 * project with one person shows that person and the control, nothing about who is missing.
 *
 * "Invite someone" makes an invitation: a role (cofounder or collaborator, each with one plain sentence), and an
 * address: always for a cofounder (only the account signed in with it can accept, so the link is never a key to the
 * project for whoever holds it), and for a collaborator only if Foundmill should email the link (an invitation that
 * names an address is that address's only). The link is shown once, to copy; it works once, for 14 days. The
 * invitations still waiting are listed with Revoke, and only when there are some. The silent add by email or account id
 * is gone (the api's `team.humans.invite` with it).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Link2, UserX } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, IconButton, Input, RadioGroup, RadioOption, SimpleSelect, useDateFormat, useToast } from "@foundmill/dugout";
import { isAdminRole, isOwnerRole, type MembershipRole } from "@foundmill/shared/constants";
import { INVITATION_ROLE_SENTENCE, INVITATION_ROLE_WORD, invitationNeedsEmail, rolesThatMayInvite, type InvitationRole } from "@foundmill/shared/people";
import { formatDate, plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";
import { ROLE_WORD } from "@/lib/roles";

const ROLE_HELP: Record<MembershipRole, string> = {
  owner: "Everything, including plan changes and permanent actions.",
  cofounder: "Everything an owner can do, with equal standing.",
  admin: "Modes, vacation, the stop switch, people, keys, billing, integrations and structure.",
  member: "Day-to-day work: inbox decisions, tasks, channels and departments.",
  collaborator: "Product and Customers, and reading the plan. No Money or Settings. Their access can end on a date.",
  viewer: "Read only.",
  advisor: "Read only, for advice.",
};

/** The roles in the order a person reads them (the stored order appends the two newest, THESIS_REVIEW 3.3). */
export const ROLE_ORDER: readonly MembershipRole[] = ["owner", "cofounder", "admin", "member", "collaborator", "viewer", "advisor"];

export { ROLE_WORD };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * How a member is named where no profile of theirs is at hand: their name or sign-in email when the list carries them,
 * else their role and short account ID ("the admin with account 3f2a91c0…c91e").
 */
export function memberLabel(m: { userId: string; role: string; displayName?: string | null; email?: string | null }): string {
  const name = m.displayName?.trim() || m.email?.trim();
  if (name) return name;
  return `the ${(ROLE_WORD[m.role as MembershipRole] ?? "member").toLowerCase()} with account ${shortId(m.userId)}`;
}

/** A long account id, short enough to read on one line ("3f2a91c0…c91e"); the full id is in the tooltip. */
export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** Whether `role` may invite someone in `invitationRole` (a cofounder only an owner's or a cofounder's; the api and RLS say the same). */
export const mayInvite = (role: MembershipRole, invitationRole: InvitationRole): boolean => rolesThatMayInvite(invitationRole).includes(role);

/**
 * Whether a person with `viewer`'s role may change `target`'s role here: nobody their own; an owner's row never from
 * this list (an owner steps down by making another person an owner first); a cofounder's and an admin's only by someone
 * with an owner's standing (the api and RLS say the same, 0026 and 0092).
 */
export function mayChangeRole(viewer: MembershipRole, target: MembershipRole, isSelf: boolean): boolean {
  if (isSelf || target === "owner") return false;
  if (target === "cofounder" || target === "admin") return isOwnerRole(viewer);
  return isAdminRole(viewer);
}

/** The line under a person's name: their role, since when, and a collaborator's end date ("until Nov 27" / "access ended Nov 3"). */
export function memberMeta(m: { role: MembershipRole; createdAt: Date | string; expiresAt?: Date | string | null }, fmt: (d: Date | string) => string, now = new Date()): string {
  const parts = [ROLE_WORD[m.role] ?? "Member", `since ${fmt(m.createdAt)}`];
  if (m.expiresAt) parts.push(new Date(m.expiresAt).getTime() <= now.getTime() ? `access ended ${fmt(m.expiresAt)}` : `until ${fmt(m.expiresAt)}`);
  return parts.join(" · ");
}

/**
 * The address: a cofounder invitation needs one (only the account signed in with it can accept); for a collaborator
 * empty is fine (copy the link yourself). Either way what is typed must look like one. `touched`: say nothing about an
 * empty required field until the person has typed or pressed Create.
 */
export function inviteEmailProblem(value: string, required = false, touched = true): string | null {
  const v = value.trim();
  if (v === "") return required && touched ? "Type the email address of the person you're inviting as a cofounder." : null;
  return EMAIL_RE.test(v) ? null : "That doesn't look like an email address.";
}

/** The address field's words for the chosen role. */
export function inviteEmailField(role: InvitationRole): { label: string; hint: string } {
  return invitationNeedsEmail(role)
    ? { label: "Their email", hint: "Only the person signed in with this address can accept. We email them the link, and you can copy it too." }
    : { label: "Email it to (optional)", hint: "Leave it empty to copy the link and send it yourself. With an address, only the person signed in with it can accept." };
}

export function MembersTab() {
  const datePrefs = useDateFormat();
  const { businessId, data, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const { toast } = useToast();
  const members = useQuery(trpc.team.humans.list.queryOptions({ businessId }));
  const invitations = useQuery(trpc.invitation.list.queryOptions({ businessId }));
  const setRole = useMutation(trpc.team.humans.role.mutationOptions({ onSuccess: () => (void invalidate(["team"]), t.saved("Role updated")), onError: (e) => t.failed(e) }));
  const remove = useMutation(trpc.team.humans.remove.mutationOptions({ onSuccess: () => (void invalidate(["team"]), t.saved("Removed from the project")), onError: (e) => t.failed(e) }));
  const myRole = data.membership.role as MembershipRole;
  const [inviteRole, setInviteRole] = useState<InvitationRole>(mayInvite(myRole, "cofounder") ? "cofounder" : "collaborator");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTried, setInviteTried] = useState(false);
  const [created, setCreated] = useState<{ link: string; emailed: boolean | null; role: InvitationRole } | null>(null);
  const create = useMutation(
    trpc.invitation.create.mutationOptions({
      onSuccess: (r) => {
        setCreated({ link: r.link, emailed: r.emailed, role: r.invitation.role });
        setInviteEmail("");
        setInviteTried(false);
        void invalidate(["invitation"]);
      },
      onError: (e) => t.failed(e),
    }),
  );
  const revoke = useMutation(trpc.invitation.revoke.mutationOptions({ onSuccess: () => (void invalidate(["invitation"]), t.saved("Invitation revoked")), onError: (e) => t.failed(e) }));
  // Removing a person's access is confirmed first, naming them and their role (DESIGN: destructive actions).
  const [removing, setRemoving] = useState<{ userId: string; name: string; role: MembershipRole } | null>(null);
  // The founder's own name, as the team calls them (the founder profile); the "You" chip only beside a real name.
  const founder = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
  const viewerName = founder.data?.profile?.displayName?.trim() || null;
  const emailRequired = invitationNeedsEmail(inviteRole);
  const emailProblem = inviteEmailProblem(inviteEmail, emailRequired, inviteTried || inviteEmail !== "");
  const emailField = inviteEmailField(inviteRole);
  const pending = (invitations.data ?? []).filter((i) => i.state === "pending");
  const nameOf = (userId: string | null) => (members.data ?? []).find((m) => m.userId === userId)?.displayName?.trim() || null;

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", description: "Send it to the person you're inviting. It works once.", tone: "good" });
    } catch {
      toast({ title: "Copy did not work", description: "Select the link and copy it by hand.", tone: "warn" });
    }
  };

  if (loadFailed(members)) return <ErrorPanel title="People" message={errorMessage(members.error)} onRetry={() => void members.refetch()} />;

  return (
    <AdminOnly>
      {refreshFailed(members) ? <RefreshFailedNotice query={members} className="flex items-center gap-2" /> : null}
      <SettingsSection wide title="People" meta={members.data ? plural(members.data.length, "person", "people") : undefined} loading={members.isLoading}>
        <ul className="flex flex-col" data-testid="member-list">
          {(members.data ?? []).map((m) => {
            const isSelf = m.userId === data.membership.userId;
            const role = ROLE_WORD[m.role as MembershipRole] ?? "Member";
            const name = isSelf ? (viewerName ?? "You") : m.displayName?.trim() || role;
            return (
              <li key={m.id} className="flex min-h-row-comfortable items-center gap-3 border-b border-line-faint py-2 last:border-b-0">
                <Avatar size={28} name={name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-body-strong text-primary">
                    <span className="truncate">{name}</span>
                    {isSelf && viewerName ? <Chip tone="kit">You</Chip> : null}
                  </span>
                  <span className="font-mono text-mono text-tertiary" title={m.userId} data-testid="member-meta">
                    {memberMeta({ role: m.role as MembershipRole, createdAt: m.createdAt, expiresAt: m.expiresAt }, (d) => formatDate(d, datePrefs))}
                  </span>
                </span>
                <SimpleSelect
                  aria-label={`Role of ${isSelf ? "you" : name}`}
                  controlSize="sm"
                  className="w-32"
                  value={m.role}
                  disabled={!mayChangeRole(myRole, m.role as MembershipRole, isSelf)}
                  onValueChange={(v) => setRole.mutate({ businessId, userId: m.userId, role: v as MembershipRole })}
                  options={ROLE_ORDER.map((r) => ({ value: r, label: ROLE_WORD[r], disabled: r === "owner" || (r === "cofounder" && !isOwner) }))}
                />
                <IconButton label={`Remove ${isSelf ? "yourself" : name}`} icon={UserX} size="sm" disabled={isOwnerRole(m.role) || isSelf} onClick={() => setRemoving({ userId: m.userId, name: isSelf ? "you" : memberLabel(m), role: m.role as MembershipRole })} />
              </li>
            );
          })}
        </ul>
        <dl className="grid grid-cols-12 gap-x-3 gap-y-1 text-small" aria-label="What each role can do">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="contents">
              <dt className="col-span-2 font-medium text-secondary">{ROLE_WORD[r]}</dt>
              <dd className="col-span-10 text-tertiary">{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>

      <SettingsSection title="Invite someone">
        <div data-testid="invite-someone" className="flex flex-col gap-3">
          <Hint>Make a link for someone to join this project. It works once, for 14 days, and you can revoke it until it is used.</Hint>
          <RadioGroup aria-label="Join as" value={inviteRole} onValueChange={(v) => setInviteRole(v as InvitationRole)} className="flex flex-col gap-2">
            {(["cofounder", "collaborator"] as const).map((r) => (
              <RadioOption
                key={r}
                id={`invite-role-${r}`}
                value={r}
                disabled={!mayInvite(myRole, r)}
                label={INVITATION_ROLE_WORD[r]}
                description={mayInvite(myRole, r) ? INVITATION_ROLE_SENTENCE[r] : `${INVITATION_ROLE_SENTENCE[r]} Only an owner or a cofounder can invite a cofounder.`}
              />
            ))}
          </RadioGroup>
          <Field htmlFor="invite-email" label={emailField.label} hint={emailField.hint} error={emailProblem ?? undefined}>
            <Input id="invite-email" type="email" required={emailRequired} aria-required={emailRequired} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" invalid={!!emailProblem} />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={Link2}
              loading={create.isPending}
              disabled={!!emailProblem || !mayInvite(myRole, inviteRole)}
              onClick={() => {
                setInviteTried(true);
                if (inviteEmailProblem(inviteEmail, emailRequired)) return;
                create.mutate({ businessId, role: inviteRole, ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}) });
              }}
              data-testid="invite-create"
            >
              Create invitation
            </Button>
          </div>
          {created ? (
            <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel-alt p-3" data-testid="invite-link">
              <p className="text-body text-primary">
                {created.emailed === true
                  ? `Emailed. You can also copy the link: it invites them as a ${INVITATION_ROLE_WORD[created.role].toLowerCase()}, and only they can accept it.`
                  : created.emailed === false
                    ? "The email could not be sent right now. Copy the link and send it yourself: only the person signed in with that address can accept it."
                    : `Copy the link and send it to the person you're inviting as a ${INVITATION_ROLE_WORD[created.role].toLowerCase()}.`}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded-sm bg-surface-2 px-2 py-1 font-mono text-mono text-primary" data-testid="invite-link-value">
                  {created.link}
                </code>
                <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copy(created.link)} data-testid="invite-link-copy">
                  Copy
                </Button>
              </div>
              <p className="text-small text-secondary">This is the only time the link is shown.</p>
            </div>
          ) : null}
        </div>
      </SettingsSection>

      {pending.length > 0 ? (
        <SettingsSection title="Invitations" meta={plural(pending.length, "waiting", "waiting")}>
          <ul className="flex flex-col" data-testid="invitation-list">
            {pending.map((i) => (
              <li key={i.id} className="flex min-h-row-comfortable items-center gap-3 border-b border-line-faint py-2 last:border-b-0" data-testid="invitation-row" data-invitation-id={i.id}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-strong text-primary">
                    {i.roleWord}
                    {i.sentTo ? <span className="font-normal text-secondary"> · emailed to {i.sentTo}</span> : null}
                  </span>
                  <span className="text-small text-tertiary">
                    By {nameOf(i.invitedByUserId) ?? "a founder"} · works until {formatDate(i.expiresAt, datePrefs)}
                  </span>
                </span>
                <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables?.invitationId === i.id} onClick={() => revoke.mutate({ businessId, invitationId: i.id })} data-testid="invitation-revoke">
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent size="sm" aria-describedby="remove-member-desc" data-testid="remove-member-dialog">
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription id="remove-member-desc">
              They lose access to this project at once: as {removing ? ROLE_WORD[removing.role].toLowerCase() : "member"}, its screens, Inbox and team. Their work and decisions stay. To bring them back, send them a new invitation.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="font-mono text-mono text-tertiary">Account {removing?.userId}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              icon={UserX}
              loading={remove.isPending}
              onClick={() => removing && remove.mutate({ businessId, userId: removing.userId }, { onSettled: () => setRemoving(null) })}
              data-testid="remove-member-confirm"
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminOnly>
  );
}
