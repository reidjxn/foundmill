"use client";
/** Create / edit a roadmap item and link it to spec blocks (product.roadmap.upsert + product.roadmap.link). */
import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, SimpleSelect, Textarea } from "@foundmill/dugout";
import { ROADMAP_HORIZONS } from "@foundmill/shared";
import { HORIZON_LABEL } from "../roadmap-status";
import { InlineError, blockTitle, groupBySection, useAction } from "../shared";
import type { RoadmapHorizon, RoadmapRow, SpecBlockRow } from "../types";

export interface ItemDraft {
  id?: string;
  title: string;
  descriptionMd: string;
  horizon: RoadmapHorizon;
  targetStart: string;
  targetEnd: string;
  confidence: number;
  specBlockIds: string[];
  status: string;
  ownerRef?: RoadmapRow["ownerRef"];
}

export function draftFrom(item: RoadmapRow | null, horizon: RoadmapHorizon = "next"): ItemDraft {
  return item
    ? { id: item.id, title: item.title, descriptionMd: item.descriptionMd ?? "", horizon: item.horizon, targetStart: item.targetStart ?? "", targetEnd: item.targetEnd ?? "", confidence: item.confidence, specBlockIds: item.specBlockIds ?? [], status: item.status, ownerRef: item.ownerRef ?? null }
    : { title: "", descriptionMd: "", horizon, targetStart: "", targetEnd: "", confidence: 3, specBlockIds: [], status: "planned", ownerRef: null };
}

/** The `product.roadmap.upsert` input for a draft (empty dates become null; status is kept, never promoted). */
export function upsertInput(d: ItemDraft): Record<string, unknown> {
  return {
    ...(d.id ? { id: d.id } : {}),
    title: d.title.trim(),
    descriptionMd: d.descriptionMd,
    horizon: d.horizon,
    targetStart: d.targetStart || null,
    targetEnd: d.targetEnd || null,
    confidence: d.confidence,
    ownerRef: d.ownerRef ?? null,
    specBlockIds: d.specBlockIds,
    status: d.status,
  };
}

export function validateDraft(d: ItemDraft): string | null {
  if (!d.title.trim()) return "Give the item a title.";
  if (d.targetStart && d.targetEnd && d.targetEnd < d.targetStart) return "The target end is before the start.";
  return null;
}

export function ItemDialog({ open, item, horizon, blocks, onClose, onSaved }: { open: boolean; item: RoadmapRow | null; horizon?: RoadmapHorizon; blocks: readonly SpecBlockRow[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<ItemDraft>(() => draftFrom(item, horizon));
  const [touched, setTouched] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(item, horizon));
      setTouched(false);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, horizon]);
  const groups = useMemo(() => groupBySection(blocks), [blocks]);
  const problem = validateDraft(draft);

  const save = async () => {
    setTouched(true);
    if (problem) return;
    await action.run("product.roadmap.upsert", upsertInput(draft), {
      key: "save",
      then: () => {
        onSaved();
        onClose();
      },
    });
  };
  const toggleBlock = (id: string, on: boolean) => setDraft((d) => ({ ...d, specBlockIds: on ? [...new Set([...d.specBlockIds, id])] : d.specBlockIds.filter((x) => x !== id) }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit roadmap item" : "New roadmap item"}</DialogTitle>
          <DialogDescription>Status is computed from linked tasks and acceptance criteria; it is not set here.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field htmlFor="rm-title" label="Title" required error={touched && !draft.title.trim() ? "Required" : undefined} className="col-span-2">
            <Input id="rm-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} autoFocus />
          </Field>
          <Field htmlFor="rm-horizon" label="Horizon">
            <SimpleSelect id="rm-horizon" value={draft.horizon} onValueChange={(v) => setDraft({ ...draft, horizon: v as RoadmapHorizon })} options={ROADMAP_HORIZONS.map((h) => ({ value: h, label: HORIZON_LABEL[h] }))} />
          </Field>
          <Field htmlFor="rm-confidence" label="Confidence" hint="1 low · 5 high">
            <SimpleSelect id="rm-confidence" value={String(draft.confidence)} onValueChange={(v) => setDraft({ ...draft, confidence: Number(v) })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of 5` }))} />
          </Field>
          <Field htmlFor="rm-start" label="Target start">
            <Input id="rm-start" type="date" value={draft.targetStart} onChange={(e) => setDraft({ ...draft, targetStart: e.target.value })} />
          </Field>
          <Field htmlFor="rm-end" label="Target end" error={touched && problem?.startsWith("The target end") ? problem : undefined}>
            <Input id="rm-end" type="date" value={draft.targetEnd} onChange={(e) => setDraft({ ...draft, targetEnd: e.target.value })} />
          </Field>
          <Field htmlFor="rm-desc" label="Description" className="col-span-2">
            <Textarea id="rm-desc" rows={3} value={draft.descriptionMd} onChange={(e) => setDraft({ ...draft, descriptionMd: e.target.value })} placeholder="What done looks like, in a sentence or two" />
          </Field>
          <fieldset className="col-span-2 min-w-0">
            <legend className="t-label mb-1">Linked specification paragraphs</legend>
            {groups.length === 0 ? <p className="text-small text-secondary">No specification paragraphs yet. Link them once the Specification has content.</p> : null}
            <div className="max-h-48 overflow-auto rounded-panel border border-subtle bg-panel-alt p-2">
              {groups.map((g) => (
                <div key={g.section} className="mb-2 last:mb-0">
                  <p className="t-label mb-1">{g.section}</p>
                  <ul className="flex flex-col gap-1">
                    {g.blocks.map((b) => {
                      const id = `rm-block-${b.id}`;
                      return (
                        <li key={b.id} className="flex items-center gap-2">
                          <Checkbox id={id} checked={draft.specBlockIds.includes(b.id)} onCheckedChange={(v) => toggleBlock(b.id, v === true)} />
                          <label htmlFor={id} className="min-w-0 flex-1 truncate text-body text-primary">
                            {blockTitle(b)}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <InlineError error={action.error ?? (touched ? problem : null)} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Save} onClick={() => void save()} loading={action.pending === "save"}>
            {item ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
