"use client";
/**
 * Settings › Danger zone (BUILD §11.15): export everything (`business.export`), archive the business
 * (`business.archive`), permanent deletion (`business.requestDeletion`: founder-only, fresh sign-in required, 7-day
 * delay, cancellable with `business.cancelDeletion`). Outlined in status-bad at 40 % (DESIGN §9).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Icon, Input, Panel, StatusPill } from "@foundmill/dugout";
import { formatDate } from "@/lib/format";
import { errorMessage, trpcErrorCode, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { Hint, useSettingsToast } from "./shared";

export const DELETION_DELAY_DAYS = 7;

export function DangerTab() {
  const { businessId, data, isOwner, isAdmin } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useSettingsToast();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");
  const refreshBusiness = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("business") as unknown[] });

  const exportAll = useMutation(trpc.business.export.mutationOptions({ onSuccess: () => t.saved("Export ready", "An Inbox note carries the archive (spec, roadmap, tasks, CRM, journeys, finance, audit log, agent instructions). Credentials are never included."), onError: (err) => t.failed(err, "Export failed") }));
  const archive = useMutation(
    trpc.business.archive.mutationOptions({
      onSuccess: (result) => {
        setConfirmArchive(false);
        void refreshBusiness();
        const n = result.stopped.pausedAgents;
        t.saved("Business archived", `${n} agent${n === 1 ? "" : "s"} stopped; the business is hidden from your list and an owner can restore it.`);
      },
      onError: (err) => t.failed(err, "Archive failed"),
    }),
  );
  const requestDeletion = useMutation(
    trpc.business.requestDeletion.mutationOptions({
      onSuccess: () => {
        setConfirmDelete(false);
        void refreshBusiness();
        t.saved("Deletion scheduled", `Everything is deleted in ${DELETION_DELAY_DAYS} days unless you cancel.`);
      },
      onError: (err) => {
        if (trpcErrorCode(err) === "PRECONDITION_FAILED") t.info("Sign in again first", "Permanent deletion needs a fresh sign-in. Sign out, sign back in with a new link, then schedule the deletion.");
        else t.failed(err, "Permanent deletion failed");
      },
    }),
  );
  const cancelDeletion = useMutation(
    trpc.business.cancelDeletion.mutationOptions({
      onSuccess: () => {
        void refreshBusiness();
        t.saved("Deletion canceled", "Nothing will be deleted.");
      },
      onError: (err) => t.failed(err, "Could not cancel the deletion"),
    }),
  );
  const scheduled = data.deletion;

  return (
    <Panel title={<span className="inline-flex items-center gap-1.5 text-status-bad"><Icon icon={TriangleAlert} size="inline" />Danger zone</span>} className="border-status-bad/40" data-testid="danger-zone">
      <div className="flex max-w-reading flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="t-display-sm">Export everything</span>
          <p className="text-body text-secondary">Spec, roadmap, tasks, CRM, journeys, finance, audit log and agent instructions as a portable archive. Credentials are never included.</p>
          <div>
            <Button icon={Download} variant="default" disabled={!isAdmin} loading={exportAll.isPending} onClick={() => exportAll.mutate({ businessId })}>
              Export everything
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="t-display-sm">Archive business</span>
          <p className="text-body text-secondary">Stops every agent and hides the business. Data stays; an owner can restore it.</p>
          <div>
            <Button icon={Archive} variant="default" disabled={!isAdmin} onClick={() => setConfirmArchive(true)}>
              Archive {data.business.name}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="t-display-sm text-status-bad">Delete permanently</span>
          <p className="text-body text-secondary">
            Founder only. You sign in again, then everything is deleted after {DELETION_DELAY_DAYS} days, and you can cancel until then. Only you can do this: no agent, mode or setting can start it.
          </p>
          {scheduled ? (
            <div className="flex items-center gap-3" data-testid="deletion-scheduled">
              <StatusPill tone="bad">Deletion scheduled{scheduled.scheduledFor ? ` · ${formatDate(scheduled.scheduledFor)}` : ""}</StatusPill>
              <Button icon={Undo2} variant="default" disabled={!isOwner} loading={cancelDeletion.isPending} onClick={() => cancelDeletion.mutate({ businessId })}>
                Cancel deletion
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button icon={Trash2} variant="danger" disabled={!isOwner} onClick={() => setConfirmDelete(true)}>
                Delete {data.business.name}
              </Button>
              {!isOwner ? <StatusPill tone="neutral">Owner only</StatusPill> : null}
            </div>
          )}
        </div>
        <Hint>Archive and delete are audited with your account; an Inbox note confirms each step.</Hint>
      </div>

      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Archive {data.business.name}?</DialogTitle>
            <DialogDescription>All agents stop within 30 seconds. The business leaves your list until an owner restores it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate({ businessId, reason: "archived" })}>
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(o) => (setConfirmDelete(o), !o && setTypedName(""))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {data.business.name} permanently?</DialogTitle>
            <DialogDescription>Type the business name to continue. You will be asked to sign in again, then deletion runs in {DELETION_DELAY_DAYS} days unless canceled from the Inbox.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field htmlFor="delete-confirm" label="Business name">
              <Input id="delete-confirm" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder={data.business.name} autoComplete="off" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={typedName.trim() !== data.business.name} loading={requestDeletion.isPending} onClick={() => requestDeletion.mutate({ businessId, confirmName: typedName.trim() })}>
              Schedule deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {requestDeletion.error ? <p className="sr-only" role="alert">{errorMessage(requestDeletion.error)}</p> : null}
    </Panel>
  );
}
