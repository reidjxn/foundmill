"use client";
/**
 * Skills a founder adds to an agent (founder request 2026-10-16), shared by the hire dialog's optional Skills step and
 * the agent profile's "Skills from the library or files" panel:
 *
 * - `SkillLibraryDialog`: the curated library (team.skills.library), searchable and grouped by category.
 * - `UploadSkillDialog`: a SKILL.md, .md or .txt file, checked in the browser (type, 64 KB, strict UTF-8), then parsed
 *   and screened by the api (team.skills.preview) and previewed before it is added. The api screens it again on add.
 * - `SkillsStep`: both buttons and the chosen skills, each removable.
 *
 * Adding never waits on a model call. A skill's instructions follow the house rules in the agent's prompt; it never
 * changes the agent's tools, autonomy, spend caps or approvals.
 */
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { BookOpen, Upload } from "lucide-react";
import { LIMITS } from "@foundmill/config";
import { Button, ChosenSkillList, cn, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SkillFilePreview, SkillLibraryList, type ChosenSkill, type LibrarySkillOption } from "@foundmill/dugout";
import type { SkillGroup } from "@foundmill/shared/constants";
import { useWidgetQuery } from "@foundmill/widgets/data";
import { InlineError, useAction } from "./shared";

/** A library skill as team.skills.library returns it. */
export interface LibrarySkillRow extends LibrarySkillOption {
  skillKey: string;
  category: string;
  instructionsMd: string;
}

/** What team.skills.preview returns for a file. */
export interface SkillFilePreviewData {
  name: string;
  description: string;
  format: "skill_md" | "markdown" | "text";
  fileName: string;
  sizeBytes: number;
  lines: string[];
  totalLines: number;
  notes: string[];
  group: SkillGroup;
}

/** A skill chosen in the hire dialog, before the agent exists. */
export type SkillDraft =
  | { id: string; source: "library"; key: string; name: string; detail: string }
  | { id: string; source: "upload"; fileName: string; content: string; name: string; detail: string };

/** The input team.agents.hire and agent.skills.add take for each skill. */
export type SkillChoiceInput = { source: "library"; key: string } | { source: "upload"; fileName: string; content: string };

export function toSkillChoices(drafts: readonly SkillDraft[]): SkillChoiceInput[] {
  return drafts.map((d) => (d.source === "library" ? { source: "library", key: d.key } : { source: "upload", fileName: d.fileName, content: d.content }));
}

/** Library and file skills one agent may carry (the api refuses more). */
export const MAX_ADDED_SKILLS = 8;
export const SKILL_FILE_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";
const SKILL_FILE_EXTENSIONS = [".md", ".markdown", ".txt"];

/** Reads a chosen file as strict UTF-8 text after the browser-side checks; the api parses and screens the text. */
export async function readSkillFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<{ ok: true; fileName: string; content: string } | { ok: false; message: string }> {
  const ext = /\.[^.]+$/.exec(file.name)?.[0]?.toLowerCase() ?? "";
  if (!SKILL_FILE_EXTENSIONS.includes(ext)) return { ok: false, message: "Upload a SKILL.md, a Markdown (.md) or a plain text (.txt) file." };
  if (file.size > LIMITS.skillFileMaxBytes) return { ok: false, message: `The file is larger than ${LIMITS.skillFileMaxBytes / 1024} KB. Keep a skill to its instructions, or split it into two skills.` };
  if (file.size === 0) return { ok: false, message: "The file is empty." };
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    return { ok: true, fileName: file.name, content };
  } catch {
    return { ok: false, message: "The file is not valid UTF-8 text. Save it as UTF-8 and upload it again." };
  }
}

/* ---------- Library ---------- */

export interface SkillLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Library keys that cannot be chosen, with the reason ("Already chosen", "Already has this skill"). */
  unavailable?: Readonly<Record<string, string>>;
  /** How many more may be added. */
  remaining?: number;
  /** Who the skills are for, in the title ("Add skills to Quill"). */
  agentName?: string;
  /** Called with the chosen skills; return false to keep the dialog open (the add failed). */
  onAdd: (skills: LibrarySkillRow[]) => boolean | void | Promise<boolean | void>;
  pending?: boolean;
  error?: Error | string | null;
}

export function SkillLibraryDialog({ open, onOpenChange, unavailable, remaining = MAX_ADDED_SKILLS, agentName, onAdd, pending, error }: SkillLibraryDialogProps) {
  const id = useId();
  const library = useWidgetQuery<LibrarySkillRow[]>("team.skills.library", {}, { enabled: open });
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);
  const rows = library.data ?? [];
  const add = async () => {
    const chosen = rows.filter((r) => selected.includes(r.key));
    if (chosen.length === 0) return;
    if ((await onAdd(chosen)) !== false) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby={`${id}-desc`} data-testid="skill-library-dialog">
        <DialogHeader>
          <DialogTitle>{agentName ? `Add skills to ${agentName}` : "Add skills from the library"}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>Each skill gives the agent how-to instructions for a kind of work and shows on its attributes, untested until a training run scores it. Skills never change its tools, how much it may do without asking you, or its spend caps.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col overflow-y-auto">
          {library.isLoading && !library.data ? <p className="text-small text-secondary">Loading the library…</p> : null}
          <InlineError error={library.error} />
          {rows.length ? <SkillLibraryList skills={rows} selected={selected} onToggle={(k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} unavailable={unavailable} max={Math.max(0, remaining)} /> : null}
          {remaining <= 0 ? <p className="mt-2 text-small text-status-warn">This agent already has {MAX_ADDED_SKILLS} skills from the library or files. Remove one to add another.</p> : null}
          <InlineError error={error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={BookOpen} disabled={selected.length === 0} loading={pending} onClick={() => void add()} data-testid="skill-library-add">
            {selected.length === 1 ? "Add 1 skill" : `Add ${selected.length} skills`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Upload ---------- */

export interface UploadSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName?: string;
  /** Called with the file and its preview; return false to keep the dialog open (the add failed). */
  onAdd: (file: { fileName: string; content: string; preview: SkillFilePreviewData }) => boolean | void | Promise<boolean | void>;
  pending?: boolean;
  error?: Error | string | null;
}

export function UploadSkillDialog({ open, onOpenChange, agentName, onAdd, pending, error }: UploadSkillDialogProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const action = useAction();
  const [file, setFile] = useState<{ fileName: string; content: string; preview: SkillFilePreviewData } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setProblem(null);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the dialog opens
  }, [open]);
  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(null);
    setProblem(null);
    action.clearError();
    const read = await readSkillFile(picked);
    if (!read.ok) return setProblem(read.message);
    const preview = await action.run<SkillFilePreviewData>("team.skills.preview", { fileName: read.fileName, content: read.content }, { key: "preview" });
    if (preview) setFile({ fileName: read.fileName, content: read.content, preview });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };
  const add = async () => {
    if (file && (await onAdd(file)) !== false) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby={`${id}-desc`} data-testid="skill-upload-dialog">
        <DialogHeader>
          <DialogTitle>{agentName ? `Upload a skill for ${agentName}` : "Upload a skill file"}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>A SKILL.md (front matter with a name and description, then instructions), or a Markdown or text file of up to {LIMITS.skillFileMaxBytes / 1024} KB. It is checked against the house rules before you add it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <input ref={inputRef} type="file" accept={SKILL_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Skill file" data-testid="skill-file-input" onChange={(e) => {
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
            data-testid="skill-file-drop"
          >
            <Button icon={Upload} loading={action.pending === "preview"} onClick={() => inputRef.current?.click()} data-testid="skill-file-choose">
              {file ? "Choose another file" : "Choose a file"}
            </Button>
            <span className="text-small text-secondary">or drop a SKILL.md, .md or .txt file here</span>
          </div>
          {problem || action.error ? (
            // The api's reason in full: it says what to change in the file.
            <p role="alert" className="text-small text-status-bad" data-testid="skill-file-problem">
              {problem ?? action.error?.message}
            </p>
          ) : null}
          {file ? <SkillFilePreview name={file.preview.name} description={file.preview.description} fileName={file.preview.fileName} sizeBytes={file.preview.sizeBytes} lines={file.preview.lines} totalLines={file.preview.totalLines} notes={file.preview.notes} /> : null}
          <InlineError error={error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!file} loading={pending} onClick={() => void add()} data-testid="skill-upload-add">
            Add skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- The hire dialog's Skills step ---------- */

export interface SkillsStepProps {
  value: readonly SkillDraft[];
  onChange: (next: SkillDraft[]) => void;
  disabled?: boolean;
}

/** Optional: skills from the library or files for the agent being hired, listed and removable before Hire. */
export function SkillsStep({ value, onChange, disabled }: SkillsStepProps) {
  const [library, setLibrary] = useState(false);
  const [upload, setUpload] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remaining = MAX_ADDED_SKILLS - value.length;
  const unavailable = useMemo(() => Object.fromEntries(value.flatMap((d) => (d.source === "library" ? [[d.key, "Already chosen"] as const] : []))), [value]);
  const items: ChosenSkill[] = value.map((d) => ({ id: d.id, name: d.name, source: d.source, detail: d.detail }));
  const named = (name: string) => value.some((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <fieldset className="flex flex-col gap-2" data-testid="hire-skills-step">
      <legend className="t-label mb-1">Skills (optional)</legend>
      <p className="text-small text-secondary">Add how-to skills from the library or a skill file. They show on the agent's attributes, untested until a training run scores them, and never change its tools, how much it may do without asking you, or its spend caps.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={BookOpen} disabled={disabled || remaining <= 0} onClick={() => setLibrary(true)} data-testid="hire-add-library-skill">
          Add from library
        </Button>
        <Button size="sm" icon={Upload} disabled={disabled || remaining <= 0} onClick={() => setUpload(true)} data-testid="hire-upload-skill">
          Upload a skill file
        </Button>
      </div>
      <ChosenSkillList items={items} onRemove={disabled ? undefined : (id) => onChange(value.filter((d) => d.id !== id))} />
      {problem ? (
        <p role="alert" className="text-small text-status-bad">
          {problem}
        </p>
      ) : null}
      <SkillLibraryDialog
        open={library}
        onOpenChange={setLibrary}
        unavailable={unavailable}
        remaining={remaining}
        onAdd={(rows) => {
          setProblem(null);
          onChange([...value, ...rows.map((r) => ({ id: r.skillKey, source: "library" as const, key: r.key, name: r.attribute.name, detail: r.description }))]);
        }}
      />
      <UploadSkillDialog
        open={upload}
        onOpenChange={setUpload}
        onAdd={(f) => {
          if (named(f.preview.name)) {
            setProblem(`A skill called "${f.preview.name}" is already chosen.`);
            return;
          }
          setProblem(null);
          onChange([...value, { id: `upload:${f.fileName}:${f.preview.name}`, source: "upload", fileName: f.fileName, content: f.content, name: f.preview.name, detail: f.preview.fileName }]);
        }}
      />
    </fieldset>
  );
}
