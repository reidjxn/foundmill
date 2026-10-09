"use client";
/**
 * The Ideation Studio's live draft on screen (audit P2/P8): `DraftStatus` says who is drafting, how far along
 * ("Ideation agent is drafting concept 4 of 8"), how long it has taken, and offers Stop; `DraftingCard` holds a concept's
 * place from the moment the slate names it until its card is saved, when the real card replaces it in place.
 */
import { Square } from "lucide-react";
import { useEffect, useState } from "react";
import { ARCHETYPE_LABELS } from "@foundmill/shared";
import { Avatar, Button, ProgressRing, Skeleton, SkeletonText } from "@foundmill/dugout";
import { costLabel } from "./concepts";
import { draftedCount, formatElapsed, progressLine, slotsOf, type DraftRun, type DraftSlot } from "./draft-run";

const SLOT_WORD: Record<DraftSlot["status"], string> = { outlined: "Queued", writing: "Writing the card", retrying: "Trying again", done: "Drafted", failed: "Could not be finished" };

/** A concept the slate has named whose card is still being written: becomes the real card in place. */
export function DraftingCard({ slot }: { slot: DraftSlot }) {
  return (
    <div className="surface-panel flex flex-col gap-3 p-panel-pad" aria-busy="true" aria-label={`${slot.name}: ${SLOT_WORD[slot.status]}`} data-testid="drafting-card" data-slot={slot.index} data-status={slot.status}>
      <div className="flex items-center gap-3">
        <Skeleton className="size-12" shape="circle" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-strong">{slot.name}</div>
          <div className="text-small text-secondary">
            {slot.archetype ? `${ARCHETYPE_LABELS[slot.archetype]} · ` : ""}
            {SLOT_WORD[slot.status]}
          </div>
        </div>
        {slot.status === "outlined" ? null : <ProgressRing indeterminate size={16} label={`Writing ${slot.name}`} />}
      </div>
      <SkeletonText lines={2} />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-2" />
      ))}
    </div>
  );
}

/** The current time, refreshed every `tickMs` while `ticking` (the timer lives here so it re-renders only this strip). */
export function useNow(ticking: boolean, tickMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [ticking, tickMs]);
  return now;
}

/** Who is drafting, how far along, how long it has taken, and Stop (audit P8). `now` pins the clock (tests). */
export function DraftStatus({ run, now: pinnedNow, onStop }: { run: DraftRun; now?: number; onStop: () => void }) {
  const tickingNow = useNow(run.status === "running" && pinnedNow === undefined);
  const now = pinnedNow ?? tickingNow;
  const drafted = draftedCount(run);
  const total = run.total ?? (slotsOf(run).length || undefined);
  const elapsed = formatElapsed((run.finishedAt ?? now) - run.startedAt);
  const running = run.status === "running";
  return (
    <div className="surface-panel mb-gutter flex items-center gap-3 px-panel-pad py-3" role="region" aria-label="Draft progress" data-testid="draft-status" data-status={run.status}>
      <Avatar name={run.agent} agent={{ seed: "ideation-agent", dept: "dept-1" }} size={32} ring={running ? "good" : "none"} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-strong" aria-live="polite" data-testid="draft-progress">
          {progressLine(run)}
        </div>
        <div className="text-small text-secondary tabular-nums">
          {total ? `${drafted} of ${total}${run.total === null ? "+" : ""} drafted · ` : ""}
          <span data-testid="draft-elapsed">{elapsed}</span>
          {run.costMinor !== null ? ` · model cost ${costLabel(run.costMinor)} · Estimate` : ""}
          {run.mock ? " · mock mode" : ""}
        </div>
      </div>
      {running ? <ProgressRing value={total ? drafted / total : undefined} indeterminate={!total} size={24} strokeWidth={3} tone="kit" label="Concepts drafted" /> : null}
      {running ? (
        <Button variant="default" icon={Square} onClick={onStop} data-testid="stop-button">
          Stop
        </Button>
      ) : null}
    </div>
  );
}

