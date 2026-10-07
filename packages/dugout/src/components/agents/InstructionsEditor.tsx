"use client";
import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GitCompareArrows, MessageSquare, PenLine, Plus, ShieldAlert, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";
import { DiffView } from "../data/DiffView";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { SimpleSelect } from "../foundation/Select";
import { Textarea } from "../foundation/Textarea";
import type { AgentInstructions, InstructionExample, InstructionVersion } from "./types";

export const INSTRUCTION_SECTIONS = ["role", "goals", "rules", "playbook", "tone", "examples"] as const;
export type InstructionSection = (typeof INSTRUCTION_SECTIONS)[number];

export const SECTION_LABELS: Record<InstructionSection, string> = { role: "Role", goals: "Goals", rules: "Rules", playbook: "Playbook", tone: "Tone", examples: "Examples" };
export const SECTION_HINTS: Record<InstructionSection, string> = {
  role: "One or two sentences: who this agent is and what it owns.",
  goals: "Outcomes, in priority order.",
  rules: "Hard constraints the agent follows every time. Club rules are always prepended and cannot be changed here.",
  playbook: "The steps it takes on a typical task, in order.",
  tone: "How it writes: to customers, in pull requests, in notes.",
  examples: "Input and the output you expect. These shape behaviour more than rules do.",
};

export function emptyInstructions(): AgentInstructions {
  return { role: "", goals: [], rules: [], playbook: [], tone: "", examples: [] };
}

/** Canonical text form used for version diffs and comments; stable ordering, one item per line. */
export function serializeInstructions(i: AgentInstructions): string {
  const list = (items: readonly string[], numbered = false) => (items.length ? items.map((s, k) => `${numbered ? `${k + 1}. ` : "- "}${s}`).join("\n") : "(none)");
  return [
    "# Role",
    i.role.trim() || "(none)",
    "",
    "# Goals",
    list(i.goals),
    "",
    "# Rules",
    list(i.rules),
    "",
    "# Playbook",
    list(i.playbook, true),
    "",
    "# Tone",
    i.tone.trim() || "(none)",
    "",
    "# Examples",
    i.examples.length ? i.examples.map((e, k) => `${k + 1}. Input: ${e.input}\n   Output: ${e.output}`).join("\n") : "(none)",
    "",
  ].join("\n");
}

export function instructionsEqual(a: AgentInstructions, b: AgentInstructions): boolean {
  return serializeInstructions(a) === serializeInstructions(b);
}

export interface InstructionViolation {
  section: InstructionSection;
  /** Index in the list for list sections; ignored for role/tone. */
  index?: number;
  reason: string;
}

export interface InstructionComment {
  id: string;
  author: string;
  at: string;
  text: string;
}

export interface InstructionsEditorProps {
  value: AgentInstructions;
  onChange: (value: AgentInstructions) => void;
  /** Live version to compare against; defaults to the `live` entry in `versions`. */
  previous?: AgentInstructions;
  versions?: readonly InstructionVersion[];
  /** Club-rule flags from the detector (AC-11.10.4): shown next to the line, with no effect on the rule. */
  violations?: readonly InstructionViolation[];
  comments?: readonly InstructionComment[];
  onComment?: (text: string) => void;
  readOnly?: boolean;
  mode?: "edit" | "diff";
  defaultMode?: "edit" | "diff";
  onModeChange?: (mode: "edit" | "diff") => void;
  className?: string;
}

function ListEditor({
  id,
  items,
  onChange,
  numbered,
  placeholder,
  readOnly,
  flagged,
  addLabel,
}: {
  id: string;
  items: readonly string[];
  onChange: (items: string[]) => void;
  numbered?: boolean;
  placeholder: string;
  readOnly?: boolean;
  flagged: Map<number, string>;
  addLabel: string;
}) {
  const set = (i: number, v: string) => onChange(items.map((s, k) => (k === i ? v : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    onChange(next);
  };
  const Tag = numbered ? "ol" : "ul";
  return (
    <div className="flex flex-col gap-1">
      <Tag className="flex flex-col gap-1" aria-labelledby={`${id}-label`}>
        {items.map((item, i) => {
          const reason = flagged.get(i);
          return (
            <li key={i} className="flex items-start gap-1" data-flagged={reason ? true : undefined}>
              <span className="w-5 shrink-0 pt-2 text-right text-small text-secondary tabular-nums" aria-hidden>
                {numbered ? `${i + 1}.` : "•"}
              </span>
              <div className="min-w-0 flex-1">
                <Input value={item} readOnly={readOnly} onChange={(e) => set(i, e.target.value)} aria-label={`${numbered ? "Step" : "Item"} ${i + 1}`} invalid={!!reason} className={cn(reason && "border-status-warn")} />
                {reason ? (
                  <p role="status" className="mt-0.5 flex items-center gap-1 text-small text-status-warn">
                    <Icon icon={ShieldAlert} size="inline" />
                    Contradicts a club rule and has no effect: {reason}
                  </p>
                ) : null}
              </div>
              {!readOnly ? (
                <>
                  <IconButton icon={ArrowUp} label={`Move ${numbered ? "step" : "item"} ${i + 1} up`} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon={ArrowDown} label={`Move ${numbered ? "step" : "item"} ${i + 1} down`} size="sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                  <IconButton icon={X} label={`Remove ${numbered ? "step" : "item"} ${i + 1}`} size="sm" onClick={() => onChange(items.filter((_, k) => k !== i))} />
                </>
              ) : null}
            </li>
          );
        })}
      </Tag>
      {!readOnly ? (
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...items, ""])} className="self-start">
          {addLabel}
        </Button>
      ) : items.length === 0 ? (
        <p className="text-small text-secondary">{placeholder}</p>
      ) : null}
    </div>
  );
}

function Section({ id, section, children }: { id: string; section: InstructionSection; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5 border-b border-subtle pb-4 last:border-b-0">
      <h3 id={`${id}-label`} className="t-label">
        {SECTION_LABELS[section]}
      </h3>
      <p className="text-small text-secondary">{SECTION_HINTS[section]}</p>
      {children}
    </section>
  );
}

/**
 * Structured instructions editor (BUILD §11.10 Training "Instructions"): role, goals, rules, playbook steps, tone and
 * examples, with a version diff view (local line diff) and comments. Club-rule contradictions are flagged on the line.
 */
export function InstructionsEditor({ value, onChange, previous, versions = [], violations = [], comments = [], onComment, readOnly, mode: modeProp, defaultMode = "edit", onModeChange, className }: InstructionsEditorProps) {
  const id = useId();
  const [modeState, setModeState] = useState<"edit" | "diff">(defaultMode);
  const mode = modeProp ?? modeState;
  const setMode = (m: "edit" | "diff") => {
    setModeState(m);
    onModeChange?.(m);
  };
  const live = versions.find((v) => v.state === "live");
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const compareTarget = compareVersion !== null ? versions.find((v) => v.version === compareVersion)?.instructions : undefined;
  const base = compareTarget ?? previous ?? live?.instructions ?? emptyInstructions();
  const [draft, setDraft] = useState("");
  const flags = (section: InstructionSection) => new Map(violations.filter((v) => v.section === section).map((v) => [v.index ?? 0, v.reason] as const));
  const dirty = !instructionsEqual(value, base);
  const update = <K extends keyof AgentInstructions>(key: K, v: AgentInstructions[K]) => onChange({ ...value, [key]: v });
  const setExample = (i: number, patch: Partial<InstructionExample>) => update("examples", value.examples.map((e, k) => (k === i ? { ...e, ...patch } : e)));

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} data-instructions-editor data-mode={mode}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Instructions view" className="inline-flex items-center gap-0.5 rounded-panel border border-subtle bg-panel-alt p-0.5">
          <Button size="sm" variant={mode === "edit" ? "default" : "ghost"} icon={PenLine} role="radio" aria-checked={mode === "edit"} onClick={() => setMode("edit")} className="h-6 px-1.5">
            Edit
          </Button>
          <Button size="sm" variant={mode === "diff" ? "default" : "ghost"} icon={GitCompareArrows} role="radio" aria-checked={mode === "diff"} onClick={() => setMode("diff")} className="h-6 px-1.5">
            Diff
          </Button>
        </div>
        {versions.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="t-label">Compare with</span>
            <SimpleSelect
              aria-label="Version to compare with"
              controlSize="sm"
              className="w-56"
              value={String(compareVersion ?? live?.version ?? "")}
              onValueChange={(v) => setCompareVersion(Number(v))}
              options={versions.map((v) => ({ value: String(v.version), label: `v${v.version} · ${v.state} · ${v.author}` }))}
            />
          </div>
        ) : null}
        <span className="flex-1" />
        {dirty ? <Chip tone="info">Draft differs from {compareVersion !== null ? `v${compareVersion}` : "live"}</Chip> : <Chip tone="neutral">No changes</Chip>}
        {violations.length > 0 ? (
          <Chip tone="warn" icon={ShieldAlert}>
            {violations.length} club-rule {violations.length === 1 ? "conflict" : "conflicts"}
          </Chip>
        ) : null}
      </div>

      {mode === "diff" ? (
        <DiffView original={serializeInstructions(base)} proposed={serializeInstructions(value)} readOnly title={`v${compareVersion ?? live?.version ?? "live"} → draft`} labels={{ original: compareVersion !== null ? `v${compareVersion}` : "Live", proposed: "Draft" }} maxHeight={560} />
      ) : (
        <div className="flex flex-col gap-4">
          <Section id={`${id}-role`} section="role">
            <Textarea id={`${id}-role-input`} aria-labelledby={`${id}-role-label`} value={value.role} readOnly={readOnly} onChange={(e) => update("role", e.target.value)} rows={2} autoGrow invalid={flags("role").size > 0} />
            {flags("role").size > 0 ? (
              <p role="status" className="flex items-center gap-1 text-small text-status-warn">
                <Icon icon={ShieldAlert} size="inline" />
                Contradicts a club rule and has no effect: {flags("role").get(0)}
              </p>
            ) : null}
          </Section>
          <Section id={`${id}-goals`} section="goals">
            <ListEditor id={`${id}-goals`} items={value.goals} onChange={(v) => update("goals", v)} placeholder="No goals yet." readOnly={readOnly} flagged={flags("goals")} addLabel="Add goal" />
          </Section>
          <Section id={`${id}-rules`} section="rules">
            <ListEditor id={`${id}-rules`} items={value.rules} onChange={(v) => update("rules", v)} placeholder="No rules yet." readOnly={readOnly} flagged={flags("rules")} addLabel="Add rule" />
          </Section>
          <Section id={`${id}-playbook`} section="playbook">
            <ListEditor id={`${id}-playbook`} items={value.playbook} onChange={(v) => update("playbook", v)} numbered placeholder="No steps yet." readOnly={readOnly} flagged={flags("playbook")} addLabel="Add step" />
          </Section>
          <Section id={`${id}-tone`} section="tone">
            <Textarea aria-labelledby={`${id}-tone-label`} value={value.tone} readOnly={readOnly} onChange={(e) => update("tone", e.target.value)} rows={2} autoGrow invalid={flags("tone").size > 0} />
          </Section>
          <Section id={`${id}-examples`} section="examples">
            <ol className="flex flex-col gap-2">
              {value.examples.map((ex, i) => {
                const reason = flags("examples").get(i);
                return (
                  <li key={i} className="grid grid-cols-[auto_1fr_auto] gap-2 rounded-panel border border-subtle bg-panel-alt p-2" data-flagged={reason ? true : undefined}>
                    <span className="pt-5 text-small text-secondary tabular-nums" aria-hidden>
                      {i + 1}.
                    </span>
                    <div className="flex min-w-0 flex-col gap-2">
                      <Field htmlFor={`${id}-ex-${i}-in`} label="Input">
                        <Textarea id={`${id}-ex-${i}-in`} value={ex.input} readOnly={readOnly} onChange={(e) => setExample(i, { input: e.target.value })} rows={2} autoGrow />
                      </Field>
                      <Field htmlFor={`${id}-ex-${i}-out`} label="Output" error={reason ? `Contradicts a club rule and has no effect: ${reason}` : undefined}>
                        <Textarea id={`${id}-ex-${i}-out`} value={ex.output} readOnly={readOnly} onChange={(e) => setExample(i, { output: e.target.value })} rows={2} autoGrow invalid={!!reason} />
                      </Field>
                    </div>
                    {!readOnly ? <IconButton icon={X} label={`Remove example ${i + 1}`} size="sm" onClick={() => update("examples", value.examples.filter((_, k) => k !== i))} /> : <span />}
                  </li>
                );
              })}
            </ol>
            {!readOnly ? (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => update("examples", [...value.examples, { input: "", output: "" }])} className="self-start">
                Add example
              </Button>
            ) : null}
          </Section>
        </div>
      )}

      {(comments.length > 0 || onComment) && (
        <section aria-label="Comments" className="flex flex-col gap-2 border-t border-subtle pt-3">
          <h3 className="t-label flex items-center gap-1">
            <Icon icon={MessageSquare} size={12} /> Comments
          </h3>
          {comments.length === 0 ? <p className="text-small text-secondary">No comments on this version yet.</p> : null}
          <ul className="flex flex-col gap-1.5">
            {comments.map((c) => (
              <li key={c.id} className="text-body">
                <span className="text-body-strong">{c.author}</span> <span className="text-small text-secondary">{formatDateTime(c.at)}</span>
                <p className="text-primary">{c.text}</p>
              </li>
            ))}
          </ul>
          {onComment ? (
            <form
              className="flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = draft.trim();
                if (!t) return;
                onComment(t);
                setDraft("");
              }}
            >
              <Textarea aria-label="New comment" value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} autoGrow placeholder="Why this change?" className="flex-1" />
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                Comment
              </Button>
            </form>
          ) : null}
        </section>
      )}
    </div>
  );
}
