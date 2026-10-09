import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Chip, ProvenanceChip, type ChipTone, type ProvenanceKind } from "../foundation/Chip";
import type { IconComponent } from "../foundation/Icon";
import { StarRating } from "../foundation/StarRating";

export interface ProfileChip {
  label: string;
  tone?: ChipTone;
  icon?: IconComponent;
}

export interface ProfileFact {
  label: string;
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
 * DESIGN §8: 96 px, avatar/logo 64 px, name display-md, role and kind chips, three key facts in label + body pairs,
 * actions right, model chip (mono, bg-panel-alt) and current/potential stars.
 */
export const ProfileHeader = forwardRef<HTMLElement, ProfileHeaderProps>(function ProfileHeader(
  { avatar, name, chips = [], facts = [], actions, model, stars, status, className, ...rest },
  ref,
) {
  const shownFacts = facts.slice(0, PROFILE_FACTS_MAX);
  return (
    <header ref={ref} data-testid="profile-header" className={cn("flex h-24 items-center gap-4 border-b border-subtle bg-panel px-gutter", className)} {...rest}>
      <div className="flex size-16 shrink-0 items-center justify-center [&>*]:size-16">{avatar}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="t-display-md min-w-0 truncate text-primary">{name}</h1>
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
        <dl className="grid shrink-0 auto-cols-max grid-flow-col gap-x-6" data-testid="profile-facts">
          {shownFacts.map((f) => (
            <div key={f.label} className="flex flex-col gap-0.5">
              <dt className="t-label">{f.label}</dt>
              <dd className="inline-flex items-center gap-1.5 text-body-strong text-primary tabular-nums">
                {f.value}
                {f.provenance ? <ProvenanceChip kind={f.provenance} /> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
});
