import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Chip, ProvenanceChip, type ChipTone, type ProvenanceKind } from "../foundation/Chip";
import type { IconComponent } from "../foundation/Icon";
import { FitText } from "../foundation/FitText";
import { StarRating } from "../foundation/StarRating";

export interface ProfileChip {
  label: string;
  tone?: ChipTone;
  icon?: IconComponent;
}

export interface ProfileFact {
  /** The fact's label: plain text, or a node such as a `<Term>` on the screen's first mention of a defined word. */
  label: ReactNode;
  /** The React key, needed when `label` is not a string ("line-manager"); a string label is its own key. */
  id?: string;
  value: ReactNode;
  /** Label non-real numbers (DESIGN §10). */
  provenance?: ProvenanceKind;
}

export interface ProfileHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** A 64 px Avatar or BusinessLogo. */
  avatar: ReactNode;
  name: ReactNode;
  /** Kind and role chips (e.g. "Agent", "Distribution lead"). */
  chips?: ProfileChip[];
  /** Up to three label + value pairs; extras are dropped. */
  facts?: ProfileFact[];
  /** Buttons, right-aligned. */
  actions?: ReactNode;
  /** Model id for agents, shown as a mono chip. */
  model?: string;
  /** Current and potential ability, 0–5 in halves. */
  stars?: { current: number; potential?: number };
  /** A status pill or other element after the chips. */
  status?: ReactNode;
}

export const PROFILE_FACTS_MAX = 3;

/**
 * DESIGN §8: 96 px, avatar/logo 64 px, the name in display-md, role and kind chips, up to three key facts as
 * data-label + value pairs, actions right, the model chip (mono) and current/potential stars. The name never gives way:
 * the facts shrink and wrap first, then the name steps its size down (FitText) before it would ever truncate.
 */
export const ProfileHeader = forwardRef<HTMLElement, ProfileHeaderProps>(function ProfileHeader(
  { avatar, name, chips = [], facts = [], actions, model, stars, status, className, ...rest },
  ref,
) {
  const shownFacts = facts.slice(0, PROFILE_FACTS_MAX);
  const nameText = typeof name === "string" || typeof name === "number" ? String(name) : undefined;
  return (
    <header
      ref={ref}
      data-testid="profile-header"
      className={cn("rule-under flex min-h-profile-header items-center gap-x-4 px-gutter py-3", className)}
      {...rest}
    >
      <div className="flex size-profile-avatar shrink-0 items-center justify-center [&>*]:size-profile-avatar">{avatar}</div>
      <div className="flex min-w-0 flex-auto flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="t-display-md flex min-w-0 max-w-full text-primary">
            {nameText !== undefined ? <FitText minPx={15}>{nameText}</FitText> : <span className="min-w-0 text-balance">{name}</span>}
          </h1>
          {stars ? <StarRating value={stars.current} potential={stars.potential} label="Ability" showValue /> : null}
          {model ? (
            <Chip tone="neutral" mono title="Model">
              {model}
            </Chip>
          ) : null}
        </div>
        {chips.length > 0 || status ? (
          <div className="flex flex-wrap items-center gap-1">
            {chips.map((c) => (
              <Chip key={c.label} tone={c.tone ?? "neutral"} icon={c.icon}>
                {c.label}
              </Chip>
            ))}
            {status}
          </div>
        ) : null}
      </div>
      {shownFacts.length > 0 ? (
        <dl className="flex min-w-0 shrink-4 flex-wrap justify-end gap-x-6 gap-y-2" data-testid="profile-facts">
          {shownFacts.map((f, i) => (
            <div key={f.id ?? (typeof f.label === "string" ? f.label : i)} className="flex min-w-0 flex-col gap-0.5">
              <dt className="t-data whitespace-nowrap">{f.label}</dt>
              <dd className="inline-flex flex-wrap items-center gap-1.5 text-body-strong text-primary tabular-nums">
                {f.value}
                {f.provenance ? <ProvenanceChip kind={f.provenance} /> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
});
