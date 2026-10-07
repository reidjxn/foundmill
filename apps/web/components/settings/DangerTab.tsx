"use client";
/**
 * Settings › Danger zone (BUILD §11.15): export everything, archive the business, permanent deletion
 * (founder-only, re-authentication, 7-day delay). Outlined in status-bad at 40 % (DESIGN §9).
 * The API has no export/archive/delete procedures yet: the buttons call them by path and explain when they are
 * missing, so the copy, confirmations and gates are already right (docs/PROGRESS.md open issue).
 */
import { useMutation } from "@tanstack/react-query";
import { Archive, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, StatusPill } from "@foundmill/dugout";
import { errorMessage, trpcErrorCode } from "@/lib/trpc";
import { useUntypedApi } from "@/components/providers/AppProviders";
import { useBusiness } from "@/components/shell/business-context";
import { Hint, useSettingsToast } from "./shared";

export const DELETION_DELAY_DAYS = 7;

export function DangerTab() {
  const { businessId, data, isOwner, isAdmin } = useBusiness();
  const untyped = useUntypedApi();
  const t = useSettingsToast();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");

  const notYet = (what: string) => (err: unknown) => {
    if (trpcErrorCode(err) === "NOT_FOUND") t.info(`${what} is not wired yet`, "The API gains this procedure in a later build; nothing happened.");
    else t.failed(err, `${what} failed`);
  };
  const exportAll = useMutation({ mutationFn: () => untyped.mutation("business.export", { businessId }), onSuccess: () => t.saved("Export started", "You will get an Inbox note with the download when it is ready."), onError: notYet("Export") });
  const archive = useMutation({ mutationFn: () => untyped.mutation("business.archive", { businessId }), onSuccess: () => (setConfirmArchive(false), t.saved("Business archived", "Agents stopped; the business is hidden from your list and can be restored.")), onError: notYet("Archive") });
  const requestDeletion = useMutation({ mutationFn: () => untyped.mutation("business.requestDeletion", { businessId }), onSuccess: () => (setConfirmDelete(false), t.saved("Deletion scheduled", `Everything is deleted in ${DELETION_DELAY_DAYS} days unless you cancel.`)), onError: notYet("Permanent deletion") });

  return (
    <section className="rounded-panel border border-status-bad/40 bg-panel" data-testid="danger-zone">
      <div className="flex h-8 items-center gap-2 border-b border-status-bad/40 bg-panel-alt px-3">
        <span className="t-label text-status-bad">Danger zone</span>
      </div>
      <div className="flex max-w-[640px] flex-col gap-6 p-3">
        <div className="flex flex-col gap-2">
          <span className="t-display-sm">Export everything</span>
          <p className="text-body text-secondary">Spec, roadmap, tasks, CRM, journeys, finance, audit log and agent instructions as a portable archive. Credentials are never included.</p>
          <div>
            <Button icon={Download} variant="default" disabled={!isAdmin} loading={exportAll.isPending} onClick={() => exportAll.mutate()}>
              Export everything
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-subtle pt-4">
          <span className="t-display-sm">Archive business</span>
          <p className="text-body text-secondary">Stops every agent and hides the business. Data stays; an owner can restore it.</p>
          <div>
            <Button icon={Archive} variant="default" disabled={!isAdmin} onClick={() => setConfirmArchive(true)}>
              Archive {data.business.name}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-subtle pt-4">
          <span className="t-display-sm text-status-bad">Delete permanently</span>
          <p className="text-body text-secondary">
            Founder only. You re-authenticate, then everything is deleted after a {DELETION_DELAY_DAYS}-day delay during which you can cancel. Permanent deletion is a hard gate: no agent, mode or setting can trigger it.
          </p>
          <div className="flex items-center gap-3">
            <Button icon={Trash2} variant="danger" disabled={!isOwner} onClick={() => setConfirmDelete(true)}>
              Delete {data.business.name}
            </Button>
            {!isOwner ? <StatusPill tone="neutral">Owner only</StatusPill> : null}
          </div>
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
            <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate()}>
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(o) => (setConfirmDelete(o), !o && setTypedName(""))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {data.business.name} permanently?</DialogTitle>
            <DialogDescription>Type the business name to continue. You will be asked to sign in again, then deletion runs in {DELETION_DELAY_DAYS} days unless cancelled from the Inbox.</DialogDescription>
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
            <Button variant="danger" disabled={typedName.trim() !== data.business.name} loading={requestDeletion.isPending} onClick={() => requestDeletion.mutate()}>
              Schedule deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {requestDeletion.error && trpcErrorCode(requestDeletion.error) !== "NOT_FOUND" ? <p className="sr-only" role="alert">{errorMessage(requestDeletion.error)}</p> : null}
    </section>
  );
}
