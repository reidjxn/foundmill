import { ArrowRight, Check, Minus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { SKILL_GROUPS, type Money, type SkillGroup } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { formatDuration, formatMoney } from "../../lib/format";
import { RatingFigure } from "../data/RatingBar";
import { SKILL_GROUP_LABELS } from "../data/SkillGrid";
import { Button } from "../foundation/Button";
import { Chip, ProvenanceChip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import type { TrainingSkillResult } from "./types";

export const DROP_HIGHLIGHT_THRESHOLD = 1;

export interface TrainingSummary {
  improved: number;
  dropped: number;
  unchanged: number;
  /** Drops of more than one point (highlighted). */
  bigDrops: TrainingSkillResult[];
  /** Mean change across skills. */
  meanDelta: number;
}

export function summariseTraining(results: readonly TrainingSkillResult[]): TrainingSummary {
  let improved = 0;
  let dropped = 0;
  let unchanged = 0;
  let sum = 0;
  const bigDrops: TrainingSkillResult[] = [];
  for (const r of results) {
    const d = r.after - r.before;
    sum += d;
    if (d > 0) improved++;
    else if (d < 0) dropped++;
    else unchanged++;
    if (-d > DROP_HIGHLIGHT_THRESHOLD) bigDrops.push(r);
  }
  return { improved, dropped, unchanged, bigDrops, meanDelta: results.length ? Math.round((sum / results.length) * 100) / 100 : 0 };
}

export interface TrainingResultsProps {
  results: readonly TrainingSkillResult[];
  coachExplanation: string;
  /** Candidate version number and the live one it would replace. */
  candidateVersion?: number;
  liveVersion?: number;
  cost?: Money;
  durationMs?: number;
  onPromote: () => void;
  onDiscard: () => void;
  promoting?: boolean;
  discarding?: boolean;
  className?: string;
}

function DeltaWord({ delta }: { delta: number }) {
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-1 text-small text-secondary">
        <Icon icon={Minus} size={12} /> no change
      </span>
    );
  const up = delta > 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-small tabular-nums", up ? "text-status-good" : "text-status-bad")}>
      <Icon icon={up ? TrendingUp : TrendingDown} size={12} />
      {up ? "up" : "down"} {Math.abs(delta)}
    </span>
  );
}

/**
 * Training session results (BUILD §11.10): old → new per skill with arrows, drops of more than one point highlighted,
 * the Coach's explanation, and Promote / Discard. Nothing changes the live version until Promote (AC-11.10.1).
 */
export function TrainingResults({ results, coachExplanation, candidateVersion, liveVersion, cost, durationMs, onPromote, onDiscard, promoting, discarding, className }: TrainingResultsProps) {
  const summary = summariseTraining(results);
  const groups = SKILL_GROUPS.filter((g) => results.some((r) => r.group === g));
  return (
    <section aria-label="Training results" className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", className)} data-training-results>
      <header className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt px-panel-pad">
        <h2 className="t-label flex-1">
          Results{candidateVersion !== undefined ? ` · draft v${candidateVersion}` : ""}
          {liveVersion !== undefined ? ` vs live v${liveVersion}` : ""}
        </h2>
        <Chip tone="good" icon={TrendingUp}>
          {summary.improved} up
        </Chip>
        <Chip tone={summary.dropped ? "bad" : "neutral"} icon={TrendingDown}>
          {summary.dropped} down
        </Chip>
        <Chip tone="neutral">{summary.unchanged} same</Chip>
      </header>
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="border-r border-subtle">
          {groups.map((g: SkillGroup) => (
            <table key={g} className="w-full border-collapse text-body" aria-label={`${SKILL_GROUP_LABELS[g]} skills`}>
              <thead>
                <tr className="h-7 bg-panel-alt/60">
                  <th scope="col" className="t-label px-panel-pad text-left font-semibold">
                    {SKILL_GROUP_LABELS[g]}
                  </th>
                  <th scope="col" className="t-label px-2 text-right font-semibold">
                    Before
                  </th>
                  <th scope="col" className="w-6" aria-label="to" />
                  <th scope="col" className="t-label px-2 text-left font-semibold">
                    After
                  </th>
                  <th scope="col" className="t-label px-2 text-left font-semibold">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {results
                  .filter((r) => r.group === g)
                  .map((r) => {
                    const d = r.after - r.before;
                    const big = -d > DROP_HIGHLIGHT_THRESHOLD;
                    return (
                      <tr key={r.id} data-skill={r.id} data-big-drop={big || undefined} className={cn("h-row-comfortable border-b hairline-50", big && "bg-status-bad/8")}>
                        <td className="px-panel-pad text-primary">
                          <Tooltip content={r.tests ? `${r.tests.passed} of ${r.tests.run} tests passed` : undefined}>
                            <span tabIndex={r.tests ? 0 : -1}>{r.name}</span>
                          </Tooltip>
                        </td>
                        <td className="px-2 text-right">
                          <RatingFigure value={r.before} className="text-secondary opacity-80" />
                        </td>
                        <td className="text-center text-secondary">
                          <Icon icon={ArrowRight} size={12} label="to" />
                        </td>
                        <td className="px-2">
                          <RatingFigure value={r.after} />
                        </td>
                        <td className="px-2">
                          <span className="inline-flex items-center gap-1.5">
                            <DeltaWord delta={d} />
                            {big ? <Chip tone="bad">Drop</Chip> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ))}
        </div>
        <div className="flex flex-col gap-3 p-panel-pad">
          <h3 className="t-label">Coach</h3>
          <p className="t-reading text-primary">{coachExplanation}</p>
          {summary.bigDrops.length > 0 ? (
            <p className="flex items-start gap-1.5 text-small text-status-bad">
              <Icon icon={TrendingDown} size="inline" className="mt-0.5" />
              {summary.bigDrops.map((r) => r.name).join(", ")} dropped by more than one point. Promoting starts a seven-day watch; a further drop offers a one-click rollback in the Inbox.
            </p>
          ) : null}
          <dl className="mt-auto grid grid-cols-2 gap-2 text-small">
            <div>
              <dt className="t-label">Mean change</dt>
              <dd className={cn("tabular-nums", summary.meanDelta > 0 ? "text-status-good" : summary.meanDelta < 0 ? "text-status-bad" : "text-secondary")}>
                {summary.meanDelta > 0 ? "+" : ""}
                {summary.meanDelta} points
              </dd>
            </div>
            {cost ? (
              <div>
                <dt className="t-label">Session cost</dt>
                <dd className="inline-flex items-center gap-1 tabular-nums">
                  {formatMoney(cost)} <ProvenanceChip kind="estimate" />
                </dd>
              </div>
            ) : null}
            {durationMs !== undefined ? (
              <div>
                <dt className="t-label">Duration</dt>
                <dd className="tabular-nums">{formatDuration(durationMs)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-subtle bg-panel-alt px-panel-pad py-2">
        <span className="mr-auto text-small text-secondary">The live version keeps working until you promote.</span>
        <Button variant="ghost" icon={Trash2} onClick={onDiscard} loading={discarding} disabled={promoting}>
          Discard
        </Button>
        <Button variant="primary" icon={Check} onClick={onPromote} loading={promoting} disabled={discarding}>
          Promote{candidateVersion !== undefined ? ` v${candidateVersion}` : ""}
        </Button>
      </footer>
    </section>
  );
}
