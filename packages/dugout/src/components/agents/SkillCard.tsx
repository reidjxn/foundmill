"use client";
/**
 * One skill as a row (WP-10 T8): in the library it can be chosen (available / selected) or not (unavailable, with the
 * reason in place of the description, at full opacity so it can be read); on an agent's profile it is one the agent has
 * (added, with Remove). It says where the skill shows on the attributes, why it is suggested, whether a training run
 * has scored it, what it is better with, and (when WP-06 passes it) what it has done.
 */
import { useId, type ReactNode } from "react";
import { BookOpen, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Checkbox } from "../foundation/Checkbox";
import { Chip } from "../foundation/Chip";
import { IconButton } from "../foundation/IconButton";
import type { SkillGroup } from "@foundmill/shared/constants";
import { RATING_MAX } from "../../lib/rating";
import { SKILL_GROUP_LABELS } from "../data/SkillGrid";

export interface LibrarySkillOption {
  key: string;
  name: string;
  description: string;
  /** The group heading ("Marketing"); groups keep the order the options arrive in. */
  categoryLabel: string;
  /** The attribute rating it shows as on the profile. */
  attribute: { name: string; group: SkillGroup };
  /** Suggested for the agent the picker was opened for: listed first, under `SUGGESTED_GROUP_LABEL`. */
  suggested?: boolean;
  /** Why it is suggested ("Fits this role"). */
  suggestedBecause?: string | null;
  /** Connectors that make it better (it works without them), and whether each is connected. */
  requires?: readonly SkillConnectorNeed[];
  /** Tools it would use that are not built yet, as plain names. */
  notYetOnFoundmill?: readonly string[];
}

/** A connector a skill is better with. */
export interface SkillConnectorNeed {
  connectorKey: string;
  name: string;
  connected: boolean;
}

/** "Better with Stripe, connected". */
export function connectorNeedLabel(need: SkillConnectorNeed): string {
  return `Better with ${need.name}, ${need.connected ? "connected" : "not connected"}`;
}

/** "Not built yet: Search Console". */
export function notBuiltLabel(names: readonly string[]): string {
  return `Not built yet: ${names.join(", ")}`;
}

/** What a skill is better with and what it would use that is not built yet; `all` names the connected ones too. */
export function SkillNeeds({ requires = [], notYetOnFoundmill = [], all = false }: { requires?: readonly SkillConnectorNeed[]; notYetOnFoundmill?: readonly string[]; all?: boolean }) {
  const shown = all ? requires : requires.filter((r) => !r.connected);
  if (shown.length === 0 && notYetOnFoundmill.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map((r) => (
        <Chip key={r.connectorKey} tone={r.connected ? "good" : "neutral"}>
          {connectorNeedLabel(r)}
        </Chip>
      ))}
      {notYetOnFoundmill.length ? <Chip tone="warn">{notBuiltLabel(notYetOnFoundmill)}</Chip> : null}
    </span>
  );
}

/** "Craft · Press releases": where the skill shows on the profile's attributes. */
export function showsAsLabel(attribute: LibrarySkillOption["attribute"]): string {
  return `${SKILL_GROUP_LABELS[attribute.group]} · ${attribute.name}`;
}


export type SkillCardState = "available" | "selected" | "added" | "unavailable";

/** The chip for a skill no training run has scored (DESIGN §10's founder word for "Untested"). */
export const NOT_TESTED_YET = "Not tested yet";

export interface SkillCardProps {
  skill: LibrarySkillOption;
  state: SkillCardState;
  /** Why it is unavailable (shown in place of the description), or why it is suggested. */
  reason?: string;
  suggested?: boolean;
  /** Whether a training run has scored it, and the rating it got. */
  result?: { tested: boolean; rating?: number };
  /** What the skill has done ("Used in 3 tasks since Nov 3"); absent, the line is not drawn. */
  effect?: ReactNode;
  onToggle?: () => void;
  onPreview?: () => void;
  onRemove?: () => void;
  /** This skill's text is the one open beside the list. */
  previewing?: boolean;
  /** No more may be chosen (the most allowed are chosen); an unchosen row cannot be ticked. */
  full?: boolean;
  className?: string;
}

export function SkillCard({ skill, state, reason, suggested, result, effect, onToggle, onPreview, onRemove, previewing, full, className }: SkillCardProps) {
  const id = useId();
  const unavailable = state === "unavailable";
  const selectable = state === "available" || state === "selected" || unavailable;
  const checked = state === "selected";
  const disabled = unavailable || (!checked && !!full);
  const suggestedBecause = suggested ? (unavailable ? (skill.suggestedBecause ?? null) : (reason ?? skill.suggestedBecause ?? null)) : null;
  const detail = unavailable && reason ? reason : skill.description;
  const name = (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-body-strong text-primary">{skill.name}</span>
      <Chip>{`Shows as ${showsAsLabel(skill.attribute)}`}</Chip>
      {suggestedBecause ? <Chip tone="info">{suggestedBecause}</Chip> : null}
      {result ? result.tested && result.rating !== undefined ? <Chip mono>{`${result.rating} of ${RATING_MAX}`}</Chip> : <Chip tone="warn">{NOT_TESTED_YET}</Chip> : null}
    </span>
  );
  const body = (
    <>
      {name}
      <span id={`${id}-desc`} className={cn("text-small", unavailable && reason ? "text-primary" : "text-secondary")} data-skill-detail={unavailable && reason ? "reason" : "description"}>
        {detail}
      </span>
      <SkillNeeds requires={skill.requires} notYetOnFoundmill={skill.notYetOnFoundmill} />
      {effect ? <span className="text-small text-tertiary">{effect}</span> : null}
    </>
  );
  return (
    <div data-skill-card={skill.key} data-state={state} data-previewing={previewing || undefined} className={cn("edge flex items-start gap-3 rounded-md bg-surface-2 px-3 py-2", checked && "row-selected", previewing && "ring-1 ring-line-strong", className)}>
      {selectable ? (
        <>
          <Checkbox id={`${id}-check`} checked={checked} disabled={disabled} onCheckedChange={() => onToggle?.()} aria-describedby={`${id}-desc`} className="mt-0.5" />
          <label htmlFor={`${id}-check`} className={cn("flex min-w-0 flex-1 flex-col gap-0.5", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
            {body}
          </label>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">{body}</span>
      )}
      {onPreview ? (
        <Button size="sm" variant="ghost" icon={BookOpen} className="shrink-0" aria-label={`Read the skill: ${skill.name}`} aria-pressed={previewing ?? false} onClick={onPreview} data-read-skill={skill.key}>
          Read
        </Button>
      ) : null}
      {state === "added" && onRemove ? <IconButton icon={X} size="sm" variant="ghost" label={`Remove ${skill.name}`} onClick={onRemove} /> : null}
    </div>
  );
}
