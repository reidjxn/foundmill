import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Skeleton } from "../foundation/Skeleton";
import { toneClass } from "./types";

export type DraftingCardState = "queued" | "drafting" | "landed";

export interface DraftingPerson {
  name: string;
  avatarSeed: string | number;
  /** The drafter's department colour: the live edge, the scan light, the dots. Default the brand's kit-lift. */
  dept?: DeptColourToken;
}

export interface DraftingCardFrameProps extends HTMLAttributes<HTMLElement> {
  state: DraftingCardState;
  /** Who is (or will be) drafting it; colours the frame while drafting. */
  drafter?: DraftingPerson;
  /** A landed card that has just arrived: a faint lit edge stays while this is set ("Just in"). */
  justIn?: boolean;
  /** Stagger index among cards landing together (40 ms apart). */
  index?: number;
  /** What the card is, for its accessible name ("Shelfproof"). */
  name?: string;
  children?: ReactNode;
}

/**
 * Classes for a card that has just landed, for cards that bring their own panel (a ConceptCard): it rises 8 px and
 * fades in, its edge lit in kit-lift and settling over 1200 ms; `justIn` keeps a faint lit edge. Set `--i` (style) to
 * stagger cards landing together. Pair with <JustInTag /> beside the card's name.
 */
export function landedCardClass({ justIn = false }: { justIn?: boolean } = {}): string {
  return justIn ? "draft-landed draft-just-in" : "draft-landed";
}

/**
 * The frame of a card in a generation grid (SPEC "Skeleton and streaming"): queued (the skeleton, named for its
 * drafter), drafting (a live edge and a light point travelling the top edge in the drafter's colour), landed (rises
 * 8 px and fades in, its edge lit in kit-lift and settling over 1200 ms). Wrap a ConceptCard, or a DraftingSkeleton.
 * Server-safe (CSS only).
 */
export function DraftingCardFrame({
  state,
  drafter,
  justIn,
  index,
  name,
  className,
  style,
  children,
  ...rest
}: DraftingCardFrameProps) {
  const busy = state !== "landed";
  const word =
    state === "queued"
      ? "queued"
      : state === "drafting"
        ? `${drafter ? `${drafter.name} is drafting` : "drafting"}`
        : "landed";
  return (
    <article
      className={cn(
        "draft-card surface-panel",
        toneClass(drafter?.dept),
        state === "landed" && landedCardClass({ justIn }),
        className,
      )}
      data-state={state}
      data-just-in={state === "landed" && justIn ? "" : undefined}
      aria-busy={busy || undefined}
      aria-label={name ? `${name}: ${word}` : undefined}
      style={index !== undefined ? ({ "--i": index, ...style } as CSSProperties) : style}
      data-testid="drafting-card-frame"
      {...rest}
    >
      {state === "drafting" ? <span aria-hidden className="draft-scan" /> : null}
      {children}
    </article>
  );
}

export interface DraftingBylineProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  state: DraftingCardState;
  drafter: DraftingPerson;
  /** queued: its place ("next · #4", "#5"); drafting: the counter ("5 of 10 · 384 tokens"); landed: "14 s · 612 tokens". */
  meta?: ReactNode;
  /** Render the drafter's name (an EntityLink); plain text by default. */
  renderName?: (person: DraftingPerson) => ReactNode;
}

/**
 * The line that says who: "Queued for Teodor · next", "Marlow is drafting" with dots and a counter, "Drafted by Pike".
 * Server-safe.
 */
export function DraftingByline({
  state,
  drafter,
  meta,
  renderName,
  className,
  ...rest
}: DraftingBylineProps) {
  const who = renderName ? renderName(drafter) : drafter.name;
  return (
    <div
      className={cn("draft-by", toneClass(drafter.dept), className)}
      data-state={state}
      data-testid="drafting-byline"
      {...rest}
    >
      <Avatar
        size={18}
        name={drafter.name}
        agent={{ seed: drafter.avatarSeed, dept: drafter.dept ?? "dept-1" }}
        presence={state === "drafting" ? "live" : undefined}
      />
      {state === "queued" ? (
        <span>Queued for {who}</span>
      ) : state === "drafting" ? (
        <>
          <span>{who} is drafting</span>
          <span aria-hidden className={cn("typing-dots", toneClass(drafter.dept))}>
            <span />
            <span />
            <span />
          </span>
        </>
      ) : (
        <span>Drafted by {who}</span>
      )}
      {meta ? <span data-meta="">{meta}</span> : null}
    </div>
  );
}

/** "Actions unlock when it lands": card actions wait for the card. Server-safe. */
export function DraftingLockedNote({
  children = "Actions unlock when it lands",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <span className={cn("text-small text-tertiary", className)}>{children}</span>;
}

/** "Just in": beside a landed card's name. Server-safe. */
export function JustInTag({ className }: { className?: string }) {
  return (
    <span className={cn("just-in-tag", className)} data-testid="just-in">
      Just in
    </span>
  );
}

export interface DraftingSkeletonProps {
  /** Attribute rows to sketch (the concept card has ten). */
  attributes?: number;
  className?: string;
}

const ROW_WIDTHS = [
  "w-3/5",
  "w-1/2",
  "w-2/5",
  "w-4/5",
  "w-3/5",
  "w-2/3",
  "w-2/5",
  "w-1/2",
  "w-3/5",
  "w-2/3",
];

/**
 * The body of a queued card: the mark, the name lines, the pitch and the attribute rows as skeleton bars, the light
 * band running down the card. Decorative (aria-hidden): the frame and the byline say what it is. Server-safe.
 */
export function DraftingSkeleton({ attributes = 10, className }: DraftingSkeletonProps) {
  let i = 0;
  return (
    <div aria-hidden className={cn("flex flex-col gap-3.5 px-3.5 pt-3.5", className)}>
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 rounded-md" index={i++} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
          <Skeleton className="h-3.5 w-3/5" index={i++} />
          <Skeleton className="h-2.5 w-2/5" index={i++} />
          <Skeleton className="h-2.5 w-1/2" index={i++} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" index={i++} />
        <Skeleton className="h-3 w-11/12" index={i++} />
        <Skeleton className="h-3 w-3/5" index={i++} />
      </div>
      <div className="flex flex-col gap-2 border-t border-line-faint pt-3">
        {Array.from({ length: attributes }, (_, r) => (
          <div key={r} className="grid grid-cols-2 items-center gap-2.5">
            <Skeleton className={cn("h-2.5", ROW_WIDTHS[r % ROW_WIDTHS.length])} index={i++} />
            <span className="draft-cells">
              {Array.from({ length: 20 }, (_, c) => (
                <i key={c} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
