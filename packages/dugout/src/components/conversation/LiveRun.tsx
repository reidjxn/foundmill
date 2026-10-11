import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import type { DateFormatPrefs } from "../../lib/date-preferences";
import { formatDate, formatMoney, formatNumber } from "../../lib/format";
import { Avatar } from "../foundation/Avatar";
import { ProvenanceChip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { StreamingText } from "./StreamingText";
import { toneClass } from "./types";

/** An agent doing part of the run: a drafter, a grounder. */
export interface LiveRunPerson {
  id?: string;
  name: string;
  avatarSeed: string | number;
  /** Their department colour: the log name, their segment, their activity dots. Default the brand's kit-lift. */
  dept?: DeptColourToken;
}

export type LiveRunStepState = "done" | "current" | "pending" | "failed";

export interface LiveRunStep {
  id: string;
  /** "Drafting cards". */
  label: string;
  /** "2 landed · 1 in progress", "Isolde · 2.1 s". */
  detail?: ReactNode;
  state: LiveRunStepState;
  /** Who is on this step (avatars under the current step). */
  people?: readonly LiveRunPerson[];
}

export type LiveRunItemState = "landed" | "drafting" | "queued" | "empty" | "failed";

export interface LiveRunItem {
  id: string;
  state: LiveRunItemState;
  /** Drafting progress 0–1 (how much of the segment is filled). */
  progress?: number | null;
  /** The drafter's colour for this item. */
  dept?: DeptColourToken;
  /** What the item is ("Shelfproof"): its segment's tooltip. */
  label?: string;
}

export interface LiveRunMeter {
  tokens?: number | null;
  elapsedMs?: number | null;
  /** Time left: always an Estimate. */
  remainingMs?: number | null;
  /** Model cost so far: always an Estimate. */
  cost?: { amountMinor: number; currency: string } | null;
  /** A preformatted cost ("£0.21") instead of `cost`. */
  costLabel?: string | null;
}

/** "<Name> is <verb> <object>": "Marlow is drafting Shelfproof". */
export interface LiveRunActivity {
  id?: string;
  person: LiveRunPerson;
  /** Default "drafting". */
  verb?: string;
  object?: ReactNode;
  /** Working right now (live portrait, dots). False for someone waiting their turn ("Teodor is up next"). Default true. */
  active?: boolean;
}

/** The one-line log: the active drafter's reasoning, streaming in. */
export interface LiveRunLog {
  text: string;
  person?: LiveRunPerson;
  /** Shown as "2:06:21 PM". */
  at?: string | Date | number;
  /** A preformatted time instead of `at` (keeps server and client render identical). */
  atLabel?: string;
  /** More is coming: the caret stays open. */
  open?: boolean;
}

export type LiveRunStatus = "running" | "done" | "stopped" | "failed";

export interface LiveRunProps {
  steps: readonly LiveRunStep[];
  /** One segment per item (12 cards → 12 segments). */
  items?: readonly LiveRunItem[];
  meter?: LiveRunMeter;
  activity?: readonly LiveRunActivity[];
  log?: LiveRunLog | null;
  status?: LiveRunStatus;
  /** The thing each segment is, singular and plural ("card", "cards"). */
  itemNoun?: readonly [string, string];
  /** Render a person's name (e.g. an EntityLink). Plain text by default. */
  renderName?: (person: LiveRunPerson) => ReactNode;
  /** The region's accessible name. Default "Live run". */
  label?: string;
  /**
   * The signed-in person's time format for the log's clock (Settings › Preferences): pass `useDateFormat()` from the
   * caller. Server-safe, so the run cannot read it itself; 12-hour without it.
   */
  datePrefs?: DateFormatPrefs | null;
  className?: string;
}

/** "0:19", "1:04:05". */
export function formatRunClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "2:06:21 PM": a log line's local clock time with seconds, on the person's clock when `prefs` is given. */
export function formatLogTime(at: string | Date | number, prefs?: DateFormatPrefs | null): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return formatDate(d, "timeSeconds", prefs);
}

/** Counts by state, and the bar's words: "2 of 12 cards landed, 1 drafting, 2 queued". */
export function liveRunSummary(
  items: readonly LiveRunItem[],
  noun: readonly [string, string] = ["card", "cards"],
): {
  landed: number;
  drafting: number;
  queued: number;
  failed: number;
  total: number;
  words: string;
} {
  const count = (s: LiveRunItemState) => items.filter((i) => i.state === s).length;
  const landed = count("landed");
  const drafting = count("drafting");
  const queued = count("queued");
  const failed = count("failed");
  const total = items.length;
  const parts = [`${landed} of ${total} ${total === 1 ? noun[0] : noun[1]} landed`];
  if (drafting) parts.push(`${drafting} drafting`);
  if (queued) parts.push(`${queued} queued`);
  if (failed) parts.push(`${failed} could not be finished`);
  return { landed, drafting, queued, failed, total, words: parts.join(", ") };
}

const STEP_WORD: Record<LiveRunStepState, string> = {
  done: "done",
  current: "in progress",
  pending: "to come",
  failed: "stopped",
};

/**
 * The live-run panel under the generate control (SPEC "Live run panel"): a step rail (done nodes green with a check,
 * the current node lit and pulsing with its drafters' portraits, pending hollow), a segment bar of the items (landed,
 * drafting, queued, empty), a mono meter (tokens · elapsed · time left and cost, both Estimates), who is doing what
 * ("Marlow is drafting Shelfproof"), and a one-line log on ink streaming the active drafter's reasoning. Driven by
 * props: it fetches nothing. Colours come from each drafter's department or the brand's kit-lift, never violet as a
 * generic "AI" colour. Server-safe (the log's stream is the only client piece).
 */
export function LiveRun({
  steps,
  items = [],
  meter,
  activity = [],
  log,
  status = "running",
  itemNoun = ["card", "cards"],
  renderName,
  label = "Live run",
  datePrefs,
  className,
}: LiveRunProps) {
  const name = (p: LiveRunPerson) => (renderName ? renderName(p) : p.name);
  const summary = liveRunSummary(items, itemNoun);
  const running = status === "running";
  const costText = meter?.costLabel ?? (meter?.cost ? formatMoney(meter.cost) : null);

  return (
    <section
      aria-label={label}
      className={cn("live-run", className)}
      data-status={status}
      data-testid="live-run"
    >
      <ol
        className="run-steps"
        style={{ "--run-steps": Math.max(1, steps.length) } as CSSProperties}
      >
        {steps.map((step) => {
          // One drafter on the step lights it in their colour; several (or none) use the brand's kit-lift.
          const tone = step.people?.length === 1 ? step.people[0]!.dept : undefined;
          return (
            <li
              key={step.id}
              className={cn("run-step", step.state === "current" && toneClass(tone))}
              data-state={step.state}
              data-testid="live-run-step"
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span
                aria-hidden
                className={cn("run-node", step.state === "current" && toneClass(tone))}
                data-state={step.state}
              >
                {step.state === "done" ? (
                  <Icon icon={Check} size={10} strokeWidth={3} />
                ) : step.state === "failed" ? (
                  <Icon icon={X} size={10} strokeWidth={3} />
                ) : null}
              </span>
              <div
                className={cn(
                  "text-action font-medium",
                  step.state === "pending" ? "text-tertiary" : "text-primary",
                )}
              >
                {step.label}
                <span className="sr-only">, {STEP_WORD[step.state]}</span>
              </div>
              {step.detail ? (
                <div className="mt-0.5 text-small text-tertiary text-pretty">{step.detail}</div>
              ) : null}
              {step.people && step.people.length ? (
                <div className="mt-1.5 flex items-center">
                  {step.people.map((p, i) => (
                    <Avatar
                      key={p.id ?? `${p.name}-${i}`}
                      size={18}
                      name={p.name}
                      agent={{ seed: p.avatarSeed, dept: p.dept ?? "dept-1" }}
                      stacked
                      className={cn(i > 0 && "-ml-1")}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {items.length || meter ? (
        <div className="run-ticker">
          {items.length ? (
            <div
              className="run-bar"
              role="img"
              aria-label={summary.words}
              data-testid="live-run-bar"
              style={{ "--run-items": items.length } as CSSProperties}
            >
              {items.map((item) => (
                <span
                  key={item.id}
                  className={cn("run-seg", item.dept ? toneClass(item.dept) : null)}
                  data-state={item.state}
                  title={item.label ? `${item.label}: ${item.state}` : undefined}
                  style={
                    item.state === "drafting" && typeof item.progress === "number"
                      ? ({
                          "--progress": Math.min(1, Math.max(0.08, item.progress)),
                        } as CSSProperties)
                      : undefined
                  }
                />
              ))}
            </div>
          ) : null}
          {meter ? (
            <div className="run-meter" data-testid="live-run-meter">
              {items.length ? <span>{`${summary.landed} of ${summary.total}`}</span> : null}
              {typeof meter.tokens === "number" ? (
                <>
                  {items.length ? (
                    <span aria-hidden data-sep="">
                      ·
                    </span>
                  ) : null}
                  <span>{`${formatNumber(meter.tokens)} tokens`}</span>
                </>
              ) : null}
              {typeof meter.elapsedMs === "number" ? (
                <>
                  <span aria-hidden data-sep="">
                    ·
                  </span>
                  <span aria-label={`${formatRunClock(meter.elapsedMs)} elapsed`}>
                    {formatRunClock(meter.elapsedMs)}
                  </span>
                </>
              ) : null}
              {running && typeof meter.remainingMs === "number" ? (
                <>
                  <span aria-hidden data-sep="">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    {`about ${formatRunClock(meter.remainingMs)} left`}
                    <ProvenanceChip kind="estimate" />
                  </span>
                </>
              ) : null}
              {costText ? (
                <>
                  <span aria-hidden data-sep="">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    {costText}
                    <ProvenanceChip kind="estimate" />
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {activity.length ? (
        <ul className="run-activity" aria-label="Who is working" data-testid="live-run-activity">
          {activity.map((a, i) => {
            const live = running && a.active !== false;
            return (
              <li key={a.id ?? `${a.person.name}-${i}`} data-active={live || undefined}>
                <Avatar
                  size={18}
                  name={a.person.name}
                  agent={{ seed: a.person.avatarSeed, dept: a.person.dept ?? "dept-1" }}
                  presence={live ? "live" : undefined}
                  surface="surface-1"
                />
                <span className={cn("min-w-0", !live && "text-tertiary")}>
                  <span className={live ? "text-primary" : undefined}>{name(a.person)}</span> is{" "}
                  {a.verb ?? "drafting"}
                  {a.object ? <> {a.object}</> : null}
                </span>
                {live ? (
                  <span aria-hidden className={cn("typing-dots", toneClass(a.person.dept))}>
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {log && log.text ? (
        <div className={cn("run-log", toneClass(log.person?.dept))} data-testid="live-run-log">
          {log.atLabel || log.at !== undefined ? (
            <span className="flex-none" suppressHydrationWarning>
              {log.atLabel ?? formatLogTime(log.at!, datePrefs)}
            </span>
          ) : null}
          {log.person ? (
            <Fragment>
              <span data-who="">{log.person.name}</span>
              <span aria-hidden className="flex-none">
                ›
              </span>
            </Fragment>
          ) : null}
          <span className="run-log-tail">
            <StreamingText
              text={log.text}
              open={running && log.open !== false}
              tone={log.person?.dept ?? "kit"}
              freshChars={20}
            />
          </span>
        </div>
      ) : null}
    </section>
  );
}
