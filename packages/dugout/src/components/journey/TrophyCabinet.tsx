"use client";
import { Lock, Share2, Trophy } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatDate, formatMoney } from "../../lib/format";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import type { TrophyCard } from "./types";

export interface TrophyCabinetProps {
  trophies: TrophyCard[];
  onOpen?: (key: string) => void;
  /** LIVE: shareable milestone cards (BUILD §11.4). Hidden when absent. */
  onShare?: (key: string) => void;
  /** Columns. Default 4. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;

/** Milestone cards with the gold treatment for reached milestones (DESIGN §5: gold is reserved for Customer Updates and milestones). */
export function TrophyCabinet({ trophies, onOpen, onShare, columns = 4, className }: TrophyCabinetProps) {
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
          return (
            <li key={t.key} data-trophy={t.key} data-achieved={achieved || undefined}>
              <Wrapper
                type={Wrapper === "button" ? "button" : undefined}
                onClick={Wrapper === "button" ? () => onOpen?.(t.key) : undefined}
                className={cn(
                  "relative flex h-full w-full flex-col gap-2 overflow-hidden rounded-panel border p-panel-pad text-left",
                  achieved ? "border-gold/45 bg-surface-1 shadow-elev-1 inset-shadow-rim" : "dashed-edge bg-canvas/40",
                  Wrapper === "button" && "outline-none transition-[border-color,filter] duration-micro ease-dugout hover:border-gold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-link",
                )}
                aria-label={Wrapper === "button" ? `${t.label}, reached ${formatDate(t.achievedAt as string)}` : undefined}
              >
                {achieved ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-gold to-gold-deep" /> : null}
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full", achieved ? "bg-gold/15 text-gold shadow-glow-gold" : "bg-white/5 text-tertiary")}>
                    <Icon icon={achieved ? Trophy : Lock} size="lg" />
                  </span>
                  {achieved ? <Chip tone="gold">Reached</Chip> : <Chip tone="neutral">Not yet</Chip>}
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
                    {t.amountMinor ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-secondary">Value</dt>
                        <dd className="tabular-nums text-gold">{formatMoney({ amountMinor: t.amountMinor, currency: t.currency ?? "EUR" })}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <span className="mt-auto text-small text-secondary">Unlocks when it happens.</span>
                )}
              </Wrapper>
              {achieved && onShare && t.shareable ? (
                <Button size="sm" variant="ghost" icon={Share2} className="mt-1 px-1.5" onClick={() => onShare(t.key)} aria-label={`Share ${t.label}`}>
                  Share
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
