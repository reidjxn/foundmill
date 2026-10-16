"use client";
/**
 * Your businesses and Create a new business › Archived businesses (BUILD §11.15; `#archived` on both pages): the archived businesses the signed-in account owns
 * (`business.listArchived`), each with Restore (`business.restore`, then its Home opens; its agents stay stopped until
 * resumed), Export everything (`business.export`, saved as a JSON file) and Delete permanently
 * (`business.requestDeletion`: fresh sign-in, typed name, 7-day delay; `business.cancelDeletion` while scheduled).
 * Archive hides a business from every other screen, so this is where its owner finds it again. Renders nothing when
 * the account owns no archived business.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Download, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Panel, StatusPill, useDateFormat, useToast } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { formatDate, plural } from "@/lib/format";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { DELETION_DELAY_DAYS, exportToast, saveExport } from "../settings/danger";

type ArchivedRow = RouterOutputs["business"]["listArchived"][number];

export function ArchivedBusinesses() {
  const trpc = useTRPC();
  const archivedQ = useQuery(trpc.business.listArchived.queryOptions(undefined, { staleTime: 15_000 }));
  const rows = archivedQ.data ?? [];
  if (archivedQ.isLoading || (!archivedQ.error && rows.length === 0)) return null;
  return (
    <div id="archived" className="mt-gutter">
      <Panel title="Archived businesses" meta={rows.length ? plural(rows.length, "business", "businesses") : undefined} error={archivedQ.error ? "Could not load your archived businesses." : undefined} onRetry={() => archivedQ.refetch()} data-testid="archived-businesses">
        <ul className="flex flex-col divide-y divide-line-faint">
          {rows.map((row) => (
            <ArchivedBusinessRow key={row.business.id} row={row} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function ArchivedBusinessRow({ row }: { row: ArchivedRow }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const datePrefs = useDateFormat();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");
  const { business, deletion } = row;
  const businessId = business.id;
  // A restored business is back in the founder's lists too (Switch business, Your businesses).
  const refresh = () => Promise.all(["business", "founder"].map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));

  const restore = useMutation(
    trpc.business.restore.mutationOptions({
      onSuccess: () => {
        toast({ title: `${business.name} restored`, description: "Everything is where you left it. Its agents stay stopped until you resume them.", tone: "good" });
        void refresh();
        router.push(routes.home(businessId));
      },
      onError: (err) => toast({ title: "Could not restore the business", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const exportAll = useMutation(
    trpc.business.export.mutationOptions({
      onSuccess: (result) => toast({ ...exportToast(result, saveExport(result)) }),
      onError: (err) => toast({ title: "Export failed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const requestDeletion = useMutation(
    trpc.business.requestDeletion.mutationOptions({
      onSuccess: () => {
        setConfirmDelete(false);
        setTypedName("");
        void refresh();
        toast({ title: "Deletion scheduled", description: `Everything is deleted in ${DELETION_DELAY_DAYS} days unless you cancel.`, tone: "good" });
      },
      onError: (err) => {
        if (trpcErrorCode(err) === "PRECONDITION_FAILED") toast({ title: "Sign in again first", description: "Permanent deletion needs a fresh sign-in. Sign out, sign back in with a new link, then schedule the deletion.", tone: "info" });
        else toast({ title: "Permanent deletion failed", description: errorMessage(err), tone: "bad" });
      },
    }),
  );
  const cancelDeletion = useMutation(
    trpc.business.cancelDeletion.mutationOptions({
      onSuccess: () => {
        void refresh();
        toast({ title: "Deletion canceled", description: "Nothing will be deleted.", tone: "good" });
      },
      onError: (err) => toast({ title: "Could not cancel the deletion", description: errorMessage(err), tone: "bad" }),
    }),
  );

  return (
    <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0" data-archived-business={businessId}>
      <Archive size={16} className="shrink-0 text-tertiary" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="t-display-sm break-words">{business.name}</span>
        <p className="text-small text-secondary">Archived {formatDate(business.archivedAt, datePrefs)}. Data stays; agents are stopped.</p>
      </div>
      {deletion ? (
        <>
          <StatusPill tone="bad" data-testid="archived-deletion-scheduled">
            Deletion scheduled{deletion.scheduledFor ? ` · ${formatDate(deletion.scheduledFor, datePrefs)}` : ""}
          </StatusPill>
          <Button size="sm" variant="default" icon={Undo2} loading={cancelDeletion.isPending} onClick={() => cancelDeletion.mutate({ businessId })}>
            Cancel deletion
          </Button>
        </>
      ) : null}
      <Button size="sm" variant="ghost" icon={Download} loading={exportAll.isPending} onClick={() => exportAll.mutate({ businessId })} data-testid="archived-export">
        Export everything
      </Button>
      {deletion ? null : (
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} data-testid="archived-delete">
          Delete permanently
        </Button>
      )}
      <Button size="sm" variant="primary" icon={ArchiveRestore} loading={restore.isPending} onClick={() => restore.mutate({ businessId })} data-testid="archived-restore">
        Restore
      </Button>

      <Dialog open={confirmDelete} onOpenChange={(o) => (setConfirmDelete(o), !o && setTypedName(""))}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {business.name} permanently?</DialogTitle>
            <DialogDescription>Type the business name to continue. You may be asked to sign in again; then deletion runs in {DELETION_DELAY_DAYS} days unless canceled here.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field htmlFor={`delete-${businessId}`} label="Business name">
              <Input id={`delete-${businessId}`} value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder={business.name} autoComplete="off" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={typedName.trim() !== business.name} loading={requestDeletion.isPending} onClick={() => requestDeletion.mutate({ businessId, confirmName: typedName.trim() })}>
              Schedule deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
