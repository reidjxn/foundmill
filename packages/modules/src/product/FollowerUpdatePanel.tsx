"use client";
/**
 * Product › Public page › "Write to your followers" (WP-08 T3; apps/api services/updates.ts): one update from the
 * founders to the people who confirmed they want to hear from the project. A founder (or the team, through
 * `draft_follower_update`) writes a draft; the preview is exactly what goes out (the subject, the words, the AI line of
 * founder D2 when the team drafted it, and the footer with the postal address and the link to stop); an owner or an
 * admin presses Send and confirms. One press sends up to the project's day of email; the rest go with "Send the rest".
 * What it says after a press comes from the api in plain words; a simulated press never reads as sent.
 */
import { useEffect, useId, useState } from "react";
import { Mail, Save, Send, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Panel, Term, Textarea } from "@foundmill/dugout";
import { PROJECT_UPDATE_BODY_MAX, PROJECT_UPDATE_SUBJECT_MAX, PROJECT_UPDATE_WORDS as W, updateProblems } from "@foundmill/shared/project-updates";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { errorMessage } from "./shared";

export interface ProjectUpdateItem {
  id: string;
  subject: string;
  body: string;
  status: "draft" | "sending" | "sent" | "canceled";
  draftedByAgentId: string | null;
  sentCount: number;
  skippedCount: number;
  remainingCount: number;
  /** When these words were saved: Send carries it, so an edit made since is never sent unseen. */
  updatedAt: string;
}
export interface UpdatesListResponse {
  followers: number;
  canSend: boolean;
  /** No postal address yet: the panel explains why one comes before the first update. Absent from an older api. */
  postalAddressMissing?: boolean;
  updates: ProjectUpdateItem[];
}
export interface UpdatePreviewResponse {
  subject: string;
  text: string;
  footer: string;
  followers: number;
  perDay: number;
  postalAddressMissing: boolean;
}
interface SendResponse {
  sent: number;
  remaining: number;
  simulated: boolean;
  refusal: string | null;
  message: string;
}

export function FollowerUpdatePanel({ projectName }: { projectName: string }) {
  const id = useId();
  const { mutate } = useWidgetData();
  const list = useWidgetQuery<UpdatesListResponse>("updates.list", {});
  useBusinessEvents(() => list.refetch(), ["update.drafted", "update.sent", "page.followed"]);
  const followers = list.data?.followers ?? 0;
  const open = list.data?.updates.find((u) => u.status === "draft" || u.status === "sending") ?? null;
  const preview = useWidgetQuery<UpdatePreviewResponse>("updates.preview", { id: open?.id ?? "" }, { enabled: Boolean(open) });

  const [writing, setWriting] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<null | "save" | "send" | "cancel">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open?.status === "draft") {
      setSubject(open.subject);
      setBody(open.body);
    }
  }, [open?.id, open?.status, open?.subject, open?.body]);

  const run = async (what: NonNullable<typeof pending>, fn: () => Promise<void>) => {
    setPending(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err as Error));
    } finally {
      setPending(null);
    }
  };
  const problem = writing || open?.status === "draft" ? updateProblems(subject, body) : null;
  const save = () =>
    run("save", async () => {
      await mutate("updates.save", { ...(open?.status === "draft" ? { id: open.id } : {}), subject, body });
      setNotice(null);
      setWriting(false);
      list.refetch();
      preview.refetch();
    });
  const send = () =>
    run("send", async () => {
      setConfirming(false);
      const r = await mutate<SendResponse>("updates.send", { id: open!.id, seenUpdatedAt: open!.updatedAt });
      setNotice(r.message);
      list.refetch();
    });
  const cancel = () =>
    run("cancel", async () => {
      await mutate("updates.cancel", { id: open!.id });
      setSubject("");
      setBody("");
      list.refetch();
    });

  if (!list.data) return null;
  const editing = writing || open?.status === "draft";
  // Send uses the saved words: while the boxes hold changes, they are saved (and previewed) first.
  const unsaved = open?.status === "draft" && (subject !== open.subject || body !== open.body);
  const p = preview.data;

  return (
    <Panel title={<>Write to your <Term id="follower">followers</Term></>} helpLabel={W.panelTitle} span={12} data-testid="follower-update">
      <div className="flex flex-col gap-3">
        {followers === 0 ? (
          <p className="t-body text-secondary" data-testid="follower-update-empty">
            {W.noFollowers}
          </p>
        ) : null}
        {notice ? (
          <p className="t-body text-primary" role="status" data-testid="follower-update-notice">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="t-body text-status-bad" role="alert">
            {error}
          </p>
        ) : null}

        {followers > 0 && (list.data.postalAddressMissing || p?.postalAddressMissing) ? (
          <div className="flex flex-col gap-1" data-testid="follower-update-postal">
            <p className="t-label text-primary">{W.postalAddressTitle}</p>
            <p className="t-reading max-w-reading text-secondary">{W.postalAddressMissing}</p>
          </div>
        ) : null}

        {!editing && !open && followers > 0 ? (
          <Button icon={Mail} className="self-start" onClick={() => setWriting(true)} data-testid="follower-update-write">
            {W.button(followers)}
          </Button>
        ) : null}

        {editing ? (
          <div className="flex flex-col gap-2">
            {open?.draftedByAgentId ? <p className="t-body text-secondary">{W.draftedByTeam}</p> : null}
            <Field label={W.subjectLabel} htmlFor={`${id}-subject`}>
              <Input id={`${id}-subject`} value={subject} maxLength={PROJECT_UPDATE_SUBJECT_MAX} onChange={(e) => setSubject(e.target.value)} data-testid="follower-update-subject" />
            </Field>
            <Field label={W.bodyLabel} htmlFor={`${id}-body`}>
              <Textarea id={`${id}-body`} rows={6} value={body} maxLength={PROJECT_UPDATE_BODY_MAX} onChange={(e) => setBody(e.target.value)} data-testid="follower-update-body" />
            </Field>
            {problem && (subject || body) ? <p className="t-body text-secondary">{problem}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button icon={Save} onClick={() => void save()} disabled={Boolean(problem)} loading={pending === "save"} data-testid="follower-update-save">
                {W.save}
              </Button>
              {open?.status === "draft" && list.data.canSend ? (
                <Button variant="ghost" icon={Trash2} onClick={() => void cancel()} loading={pending === "cancel"} data-testid="follower-update-cancel">
                  {W.cancel}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {open && p ? (
          <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-1 border-t border-line pt-3" data-testid="follower-update-preview">
            <h3 id={`${id}-preview`} className="t-label text-secondary">
              {W.preview}
            </h3>
            <p className="t-body text-primary">{p.subject}</p>
            <p className="t-reading max-w-reading whitespace-pre-wrap break-words text-primary">{p.text}</p>
            <p className="t-reading max-w-reading whitespace-pre-wrap break-words text-secondary">{p.footer}</p>

          </section>
        ) : null}

        {open && list.data.canSend && followers > 0 ? (
          <Button variant="primary" icon={Send} className="self-start" disabled={Boolean(p?.postalAddressMissing) || unsaved} loading={pending === "send"} onClick={() => setConfirming(true)} data-testid="follower-update-send">
            {open.status === "sending" ? W.sendRest : W.send}
          </Button>
        ) : null}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent size="sm" aria-describedby={`${id}-confirm`}>
          <DialogHeader>
            <DialogTitle>{W.panelTitle}</DialogTitle>
            <DialogDescription id={`${id}-confirm`}>{W.confirm(open?.status === "sending" ? open.remainingCount : followers, projectName)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {W.confirmBack}
            </Button>
            <Button variant="primary" icon={Send} onClick={() => void send()} data-testid="follower-update-confirm">
              {W.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
