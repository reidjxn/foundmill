"use client";
/**
 * The hero's deck: one screen of the product on the example business, and it works. The top bar is the product's own
 * parts (logo, runway, mode, Continue, Stop all agents) on the brand colours; under it the processing strip, then the
 * Inbox, the team orbit and the live feed. Pressing Continue runs a cycle: the strip shimmers, the feed speeds up, and
 * the cycle comes back with a decision (Continue turns into "Respond · 1") or a customer (gold). The first cycle runs
 * on its own once the deck is on screen, unless the visitor prefers reduced motion.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Check, Inbox as InboxIcon, Star, ThumbsUp, Trophy } from "lucide-react";
import {
  Avatar,
  AvatarStack,
  Button,
  Chip,
  ContinueButton,
  Crest,
  Icon,
  ModeChip,
  ProcessingStrip,
  ProvenanceChip,
  RunwayChip,
  StopAllAgents,
  TeamOrbit,
  cn,
  formatMoney,
  kitBarGradient,
  kitStyle,
  usePrefersReducedMotion,
  type ProcessingSegment,
} from "@foundmill/dugout";
import { ACTIVITY, EXAMPLE_BUSINESS, EXAMPLE_CHAPTER, EXAMPLE_CURRENCY, EXAMPLE_KIT, EXAMPLE_RUNWAY_MONTHS, LEADS, exampleToday, type ActivityLine, type ExampleDecision, type ExampleWin } from "./example";
import { continueStateFor, cycleReducer, cycleStatusText, cycleTasks, initialCycleState, type CycleState, type InboxItem } from "./cycle";
import { useSeen } from "./parts";

/** How long a cycle runs in the deck (the product's cycles take hours; this is the replay). */
export const DECK_CYCLE_MS = 4200;
const DECK_CYCLE_MS_REDUCED = 900;
const FEED_MAX = 6;
/** A second click this soon after Continue is a double click, not a request to pause the cycle it just started. */
const PAUSE_GRACE_MS = 800;

export function CycleDeck({ onOpenJourney }: { onOpenJourney?: () => void }) {
  const reduced = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(cycleReducer, undefined, initialCycleState);
  const [ref, seen] = useSeen<HTMLDivElement>("0px");
  const [autoRan, setAutoRan] = useState(false);
  const decisionRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const startedAt = useRef(0);
  const today = useMemo(exampleToday, []);
  const working = state.phase === "processing";
  const cycleMs = reduced ? DECK_CYCLE_MS_REDUCED : DECK_CYCLE_MS;
  const tick = useTicker(working ? 650 : 2800);
  const feed = useFeed(tick);
  const progress = useCycleProgress(working, cycleMs);

  const start = (byVisitor: boolean) => {
    startedAt.current = performance.now();
    dispatch({ type: "continue", byVisitor });
  };
  const stop = () => {
    if (performance.now() - startedAt.current < PAUSE_GRACE_MS) return;
    dispatch({ type: "stopAll" });
  };
  // Answering removes the decision card; focus moves to Continue, the next thing to press.
  const decide = (optionId: string) => {
    dispatch({ type: "decide", optionId });
    setTimeout(() => continueRef.current?.focus(), 0);
  };

  // The first cycle runs on its own once the deck is on screen, so the loop is visible without a click.
  useEffect(() => {
    if (!seen || reduced || autoRan) return;
    const t = setTimeout(() => {
      setAutoRan(true);
      startedAt.current = performance.now();
      dispatch({ type: "continue" });
    }, 1400);
    return () => clearTimeout(t);
  }, [seen, reduced, autoRan]);

  useEffect(() => {
    if (state.phase !== "processing") return;
    const t = setTimeout(() => dispatch({ type: "finish" }), cycleMs);
    return () => clearTimeout(t);
  }, [state.phase, state.cycle, cycleMs]);

  const openWin = () => {
    dispatch({ type: "openWin" });
    onOpenJourney?.();
  };

  // Segments take turns visually; the strip's spoken status stays one sentence per cycle (its own label is per segment).
  const segments: ProcessingSegment[] = LEADS.map((l, i) => ({ id: l.key, label: l.department, dept: l.dept, active: working && (tick + i) % 4 !== 0 }));

  return (
    <div ref={ref} className="relative" style={kitStyle(EXAMPLE_KIT)} data-testid="cycle-deck" data-phase={state.phase}>
      <div aria-hidden className="pointer-events-none absolute -inset-x-24 -bottom-24 top-24 blur-3xl" style={{ background: "radial-gradient(ellipse 45% 55% at 50% 45%, color-mix(in oklab, var(--kit-primary) 38%, transparent), transparent 72%)" }} />
      <div className="relative overflow-hidden rounded-panel border border-subtle bg-base" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 60px 120px -40px rgba(0,0,0,0.95)" }}>
        {/* The product's top bar, on the example business's brand colours. */}
        <div className="flex h-kitbar items-center gap-3 px-3 text-kit-on-primary" style={{ backgroundImage: kitBarGradient(EXAMPLE_KIT) }}>
          <Crest seed={EXAMPLE_BUSINESS.seed} monogram={EXAMPLE_BUSINESS.monogram} kitPrimary={EXAMPLE_KIT.primary} kitSecondary={EXAMPLE_KIT.secondary} size={32} title={`${EXAMPLE_BUSINESS.name} logo`} />
          <span className="t-display-sm whitespace-nowrap">{EXAMPLE_BUSINESS.name}</span>
          <span aria-hidden className="mx-1 h-5 w-px bg-kit-on-primary/25" />
          <span className="t-display-md">Home</span>
          <span className="truncate text-small text-kit-on-primary tabular-nums">
            Cycle {state.phase === "idle" ? state.cycle + 1 : state.cycle} · {EXAMPLE_CHAPTER}
          </span>
          <span className="flex-1" />
          <RunwayChip date={today} runwayMonths={EXAMPLE_RUNWAY_MONTHS} estimate />
          <ModeChip mode="assisted" />
          <ContinueButton
            ref={continueRef}
            state={continueStateFor(state)}
            pulseKey={state.phase === "idle" ? undefined : `${state.phase}-${state.cycle}`}
            onContinue={() => start(true)}
            onPause={stop}
            onRespond={() => decisionRef.current?.focus()}
            onGoToJourney={openWin}
          />
          <StopAllAgents onConfirm={stop} runningCount={working ? cycleTasks(state.cycle).tasks : 0} />
        </div>
        <ProcessingStrip segments={segments} active={working} label={working ? `Cycle ${state.cycle} running` : "No cycle running"} />

        <div className="grid h-125 grid-cols-[21rem_1fr_18rem]">
          <InboxColumn state={state} decisionRef={decisionRef} onDecide={decide} onOpenWin={openWin} />
          <div className="relative flex min-w-0 flex-col items-center justify-center gap-3 overflow-hidden">
            <div aria-hidden className="absolute inset-0" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--white) 7%, transparent) 1px, transparent 1.5px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 85%)" }} />
            <TeamOrbit className="relative w-108" />
            <p className="relative flex items-center gap-2 text-small text-secondary" aria-live="polite" data-testid="cycle-status">
              <span className={cn("size-1.5 rounded-full", working ? "animate-pulse bg-status-good" : state.phase === "decision" ? "bg-status-bad" : state.phase === "win" ? "bg-gold" : "bg-secondary")} />
              {cycleStatusText(state)}
            </p>
          </div>
          <LiveColumn feed={feed} state={state} progress={progress} />
        </div>
      </div>

      {state.phase === "idle" && !state.pressed && (autoRan || reduced) ? <PressHint /> : null}
    </div>
  );
}

function PressHint() {
  return (
    <div aria-hidden className="pointer-events-none absolute right-3 top-16 z-10 flex animate-rise-in flex-col items-end">
      <Icon icon={ArrowUp} size={16} className="mr-26 animate-bounce text-primary" />
      <span className="rounded-chip border border-subtle bg-panel-alt px-2.5 py-1 text-small text-primary shadow-overlay">Press Continue to run the next cycle</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Inbox column
// ---------------------------------------------------------------------------------------------------------------------

function InboxColumn({ state, decisionRef, onDecide, onOpenWin }: { state: CycleState; decisionRef: React.RefObject<HTMLButtonElement | null>; onDecide: (optionId: string) => void; onOpenWin: () => void }) {
  const waiting = state.phase === "decision" || state.phase === "win";
  return (
    <section aria-label="Inbox" className="flex min-h-0 flex-col border-r border-subtle bg-panel">
      <div className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt px-3">
        <Icon icon={InboxIcon} size="inline" className="text-secondary" />
        <span className="t-label">Inbox</span>
        <span className="flex-1" />
        {state.phase === "decision" ? <Chip tone="bad">1 needs you</Chip> : state.phase === "win" ? <Chip tone="gold">Customer won</Chip> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2">
        {state.phase === "processing" ? (
          <div className="flex shrink-0 items-center gap-2 rounded-panel border border-subtle/70 bg-panel-alt/60 px-2 py-2.5">
            <Avatar size={24} name="Orla" agent={{ seed: "orla", dept: "dept-1" }} status="healthy" />
            <span className="min-w-0 flex-1">
              <span className="t-body-strong block truncate">Cycle {state.cycle} in progress</span>
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-panel">
                <span className="block h-full w-1/2 animate-sweep rounded-full bg-kit-primary" />
              </span>
            </span>
          </div>
        ) : null}
        {state.current?.kind === "decision" ? <DecisionCard decision={state.current} buttonRef={decisionRef} onDecide={onDecide} /> : null}
        {state.current?.kind === "win" ? <WinCard win={state.current} onOpen={onOpenWin} /> : null}
        <ul className={cn("flex min-h-0 flex-col overflow-hidden", waiting && "opacity-60")}>
          {state.inbox.map((item) => (
            <InboxRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  return (
    <li className={cn("flex animate-fade-in items-start gap-2 rounded-panel border-l-2 px-2 py-2", item.tone === "won" ? "border-gold" : "border-transparent")}>
      <Avatar size={24} name={item.from.name} agent={{ seed: item.from.seed, dept: item.from.dept }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {item.tone === "decided" ? <Icon icon={Check} size="inline" className="shrink-0 text-status-good" /> : item.tone === "won" ? <Icon icon={Trophy} size="inline" className="shrink-0 text-gold" /> : null}
          <span className="t-body-strong truncate text-primary">{item.title}</span>
        </span>
        <span className="line-clamp-2 text-small text-secondary">{item.detail}</span>
      </span>
    </li>
  );
}

function DecisionCard({ decision: d, buttonRef, onDecide }: { decision: ExampleDecision; buttonRef: React.RefObject<HTMLButtonElement | null>; onDecide: (optionId: string) => void }) {
  return (
    <div className="flex shrink-0 animate-rise-in flex-col gap-2 rounded-panel border p-3" style={{ borderColor: "color-mix(in oklab, var(--status-bad) 45%, var(--line-subtle))", background: "color-mix(in oklab, var(--status-bad) 6%, var(--bg-panel-alt))" }} data-testid="deck-decision">
      <span className="flex items-center gap-2">
        <Avatar size={24} name={d.from.name} agent={{ seed: d.from.seed, dept: d.from.dept }} />
        <span className="min-w-0 flex-1 truncate text-small text-secondary">
          <span className="font-medium text-primary">{d.from.name}</span> · {d.from.role}
        </span>
      </span>
      <span className="t-body-strong text-primary">{d.subject}</span>
      <span className="text-small text-secondary">{d.body}</span>
      <span>
        <Chip tone="neutral">{d.stake}</Chip>
      </span>
      <span className="flex flex-wrap gap-2 pt-1">
        {d.options.map((o, i) => (
          <Button key={o.id} ref={i === 0 ? buttonRef : undefined} size="sm" variant={o.recommended ? "primary" : "default"} icon={o.recommended ? ThumbsUp : undefined} onClick={() => onDecide(o.id)}>
            {o.label}
          </Button>
        ))}
      </span>
    </div>
  );
}

function WinCard({ win: w, onOpen }: { win: ExampleWin; onOpen: () => void }) {
  return (
    <div className="relative flex shrink-0 animate-rise-in flex-col gap-2 overflow-hidden rounded-panel border border-gold/50 bg-panel-alt p-3" style={{ boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--gold) 35%, transparent), 0 0 40px -12px color-mix(in oklab, var(--gold) 45%, transparent)" }} data-testid="deck-win">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-gold to-gold-deep" />
      <span className="flex items-center gap-2">
        <Icon icon={Trophy} size="inline" className="text-gold" />
        <span className="t-label text-gold">Customer won</span>
        <span className="flex-1" />
        <Chip tone="neutral">Example</Chip>
      </span>
      <span className="t-display-md text-primary">{w.customer}</span>
      <span className="text-small text-secondary">{w.plan}</span>
      <span className="text-small text-secondary">
        First touch: <span className="text-primary">{w.firstTouch}</span>
      </span>
      <span className="flex items-center gap-2 pt-1">
        <AvatarStack size={24} items={w.involved.map((a) => ({ name: a.name, agent: { seed: a.seed, dept: a.dept } }))} />
        <span className="inline-flex items-center gap-1 text-small text-secondary">
          Standout <span className="font-medium text-primary">{w.standout.name}</span>
          <Star size={12} className="text-gold" fill="currentColor" aria-hidden />
        </span>
      </span>
      <Button size="sm" variant="gold" iconRight={ArrowRight} onClick={onOpen} className="mt-1">
        See the Customer Update
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Live column
// ---------------------------------------------------------------------------------------------------------------------

function LiveColumn({ feed, state, progress }: { feed: Array<{ key: number; line: ActivityLine }>; state: CycleState; progress: number }) {
  const working = state.phase === "processing";
  const t = cycleTasks(state.cycle);
  const done = Math.min(t.tasks, Math.floor(progress * t.tasks));
  return (
    <section aria-label="Live now" className="flex min-h-0 flex-col border-l border-subtle bg-panel">
      <div className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt px-3">
        <span className="relative inline-flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-status-good/60" />
          <span className="relative size-2 rounded-full bg-status-good" />
        </span>
        <span className="t-label">Live now</span>
        <span className="flex-1" />
        <span className="text-small text-secondary tabular-nums">{working ? 9 : 4} agents working</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3" aria-hidden>
        {feed.map((f, i) => (
          <li key={f.key} className="flex animate-rise-in items-start gap-2 text-small" style={{ opacity: 1 - i * 0.13 }}>
            <Avatar size={20} name={f.line.who} agent={{ seed: f.line.who.toLowerCase(), dept: f.line.dept }} />
            <span className="min-w-0">
              <span className="font-medium text-primary">{f.line.who}</span> <span className="text-secondary">{f.line.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-subtle px-3 py-3">
        <span className="t-label">This cycle</span>
        <dl className="flex flex-col gap-1.5">
          <DeckStat label="Tasks done" value={`${done} of ${t.tasks}`} />
          <DeckStat label="Pull requests merged" value={String(Math.min(t.prs, Math.floor(progress * t.prs)))} />
          <DeckStat label="Agent spend" value={formatMoney({ amountMinor: Math.round(progress * t.tasks * 46), currency: EXAMPLE_CURRENCY })} estimate />
        </dl>
      </div>
    </section>
  );
}

function DeckStat({ label, value, estimate }: { label: string; value: string; estimate?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-small">
      <dt className="flex-1 text-secondary">{label}</dt>
      <dd className="flex items-center gap-2">
        {estimate ? <ProvenanceChip kind="estimate" /> : null}
        <span className="t-display-sm tabular-nums text-primary">{value}</span>
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------------------------------------------------

/** A counter that advances every `ms`; the interval restarts when `ms` changes. */
function useTicker(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

/** How far the running cycle is, 0 to 1 over `durationMs`; 1 when no cycle runs (the last cycle's figures stand). */
function useCycleProgress(active: boolean, durationMs: number): number {
  const [fraction, setFraction] = useState(0);
  useEffect(() => {
    if (!active) return;
    const begun = performance.now();
    const id = setInterval(() => setFraction(Math.min(1, (performance.now() - begun) / durationMs)), 200);
    return () => {
      clearInterval(id);
      setFraction(0);
    };
  }, [active, durationMs]);
  return active ? fraction : 1;
}

/** The live feed: one new line per tick, newest first. Starts with four lines so the server and browser agree. */
function useFeed(tick: number): Array<{ key: number; line: ActivityLine }> {
  const [feed, setFeed] = useState(() => [3, 2, 1, 0].map((k) => ({ key: k, line: ACTIVITY[k % ACTIVITY.length]! })));
  const last = useRef(tick);
  useEffect(() => {
    if (tick === last.current) return;
    last.current = tick;
    setFeed((prev) => {
      const key = (prev[0]?.key ?? 0) + 1;
      return [{ key, line: ACTIVITY[key % ACTIVITY.length]! }, ...prev].slice(0, FEED_MAX);
    });
  }, [tick]);
  return feed;
}
