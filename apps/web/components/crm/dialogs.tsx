"use client";
/**
 * CRM dialogs: new record (`crm.entity.create`), merge (search the other record, choose which survives →
 * `crm.entity.merge`, reversible, AC-11.12.3), rename/edit (`crm.entity.update`), export (data duty: JSON of
 * everything held), deletion request (outreach suppressed at once; the nightly deletion job removes the record after 7 days), add role (`crm.roles.add`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, GitMerge, Search, Trash2, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { downloadText } from "@/lib/download";
import { plainWords } from "@/lib/format";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ENTITY_KIND_ICONS, ENTITY_KIND_LABELS, Field, Icon, Input, RadioGroup, RadioOption, SimpleSelect, Textarea, useToast } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import { TRPCClientError } from "@trpc/client";
import { appErrorCode, errorMessage, trpcErrorCode, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useUntypedApi } from "@/components/providers/AppProviders";
import { LAWFUL_BASES, LAWFUL_BASIS_LABEL, deletionRequestNote, exportEntityJson, type EntityGet, type EntityRecord } from "./logic";
import { KNOWN_ROLES } from "./search";

const CREATE_KINDS: { value: EntityKind; label: string }[] = [
  { value: "person", label: "Person" },
  { value: "organisation", label: "Organization" },
  { value: "venue", label: "Venue" },
];

export function useCrmInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("crm") as unknown[] });
}

// --- new record -----------------------------------------------------------------------------------------------------

/** The record a refused "New record" matched (`duplicate_entity`: a live record already holds the email or domain). */
function duplicateOf(err: unknown): { id: string; displayName: string; message: string } | null {
  if (appErrorCode(err) !== "duplicate_entity" || !(err instanceof TRPCClientError)) return null;
  const existing = (err.data as { details?: { existing?: { id?: string; displayName?: string } } } | undefined)?.details?.existing;
  return existing?.id ? { id: existing.id, displayName: existing.displayName ?? "That record", message: err.message } : null;
}

export function NewEntityDialog({ businessId, open, onOpenChange, onCreated, onOpenExisting }: { businessId: string; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (entity: EntityRecord) => void; onOpenExisting?: (entityId: string) => void }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const [kind, setKind] = useState<"person" | "organisation" | "venue">("person");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [lawfulBasis, setLawfulBasis] = useState<string>("legitimate_interest");
  const [duplicate, setDuplicate] = useState<{ id: string; displayName: string; message: string } | null>(null);
  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setDomain("");
      setDuplicate(null);
    }
  }, [open]);
  const create = useMutation(
    trpc.crm.entity.create.mutationOptions({
      onSuccess: (e) => {
        void invalidate();
        toast({ title: `${e.displayName} added`, tone: "good" });
        onOpenChange(false);
        onCreated(e);
      },
      onError: (err) => {
        const dup = duplicateOf(err);
        if (dup) setDuplicate(dup);
        else toast({ title: "Could not add the record", description: errorMessage(err), tone: "bad" });
      },
    }),
  );
  const identifiers: Record<string, string> = {};
  if (email.trim()) identifiers.email = email.trim().toLowerCase();
  if (domain.trim()) identifiers.domain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="new-entity-dialog">
        <DialogHeader>
          <DialogTitle>New record</DialogTitle>
          <DialogDescription>Strong identifiers (email, domain) let the identity resolver match imports and mentions to this record.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as typeof kind)} aria-label="Kind" className="flex gap-4">
            {CREATE_KINDS.map((k) => (
              <RadioOption key={k.value} id={`new-kind-${k.value}`} value={k.value} label={k.label} />
            ))}
          </RadioGroup>
          <Field htmlFor="new-name" label="Name" required>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          {kind === "person" ? (
            <Field htmlFor="new-email" label="Email">
              <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          ) : (
            <Field htmlFor="new-domain" label="Domain">
              <Input id="new-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            </Field>
          )}
          {kind === "person" ? (
            <Field htmlFor="new-basis" label="Lawful basis" hint="The lawful basis is the legal reason the business may hold this person's data, recorded per person.">
              <SimpleSelect id="new-basis" value={lawfulBasis} onValueChange={setLawfulBasis} options={LAWFUL_BASES.map((b) => ({ value: b, label: LAWFUL_BASIS_LABEL[b]! }))} />
            </Field>
          ) : null}
          {duplicate ? (
            <div role="alert" className="flex flex-col gap-2 rounded-md border border-line bg-panel p-3 text-small" data-testid="new-entity-duplicate">
              <p className="text-status-warn">{duplicate.message}</p>
              <div className="flex flex-wrap gap-2">
                {onOpenExisting ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenExisting(duplicate.id);
                    }}
                    data-testid="new-entity-open-existing"
                  >
                    Open {duplicate.displayName}
                  </Button>
                ) : null}
                <Button variant="ghost" loading={create.isPending} onClick={() => create.mutate({ businessId, kind, displayName: name.trim(), identifiers, aliases: [], lawfulBasis: kind === "person" ? lawfulBasis : null, allowDuplicate: true })} data-testid="new-entity-add-anyway">
                  Add anyway
                </Button>
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserRoundPlus} disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate({ businessId, kind, displayName: name.trim(), identifiers, aliases: [], lawfulBasis: kind === "person" ? lawfulBasis : null })} data-testid="new-entity-save">
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- merge ----------------------------------------------------------------------------------------------------------

export function MergeDialog({ businessId, source, open, onOpenChange, onMerged }: { businessId: string; source: Pick<EntityRecord, "id" | "displayName" | "kind">; open: boolean; onOpenChange: (o: boolean) => void; onMerged: (keptId: string, mergeLogId: string) => void }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const [q, setQ] = useState("");
  const [other, setOther] = useState<{ id: string; displayName: string; kind: EntityKind } | null>(null);
  const [keep, setKeep] = useState<"source" | "other">("source");
  useEffect(() => {
    if (!open) {
      setQ("");
      setOther(null);
      setKeep("source");
    }
  }, [open]);
  const searchQ = useQuery(trpc.crm.search.queryOptions({ businessId, q: q.trim() || "-", kinds: [source.kind], limit: 8 }, { enabled: open && q.trim().length > 0, staleTime: 10_000, retry: false }));
  const merge = useMutation(
    trpc.crm.entity.merge.mutationOptions({
      onSuccess: (r) => {
        void invalidate();
        toast({ title: `Merged into ${r.kept.displayName}`, description: "Reversible from the profile's merge history.", tone: "good" });
        onOpenChange(false);
        onMerged(r.kept.id, r.log.id);
      },
      onError: (err) => toast({ title: "Merge failed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const hits = (searchQ.data?.hits ?? []).filter((h) => h.entity.id !== source.id);
  const keptId = keep === "source" ? source.id : other?.id;
  const mergedId = keep === "source" ? other?.id : source.id;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>Merge {source.displayName}</DialogTitle>
          <DialogDescription>Roles, relationships, mentions, interactions and identifiers move to the record you keep. Merges are audited and can be undone: undoing one takes back only what it brought in, so later edits stay.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor="merge-search" label={`Find the duplicate ${ENTITY_KIND_LABELS[source.kind].toLowerCase()}`}>
            <Input id="merge-search" icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or domain" autoFocus />
          </Field>
          {q.trim() && !other ? (
            <ul role="listbox" aria-label="Matches" className="flex max-h-56 flex-col overflow-y-auto rounded-panel border border-subtle bg-panel-alt" data-testid="merge-matches">
              {searchQ.isLoading ? <li className="p-2 text-small text-secondary">Searching…</li> : null}
              {!searchQ.isLoading && hits.length === 0 ? <li className="p-2 text-small text-secondary">No other {ENTITY_KIND_LABELS[source.kind].toLowerCase()} matches.</li> : null}
              {hits.map((h) => (
                <li key={h.entity.id} role="option" aria-selected={false}>
                  <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-body text-primary hover:bg-white/4" onClick={() => setOther({ id: h.entity.id, displayName: h.entity.displayName, kind: h.entity.kind })}>
                    <Icon icon={ENTITY_KIND_ICONS[h.entity.kind]} size="inline" className="text-secondary" />
                    <span className="flex-1 truncate">{h.entity.displayName}</span>
                    <span className="text-small text-secondary">{typeof h.entity.identifiers.email === "string" ? h.entity.identifiers.email : typeof h.entity.identifiers.domain === "string" ? h.entity.identifiers.domain : h.matchedOn}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {other ? (
            <RadioGroup value={keep} onValueChange={(v) => setKeep(v as typeof keep)} aria-label="Which record survives" className="gap-2">
              <RadioOption id="keep-source" value="source" label={`Keep ${source.displayName}`} description={`${other.displayName} is merged into it.`} />
              <RadioOption id="keep-other" value="other" label={`Keep ${other.displayName}`} description={`${source.displayName} is merged into it.`} />
            </RadioGroup>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {other ? (
            <Button variant="ghost" onClick={() => setOther(null)}>
              Pick another
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={GitMerge} disabled={!keptId || !mergedId} loading={merge.isPending} onClick={() => keptId && mergedId && merge.mutate({ businessId, keptId, mergedId })} data-testid="merge-confirm">
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- edit -----------------------------------------------------------------------------------------------------------

export function EditEntityDialog({ businessId, entity, open, onOpenChange }: { businessId: string; entity: EntityRecord; open: boolean; onOpenChange: (o: boolean) => void }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const [name, setName] = useState(entity.displayName);
  const [aliases, setAliases] = useState(entity.aliases.join(", "));
  const [email, setEmail] = useState(typeof entity.identifiers.email === "string" ? entity.identifiers.email : "");
  const [domain, setDomain] = useState(typeof entity.identifiers.domain === "string" ? entity.identifiers.domain : "");
  const [lawfulBasis, setLawfulBasis] = useState(entity.lawfulBasis ?? "");
  useEffect(() => {
    if (open) {
      setName(entity.displayName);
      setAliases(entity.aliases.join(", "));
      setEmail(typeof entity.identifiers.email === "string" ? entity.identifiers.email : "");
      setDomain(typeof entity.identifiers.domain === "string" ? entity.identifiers.domain : "");
      setLawfulBasis(entity.lawfulBasis ?? "");
    }
  }, [open, entity]);
  const update = useMutation(
    trpc.crm.entity.update.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast({ title: "Record updated", tone: "good" });
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Update failed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const save = () => {
    const identifiers: Record<string, unknown> = { ...entity.identifiers };
    if (email.trim()) identifiers.email = email.trim().toLowerCase();
    else delete identifiers.email;
    if (domain.trim()) identifiers.domain = domain.trim().toLowerCase();
    else delete identifiers.domain;
    update.mutate({ businessId, entityId: entity.id, patch: { displayName: name.trim(), aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean), identifiers, lawfulBasis: lawfulBasis || null } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="edit-entity-dialog">
        <DialogHeader>
          <DialogTitle>Edit {entity.displayName}</DialogTitle>
          <DialogDescription>Edits are recorded with you as the source; enrichment never overwrites them.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor="edit-name" label="Name" required>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field htmlFor="edit-aliases" label="Aliases" hint="Comma-separated.">
            <Input id="edit-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="edit-email" label="Email">
              <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field htmlFor="edit-domain" label="Domain">
              <Input id="edit-domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
            </Field>
          </div>
          {entity.kind === "person" ? (
            <Field htmlFor="edit-basis" label="Lawful basis">
              <SimpleSelect id="edit-basis" value={lawfulBasis} onValueChange={setLawfulBasis} placeholder="Not recorded" options={LAWFUL_BASES.map((b) => ({ value: b, label: LAWFUL_BASIS_LABEL[b]! }))} />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={update.isPending} onClick={save} data-testid="edit-entity-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- add role -------------------------------------------------------------------------------------------------------

export function AddRoleDialog({ businessId, entityId, open, onOpenChange, roles }: { businessId: string; entityId: string; open: boolean; onOpenChange: (o: boolean) => void; roles?: readonly string[] }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const [role, setRole] = useState("lead");
  const [stage, setStage] = useState("");
  const options = useMemo(() => [...new Set([...(roles ?? []), ...KNOWN_ROLES])].map((r) => ({ value: r, label: plainWords(r) })), [roles]);
  const add = useMutation(
    trpc.crm.roles.add.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast({ title: "Role added", tone: "good" });
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Could not add the role", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="add-role-dialog">
        <DialogHeader>
          <DialogTitle>Add a role</DialogTitle>
          <DialogDescription>A record can hold several roles at once (customer and champion, supplier and partner).</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor="role" label="Role">
            <SimpleSelect id="role" value={role} onValueChange={setRole} options={options} />
          </Field>
          <Field htmlFor="stage" label="Stage" hint="Optional: signed_up, activated, customer, churned, shortlisted…">
            <Input id="stage" value={stage} onChange={(e) => setStage(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={add.isPending} onClick={() => add.mutate({ businessId, entityId, role: { role, stage: stage.trim() || null } })} data-testid="add-role-save">
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- data duties: export and deletion request ----------------------------------------------------------------------

export function ExportDialog({ get, open, onOpenChange }: { get: EntityGet; open: boolean; onOpenChange: (o: boolean) => void }) {
  const json = useMemo(() => exportEntityJson(get), [get]);
  const filename = `${get.entity.displayName.replace(/[^\w-]+/g, "-").toLowerCase()}-export.json`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>Export everything held on {get.entity.displayName}</DialogTitle>
          <DialogDescription>Identifiers, roles, relationships, interaction summaries, mentions, signups and payments, and merge history. Encrypted bodies are referenced, never decrypted here.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea readOnly mono value={json} rows={14} aria-label="Export JSON" onFocus={(e) => e.currentTarget.select()} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="primary" icon={Download} onClick={() => downloadText(filename, json)} data-testid="export-download">
            Download JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRequestDialog({ businessId, entity, requestedBy, open, onOpenChange }: { businessId: string; entity: Pick<EntityRecord, "id" | "displayName">; requestedBy: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const trpc = useTRPC();
  const untyped = useUntypedApi();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const [reason, setReason] = useState("");
  const addNote = useMutation(trpc.crm.notes.add.mutationOptions());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const note = `${deletionRequestNote(requestedBy)}${reason.trim() ? ` Reason: ${reason.trim()}` : ""}`;
    try {
      // The dedicated request procedure lands with the deletion job; until then the request is recorded on the profile.
      await untyped.mutation("crm.entity.requestDeletion", { businessId, entityId: entity.id, reason: reason.trim() || undefined });
    } catch (err) {
      if (trpcErrorCode(err) !== "NOT_FOUND") {
        toast({ title: "Request not recorded", description: errorMessage(err), tone: "bad" });
        setBusy(false);
        return;
      }
      try {
        await addNote.mutateAsync({ businessId, entityId: entity.id, note });
      } catch (e2) {
        toast({ title: "Request not recorded", description: errorMessage(e2), tone: "bad" });
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    void invalidate();
    toast({ title: "Deletion requested", description: "Outreach to them stops now. The nightly deletion job removes the record in 7 days; the audit log records the request.", tone: "info" });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="delete-request-dialog">
        <DialogHeader>
          <DialogTitle>Request deletion of {entity.displayName}</DialogTitle>
          <DialogDescription>Deletion never runs immediately. Outreach to them stops now and a suppression entry stops re-import; the nightly, audited deletion job removes the record 7 days after the request.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor="delete-reason" label="Reason" hint="Optional: the person asked, data is wrong, retention rule.">
            <Textarea id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} loading={busy} onClick={() => void submit()} data-testid="delete-request-confirm">
            Queue deletion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KindChip({ kind }: { kind: EntityKind }) {
  return (
    <Chip tone="neutral" icon={ENTITY_KIND_ICONS[kind]}>
      {ENTITY_KIND_LABELS[kind]}
    </Chip>
  );
}
