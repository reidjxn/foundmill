"use client";
/**
 * Skills a founder adds to an agent (founder request 2026-10-16): the skills library as a searchable list grouped by
 * category (`SkillLibraryList`), the preview of an uploaded skill file before it is added (`SkillFilePreview`) and the
 * skills chosen so far, each removable (`ChosenSkillList`). Presentational: the hire dialog and the agent profile wire
 * them to data.
 */
import { useId, useMemo, useState } from "react";
import { BookOpen, FileText, Info, Search, X } from "lucide-react";
import type { SkillGroup } from "@foundmill/shared/constants";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { Checkbox } from "../foundation/Checkbox";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Input } from "../foundation/Input";
import { SKILL_GROUP_LABELS } from "../data/SkillGrid";

export interface LibrarySkillOption {
  key: string;
  name: string;
  description: string;
  /** The group heading ("Marketing"); groups keep the order the options arrive in. */
  categoryLabel: string;
  /** The attribute rating it shows as on the profile. */
  attribute: { name: string; group: SkillGroup };
}

/** "Craft · Press releases": where the skill shows on the profile's attributes. */
export function showsAsLabel(attribute: LibrarySkillOption["attribute"]): string {
  return `${SKILL_GROUP_LABELS[attribute.group]} · ${attribute.name}`;
}

/** Every word of the query appears in the skill's name, description, attribute or category (case-insensitive). */
export function matchesSkillQuery(skill: LibrarySkillOption, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${skill.name} ${skill.description} ${skill.attribute.name} ${skill.categoryLabel}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface SkillLibraryListProps {
  skills: readonly LibrarySkillOption[];
  selected: readonly string[];
  onToggle: (key: string) => void;
  /** Skills that cannot be chosen, with the reason shown in their place ("Already has this skill"). */
  unavailable?: Readonly<Record<string, string>>;
  /** Most that may be selected; the rest disable once it is reached. */
  max?: number;
  className?: string;
}

/** The skills library: a search field, then the skills grouped by category, each with a checkbox. */
export function SkillLibraryList({ skills, selected, onToggle, unavailable = {}, max, className }: SkillLibraryListProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const out = new Map<string, LibrarySkillOption[]>();
    for (const s of skills) if (matchesSkillQuery(s, query)) out.set(s.categoryLabel, [...(out.get(s.categoryLabel) ?? []), s]);
    return [...out.entries()];
  }, [skills, query]);
  const full = max !== undefined && selected.length >= max;
  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)} data-skill-library>
      <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills" aria-label="Search skills" controlSize="lg" />
      {groups.length === 0 ? (
        <p className="text-small text-secondary" role="status">
          No skill matches “{query.trim()}”. Try a kind of work, such as release notes, pricing or contracts.
        </p>
      ) : null}
      <div className="flex min-h-0 flex-col gap-4">
        {groups.map(([label, rows]) => (
          <section key={label} aria-labelledby={`${id}-${label}`} className="flex flex-col gap-1">
            <h3 id={`${id}-${label}`} className="t-label flex items-center gap-2">
              {label}
              <span className="font-mono text-micro text-tertiary tabular-nums">{formatNumber(rows.length, { maxDigits: 0 })}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {rows.map((s) => {
                const cid = `${id}-${s.key}`;
                const reason = unavailable[s.key];
                const checked = selected.includes(s.key);
                const disabled = Boolean(reason) || (!checked && full);
                return (
                  <li key={s.key} data-library-skill={s.key} className={cn("edge flex items-start gap-3 rounded-md bg-surface-2 px-3 py-2", checked && "row-selected", disabled && !checked && "opacity-60")}>
                    <Checkbox id={cid} checked={checked} disabled={disabled} onCheckedChange={() => onToggle(s.key)} aria-describedby={`${cid}-desc`} className="mt-0.5" />
                    <label htmlFor={cid} className={cn("flex min-w-0 flex-1 flex-col gap-0.5", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-body-strong text-primary">{s.name}</span>
                        <Chip>{`Shows as ${showsAsLabel(s.attribute)}`}</Chip>
                      </span>
                      <span id={`${cid}-desc`} className="text-small text-secondary">
                        {reason ?? s.description}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export interface SkillFilePreviewProps {
  name: string;
  description: string;
  fileName: string;
  /** Size in bytes, shown as KB. */
  sizeBytes?: number;
  /** The first lines of the instructions. */
  lines: readonly string[];
  /** All non-empty lines of the instructions, for "and N more lines". */
  totalLines?: number;
  /** Front matter the platform ignores, said once each. */
  notes?: readonly string[];
  className?: string;
}

/** An uploaded skill file before it is added: its name, description, file, first lines and anything ignored. */
export function SkillFilePreview({ name, description, fileName, sizeBytes, lines, totalLines, notes = [], className }: SkillFilePreviewProps) {
  const more = totalLines !== undefined ? totalLines - lines.length : 0;
  return (
    <section aria-label={`Preview of ${name}`} className={cn("edge flex flex-col gap-2 rounded-md bg-surface-2 p-panel-pad", className)} data-skill-file-preview>
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-body-strong text-primary">{name}</span>
        <Chip icon={FileText}>{sizeBytes !== undefined ? `${fileName} · ${formatNumber(Math.max(0.1, sizeBytes / 1024), { maxDigits: 1 })} KB` : fileName}</Chip>
      </header>
      <p className="text-small text-secondary">{description}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-black/20 p-2 font-mono text-mono text-secondary" aria-label="First lines">
        {lines.join("\n")}
      </pre>
      {more > 0 ? <p className="text-small text-tertiary">{`and ${formatNumber(more, { maxDigits: 0 })} more ${more === 1 ? "line" : "lines"}`}</p> : null}
      {notes.map((n) => (
        <p key={n} className="inline-flex items-center gap-1.5 text-small text-secondary">
          <Icon icon={Info} size={12} /> {n}
        </p>
      ))}
    </section>
  );
}

export interface ChosenSkill {
  id: string;
  name: string;
  source: "library" | "upload";
  /** A line under the name: the description, or the file it came from. */
  detail?: string;
  /** Shown as "Untested" until a training run scores it. */
  untested?: boolean;
}

export interface ChosenSkillListProps {
  items: readonly ChosenSkill[];
  onRemove?: (id: string) => void;
  /** Shown when nothing is chosen. */
  emptyText?: string;
  /** Disables the remove buttons (a request in flight). */
  busy?: boolean;
  className?: string;
}

export const SKILL_SOURCE_LABELS: Record<ChosenSkill["source"], string> = { library: "Library", upload: "Skill file" };

/** The skills chosen for (or carried by) an agent, each with where it came from and a remove button. */
export function ChosenSkillList({ items, onRemove, emptyText, busy, className }: ChosenSkillListProps) {
  if (items.length === 0) return emptyText ? <p className={cn("text-small text-secondary", className)}>{emptyText}</p> : null;
  return (
    <ul aria-label="Chosen skills" className={cn("flex flex-col divide-y divide-line-faint", className)}>
      {items.map((s) => (
        <li key={s.id} data-chosen-skill={s.id} className="flex items-center gap-3 py-1.5">
          <Icon icon={s.source === "upload" ? FileText : BookOpen} size={14} className="shrink-0 text-tertiary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-body text-primary">{s.name}</span>
              <Chip>{SKILL_SOURCE_LABELS[s.source]}</Chip>
              {s.untested ? <Chip tone="warn">Untested</Chip> : null}
            </span>
            {s.detail ? <span className="truncate text-small text-secondary">{s.detail}</span> : null}
          </span>
          {onRemove ? <IconButton icon={X} size="sm" variant="ghost" label={`Remove ${s.name}`} disabled={busy} onClick={() => onRemove(s.id)} /> : null}
        </li>
      ))}
    </ul>
  );
}
