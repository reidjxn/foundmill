"use client";
/**
 * The body of the public waitlist page (app/waitlist; WP-14 T15) in the brand frame: the batch sentence with the API's
 * real numbers, or the plain statement that no batch is set, then the one way on. A client component because the
 * design system's button takes its icon as a component, which cannot cross from a server page. From 390 px.
 */
import { ArrowRight } from "lucide-react";
import { Button } from "@foundmill/dugout";
import { BrandFrame } from "@/components/shell/BrandFrame";
import type { WaitlistBatchRead } from "@/lib/waitlist-batch.server";
import { IndicativePrices } from "./IndicativePrices";
import { WAITLIST_PAGE_WORDS, waitlistBatchLine } from "./words";

export function WaitlistPanel({ read }: { read: WaitlistBatchRead }) {
  return (
    <BrandFrame smallScreen title={WAITLIST_PAGE_WORDS.title} footer={<a href="/">{WAITLIST_PAGE_WORDS.about}</a>}>
      <div className="flex flex-col gap-3" data-testid="waitlist-page" data-batch={read.status}>
        {read.status === "batch" ? (
          <p className="text-title text-primary tabular-nums" data-testid="waitlist-batch">
            {waitlistBatchLine(read.batch)}
          </p>
        ) : (
          <p className="text-body text-primary" data-testid={read.status === "none" ? "waitlist-no-batch" : "waitlist-batch-unavailable"}>
            {read.status === "none" ? WAITLIST_PAGE_WORDS.none : WAITLIST_PAGE_WORDS.unavailable}
          </p>
        )}
        <p className="text-body text-secondary">{WAITLIST_PAGE_WORDS.how}</p>
        <IndicativePrices />
        <Button asChild variant="primary" size="lg" iconRight={ArrowRight} className="min-h-tap self-start">
          <a href="/login">{WAITLIST_PAGE_WORDS.join}</a>
        </Button>
      </div>
    </BrandFrame>
  );
}
