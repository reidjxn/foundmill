"use client";
/**
 * Import a plan (founder-only, Product › Vision): a founder who already has a written plan (a vision, a specification
 * and a roadmap in one Markdown file) chooses the file, reads what it would write (`product.plan.preview`, which writes
 * nothing and names the line of every problem), and imports it (`product.plan.import`). The file is checked in the
 * browser first (a .md file of at most 256 KB, strict UTF-8), the way a skill file is (team/skills.tsx); the api checks
 * it again. Owners and admins only: VisionScreen shows the button to them alone, and the api refuses everyone else.
 */
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { FileUp, Upload } from "lucide-react";
import { LIMITS } from "@foundmill/config";
import { Button, Checkbox, cn, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Term, useToast } from "@foundmill/dugout";
import type { RoadmapHorizon } from "@foundmill/shared";
import { InlineError, useAction } from "../shared";

/** One problem in the file, as `product.plan.preview` reports it (`line` is null for the file as a whole). */
export interface PlanFileProblem {
  line: number | null;
  message: string;
}

/** What `product.plan.preview` answers (apps/api services/plan-import.ts `PlanPreview`). */
export interface PlanPreviewData {
  ok: boolean;
  errors: PlanFileProblem[];
  vision: boolean;
  sections: { write: string[]; create: string[]; paragraphsRetired: number };
  roadmap: Record<RoadmapHorizon, number>;
  archive: number;
}

/** What `product.plan.import` answers (`PlanImportResult`). */
export interface PlanImportResultData {
  sectionsWritten: string[];
  sectionsCreated: string[];
  paragraphsRetired: number;
  itemsAdded: Record<RoadmapHorizon, number>;
  itemsArchived: number;
  visionSet: boolean;
}

export const PLAN_FILE_ACCEPT = ".md,.markdown,text/markdown";
const PLAN_FILE_EXTENSIONS = [".md", ".markdown"];
const KB = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** Reads a chosen file as strict UTF-8 text after the browser-side checks; the api parses it. */
export async function readPlanFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<{ ok: true; fileName: string; text: string } | { ok: false; message: string }> {
  const ext = /\.[^.]+$/.exec(file.name)?.[0]?.toLowerCase() ?? "";
  if (!PLAN_FILE_EXTENSIONS.includes(ext)) return { ok: false, message: "Choose a Markdown file (.md)." };
  if (file.size > LIMITS.planFileMaxBytes) return { ok: false, message: `The file is larger than ${KB(LIMITS.planFileMaxBytes)}. Split the plan, or shorten the specification.` };
  if (file.size === 0) return { ok: false, message: "The file is empty." };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    return { ok: true, fileName: file.name, text };
  } catch {
    return { ok: false, message: "The file is not valid UTF-8 text. Save it as UTF-8 and choose it again." };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const horizons = (c: Record<RoadmapHorizon, number>) => `Now ${c.now} · Next ${c.next} · Later ${c.later}`;

/** The toast's line after an import: what changed, in one sentence. */
export function importSummary(r: PlanImportResultData): string {
  const items = r.itemsAdded.now + r.itemsAdded.next + r.itemsAdded.later;
  const parts = [
    r.visionSet ? "vision updated" : null,
    r.sectionsWritten.length ? `${plural(r.sectionsWritten.length, "section")} rewritten` : null,
    r.sectionsCreated.length ? `${plural(r.sectionsCreated.length, "section")} added` : null,
    items ? `${plural(items, "roadmap item")} added` : null,
    r.itemsArchived ? `${plural(r.itemsArchived, "unstarted item")} retired` : null,
  ].filter(Boolean);
  const line = parts.join(", ") || "nothing changed";
  return `${line[0]!.toUpperCase()}${line.slice(1)}.`;
}

const names = (list: string[]) => (list.length ? `: ${list.slice(0, 4).join(", ")}${list.length > 4 ? `, and ${list.length - 4} more` : ""}` : "");

/** The preview as label and value rows, in the order the import writes them. */
export function previewRows(p: PlanPreviewData, replaceUnstarted: boolean): { label: string; value: string }[] {
  const rows = [
    { label: "Vision", value: p.vision ? "Replaces the current vision" : "Not in this file" },
    { label: "Sections to rewrite", value: `${p.sections.write.length}${names(p.sections.write)}` },
    { label: "Sections to add", value: `${p.sections.create.length}${names(p.sections.create)}` },
    { label: "Roadmap items to add", value: horizons(p.roadmap) },
  ];
  if (p.sections.paragraphsRetired) rows.push({ label: "Older paragraphs to retire", value: `${p.sections.paragraphsRetired} (in the sections rewritten)` });
  if (replaceUnstarted) rows.push({ label: "Unstarted items to retire", value: String(p.archive) });
  return rows;
}

export interface PlanImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful import (the screen refetches the specification, the roadmap and the vision). */
  onImported?: (result: PlanImportResultData) => void;
}

export function PlanImportDialog({ open, onOpenChange, onImported }: PlanImportDialogProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const action = useAction();
  const { toast } = useToast();
  const [file, setFile] = useState<{ fileName: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PlanPreviewData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [replaceUnstarted, setReplaceUnstarted] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setPreview(null);
      setProblem(null);
      setReplaceUnstarted(false);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the dialog opens
  }, [open]);

  const runPreview = async (text: string, replace: boolean) => {
    setPreview(null);
    const p = await action.run<PlanPreviewData>("product.plan.preview", { fileText: text, replaceUnstarted: replace }, { key: "preview" });
    if (p) setPreview(p);
  };
  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(null);
    setPreview(null);
    setProblem(null);
    action.clearError();
    const read = await readPlanFile(picked);
    if (!read.ok) return setProblem(read.message);
    setFile({ fileName: read.fileName, text: read.text });
    await runPreview(read.text, replaceUnstarted);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };
  const toggleReplace = (value: boolean) => {
    setReplaceUnstarted(value);
    if (file) void runPreview(file.text, value);
  };
  const runImport = async () => {
    if (!file || !preview?.ok) return;
    const result = await action.run<PlanImportResultData>("product.plan.import", { fileText: file.text, replaceUnstarted }, { key: "import" });
    if (!result) return;
    toast({ title: "Plan imported", description: importSummary(result), tone: "good", type: "foreground" });
    onImported?.(result);
    onOpenChange(false);
  };

  const errors = preview?.errors ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby={`${id}-desc`} data-testid="plan-import-dialog">
        <DialogHeader>
          <DialogTitle>Import a plan</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            One Markdown file with a # Vision, a # <Term id="specification">Specification</Term> and a # <Term id="roadmap">Roadmap</Term>, any of them optional, up to {KB(LIMITS.planFileMaxBytes)} ({KB(LIMITS.planSectionMaxBytes)} a section). Sections you name are written as your own edits; sections you leave out stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <input ref={inputRef} type="file" accept={PLAN_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Plan file" data-testid="plan-file-input" onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }} />
          <div
            className={cn("edge flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2 p-panel-pad text-center", dragging && "row-selected")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="plan-file-drop"
          >
            <Button icon={Upload} loading={action.pending === "preview"} onClick={() => inputRef.current?.click()} data-testid="plan-file-choose">
              {file ? "Choose another file" : "Choose a file"}
            </Button>
            <span className="text-small text-secondary">{file ? file.fileName : "or drop a .md file here"}</span>
          </div>
          {problem ? (
            <p role="alert" className="text-small text-status-bad" data-testid="plan-file-problem">
              {problem}
            </p>
          ) : null}
          {errors.length ? (
            <div role="alert" className="flex flex-col gap-1" data-testid="plan-file-errors">
              <p className="text-small text-status-bad">Fix {errors.length === 1 ? "this" : "these"} in the file, then choose it again:</p>
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-status-bad">
                {errors.map((e, i) => (
                  <li key={`${e.line ?? "file"}-${i}`} data-line={e.line ?? undefined}>
                    {e.line ? <span className="tabular-nums">Line {e.line}: </span> : null}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview?.ok ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-subtle p-3" data-testid="plan-preview">
              {previewRows(preview, replaceUnstarted).map((r) => (
                <div key={r.label} className="contents">
                  <dt className="t-label">{r.label}</dt>
                  <dd className="text-body text-primary tabular-nums" data-preview-row={r.label}>
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-replace`} checked={replaceUnstarted} onCheckedChange={(v) => toggleReplace(v === true)} data-testid="plan-replace-unstarted" />
              <label htmlFor={`${id}-replace`} className="text-body text-primary">
                Retire roadmap items nobody has started
              </label>
            </div>
            <p className="pl-6 text-small text-secondary">Items with work started or finished always stay. Retired items are archived, not deleted.</p>
          </div>
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={FileUp} disabled={!preview?.ok} loading={action.pending === "import"} onClick={() => void runImport()} data-testid="plan-import-submit">
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
