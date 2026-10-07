import { Bookmark, BookmarkCheck, GitFork, GitMerge, MessageCircleQuestionMark, Trash } from "lucide-react";
import { cn } from "../../../lib/cn";
import { initials } from "../../../lib/format";
import { Button } from "../../foundation/Button";
import { Chip } from "../../foundation/Chip";
import { Crest } from "../../foundation/Crest";
import { Icon, type IconComponent } from "../../foundation/Icon";
import { StarRating } from "../../foundation/StarRating";
import { Tooltip } from "../../foundation/Tooltip";
import { CONCEPT_ATTRIBUTE_LABELS, type Concept, type ConceptAction } from "../types";
import { AttributeBar } from "./AttributeBar";

export interface ConceptCardProps {
  concept: Concept;
  onAction?: (action: ConceptAction, conceptId: string) => void;
  /** Already on the shortlist: the Shortlist button reads "Shortlisted". */
  shortlisted?: boolean;
  /** Selected for Compare. */
  selected?: boolean;
  onToggleSelect?: (conceptId: string) => void;
  /** Hide the action row (Compare columns). */
  hideActions?: boolean;
  className?: string;
}

const ACTIONS: Array<{ action: ConceptAction; label: string; icon: IconComponent; title: string }> = [
  { action: "shortlist", label: "Shortlist", icon: Bookmark, title: "Keep this concept for Compare and Commit" },
  { action: "merge", label: "Merge", icon: GitMerge, title: "Merge with another concept (creates a new version)" },
  { action: "fork", label: "Fork", icon: GitFork, title: "Fork into a variant (creates a new version)" },
  { action: "ask", label: "Ask", icon: MessageCircleQuestionMark, title: "Ask the research agent a question about it" },
  { action: "discard", label: "Discard", icon: Trash, title: "Discard (reversible from history)" },
];

/** Overall ability on the 1–20 ramp: the mean attribute, rounded. */
export function conceptOverall(concept: Concept): number {
  if (concept.attributes.length === 0) return 1;
  return Math.round(concept.attributes.reduce((s, a) => s + a.value, 0) / concept.attributes.length);
}

/**
 * The Ideation Studio's player card (BUILD §11.1, DESIGN §9): crest 48, name display-sm, pitch, current and potential
 * stars, ten attributes as 20-cell bars with evidence on hover, actions Shortlist / Merge / Fork / Ask / Discard.
 */
export function ConceptCard({ concept, onAction, shortlisted, selected, onToggleSelect, hideActions, className }: ConceptCardProps) {
  const overall = conceptOverall(concept);
  return (
    <article
      className={cn("surface-panel flex w-80 flex-col overflow-hidden", selected && "outline outline-2 outline-link", className)}
      aria-label={`${concept.name}: concept card`}
      data-concept={concept.id}
      data-selected={selected || undefined}
      style={{ ["--kit-primary" as string]: concept.kit.primary, ["--kit-secondary" as string]: concept.kit.secondary }}
    >
      <header className="flex items-start gap-3 border-b border-subtle bg-panel-alt p-panel-pad">
        <Crest seed={concept.crestSeed} kitPrimary={concept.kit.primary} kitSecondary={concept.kit.secondary} monogram={concept.monogram ?? initials(concept.name)} size={48} title={`${concept.name} crest`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="t-display-sm truncate">{concept.name}</h3>
            {concept.version && concept.version > 1 ? <Chip mono>v{concept.version}</Chip> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StarRating value={concept.currentStars} potential={concept.potentialStars} label="Current ability" showValue />
            {concept.archetypeLabel ? <span className="text-small text-secondary">{concept.archetypeLabel}</span> : null}
          </div>
        </div>
        {onToggleSelect ? (
          <Tooltip content={selected ? "Remove from Compare" : "Add to Compare"}>
            <button type="button" aria-pressed={selected} aria-label={`Compare ${concept.name}`} onClick={() => onToggleSelect(concept.id)} className={cn("inline-flex size-6 items-center justify-center rounded-chip border border-subtle text-secondary hover:text-primary", selected && "border-link text-link")}>
              <Icon icon={selected ? BookmarkCheck : Bookmark} size="inline" />
            </button>
          </Tooltip>
        ) : null}
      </header>
      <div className="flex flex-col gap-3 p-panel-pad">
        <p className="text-body text-primary">{concept.pitch}</p>
        <div className="flex items-center gap-2 text-small text-secondary">
          <span>
            Overall <span className="t-display-sm text-primary">{overall}</span>
          </span>
          {concept.citations !== undefined ? <span>· {concept.citations} citations</span> : null}
        </div>
        <ol className="flex flex-col gap-1.5" aria-label="Attributes">
          {concept.attributes.map((a) => (
            <li key={a.key}>
              <AttributeBar label={CONCEPT_ATTRIBUTE_LABELS[a.key]} value={a.value} evidence={a.evidence} />
            </li>
          ))}
        </ol>
      </div>
      {hideActions ? null : (
        <footer className="flex items-center gap-1 border-t border-subtle bg-panel-alt px-2 py-1.5" aria-label="Actions">
          {ACTIONS.map((a) => {
            const isShortlist = a.action === "shortlist";
            return (
              <Tooltip key={a.action} content={a.title}>
                <Button size="sm" variant={a.action === "discard" ? "ghost" : isShortlist && shortlisted ? "primary" : "ghost"} icon={isShortlist && shortlisted ? BookmarkCheck : a.icon} aria-pressed={isShortlist ? !!shortlisted : undefined} className={cn("h-6 px-1.5", a.action === "discard" && "ml-auto hover:text-status-bad")} onClick={() => onAction?.(a.action, concept.id)} data-concept-action={a.action}>
                  {isShortlist && shortlisted ? "Shortlisted" : a.label}
                </Button>
              </Tooltip>
            );
          })}
        </footer>
      )}
    </article>
  );
}
