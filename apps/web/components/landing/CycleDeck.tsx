"use client";
/**
 * The hero's deck: one screen of the product on the example business, and it works. It reads the business once, when
 * it mounts (the hero keys it by the business, so choosing another one starts a fresh deck and a fresh cycle loop). The top bar is the product's own
 * parts (logo, runway, mode, Continue, Stop all agents) on the brand colours; under it the processing strip, then the
 * Inbox, the team orbit and the live feed. Pressing Continue runs a cycle: the strip shimmers, the feed speeds up, and
 * the cycle comes back with a decision (Continue turns into "Respond · 1") or a customer (gold). The first cycle runs
 * on its own once the deck is on screen, unless the visitor prefers reduced motion.
 */
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Inbox as InboxIcon, Pause, Play, Star, ThumbsUp, Trophy } from "lucide-react";
import {
  Avatar,
  AvatarStack,
  Button,
  Callout,
  Chip,
  ContinueButton,
  BusinessLogo,
  Icon,
  ModeChip,
  ProcessingStrip,
  ProvenanceChip,
  RunwayChip,
  StopAllAgents,
  TeamOrbit,
  Term,
  cn,
  kitBarGradient,
  kitStyle,
  usePrefersReducedMotion,
  type ProcessingSegment,
} from "@foundmill/dugout";
import { useExample } from "./examples/context";
import { currentChapter, exampleMoney, exampleToday, orbitDepartments } from "./examples/helpers";
import type { ActivityLine, ExampleBusiness, ExampleDecision, ExampleWin } from "./examples/types";
import { continueStateFor, cycleReducer, cycleStatusText, cycleTasks, initialCycleState, type CycleAction, type CycleState, type InboxItem } from "./cycle";
import { useSeen, useToday } from "./parts";

/** How long a cycle runs in the deck (the product's cycles take hours; this is the replay). */
export const DECK_CYCLE_MS = 4200;
const DECK_CYCLE_MS_REDUCED = 900;
const FEED_MAX = 6;
/** A second click this soon after Continue is a double click, not a request to pause the cycle it just started. */
const PAUSE_GRACE_MS = 800;
/**
 * The callout under Continue: the same single-step Callout (Dugout firstrun/Coachmark) and the same words as the app's
 * first-Continue callout (docs/UX_AUDIT_AND_PLAN.md §5.1, §7.1, apps/web/components/shell/BusinessShell.tsx
 * FIRST_CONTINUE_CALLOUT), so the loop is taught with one voice. The landing page has no GuidanceProvider, so guidance
 * reads as on there; the tour is never marked anywhere (no account), and the deck shows it until the visitor presses
 * Continue. Its target is the deck's own Continue (a wrapper the deck marks `data-coachmark="deck-continue"`), never
 * the one the How-it-works beat draws.
 */
export const DECK_CALLOUT = { tourId: "deck-continue", targetId: "deck-continue", title: "This is how you move forward", body: "One press and your team works until nothing is left to do. Anything that needs you shows in Needs you." } as const;
/** The callout's sentence as one line, for copy that quotes it. */
export const CONTINUE_CALLOUT = `${DECK_CALLOUT.title}. ${DECK_CALLOUT.body}`;

export function CycleDeck({ onOpenJourney }: { onOpenJourney?: () => void }) {
  const business = useExample();
  const reduced = usePrefersReducedMotion();
  const [state, dispatch] = useReducer((s: CycleState, a: CycleAction) => cycleReducer(business, s, a), business, initialCycleState);
  const [ref, seen] = useSeen<HTMLDivElement>("0px");
  const [autoRan, setAutoRan] = useState(false);
  const decisionRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const startedAt = useRef(0);
  const todayKey = useToday();
  const today = useMemo(() => exampleToday(todayKey), [todayKey]);
  const working = state.phase === "processing";
  const cycleMs = reduced ? DECK_CYCLE_MS_REDUCED : DECK_CYCLE_MS;
  // The feed moves while a cycle runs (a few seconds, started by the visitor or by the deck's first run) and, when the
  // visitor allows motion, on its own between cycles. Under reduced motion nothing runs by itself, and anyone can pause
  // the idle updates (WCAG 2.2.2; DESIGN: "Under reduced motion nothing runs by itself"; audit A11Y-14).
  const [feedPaused, setFeedPaused] = useState(false);
  const tick = useTicker(feedTickMs({ working, reduced, paused: feedPaused }));
  const feed = useFeed(tick, business.activity);
  const orbit = useMemo(() => orbitDepartments(business), [business]);
  const { identity, deck } = business;
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
  const segments: ProcessingSegment[] = business.departments.map((d, i) => ({ id: d.id, label: d.label, dept: d.dept, active: working && (tick + i) % 4 !== 0 }));

  return (
    <div ref={ref} className="relative" style={kitStyle(identity.kit)} data-testid="cycle-deck" data-example={identity.id} data-phase={state.phase}>
      <div aria-hidden className="pointer-events-none absolute -inset-x-24 -bottom-24 top-24 blur-3xl" style={{ background: "radial-gradient(ellipse 45% 55% at 50% 45%, color-mix(in oklab, var(--kit-primary) 38%, transparent), transparent 72%)" }} />
      <div className="relative overflow-hidden rounded-panel border border-subtle bg-base" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 60px 120px -40px rgba(0,0,0,0.95)" }}>
        {/* The product's top bar, on the example business's brand colours. */}
        <div className="flex h-kitbar items-center gap-3 px-3 text-kit-on-primary" style={{ backgroundImage: kitBarGradient(identity.kit) }}>
          <BusinessLogo src={identity.logo} name={identity.name} primary={identity.kit.primary} size={32} />
          <span className="t-display-sm whitespace-nowrap">{identity.name}</span>
          <span aria-hidden className="mx-1 h-5 w-px bg-kit-on-primary/25" />
          <span className="t-display-md">Home</span>
          <span className="truncate text-small text-kit-on-primary tabular-nums">
            Cycle {state.phase === "idle" ? state.cycle + 1 : state.cycle} · {currentChapter(todayKey)}
          </span>
          <span className="flex-1" />
          <RunwayChip date={today} runwayMonths={deck.runwayMonths} estimate />
          <ModeChip mode="assisted" />
          {/* The callout's anchor: ContinueButton marks its button data-coachmark="continue", as the app's does, and the
              How-it-works beat draws another one; the wrapper's own id keeps the deck's callout on the deck's button. */}
          <span className="inline-flex shrink-0" data-coachmark={DECK_CALLOUT.targetId} data-testid="deck-continue">
            <ContinueButton
              ref={continueRef}
              state={continueStateFor(state)}
              pulseKey={state.phase === "idle" ? undefined : `${state.phase}-${state.cycle}`}
              onContinue={() => start(true)}
              onPause={stop}
              onRespond={() => decisionRef.current?.focus()}
              onGoToJourney={openWin}
            />
          </span>
          <StopAllAgents onConfirm={stop} runningCount={working ? cycleTasks(state.cycle).tasks : 0} />
        </div>
        <ProcessingStrip segments={segments} active={working} label={working ? `Cycle ${state.cycle} running` : "No cycle running"} />

        <div className="grid h-125 grid-cols-[21rem_1fr_18rem]">
          <InboxColumn business={business} state={state} decisionRef={decisionRef} onDecide={decide} onOpenWin={openWin} />
          <div className="relative flex min-w-0 flex-col items-center justify-center gap-3 overflow-hidden">
            <div aria-hidden className="absolute inset-0" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--white) 7%, transparent) 1px, transparent 1.5px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 85%)" }} />
            <TeamOrbit className="relative w-108" chief={business.chief} departments={orbit} />
            <p className="relative flex items-center gap-2 text-small text-secondary" aria-live="polite" data-testid="cycle-status">
              <span className={cn("size-1.5 rounded-full", working ? "animate-pulse bg-status-good" : state.phase === "decision" ? "bg-status-bad" : state.phase === "win" ? "bg-gold" : "bg-secondary")} />
              {cycleStatusText(state)}
            </p>
          </div>
          <LiveColumn business={business} feed={feed} state={state} progress={progress} paused={feedPaused} onTogglePaused={() => setFeedPaused((p) => !p)} canPause={!reduced} />
        </div>
      </div>

      {/* The callout under Continue once the deck has run a cycle by itself and the visitor has not pressed it yet. A
          tutoring surface, so the Coachmark keeps it off when guidance is off (a signed-in page's provider), like the
          app's coach marks; "Got it" closes it, pressing Continue takes it away for good. */}
      {state.phase === "idle" && !state.pressed && (autoRan || reduced) ? <Callout tourId={DECK_CALLOUT.tourId} targetId={DECK_CALLOUT.targetId} title={DECK_CALLOUT.title} body={DECK_CALLOUT.body} side="bottom" align="end" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Inbox column
// ---------------------------------------------------------------------------------------------------------------------

function InboxColumn({ business, state, decisionRef, onDecide, onOpenWin }: { business: ExampleBusiness; state: CycleState; decisionRef: React.RefObject<HTMLButtonElement | null>; onDecide: (optionId: string) => void; onOpenWin: () => void }) {
  const waiting = state.phase === "decision" || state.phase === "win";
  return (
    <section aria-label="Inbox" className="flex min-h-0 flex-col border-r border-subtle bg-panel">
      <div className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt px-3">
        <Icon icon={InboxIcon} size="inline" className="text-secondary" />
        <span className="t-label">Inbox</span>
        <span className="flex-1" />
        {state.phase === "decision" ? <Chip tone="bad">1 needs your answer</Chip> : state.phase === "win" ? <Chip tone="gold">Customer won</Chip> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2">
        {state.phase === "processing" ? (
          <div className="flex shrink-0 items-center gap-2 rounded-panel border border-subtle/70 bg-panel-alt/60 px-2 py-2.5">
            <Avatar size={24} name={business.chief.name} agent={{ seed: business.chief.seed, dept: business.chief.dept }} status="healthy" />
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

function LiveColumn({ business, feed, state, progress, paused, onTogglePaused, canPause }: { business: ExampleBusiness; feed: Array<{ key: number; line: ActivityLine }>; state: CycleState; progress: number; paused: boolean; onTogglePaused: () => void; canPause: boolean }) {
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
        {canPause ? (
          <Button size="sm" variant="ghost" icon={paused ? Play : Pause} aria-pressed={paused} onClick={onTogglePaused} data-testid="feed-pause">
            {paused ? "Resume updates" : "Pause updates"}
          </Button>
        ) : null}
        <span className="flex-1" />
        <span className="text-small text-secondary tabular-nums">{working ? 9 : 4} agents working</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3" aria-hidden>
        {feed.map((f, i) => (
          <li key={f.key} className="flex animate-rise-in items-start gap-2 text-small">
            {/* Older lines fade by their avatar only: the words stay at full contrast (WCAG 1.4.3). */}
            <span className="shrink-0" style={{ opacity: 1 - i * 0.13 }}>
              <Avatar size={20} name={f.line.who} agent={{ seed: f.line.who.toLowerCase(), dept: f.line.dept }} />
            </span>
            <span className="min-w-0">
              <span className="font-medium text-primary">{f.line.who}</span> <span className="text-secondary">{f.line.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-subtle px-3 py-3">
        <span className="t-label">
          This <Term id="cycle">cycle</Term>
        </span>
        <dl className="flex flex-col gap-1.5">
          <DeckStat label="Tasks done" value={`${done} of ${t.tasks}`} />
          <DeckStat label={<><Term id="pull_request">Pull requests</Term> merged</>} value={String(Math.min(t.prs, Math.floor(progress * t.prs)))} />
          <DeckStat label="Agent spend" value={exampleMoney(business, Math.round(progress * t.tasks * business.deck.costPerTaskMinor))} estimate />
        </dl>
      </div>
    </section>
  );
}

function DeckStat({ label, value, estimate }: { label: ReactNode; value: string; estimate?: boolean }) {
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

/**
 * How often the feed advances: fast while a cycle runs, slowly between cycles, and not at all between cycles when the
 * visitor prefers reduced motion or has paused it (null). Exported for tests.
 */
export function feedTickMs({ working, reduced, paused }: { working: boolean; reduced: boolean; paused: boolean }): number | null {
  if (working) return 650;
  return reduced || paused ? null : 2800;
}

/** A counter that advances every `ms` (never when `ms` is null); the interval restarts when `ms` changes. */
function useTicker(ms: number | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (ms === null) return;
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
function useFeed(tick: number, activity: readonly ActivityLine[]): Array<{ key: number; line: ActivityLine }> {
  const [feed, setFeed] = useState(() => [3, 2, 1, 0].map((k) => ({ key: k, line: activity[k % activity.length]! })));
  const last = useRef(tick);
  useEffect(() => {
    if (tick === last.current) return;
    last.current = tick;
    setFeed((prev) => {
      const key = (prev[0]?.key ?? 0) + 1;
      return [{ key, line: activity[key % activity.length]! }, ...prev].slice(0, FEED_MAX);
    });
  }, [tick, activity]);
  return feed;
}
