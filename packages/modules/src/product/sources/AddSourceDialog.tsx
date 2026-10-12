"use client";
/** Add a source by hand (a link, a pasted note, a competitor page). Saves through `product.sources.add`. */
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, SimpleSelect, Textarea } from "@foundmill/dugout";
import type { SourceKind } from "@foundmill/shared";
import { InlineError, useAction } from "../shared";
import { SOURCE_KIND_OPTIONS } from "./kinds";

export interface SourceDraft {
  kind: SourceKind;
  title: string;
  uri: string;
  notes: string;
}

export const EMPTY_SOURCE_DRAFT: SourceDraft = { kind: "doc", title: "", uri: "", notes: "" };

export function validateSourceDraft(d: SourceDraft): string | null {
  if (!d.title.trim() && !d.uri.trim()) return "Give the source a title or a link.";
  if (d.uri.trim()) {
    try {
      const u = new URL(d.uri.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") return "Links must start with http:// or https://.";
    } catch {
      return "That link does not look like a URL.";
    }
  }
  return null;
}

/** The `product.sources.add` input: the notes (or pasted text) are read with the source and show as its summary until the Source Watcher writes one. */
export function sourceInput(d: SourceDraft): Record<string, unknown> {
  const uri = d.uri.trim() || null;
  return { kind: d.kind, uri, title: d.title.trim() || uri || "", contentRef: null, relevance: d.notes.trim() ? { notes: d.notes.trim() } : {} };
}

export function AddSourceDialog({ open, kind, onClose, onSaved }: { open: boolean; kind?: SourceKind; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<SourceDraft>({ ...EMPTY_SOURCE_DRAFT, kind: kind ?? "doc" });
  const [touched, setTouched] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY_SOURCE_DRAFT, kind: kind ?? "doc" });
      setTouched(false);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);
  const problem = validateSourceDraft(draft);
  const save = async () => {
    setTouched(true);
    if (problem) return;
    await action.run("product.sources.add", sourceInput(draft), {
      key: "save",
      then: () => {
        onSaved();
        onClose();
      },
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>The Source Watcher reads it, scores its relevance to each spec block and raises a change proposal when it matters.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field htmlFor="src-kind" label="Kind">
            <SimpleSelect id="src-kind" value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as SourceKind })} options={SOURCE_KIND_OPTIONS} />
          </Field>
          <Field htmlFor="src-title" label="Title" error={touched && problem?.startsWith("Give") ? problem : undefined}>
            <Input id="src-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={400} autoFocus />
          </Field>
          <Field htmlFor="src-uri" label="Link" hint="Public pages are fetched within robots.txt; logins are never bypassed." error={touched && problem && !problem.startsWith("Give") ? problem : undefined} className="col-span-2">
            <Input id="src-uri" type="url" inputMode="url" value={draft.uri} onChange={(e) => setDraft({ ...draft, uri: e.target.value })} placeholder="https://" maxLength={2048} />
          </Field>
          <Field htmlFor="src-notes" label="Notes" className="col-span-2">
            <Textarea id="src-notes" rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="What this says, in a sentence or two (or paste the text)" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <InlineError error={action.error ?? (touched ? problem : null)} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => void save()} loading={action.pending === "save"}>
            Add source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
