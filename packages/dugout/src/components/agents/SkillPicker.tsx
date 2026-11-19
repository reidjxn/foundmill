"use client";
/**
 * Skills a founder adds to an agent (founder request 2026-10-16): the skills library as a searchable list grouped by
 * category, the skills suggested for the agent first (`SkillLibraryList`), one skill's whole text to read before adding
 * it (`SkillReader`, WP-06 T7), the preview of an uploaded skill file before it is added (`SkillFilePreview`) and the
 * skills chosen so far, each removable (`ChosenSkillList`). Presentational: the hire dialog and the agent profile wire
 * them to data.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, FileText, Info, Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { Markdown } from "../data/Markdown";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Input } from "../foundation/Input";
import { VirtualList } from "../data/VirtualList";

export { connectorNeedLabel, notBuiltLabel, showsAsLabel, SkillNeeds, type LibrarySkillOption, type SkillConnectorNeed } from "./SkillCard";
import { NOT_TESTED_YET, SkillCard, SkillNeeds, showsAsLabel, type LibrarySkillOption, type SkillConnectorNeed } from "./SkillCard";

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
  /** Shows "Read" on each row; called with its key (the host loads and shows the text). Kept for `onPreview`. */
  onRead?: (key: string) => void;
  /**
   * The skills suggested for the agent, with why (WP-06). Given, they lead the list and "Suggested" is the chip the list
   * opens on; absent, each skill's own `suggested` flag is used; neither, there is no Suggested group or chip.
   */
  suggested?: readonly { key: string; reason: string }[];
  /** The chosen category chip (null: All; `SUGGESTED_CATEGORY`: the suggested skills). Uncontrolled without it. */
  category?: string | null;
  onCategoryChange?: (category: string | null) => void;
  /** The skill whose text is open beside the list. */
  previewKey?: string | null;
  onPreview?: (key: string | null) => void;
  /** The right-hand pane's content for the skill being read; given, the list draws two panes. */
  preview?: (key: string) => ReactNode;
  /** What the right-hand pane says before a skill is picked. */
  previewEmpty?: ReactNode;
  className?: string;
}

/** The heading of the suggested group, which leads the list. */
export const SUGGESTED_GROUP_LABEL = "Suggested for this agent";
/** The category chip value for the suggested skills. */
export const SUGGESTED_CATEGORY = "suggested";
/** Above this many rows the list draws only what is in view (VirtualList). */
export const SKILL_LIST_VIRTUALIZE_AFTER = 50;

type ListItem = { kind: "heading"; label: string; count: number; suggested: boolean } | { kind: "skill"; skill: LibrarySkillOption; suggested: string | null };

/** "20 skills", "1 skill", "3 skills match “pricing”". */
export function skillCountText(count: number, query: string): string {
  const n = `${formatNumber(count, { maxDigits: 0 })} ${count === 1 ? "skill" : "skills"}`;
  const q = query.trim();
  return q ? `${n} ${count === 1 ? "matches" : "match"} “${q}”` : n;
}

/**
 * The skills library (WP-10 T8): a search field, single-select category chips with counts, a count of what is shown,
 * then the suggested skills (when any) and the rest grouped by category, each a `SkillCard`. Above
 * `SKILL_LIST_VIRTUALIZE_AFTER` rows the list draws only what is in view. With `preview`, the skill being read opens in a
 * pane beside the list, so the search and the choice stay where they were.
 */
export function SkillLibraryList({ skills, selected, onToggle, unavailable = {}, max, onRead, suggested, category: categoryProp, onCategoryChange, previewKey, onPreview, preview, previewEmpty, className }: SkillLibraryListProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const reasons = useMemo(() => {
    if (suggested) return new Map(suggested.map((s) => [s.key, s.reason] as const));
    return new Map(skills.filter((s) => s.suggested).map((s) => [s.key, s.suggestedBecause ?? ""] as const));
  }, [skills, suggested]);
  const hasSuggested = reasons.size > 0;
  const [ownCategory, setOwnCategory] = useState<string | null>(hasSuggested ? SUGGESTED_CATEGORY : null);
  const chosenCategory = categoryProp !== undefined ? categoryProp : ownCategory;
  // A search looks through the whole library: a skill that is not in the chosen chip is still found.
  const category = query.trim() ? null : chosenCategory;
  const chooseCategory = (c: string | null) => {
    setOwnCategory(c);
    onCategoryChange?.(c);
  };
  const matching = useMemo(() => skills.filter((s) => matchesSkillQuery(s, query)), [skills, query]);
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of matching) counts.set(s.categoryLabel, (counts.get(s.categoryLabel) ?? 0) + 1);
    const out: { value: string | null; label: string; count: number }[] = [];
    if (hasSuggested) out.push({ value: SUGGESTED_CATEGORY, label: "Suggested", count: matching.filter((s) => reasons.has(s.key)).length });
    out.push({ value: null, label: "All", count: matching.length });
    const seen = new Set<string>();
    for (const s of skills) if (!seen.has(s.categoryLabel)) {
      seen.add(s.categoryLabel);
      out.push({ value: s.categoryLabel, label: s.categoryLabel, count: counts.get(s.categoryLabel) ?? 0 });
    }
    return out;
  }, [skills, matching, hasSuggested, reasons]);
  const groups = useMemo(() => {
    const out = new Map<string, { suggested: boolean; rows: LibrarySkillOption[] }>();
    const add = (label: string, isSuggested: boolean, s: LibrarySkillOption) => {
      const g = out.get(label) ?? { suggested: isSuggested, rows: [] };
      g.rows.push(s);
      out.set(label, g);
    };
    const inChip = (s: LibrarySkillOption) => category === null || (category === SUGGESTED_CATEGORY ? reasons.has(s.key) : s.categoryLabel === category);
    for (const s of matching) if (reasons.has(s.key) && inChip(s)) add(SUGGESTED_GROUP_LABEL, true, s);
    for (const s of matching) if (!reasons.has(s.key) && inChip(s) && category !== SUGGESTED_CATEGORY) add(s.categoryLabel, false, s);
    return [...out.entries()];
  }, [matching, category, reasons]);
  const shown = groups.reduce((n, [, g]) => n + g.rows.length, 0);
  const full = max !== undefined && selected.length >= max;
  const read = onPreview ?? onRead;
  const card = (s: LibrarySkillOption) => {
    const reason = unavailable[s.key];
    const why = reasons.get(s.key);
    return (
      <SkillCard
        skill={why !== undefined ? { ...s, suggestedBecause: why || s.suggestedBecause } : s}
        state={reason ? "unavailable" : selected.includes(s.key) ? "selected" : "available"}
        reason={reason}
        suggested={why !== undefined}
        full={full}
        onToggle={() => onToggle(s.key)}
        onPreview={read ? () => read(s.key) : undefined}
        previewing={previewKey === s.key}
      />
    );
  };
  const items: ListItem[] = groups.flatMap(([label, g]) => [{ kind: "heading" as const, label, count: g.rows.length, suggested: g.suggested }, ...g.rows.map((s) => ({ kind: "skill" as const, skill: s, suggested: reasons.get(s.key) ?? null }))]);
  const list =
    shown > SKILL_LIST_VIRTUALIZE_AFTER ? (
      <VirtualList
        items={items}
        getKey={(it) => (it.kind === "heading" ? `h:${it.label}` : it.skill.key)}
        virtualizeAfter={SKILL_LIST_VIRTUALIZE_AFTER}
        estimateSize={84}
        aria-label="Skills"
        className="flex min-h-0 flex-1 flex-col"
        rowClassName="pb-1"
        renderItem={(it) => (it.kind === "heading" ? <h3 className="t-label flex items-center gap-2 pt-3">{it.label}<span className="font-mono text-micro text-tertiary tabular-nums">{formatNumber(it.count, { maxDigits: 0 })}</span></h3> : <div data-library-skill={it.skill.key}>{card(it.skill)}</div>)}
      />
    ) : (
      <div className="flex min-h-0 flex-col gap-4">
        {groups.map(([label, g], gi) => (
          <section key={label} aria-labelledby={`${id}-group-${gi}`} className="flex flex-col gap-1" data-skill-group={g.suggested ? "suggested" : undefined}>
            <h3 id={`${id}-group-${gi}`} className="t-label flex items-center gap-2">
              {label}
              <span className="font-mono text-micro text-tertiary tabular-nums">{formatNumber(g.rows.length, { maxDigits: 0 })}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {g.rows.map((s) => (
                <li key={s.key} data-library-skill={s.key}>
                  {card(s)}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  const left = (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills" aria-label="Search skills" controlSize="lg" />
      <div role="group" aria-label="Categories" className="flex flex-wrap gap-1.5" data-skill-categories>
        {chips.map((c) => (
          <Chip key={c.value ?? "all"} selected={category === c.value} onClick={() => chooseCategory(c.value)} data-skill-category={c.value ?? "all"}>
            {`${c.label} ${formatNumber(c.count, { maxDigits: 0 })}`}
          </Chip>
        ))}
      </div>
      <p className="text-small text-secondary" role="status" data-skill-count>
        {shown === 0 ? `No skill matches “${query.trim()}”. Try a kind of work, such as release notes, pricing or contracts.` : skillCountText(shown, query)}
      </p>
      {list}
    </div>
  );
  if (!preview) {
    return (
      <div className={cn("flex min-h-0 flex-col", className)} data-skill-library>
        {left}
      </div>
    );
  }
  return (
    <div className={cn("grid min-h-0 grid-cols-2 gap-4", className)} data-skill-library>
      <div className="flex min-h-0 flex-col overflow-y-auto pr-1">{left}</div>
      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto" data-skill-preview>
        {previewKey ? preview(previewKey) : <p className="text-small text-secondary">{previewEmpty ?? "Pick a skill to read what it says."}</p>}
      </div>
    </div>
  );
}

export interface SkillReaderProps {
  name: string;
  /** The skill's whole text in Markdown; null while it loads or when it failed. */
  instructionsMd: string | null;
  version?: number;
  /** "Adapted from ... under the MIT license."; null for text written for the product. */
  attribution?: string | null;
  requires?: readonly SkillConnectorNeed[];
  notYetOnFoundmill?: readonly string[];
  loading?: boolean;
  error?: string | null;
  /** The way back to the list when the text takes its place; absent, the text sits beside the list (a pane). */
  onBack?: () => void;
  /** Where the skill shows on the attributes ("Adds to Craft · Release notes"). */
  attribute?: LibrarySkillOption["attribute"];
  /** Who it is for, in the heading over the text ("What Quill will do"). */
  agentName?: string;
  className?: string;
}

/** Said under every skill's text: what a skill can never change. */
export const SKILL_NEVER_CHANGES = "It never changes tools, spend limits or approvals.";

/**
 * One library skill's whole text, for a person to read before adding it (founder, Nov 16, 2026: a person reads a skill's
 * text in the product). Rendered as Markdown with raw HTML skipped, no images loaded, no entity links and web links
 * only: library text is safe, and is still shown as text, never as markup.
 */
export function SkillReader({ name, instructionsMd, version, attribution, requires, notYetOnFoundmill, loading, error, onBack, attribute, agentName, className }: SkillReaderProps) {
  // It takes the place of the list the person pressed "Read the skill" in: focus moves with it, onto the way back.
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (onBack) back.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the text opens
  }, []);
  return (
    <section aria-label={name} className={cn("flex min-h-0 flex-col gap-3", className)} data-skill-reader>
      <header className="flex min-w-0 flex-col gap-2">
        {onBack ? (
          <Button ref={back} size="sm" variant="ghost" icon={ArrowLeft} className="-ml-2 self-start" onClick={onBack} data-testid="skill-reader-back">
            Back to the library
          </Button>
        ) : null}
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-body-strong text-primary">{name}</span>
          {version !== undefined ? <Chip mono>{`Version ${formatNumber(version, { maxDigits: 0 })}`}</Chip> : null}
        </span>
        {attribute ? <span className="text-small text-secondary">{`Adds to ${showsAsLabel(attribute)}`}</span> : null}
        <SkillNeeds requires={requires} notYetOnFoundmill={notYetOnFoundmill} all />
      </header>
      {agentName ? <h4 className="t-label">{`What ${agentName} will do`}</h4> : null}
      {loading && instructionsMd === null ? (
        <p role="status" className="text-small text-secondary">
          Loading the skill…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-status-bad">
          {error}
        </p>
      ) : null}
      {instructionsMd !== null ? (
        <div className="edge rounded-md bg-surface-2 p-panel-pad" data-skill-text>
          <Markdown variant="body" entities={false} images={false} webLinksOnly>
            {instructionsMd}
          </Markdown>
        </div>
      ) : null}
      <p className="text-small text-secondary">{SKILL_NEVER_CHANGES}</p>
      {attribution ? <p className="text-small text-tertiary">{attribution}</p> : null}
    </section>
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
  /** Shown as "Not tested yet" until a training run scores it. */
  untested?: boolean;
  /** One of the skills the agent's role comes with (WP-06 T6), shown as "Came with the role"; removable like the rest. */
  cameWithRole?: boolean;
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
              {s.cameWithRole ? <Chip>Came with the role</Chip> : null}
              {s.untested ? <Chip tone="warn">{NOT_TESTED_YET}</Chip> : null}
            </span>
            {s.detail ? <span className="truncate text-small text-secondary">{s.detail}</span> : null}
          </span>
          {onRemove ? <IconButton icon={X} size="sm" variant="ghost" label={`Remove ${s.name}`} disabled={busy} onClick={() => onRemove(s.id)} /> : null}
        </li>
      ))}
    </ul>
  );
}
