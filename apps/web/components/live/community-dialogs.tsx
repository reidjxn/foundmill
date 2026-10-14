"use client";
/**
 * The community dialogs (BUILD §11.14; audit #28): start a community (`live.communities.create`, public or by
 * invitation, with its kind), invite one of your connections (`live.communities.invite`, owners and moderators), report a
 * post to the moderators (`live.posts.report`), and edit your own post (`live.posts.edit`, screened again). A name,
 * description or post that moderation holds says so; nothing here posts or sends for anyone but the signed-in founder.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Pencil, Plus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, RadioGroup, RadioOption, Textarea, useToast } from "@foundmill/dugout";
import { COMMUNITY_KIND_OPTIONS, REPORT_REASONS, counterpartId, type ReportReason } from "@/lib/live";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { usePeople } from "./shared";
import { useLiveViewer } from "./viewer";

type CreatedCommunity = RouterOutputs["live"]["communities"]["create"];

function useRefreshLive() {
  const qc = useQueryClient();
  return (...paths: string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: trpcPathPrefix(p) as unknown[] })));
}

// --- start a community ----------------------------------------------------------------------------------------------

export function CreateCommunityDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (community: CreatedCommunity) => void }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const refresh = useRefreshLive();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<(typeof COMMUNITY_KIND_OPTIONS)[number]["value"]>("category");
  const [access, setAccess] = useState<"public" | "private">("public");
  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setKind("category");
      setAccess("public");
    }
  }, [open]);
  const create = useMutation(
    trpc.live.communities.create.mutationOptions({
      onSuccess: (community) => {
        void refresh("live.communities");
        toast({ title: `${community.name} started`, description: access === "private" ? "Invite your connections from its page." : "Anyone on the network can find and join it.", tone: "good" });
        onOpenChange(false);
        onCreated(community);
      },
      onError: (err) => toast({ title: "Community not started", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="create-community-dialog">
        <DialogHeader>
          <DialogTitle>Start a community</DialogTitle>
          <DialogDescription>You will be its owner: you invite people, choose moderators, and hide or remove posts. Its name and description are screened like posts.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor="community-name" label="Name" required>
            <Input id="community-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field htmlFor="community-description" label="What it is for" hint="Optional. Members see it on the community's page.">
            <Textarea id="community-description" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field htmlFor="community-kind" label="Kind">
            <RadioGroup id="community-kind" value={kind} onValueChange={(v) => setKind(v as typeof kind)} aria-label="Kind" className="flex flex-col gap-2">
              {COMMUNITY_KIND_OPTIONS.map((k) => (
                <RadioOption key={k.value} id={`community-kind-${k.value}`} value={k.value} label={k.label} description={k.description} />
              ))}
            </RadioGroup>
          </Field>
          <Field htmlFor="community-access" label="Who can join">
            <RadioGroup id="community-access" value={access} onValueChange={(v) => setAccess(v as typeof access)} aria-label="Who can join" className="flex flex-col gap-2">
              <RadioOption id="community-access-public" value="public" label="Anyone on the network" description="Listed for every founder; anyone can join." />
              <RadioOption id="community-access-private" value="private" label="By invitation" description="Hidden from everyone else. Owners and moderators invite their connections." />
            </RadioGroup>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={Plus} disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate({ name: name.trim(), descriptionMd: description.trim(), kind, visibility: access })} data-testid="create-community-save">
            Start community
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- invite a connection --------------------------------------------------------------------------------------------

/** Lists the founder's connections who are not in the community yet, each with an Invite button. */
export function InviteDialog({ communityId, communityName, memberIds, open, onOpenChange }: { communityId: string; communityName: string; memberIds: readonly string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const viewer = useLiveViewer();
  const { toast } = useToast();
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!open) setInvited(new Set());
  }, [open]);
  const connectionsQ = useQuery(trpc.live.connections.list.queryOptions({ status: "accepted" }, { enabled: open, staleTime: 15_000 }));
  const candidates = useMemo(() => {
    const members = new Set(memberIds);
    return (connectionsQ.data ?? []).map((c) => counterpartId(c, viewer.userId)).filter((id) => !members.has(id));
  }, [connectionsQ.data, memberIds, viewer.userId]);
  const people = usePeople(candidates);
  const invite = useMutation(
    trpc.live.communities.invite.mutationOptions({
      onSuccess: (result, vars) => {
        setInvited((prev) => new Set([...prev, vars.userId]));
        toast({ title: result.status === "invited" ? `Invited ${people.name(vars.userId)}` : `${people.name(vars.userId)} is already a member`, tone: "good" });
      },
      onError: (err) => toast({ title: "Invitation not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>Invite to {communityName}</DialogTitle>
          <DialogDescription>You can invite your connections. They see the invitation on Network and choose whether to join.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col">
          {connectionsQ.isLoading ? <p className="text-small text-secondary">Loading your connections…</p> : null}
          {connectionsQ.error ? <p className="text-small text-status-bad" role="alert">{errorMessage(connectionsQ.error)}</p> : null}
          {!connectionsQ.isLoading && !connectionsQ.error && candidates.length === 0 ? <p className="text-body text-secondary">None of your connections is left to invite. Connect with founders first, then invite them here.</p> : null}
          <ul>
            {candidates.map((userId) => {
              const name = people.name(userId);
              return (
                <li key={userId} className="flex items-center gap-2 border-b border-subtle/50 py-1.5 last:border-b-0" data-testid="invite-candidate">
                  <Avatar size={24} name={name} />
                  <span className="t-body-strong min-w-0 flex-1 truncate text-primary">{name}</span>
                  {invited.has(userId) ? (
                    <Chip tone="good">Invited</Chip>
                  ) : (
                    <Button size="sm" icon={UserPlus} aria-label={`Invite ${name}`} disabled={invite.isPending && invite.variables?.userId === userId} onClick={() => invite.mutate({ communityId, userId })}>
                      Invite
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- report a post --------------------------------------------------------------------------------------------------

export function ReportDialog({ postId, authorName, onOpenChange }: { postId: string | null; authorName: string; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const refresh = useRefreshLive();
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!postId) {
      setReason("spam");
      setNote("");
    }
  }, [postId]);
  const report = useMutation(
    trpc.live.posts.report.mutationOptions({
      onSuccess: (result) => {
        void refresh("live.communities.posts");
        toast({ title: "Reported to the moderators", description: result.held ? "Enough members reported it, so it is out of the feed until a moderator decides." : "The community's owner and moderators review it. The author is not told who reported it.", tone: "info" });
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Report not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <Dialog open={postId !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>Report this post</DialogTitle>
          <DialogDescription>By {authorName}. The community's owner and moderators see your report; the author does not see who sent it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <RadioGroup value={reason} onValueChange={(v) => setReason(v as ReportReason)} aria-label="Why" className="flex flex-col gap-2">
            {REPORT_REASONS.map((r) => (
              <RadioOption key={r.value} id={`report-${r.value}`} value={r.value} label={r.label} />
            ))}
          </RadioGroup>
          <Field htmlFor="report-note" label="Anything the moderators should know" hint="Optional.">
            <Textarea id="report-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" icon={Flag} loading={report.isPending} onClick={() => postId && report.mutate({ postId, reason, note: note.trim() || undefined })} data-testid="report-send">
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- edit your post -------------------------------------------------------------------------------------------------

export function EditPostDialog({ post, onOpenChange }: { post: { id: string; bodyMd: string } | null; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const refresh = useRefreshLive();
  const [body, setBody] = useState("");
  useEffect(() => setBody(post?.bodyMd ?? ""), [post]);
  const edit = useMutation(
    trpc.live.posts.edit.mutationOptions({
      onSuccess: (result) => {
        void refresh("live.communities.posts");
        toast(result.held ? { title: "Edited, and held for review", description: "It waits for the community's moderators; members see the new text once a moderator approves it.", tone: "warn" } : { title: "Post edited", tone: "good" });
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <Dialog open={post !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="edit-post-dialog">
        <DialogHeader>
          <DialogTitle>Edit your post</DialogTitle>
          <DialogDescription>The new text is screened again before members see it, and the post shows that it was edited.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea aria-label="Post text" rows={5} maxLength={20_000} value={body} onChange={(e) => setBody(e.target.value)} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={Pencil} disabled={!body.trim() || body.trim() === post?.bodyMd.trim()} loading={edit.isPending} onClick={() => post && edit.mutate({ postId: post.id, bodyMd: body.trim() })} data-testid="edit-post-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
