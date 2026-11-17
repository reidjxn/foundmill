"use client";
import { fitLine, type FitBasis } from "@foundmill/config";
import { Bookmark, BookmarkCheck, Columns2, Ellipsis, Fan, GitMerge, MessageCircleQuestionMark, Pencil, Trash } from "lucide-react";
import { cn } from "../../../lib/cn";
import { ratingClass } from "../../../lib/rating";
import { Button } from "../../foundation/Button";
import { Chip } from "../../foundation/Chip";
import { BusinessLogo } from "../../foundation/BusinessLogo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../foundation/DropdownMenu";
import { FitText } from "../../foundation/FitText";
import { Icon, type IconComponent } from "../../foundation/Icon";
import { IconButton } from "../../foundation/IconButton";
import { StarRating } from "../../foundation/StarRating";
import { Tooltip } from "../../foundation/Tooltip";
import { Term } from "../../guidance/Term";
import { CONCEPT_ATTRIBUTE_HINTS, CONCEPT_ATTRIBUTE_LABELS, type Concept, type ConceptAction } from "../types";
import { AttributeBar } from "./AttributeBar";

export interface ConceptCardProps {
  concept: Concept;
  onAction?: (action: ConceptAction, conceptId: string) => void;
  /** Already on the shortlist: the Shortlist button reads "Shortlisted". */
  shortlisted?: boolean;
  /** Selected for Compare. */
  selected?: boolean;
  onToggleSelect?: (conceptId: string) => void;
  /**
   * What Founder fit rests on (WP-14 T2). "quick": the first profile's quick answers, and the card says so under the
   * bar ("Fit: 15 (quick profile)") until the long profile is saved. Absent or "full": the bar alone.
   */
  fitBasis?: FitBasis;
  /** Hide the action row (Compare columns). */
  hideActions?: boolean;
  className?: string;
}

/** The display label for each action. Fork reads "More like this" (DESIGN: a per-card generate pill, not git words). */
const ACTION_META: Record<ConceptAction, { label: string; icon: IconComponent; title: string }> = {
  shortlist: { label: "Shortlist", icon: Bookmark, title: "Keep this idea to compare or choose later" },
  edit: { label: "Edit", icon: Pencil, title: "Change the name, the pitch or the kind of business in your own words (creates a new version)" },
  merge: { label: "Merge with another", icon: GitMerge, title: "Merge with another concept (creates a new version)" },
  fork: { label: "More like this", icon: Fan, title: "Draft a variant of this concept (creates a new version)" },
  ask: { label: "Ask", icon: MessageCircleQuestionMark, title: "Ask the research agent a question about it" },
  discard: { label: "Discard", icon: Trash, title: "Discard (reversible from history)" },
};

/** Overall ability on the 1–20 ramp: the mean attribute, rounded. */
export function conceptOverall(concept: Concept): number {
  if (concept.attributes.length === 0) return 1;
  return Math.round(concept.attributes.reduce((s, a) => s + a.value, 0) / concept.attributes.length);
}

/**
 * The Ideation Studio's profile card (BUILD §11.1, DESIGN §9, Mission): the logo (the initials mark until one is
 * chosen), name, archetype, current and potential stars, the pitch, the overall figure, ten attributes as 20-cell lit
 * bars with evidence on hover and, on every label, a tooltip saying what the attribute measures and which way it reads
 * (`CONCEPT_ATTRIBUTE_HINTS`). Actions never clip: Shortlist, the "More like this" generate pill and Ask are visible
 * (icon buttons with tooltips in a narrow card), Merge and Discard sit in a "More" menu.
 */
export function ConceptCard({ concept, onAction, shortlisted, selected, onToggleSelect, fitBasis, hideActions, className }: ConceptCardProps) {
  const overall = conceptOverall(concept);
  const act = (a: ConceptAction) => onAction?.(a, concept.id);
  const shortlistLabel = shortlisted ? "Shortlisted" : ACTION_META.shortlist.label;
  return (
    <article
      className={cn("@container surface-panel glow-brand flex w-80 flex-col overflow-hidden", selected && "edge-tint tone-accent outline-1 outline-accent/60", className)}
      aria-label={`${concept.name}: concept card`}
      data-concept={concept.id}
      data-selected={selected || undefined}
      style={{ ["--kit-primary" as string]: concept.kit.primary, ["--kit-secondary" as string]: concept.kit.secondary }}
    >
      <header className="flex items-start gap-3 px-panel-pad pb-2 pt-panel-pad">
        <BusinessLogo src={concept.logoSrc} name={concept.name} primary={concept.kit.primary} monogram={concept.monogram} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 font-display text-display-md font-semibold text-primary">
              {/* DIRECTION #15: step down, then two lines, and only then truncate (a long or forked name stays readable). */}
              <FitText minPx={15} lines={2}>{concept.name}</FitText>
            </h3>
            {concept.version && concept.version > 1 ? <Chip className="shrink-0">Version {concept.version}</Chip> : null}
          </div>
          {concept.archetypeLabel ? <p className="text-small text-secondary">{concept.archetypeLabel}</p> : null}
          {/* Whose words the pitch is: the founder's own, or the sample model's (never passed off as the team's judgment). */}
          {concept.yourWords || concept.sample ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {concept.yourWords ? (
                <Tooltip content="You wrote this pitch. The team builds from these words.">
                  <span>
                    <Chip tone="kit" icon={Pencil} data-concept-your-words="">
                      Your words
                    </Chip>
                  </span>
                </Tooltip>
              ) : null}
              {concept.sample ? (
                <Tooltip content="Sample content: the sample model wrote this card, not a research agent. Add a model key to draft real cards.">
                  <span>
                    <Chip tone="warn" data-concept-sample="">
                      Sample
                    </Chip>
                  </span>
                </Tooltip>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1">
            <StarRating value={concept.currentStars} potential={concept.potentialStars} label="Current ability" showValue />
          </div>
        </div>
        {onToggleSelect ? (
          <Tooltip content={selected ? "Remove from Compare" : "Add to Compare"}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`Compare ${concept.name}`}
              onClick={() => onToggleSelect(concept.id)}
              className={cn("pressable inline-flex size-control-sm shrink-0 items-center justify-center rounded-sm text-tertiary transition-colors hover:bg-white/6 hover:text-primary focus-visible:shadow-ring", selected && "bg-accent/12 text-accent")}
            >
              <Icon icon={selected ? BookmarkCheck : Columns2} size="inline" />
            </button>
          </Tooltip>
        ) : null}
      </header>
      <div className="flex flex-col gap-3 px-panel-pad pb-panel-pad">
        <p className="text-body text-pretty text-primary">{concept.pitch}</p>
        <div className="flex items-center gap-2 text-small text-secondary">
          {/* The figure's scale is a defined word (first-time founder report, Nov 8, 2026: "Rating /20" met nobody who explained it). */}
          <span className="t-data">
            <Term id="rating">Overall</Term>
          </span>
          <span className={cn("font-display text-display-md font-semibold tabular-nums", ratingClass(overall))}>{overall}</span>
          {concept.citations !== undefined ? <span className="text-tertiary">· {concept.citations} citations</span> : null}
        </div>
        <ol className="flex flex-col gap-1.5 border-t border-line-faint pt-3" aria-label="Attributes">
          {concept.attributes.map((a) => (
            <li key={a.key}>
              <AttributeBar label={CONCEPT_ATTRIBUTE_LABELS[a.key]} hint={CONCEPT_ATTRIBUTE_HINTS[a.key]} value={a.value} evidence={a.evidence} />
              {a.key === "founder_fit" && fitBasis === "quick" ? (
                <p className="mt-0.5 text-small text-tertiary" data-concept-fit-basis="quick">
                  {fitLine(a.value, "quick")}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      {hideActions ? null : (
        <footer className="mt-auto flex items-center gap-1.5 border-t border-line px-2.5 py-2" aria-label="Actions">
          <Tooltip content={ACTION_META.shortlist.title}>
            <Button size="sm" variant={shortlisted ? "tinted" : "default"} icon={shortlisted ? BookmarkCheck : Bookmark} aria-pressed={!!shortlisted} aria-label={shortlistLabel} onClick={() => act("shortlist")} data-concept-action="shortlist" className="shrink-0">
              <span className="hidden @md:inline">{shortlistLabel}</span>
            </Button>
          </Tooltip>
          <Tooltip content={ACTION_META.fork.title}>
            <Button size="sm" variant="generate" onClick={() => act("fork")} data-concept-action="fork" className="shrink-0">
              {ACTION_META.fork.label}
            </Button>
          </Tooltip>
          <Tooltip content={ACTION_META.ask.title}>
            <Button size="sm" variant="ghost" icon={ACTION_META.ask.icon} aria-label={ACTION_META.ask.label} onClick={() => act("ask")} data-concept-action="ask" className="shrink-0">
              <span className="hidden @md:inline">{ACTION_META.ask.label}</span>
            </Button>
          </Tooltip>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" variant="ghost" icon={Ellipsis} label={`More actions for ${concept.name}`} data-concept-more="" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => act("edit")} data-concept-action="edit">
                <Icon icon={ACTION_META.edit.icon} size="inline" className="text-secondary" />
                {ACTION_META.edit.label}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act("merge")} data-concept-action="merge">
                <Icon icon={ACTION_META.merge.icon} size="inline" className="text-secondary" />
                {ACTION_META.merge.label}
              </DropdownMenuItem>
              <DropdownMenuItem variant="danger" onSelect={() => act("discard")} data-concept-action="discard">
                <Icon icon={ACTION_META.discard.icon} size="inline" />
                {ACTION_META.discard.label}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </footer>
      )}
    </article>
  );
}
