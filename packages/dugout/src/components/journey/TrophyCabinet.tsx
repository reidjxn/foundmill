"use client";
import { Eye, Globe, Link2, Lock, Share2, Trophy } from "lucide-react";
import { MILESTONE_SHOW_WORDS } from "@foundmill/shared/project-story";
import { SHARE_OPEN_WORDS } from "@foundmill/shared/share-drafts";
import { cn } from "../../lib/cn";
import { formatMoney } from "../../lib/format";
import { Button } from "../foundation/Button";
import { Chip, ProvenanceChip } from "../foundation/Chip";
import { useFormatters } from "../foundation/DateFormatProvider";
import { Icon } from "../foundation/Icon";
import type { TrophyCard } from "./types";

export interface TrophyCabinetProps {
  trophies: TrophyCard[];
  onOpen?: (key: string) => void;
  /** LIVE: shareable milestone cards (BUILD §11.4). Hidden when absent. */
  onShare?: (key: string) => void;
  /**
   * The project's public page (0089): "Show on your page" under a reached milestone whose `page` is "hidden". Left out
   * for a reader who cannot publish, and while the page is not live.
   */
  onShowOnPage?: (key: string) => void;
  /** "Hide" beside the quiet "On your page" state. Left out for a reader who cannot publish (the state still shows). */
  onHideFromPage?: (key: string) => void;
  /** "Copy card link" beside it, while the milestone is on the page. */
  onCopyCardLink?: (key: string) => void;
  /**
   * "Share" beside "Copy card link", while the milestone is on the page: opens the share panel for its card (tap-to-post,
   * docs/DESIGN.md §9g). Not the LIVE share card above (`onShare`), which copies a line of text.
   */
  onSharePost?: (key: string) => void;
  /** The milestone whose change is on its way: its controls wait. */
  pendingKey?: string | null;
  /** Columns. Default 4. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;

/** Milestone cards with the gold treatment for reached milestones (DESIGN §5: gold is reserved for Customer Updates and milestones). */
export function TrophyCabinet({ trophies, onOpen, onShare, onShowOnPage, onHideFromPage, onCopyCardLink, onSharePost, pendingKey = null, columns = 4, className }: TrophyCabinetProps) {
  const { formatDate } = useFormatters();
  const won = trophies.filter((t) => t.achievedAt).length;
  return (
    <div className={cn("flex flex-col gap-2", className)} data-trophy-cabinet>
      <div className="flex items-center gap-2 px-1 text-small text-secondary">
        <Icon icon={Trophy} size="inline" className="text-gold" />
        <span className="t-title text-primary">Milestones</span>
        <span className="tabular-nums">
          {won} of {trophies.length} reached
        </span>
      </div>
      <ul className={cn("grid gap-gutter", COLS[columns])}>
        {trophies.map((t) => {
          const achieved = !!t.achievedAt;
          const Wrapper = onOpen && achieved ? "button" : "div";
          // The card grows to the row's height inside a column with the Share button under it, so the button is part of
          // the row (never overflowing into the next row or the panel footer, where they would catch its clicks).
          return (
            <li key={t.key} data-trophy={t.key} data-achieved={achieved || undefined} className="flex min-w-0 flex-col gap-1">
              <Wrapper
                type={Wrapper === "button" ? "button" : undefined}
                onClick={Wrapper === "button" ? () => onOpen?.(t.key) : undefined}
                className={cn(
                  "relative flex w-full flex-1 flex-col gap-2 overflow-hidden rounded-panel border p-panel-pad text-left",
                  achieved ? "border-gold/45 bg-surface-1 shadow-elev-1 inset-shadow-rim" : "dashed-edge bg-canvas/40",
                  Wrapper === "button" && "transition-[border-color,filter] duration-micro ease-dugout hover:border-gold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-link",
                )}
                aria-label={Wrapper === "button" ? `${t.label}, reached ${formatDate(t.achievedAt as string)}` : undefined}
              >
                {achieved ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-gold to-gold-deep" /> : null}
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full", achieved ? "bg-gold/15 text-gold shadow-glow-gold" : "bg-white/5 text-tertiary")}>
                    <Icon icon={achieved ? Trophy : Lock} size="lg" />
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    {achieved && t.estimate ? <ProvenanceChip kind="estimate" /> : null}
                    {achieved ? <Chip tone="gold">Reached</Chip> : <Chip tone="neutral">Not yet</Chip>}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className={cn("t-display-sm block break-words", achieved ? "text-primary" : "text-secondary")}>{t.label}</span>
                  <span className="block text-small text-secondary">{t.description}</span>
                </div>
                {achieved ? (
                  <dl className="mt-auto flex flex-col gap-0.5 text-small">
                    <div className="flex justify-between gap-2">
                      <dt className="text-secondary">Date</dt>
                      <dd className="tabular-nums">{formatDate(t.achievedAt as string)}</dd>
                    </div>
                    {t.customerName ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-secondary">Customer</dt>
                        <dd className="break-words">{t.customerName}</dd>
                      </div>
                    ) : null}
                    {t.amountMinor && t.currency ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-secondary">Value</dt>
                        <dd className="tabular-nums text-gold">{formatMoney({ amountMinor: t.amountMinor, currency: t.currency })}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <span className="mt-auto text-small text-secondary">Unlocks when it happens.</span>
                )}
              </Wrapper>
              {achieved && onShare && t.shareable ? (
                <Button size="sm" variant="ghost" icon={Share2} className="self-start px-1.5" onClick={() => onShare(t.key)} aria-label={`Share ${t.label}`} data-trophy-share>
                  Share
                </Button>
              ) : null}
              {/* The project's public page: one press shows a reached milestone, and it stays the founder's to hide. */}
              {achieved && t.page === "hidden" && onShowOnPage ? (
                <Button size="sm" variant="ghost" icon={Eye} className="self-start px-1.5" disabled={pendingKey === t.key} onClick={() => onShowOnPage(t.key)} aria-label={`${MILESTONE_SHOW_WORDS.show}: ${t.label}`} data-trophy-show>
                  {MILESTONE_SHOW_WORDS.show}
                </Button>
              ) : null}
              {achieved && (t.page === "shown" || t.page === "waiting") ? (
                <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 px-1.5" data-trophy-on-page={t.page}>
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-small text-secondary">
                    <Icon icon={Globe} size="inline" className="shrink-0 text-tertiary" />
                    {t.page === "shown" ? MILESTONE_SHOW_WORDS.shown : MILESTONE_SHOW_WORDS.waiting}
                  </span>
                  {onHideFromPage ? (
                    <Button size="sm" variant="ghost" className="px-1.5" disabled={pendingKey === t.key} onClick={() => onHideFromPage(t.key)} aria-label={`${MILESTONE_SHOW_WORDS.hide}: ${t.label}`} data-trophy-hide>
                      {MILESTONE_SHOW_WORDS.hide}
                    </Button>
                  ) : null}
                  {t.page === "shown" && onCopyCardLink ? (
                    <Button size="sm" variant="ghost" icon={Link2} className="px-1.5" onClick={() => onCopyCardLink(t.key)} aria-label={`${MILESTONE_SHOW_WORDS.copy}: ${t.label}`} data-trophy-copy-link>
                      {MILESTONE_SHOW_WORDS.copy}
                    </Button>
                  ) : null}
                  {t.page === "shown" && onSharePost ? (
                    <Button size="sm" variant="ghost" icon={Share2} className="px-1.5" onClick={() => onSharePost(t.key)} aria-label={`${SHARE_OPEN_WORDS.share}: ${t.label}`} data-trophy-share-post>
                      {SHARE_OPEN_WORDS.share}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
