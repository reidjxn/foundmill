"use client";
/**
 * Settings › Danger zone (BUILD §11.15): export everything (`business.export`, saved by the browser as a JSON file),
 * archive the business (`business.archive`; an owner restores it from Your businesses › Archived businesses), permanent
 * deletion (`business.requestDeletion`: founder-only, fresh sign-in required, 7-day delay, cancellable with
 * `business.cancelDeletion`). Outlined in status-bad at 40 % (DESIGN §9).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConsequenceLine, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Icon, Input, Panel, StatusPill, useDateFormat } from "@foundmill/dugout";
import { formatDate } from "@/lib/format";
import { errorMessage, trpcErrorCode, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ARCHIVED_HREF, DANGER_CONSEQUENCES, DELETION_DELAY_DAYS, exportToast, saveExport, type ExportedArchive } from "./danger";
import { Hint, useSettingsToast } from "./shared";

export function DangerTab() {
  const datePrefs = useDateFormat();
  const { businessId, data, isOwner, isAdmin } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useSettingsToast();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");
  // The last export of this visit, so a blocked or lost download can be saved again without exporting again.
  const [lastExport, setLastExport] = useState<ExportedArchive | null>(null);
  const refreshBusiness = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("business") as unknown[] });

  const exportAll = useMutation(
    trpc.business.export.mutationOptions({
      onSuccess: (result) => {
        setLastExport(result);
        const toast = exportToast(result, saveExport(result));
        if (toast.tone === "good") t.saved(toast.title, toast.description);
        else t.info(toast.title, toast.description);
      },
      onError: (err) => t.failed(err, "Export failed"),
    }),
  );
  const archive = useMutation(
    trpc.business.archive.mutationOptions({
      onSuccess: (result) => {
        setConfirmArchive(false);
        const n = result.stopped.pausedAgents;
        t.saved("Business archived", `${n} agent${n === 1 ? "" : "s"} stopped. The business is hidden from your list; ${isOwner ? "restore it" : "an owner can restore it"} from Your businesses › Archived businesses.`);
        // This business no longer opens: leave for Your businesses, where its owner finds it under Archived businesses.
        router.push(ARCHIVED_HREF);
        void refreshBusiness();
        // It leaves the founder's lists too (Switch business, Your businesses).
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("founder") as unknown[] });
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
          <p className="text-body text-secondary">Every record of the business (spec, roadmap, tasks, team and conversations, CRM, journeys, finance, legal, Inbox, usage and audit log) saved to your computer as one JSON file. Credentials are never included.</p>
          <div className="flex items-center gap-3">
            <Button icon={Download} variant="default" disabled={!isAdmin} loading={exportAll.isPending} onClick={() => exportAll.mutate({ businessId })} data-testid="export-everything">
              Export everything
            </Button>
            {lastExport ? (
              <Button icon={Download} variant="ghost" onClick={() => saveExport(lastExport)} data-testid="export-save-again">
                Save the file
              </Button>
            ) : null}
            {lastExport ? <span className="font-mono text-mono text-secondary" data-testid="export-file-name">{lastExport.fileName}</span> : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="t-display-sm">Archive business</span>
          <p className="text-body text-secondary">Stops every agent and hides the business. Data stays; an owner can restore, export or delete it from Your businesses › Archived businesses.</p>
          <div>
            <Button icon={Archive} variant="default" disabled={!isAdmin} onClick={() => setConfirmArchive(true)}>
              Archive {data.business.name}
            </Button>
          </div>
          <ConsequenceLine {...DANGER_CONSEQUENCES.archive} data-testid="archive-consequence" />
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="t-display-sm text-status-bad">Delete permanently</span>
          <p className="text-body text-secondary">
            Founder only. You sign in again, then everything is deleted after {DELETION_DELAY_DAYS} days, and you can cancel until then. Only you can do this: no agent, mode or setting can start it.
          </p>
          {scheduled ? (
            <div className="flex items-center gap-3" data-testid="deletion-scheduled">
              <StatusPill tone="bad">Deletion scheduled{scheduled.scheduledFor ? ` · ${formatDate(scheduled.scheduledFor, datePrefs)}` : ""}</StatusPill>
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
          {scheduled ? null : <ConsequenceLine {...DANGER_CONSEQUENCES.delete} data-testid="delete-consequence" />}
        </div>
        <Hint>Archive and delete are audited with your account; an Inbox note confirms each step.</Hint>
      </div>

      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Archive {data.business.name}?</DialogTitle>
            <DialogDescription>All agents stop within 30 seconds. The business leaves your list until an owner restores it from Your businesses › Archived businesses.</DialogDescription>
            <ConsequenceLine {...DANGER_CONSEQUENCES.archive} />
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
            <DialogDescription>Type the business name to continue. You will be asked to sign in again, then deletion runs in {DELETION_DELAY_DAYS} days unless an owner cancels it here, in Settings › Danger zone.</DialogDescription>
            <ConsequenceLine {...DANGER_CONSEQUENCES.delete} />
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
