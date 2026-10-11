"use client";
/**
 * The Ideation Studio's live draft on screen (audit P2/P8, SPEC "Live run panel", "Skeleton and streaming"):
 * `DraftStatus` is the live run under the brief — who is drafting, how far along ("Ideation agent is drafting concept 4
 * of 8"), the step rail (profile → slate → cards → Compare), one bar segment per concept, the elapsed time and the time
 * left (an Estimate), and the slate's names streaming in on the log line. Stop sits beside the generate control.
 * `DraftingCard` holds a concept's place from the moment the slate names it until its card is saved: queued, then
 * drafting (a live edge in the drafter's colour), then the real card lands in its place.
 */
import { useEffect, useMemo, useState } from "react";
import { ARCHETYPE_LABELS, type DeptColourToken } from "@foundmill/shared";
import { Avatar, DraftingByline, DraftingCardFrame, DraftingLockedNote, DraftingSkeleton, LiveRun, useDateFormat, type LiveRunItem, type LiveRunPerson, type LiveRunStep } from "@foundmill/dugout";
import { costLabel } from "./concepts";
import { draftItems, draftSteps, draftingNames, formatElapsed, progressLine, remainingEstimateMs, slateLine, slotsOf, type DraftRun, type DraftSlot } from "./draft-run";

const SLOT_WORD: Record<DraftSlot["status"], string> = { outlined: "Queued", writing: "Writing the card", retrying: "Trying again", done: "Drafted", failed: "Could not be finished" };

/** Who drafts in the Studio: the Ideation agent, in the Product colour (never a generic "AI" violet). */
export const DRAFTER: LiveRunPerson & { dept: DeptColourToken } = { id: "ideation-agent", name: "Ideation agent", avatarSeed: "ideation-agent", dept: "dept-1" };

/** A concept the slate has named whose card is still being written: becomes the real card in place. */
export function DraftingCard({ slot, agent = DRAFTER.name, queuePosition }: { slot: DraftSlot; agent?: string; queuePosition?: number }) {
  const drafting = slot.status === "writing" || slot.status === "retrying";
  const drafter = { name: agent, avatarSeed: DRAFTER.avatarSeed, dept: DRAFTER.dept };
  return (
    <DraftingCardFrame state={drafting ? "drafting" : "queued"} drafter={drafter} name={slot.name} index={slot.index} aria-label={`${slot.name}: ${SLOT_WORD[slot.status]}`} data-testid="drafting-card" data-slot={slot.index} data-status={slot.status} className="flex flex-col">
      <div className="flex items-start gap-3 px-panel-pad pt-panel-pad">
        <div className="min-w-0 flex-1">
          <div className="font-display text-display-md font-semibold text-primary text-pretty">{slot.name}</div>
          <div className="text-small text-secondary">
            {slot.archetype ? `${ARCHETYPE_LABELS[slot.archetype]} · ` : ""}
            {SLOT_WORD[slot.status]}
          </div>
        </div>
      </div>
      <DraftingSkeleton className="pb-2" />
      <div className="mt-auto flex flex-col gap-2 border-t border-line-faint px-panel-pad py-2.5">
        <DraftingByline state={drafting ? "drafting" : "queued"} drafter={drafter} meta={drafting ? (slot.status === "retrying" ? "second attempt" : undefined) : queuePosition ? `#${queuePosition}` : undefined} />
        <DraftingLockedNote />
      </div>
    </DraftingCardFrame>
  );
}

/** The current time, refreshed every `tickMs` while `ticking` (the timer lives here so it re-renders only this panel). */
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

/** The live run under the brief: progress line, steps, the card bar, elapsed / time left / cost, the slate log. `now` pins the clock (tests). */
export function DraftStatus({ run, now: pinnedNow }: { run: DraftRun; now?: number }) {
  const datePrefs = useDateFormat();
  const tickingNow = useNow(run.status === "running" && pinnedNow === undefined);
  const now = pinnedNow ?? tickingNow;
  const running = run.status === "running";
  const elapsedMs = (run.finishedAt ?? now) - run.startedAt;
  const drafter = useMemo<LiveRunPerson>(() => ({ ...DRAFTER, name: run.agent }), [run.agent]);

  const steps = useMemo<LiveRunStep[]>(() => draftSteps(run).map((s) => ({ id: s.id, label: s.label, detail: s.detail, state: s.state, people: s.state === "current" ? [drafter] : undefined })), [run, drafter]);
  const items = useMemo<LiveRunItem[]>(() => draftItems(run).map((i) => ({ id: i.id, state: i.state, label: i.label, dept: i.state === "drafting" || i.state === "landed" ? DRAFTER.dept : undefined })), [run]);
  const writing = draftingNames(run);
  const slate = slateLine(run);
  const remaining = remainingEstimateMs(run, now);

  return (
    <section className="flex flex-col gap-3" aria-label="Draft progress" data-testid="draft-status" data-status={run.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Avatar name={run.agent} agent={{ seed: DRAFTER.avatarSeed, dept: DRAFTER.dept }} size={24} presence={running ? "live" : undefined} />
        <span className="min-w-0 text-body-strong text-pretty" aria-live="polite" data-testid="draft-progress">
          {progressLine(run)}
        </span>
        <span className="ml-auto font-mono text-mono text-tertiary tabular-nums">
          <span data-testid="draft-elapsed" aria-label={`${formatElapsed(elapsedMs)} elapsed`}>
            {formatElapsed(elapsedMs)}
          </span>
          {run.mock ? " · sample drafts" : ""}
        </span>
      </div>
      <LiveRun
        label="Live draft"
        status={run.status}
        steps={steps}
        items={items}
        itemNoun={["concept", "concepts"]}
        meter={{ remainingMs: remaining, costLabel: run.costMinor !== null ? costLabel(run.costMinor) : null }}
        activity={running ? [{ id: "drafter", person: drafter, verb: writing ? "drafting" : slotsOf(run).length ? "outlining" : "reading", object: writing ?? (slotsOf(run).length ? "the set" : "your brief and profile") }] : []}
        log={slate ? { text: slate, person: { ...drafter, name: "slate" }, open: running && run.total === null } : null}
        datePrefs={datePrefs}
      />
    </section>
  );
}
