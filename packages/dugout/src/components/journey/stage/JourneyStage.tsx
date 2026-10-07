import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Pause, Play, RotateCcw, Star, Trophy, VolumeX } from "lucide-react";
import { CHANNEL_META, type ChannelKey, type EntityKind, type MatchdayLevel } from "@foundmill/shared";
import { cn } from "../../../lib/cn";
import { formatDate, formatDateTime, formatDuration, formatMoney, formatNumber, formatOrdinal, formatPercent } from "../../../lib/format";
import { ratingClass } from "../../../lib/rating";
import { usePrefersReducedMotion } from "../../../lib/reducedMotion";
import { Avatar } from "../../foundation/Avatar";
import { Button } from "../../foundation/Button";
import { Chip, ProvenanceChip } from "../../foundation/Chip";
import { Icon } from "../../foundation/Icon";
import { IconButton } from "../../foundation/IconButton";
import { ProgressRing } from "../../foundation/ProgressRing";
import { Slider } from "../../foundation/Slider";
import { Tooltip } from "../../foundation/Tooltip";
import { LineChart } from "../charts/LineChart";
import { EntityText } from "../EntityText";
import type { CustomerFacts, Journey, JourneyAgent, Kit, StageAgentMeta, Touch } from "../types";
import { GoalBurst } from "./GoalBurst";
import {
  buildReplaySchedule,
  commentaryShownBy,
  formatReplayClock,
  REPLAY_SPEED_LABELS,
  REPLAY_SPEEDS,
  STAGE_LABELS,
  STAGE_ORDER,
  stageAt,
  stageWindow,
  touchesPlayedBy,
  type ReplaySpeed,
  type StageName,
} from "./schedule";

export const LEVEL_WORD: Record<MatchdayLevel, string> = { friendly: "Friendly", league: "League match", cup: "Cup tie" };
export const KIND_RESULT: Record<Journey["kind"], string> = { signup: "Signup", activation: "Activation", payment: "Customer won" };

export interface JourneyStageProps {
  journey: Journey;
  touches: readonly Touch[];
  customer: CustomerFacts;
  /** Avatar seeds, department colours and models per agent id. */
  agents?: readonly StageAgentMeta[];
  kit: Kit;
  speed?: ReplaySpeed;
  /** Remembered per founder by the app (BUILD §11.4). Default "full". */
  defaultSpeed?: ReplaySpeed;
  onSpeedChange?: (speed: ReplaySpeed) => void;
  /** Start playing on mount. Default true. */
  autoplay?: boolean;
  onOpenEntity?: (id: string) => void;
  entityKinds?: Record<string, EntityKind>;
  onClose?: () => void;
  closeLabel?: string;
  currency?: string;
  /** "pixi" (default) draws the Goal particle burst; "none" skips the canvas (tests, reduced motion). */
  overlay?: "pixi" | "none";
  className?: string;
}

/* ---------- Clock ---------- */

function useReplayClock(durationMs: number, autoplay: boolean, resetKey: string) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(autoplay && durationMs > 0);
  useEffect(() => {
    setTime(0);
    setPlaying(autoplay && durationMs > 0);
  }, [resetKey, durationMs, autoplay]);
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== "function") return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      setTime((t) => Math.min(durationMs, t + dt));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs]);
  useEffect(() => {
    if (playing && time >= durationMs) setPlaying(false);
  }, [time, durationMs, playing]);
  const seek = useCallback((ms: number) => setTime(Math.max(0, Math.min(durationMs, ms))), [durationMs]);
  return { time, playing, setPlaying, seek };
}

/* ---------- Helpers ---------- */

function offsetLabel(iso: string, kickoffIso: string | null): string {
  if (!kickoffIso) return formatDateTime(iso);
  const ms = Date.parse(iso) - Date.parse(kickoffIso);
  const day = Math.floor(ms / 86_400_000) + 1;
  return `Day ${day} · ${formatDate(iso, "HH:mm")}`;
}

function channelLabel(key: ChannelKey | null): string {
  return key ? CHANNEL_META[key].label : "Direct";
}

function agentMeta(agents: readonly StageAgentMeta[] | undefined, id: string | null | undefined): StageAgentMeta {
  const found = id ? agents?.find((a) => a.agentId === id) : undefined;
  return found ?? { agentId: id ?? "unknown", seed: id ?? "unknown", dept: "dept-3" };
}

/* ---------- Stage panels ---------- */

function Panelette({ title, children, className, action }: { title: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", className)} aria-label={title}>
      <header className="flex h-panel-header shrink-0 items-center gap-2 border-b border-subtle bg-panel-alt px-panel-pad">
        <h3 className="t-label flex-1 truncate">{title}</h3>
        {action}
      </header>
      <div className="min-h-0 flex-1 p-panel-pad">{children}</div>
    </section>
  );
}

function TeamSheet({ journey, agents }: { journey: Journey; agents?: readonly StageAgentMeta[] }) {
  const maxW = Math.max(1e-9, ...journey.channels.map((c) => c.weight));
  const captainAgent = journey.captain?.agentId ?? null;
  const captainChannel = journey.captain?.channelKey ?? null;
  return (
    <div className="grid grid-cols-2 gap-gutter" data-stage-panel="team_sheet">
      <Panelette title="Channels">
        <ol className="flex flex-col gap-2">
          {journey.channels.map((c) => (
            <li key={c.channelKey ?? "direct"} className="flex items-center gap-2">
              <span className="w-36 truncate text-body-strong">
                {channelLabel(c.channelKey)}
                {c.channelKey === captainChannel && journey.captain ? <Icon icon={Star} size="inline" className="ml-1 inline text-gold" label="Captain" /> : null}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-alt">
                <span className="block h-full bg-kit-primary" style={{ width: `${Math.round((c.weight / maxW) * 100)}%` }} />
              </span>
              <span className="w-12 text-right tabular-nums">{formatPercent(c.weight, { digits: 0 })}</span>
              <span className="w-16 text-right text-small text-secondary tabular-nums">
                {c.touchCount} {c.touchCount === 1 ? "touch" : "touches"}
              </span>
            </li>
          ))}
        </ol>
      </Panelette>
      <Panelette title="Squad">
        <ol className="flex flex-col gap-2">
          {[...journey.agents]
            .sort((a, b) => b.contribution - a.contribution)
            .map((a) => {
              const meta = agentMeta(agents, a.agentId);
              return (
                <li key={a.agentId} className="flex items-center gap-2">
                  <Avatar size={24} name={a.name} agent={{ seed: meta.seed, dept: meta.dept }} status={meta.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-strong">
                      {a.name}
                      {a.agentId === captainAgent ? <Icon icon={Star} size="inline" className="ml-1 inline text-gold" label="Captain" /> : null}
                    </span>
                    <span className="block truncate text-small text-secondary">{a.role ?? "Agent"}</span>
                  </span>
                  <span className="tabular-nums">{formatPercent(a.contribution, { digits: 0 })}</span>
                </li>
              );
            })}
        </ol>
        {journey.partialJourney ? (
          <p className="mt-3 text-small text-secondary">Partial journey: without consent only first-party touches are shown.</p>
        ) : null}
      </Panelette>
    </div>
  );
}

function KickOff({ journey, touches }: { journey: Journey; touches: readonly Touch[] }) {
  const start = journey.stats.firstTouchAt ? Date.parse(journey.stats.firstTouchAt) : Date.parse(journey.convertedAt);
  const end = Date.parse(journey.convertedAt);
  const span = Math.max(1, end - start);
  const captain = journey.captain?.touchId;
  return (
    <Panelette title="Kick-off" className="h-full" data-stage-panel="kick_off">
      <div className="flex flex-col gap-4" data-stage-panel="kick_off">
        <div className="flex items-baseline gap-3">
          <span className="t-display-md">{journey.stats.firstTouchAt ? formatDateTime(journey.stats.firstTouchAt) : "Kick-off"}</span>
          <span className="text-small text-secondary">to {formatDateTime(journey.convertedAt)} · {formatDuration(span)}</span>
        </div>
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 h-px bg-subtle" />
          {touches.map((t) => {
            const x = ((Date.parse(t.occurredAt) - start) / span) * 100;
            const isCaptain = t.id === captain;
            return (
              <span key={t.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%` }} title={`${channelLabel(t.channelKey)} · ${formatDateTime(t.occurredAt)}`}>
                <span className={cn("block rounded-full", isCaptain ? "size-3 bg-gold" : "size-2 border border-primary bg-panel")} />
              </span>
            );
          })}
          <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2">
            <Icon icon={Trophy} size="inline" className="text-gold" label="Conversion" />
          </span>
        </div>
        <p className="text-small text-secondary">
          {touches.length} touches across {journey.channels.length} channels, scaled to the real {formatDuration(span)}. The gold dot is the captain, the heaviest touch.
        </p>
      </div>
    </Panelette>
  );
}

function MatchFeed({ journey, touches, playedIds, commentaryShown, agents, onOpenEntity, entityKinds, reduced }: { journey: Journey; touches: readonly Touch[]; playedIds: string[]; commentaryShown: number[]; agents?: readonly StageAgentMeta[]; onOpenEntity?: (id: string) => void; entityKinds?: Record<string, EntityKind>; reduced: boolean }) {
  const kickoff = journey.stats.firstTouchAt;
  const played = new Set(playedIds);
  const shownComm = new Set(commentaryShown);
  const comm = (journey.commentary as Array<{ text?: unknown; touchId?: unknown }>).map((c, i) => ({ i, text: typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "", touchId: typeof c?.touchId === "string" ? c.touchId : null }));
  const unanchored = comm.filter((c) => !c.touchId && shownComm.has(c.i));
  const rows = touches.filter((t) => played.has(t.id));
  const latest = rows[rows.length - 1];
  const xc = latest ? (journey.xcSeries.find((p) => p.touchId === latest.id)?.cumulative ?? 0) : 0;
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, commentaryShown.length]);
  return (
    <div className="grid grid-cols-[1fr_200px] gap-gutter" data-stage-panel="match">
      <Panelette title="Match">
        <ol ref={feedRef} className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1" aria-live="polite" aria-relevant="additions">
          {rows.length === 0 ? <li className="text-small text-secondary">Waiting for the first touch…</li> : null}
          {rows.map((t, idx) => {
            const meta = agentMeta(agents, t.source?.agentId ?? null);
            const agent = journey.agents.find((a) => a.agentId === t.source?.agentId);
            const weight = journey.weights[t.id] ?? 0;
            const isCaptain = journey.captain?.touchId === t.id;
            const lines = comm.filter((c) => c.touchId === t.id && shownComm.has(c.i));
            return (
              <li key={t.id} className={cn("flex flex-col gap-1", !reduced && idx === rows.length - 1 && "animate-rise-in")} data-touch-row={t.id}>
                <div className="flex items-center gap-2">
                  <span className="w-28 shrink-0 font-mono text-mono text-secondary">{offsetLabel(t.occurredAt, kickoff)}</span>
                  <Chip tone={isCaptain ? "gold" : "neutral"} icon={isCaptain ? Star : undefined}>
                    {channelLabel(t.channelKey)}
                  </Chip>
                  {agent ? <Avatar size={20} name={agent.name} agent={{ seed: meta.seed, dept: meta.dept }} /> : null}
                  <EntityText text={t.source?.label ?? `${channelLabel(t.channelKey)} ${t.kind.replace(/_/g, " ")}`} kinds={entityKinds} onOpenEntity={onOpenEntity} className="min-w-0 flex-1 truncate text-body-strong" />
                  <span className="text-small text-secondary tabular-nums">{formatPercent(weight, { digits: 0 })}</span>
                </div>
                {lines.map((l) => (
                  <EntityText key={l.i} as="p" text={l.text} kinds={entityKinds} onOpenEntity={onOpenEntity} className="t-reading pl-30 text-primary" />
                ))}
              </li>
            );
          })}
          {unanchored.map((l) => (
            <li key={`c-${l.i}`}>
              <EntityText as="p" text={l.text} kinds={entityKinds} onOpenEntity={onOpenEntity} className="t-reading text-primary" />
            </li>
          ))}
        </ol>
      </Panelette>
      <Panelette title="xC">
        <div className="flex flex-col items-center gap-2 py-2">
          <ProgressRing value={xc} size={72} strokeWidth={5} tone="kit" label="Expected conversion" />
          <span className="t-display-lg tabular-nums">{formatPercent(xc, { digits: 0 })}</span>
          <span className="text-center text-small text-secondary">
            Chance of this customer converting after {rows.length} of {touches.length} touches
          </span>
          <ProvenanceChip kind="estimate" />
        </div>
      </Panelette>
    </div>
  );
}

const RAIL_PANELS = ["attribution", "touches", "time", "cost", "xc"] as const;
type RailPanel = (typeof RAIL_PANELS)[number];
const RAIL_LABELS: Record<RailPanel, string> = { attribution: "Attribution", touches: "Touch count", time: "Time to convert", cost: "Acquisition cost", xc: "xC curve" };

function paybackMonths(journey: Journey): number | null {
  const cost = journey.stats.acquisitionCostMinor;
  const amount = journey.amountMinor ?? 0;
  if (cost === null || amount <= 0) return null;
  return cost / (amount / 12);
}

function Rails({ journey, customer, touches, currency, onOpenEntity, entityKinds }: { journey: Journey; customer: CustomerFacts; touches: readonly Touch[]; currency: string; onOpenEntity?: (id: string) => void; entityKinds?: Record<string, EntityKind> }) {
  const [panel, setPanel] = useState<RailPanel>("attribution");
  const maxW = Math.max(1e-9, ...journey.channels.map((c) => c.weight));
  const byKind = touches.reduce<Record<string, number>>((acc, t) => ((acc[t.kind] = (acc[t.kind] ?? 0) + 1), acc), {});
  const payback = paybackMonths(journey);
  const tabsRef = useRef<HTMLDivElement>(null);
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = RAIL_PANELS.indexOf(panel);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = RAIL_PANELS[(i + (e.key === "ArrowRight" ? 1 : RAIL_PANELS.length - 1)) % RAIL_PANELS.length] as RailPanel;
      setPanel(next);
      (tabsRef.current?.querySelector<HTMLButtonElement>(`[data-rail-tab='${next}']`))?.focus();
    }
  };
  return (
    <div className="grid grid-cols-[280px_1fr] gap-gutter" data-stage-panel="rails">
      <Panelette title="Customer">
        <div className="flex flex-col gap-2">
          <EntityText text={customer.entityId ? `[[ent:${customer.entityId}|${customer.name}]]` : customer.name} kinds={entityKinds} onOpenEntity={onOpenEntity} className="t-display-sm" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {customer.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="t-label">{f.label}</dt>
                <dd className="truncate text-body">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Panelette>
      <Panelette
        title={RAIL_LABELS[panel]}
        action={
          <div ref={tabsRef} role="tablist" aria-label="Stat panels" className="flex items-center gap-0.5" onKeyDown={onTabKey}>
            {RAIL_PANELS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={panel === p} tabIndex={panel === p ? 0 : -1} data-rail-tab={p} onClick={() => setPanel(p)} className={cn("h-6 rounded-chip px-2 t-label hover:bg-white/6 hover:text-primary", panel === p && "bg-panel text-primary")}>
                {RAIL_LABELS[p]}
              </button>
            ))}
          </div>
        }
      >
        <div role="tabpanel" data-rail-panel={panel} className="min-h-40">
          {panel === "attribution" ? (
            <div className="flex flex-col gap-2">
              <ol className="flex flex-col gap-2">
                {journey.channels.map((c) => (
                  <li key={c.channelKey ?? "direct"} className="flex items-center gap-2">
                    <span className="w-36 truncate text-body-strong">{channelLabel(c.channelKey)}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-alt">
                      <span className="block h-full bg-kit-primary" style={{ width: `${Math.round((c.weight / maxW) * 100)}%` }} />
                    </span>
                    <span className="w-12 text-right tabular-nums">{formatPercent(c.weight, { digits: 0 })}</span>
                  </li>
                ))}
              </ol>
              <span className="text-small text-secondary">Model: {journey.attributionModel === "data_driven_markov" ? "data-driven (Markov removal effect)" : "position-based 40 / 20 / 40"}</span>
            </div>
          ) : null}
          {panel === "touches" ? (
            <div className="flex items-end gap-6">
              <span className="t-display-xl tabular-nums">{journey.stats.touchCount}</span>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-small">
                {Object.entries(byKind).map(([k, n]) => (
                  <div key={k} className="contents">
                    <dt className="text-secondary">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-right tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {panel === "time" ? (
            <div className="flex flex-col gap-1">
              <span className="t-display-xl tabular-nums">{journey.stats.timeToConvertHours === null ? "—" : formatDuration(journey.stats.timeToConvertHours * 3_600_000)}</span>
              <span className="text-small text-secondary">
                First touch {journey.stats.firstTouchAt ? formatDateTime(journey.stats.firstTouchAt) : "—"} · converted {formatDateTime(journey.convertedAt)}
              </span>
            </div>
          ) : null}
          {panel === "cost" ? (
            <div className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-2">
                <span className="t-display-xl tabular-nums">{journey.stats.acquisitionCostMinor === null ? "—" : formatMoney({ amountMinor: journey.stats.acquisitionCostMinor, currency: journey.stats.currency || currency })}</span>
                <ProvenanceChip kind="estimate" />
              </span>
              <span className="text-small text-secondary">Σ attribution weight × channel cost per acquisition{payback !== null ? ` · payback ${formatNumber(payback, { maxDigits: 1 })} months` : ""}</span>
            </div>
          ) : null}
          {panel === "xc" ? (
            <LineChart
              label="Expected conversion over the journey"
              height={180}
              xType="linear"
              yDomain={[0, 1]}
              yFormat={(v) => formatPercent(v, { digits: 0 })}
              xFormat={(v) => `Touch ${Math.round(v)}`}
              linear
              legend={false}
              provenance="estimate"
              series={[{ id: "xc", label: "xC", tone: "kit", area: true, data: journey.xcSeries.map((p) => ({ x: p.index, y: p.cumulative })) }]}
            />
          ) : null}
        </div>
      </Panelette>
    </div>
  );
}

function GoalMoment({ journey, customer, kit, currency, reduced, overlay }: { journey: Journey; customer: CustomerFacts; kit: Kit; currency: string; reduced: boolean; overlay: "pixi" | "none" }) {
  const [wiped, setWiped] = useState(reduced);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced) return;
    const id = requestAnimationFrame(() => setWiped(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);
  useEffect(() => {
    const el = ref.current;
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);
  const amount = journey.amountMinor && journey.amountMinor > 0 ? formatMoney({ amountMinor: journey.amountMinor, currency: journey.currency ?? currency }) : null;
  if (reduced) {
    return (
      <div className="surface-panel flex flex-col items-center gap-2 border-gold/40 p-8 text-center" data-stage-panel="goal" data-static>
        <Icon icon={Trophy} size="lg" className="text-gold" />
        <span className="t-label text-gold">{KIND_RESULT[journey.kind]}</span>
        <span className="t-display-xl">{customer.name}</span>
        {amount ? <span className="t-display-lg tabular-nums text-gold">{amount}</span> : null}
        <span className="text-small text-secondary">
          {formatOrdinal(journey.nthOfKind)} {journey.kind} · {formatDateTime(journey.convertedAt)}
        </span>
      </div>
    );
  }
  return (
    <div ref={ref} className="relative h-[420px] overflow-hidden rounded-panel" data-stage-panel="goal">
      <div className="absolute inset-0 bg-kit-primary transition-[clip-path] duration-ribbon ease-dugout" style={{ clipPath: wiped ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }} />
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-kit-on-primary transition-opacity duration-view ease-dugout", wiped ? "opacity-100" : "opacity-0")}>
        <span className="t-label text-kit-on-primary opacity-80">{KIND_RESULT[journey.kind]}</span>
        <span className="t-display-xl">{customer.name}</span>
        {amount ? <span className="t-display-lg tabular-nums">{amount}</span> : null}
        <span className="text-small opacity-80">
          {formatOrdinal(journey.nthOfKind)} {journey.kind} · {LEVEL_WORD[journey.matchdayLevel]}
        </span>
      </div>
      {wiped && size.w > 0 ? <GoalBurst width={size.w} height={size.h} colours={[kit.secondary, "#E8C56B"]} seed={journey.conversionId} enabled={overlay === "pixi"} /> : null}
      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-chip bg-ink/40 px-1.5 t-label text-kit-on-primary">
        <Icon icon={VolumeX} size={12} /> Sound off
      </span>
    </div>
  );
}

function FullTime({ journey, customer, agents, currency, onReplay, onClose, closeLabel }: { journey: Journey; customer: CustomerFacts; agents?: readonly StageAgentMeta[]; currency: string; onReplay: () => void; onClose?: () => void; closeLabel: string }) {
  const payback = paybackMonths(journey);
  const potm = journey.agents.find((a) => a.agentId === journey.playerOfTheMatch) ?? null;
  const sorted = [...journey.agents].sort((a, b) => b.rating - a.rating || b.contribution - a.contribution);
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-gutter" data-stage-panel="full_time">
      <Panelette title="Full time">
        <div className="flex flex-col gap-3">
          <div>
            <span className="t-label">{KIND_RESULT[journey.kind]}</span>
            <p className="t-display-md">{customer.name}</p>
            <p className="text-small text-secondary">
              {formatOrdinal(journey.nthOfKind)} {journey.kind} · {LEVEL_WORD[journey.matchdayLevel]} · {formatDateTime(journey.convertedAt)}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="t-label">Acquisition cost</dt>
              <dd className="inline-flex items-center gap-2">
                <span className="t-display-lg tabular-nums">{journey.stats.acquisitionCostMinor === null ? "—" : formatMoney({ amountMinor: journey.stats.acquisitionCostMinor, currency: journey.stats.currency || currency })}</span>
                <ProvenanceChip kind="estimate" />
              </dd>
            </div>
            <div>
              <dt className="t-label">Payback</dt>
              <dd className="inline-flex items-center gap-2">
                <span className="t-display-lg tabular-nums">{payback === null ? "—" : `${formatNumber(payback, { maxDigits: 1 })} mo`}</span>
                {payback !== null ? <ProvenanceChip kind="estimate" /> : null}
              </dd>
            </div>
            <div>
              <dt className="t-label">Time to convert</dt>
              <dd className="t-display-lg tabular-nums">{journey.stats.timeToConvertHours === null ? "—" : formatDuration(journey.stats.timeToConvertHours * 3_600_000)}</dd>
            </div>
            <div>
              <dt className="t-label">Touches</dt>
              <dd className="t-display-lg tabular-nums">{journey.stats.touchCount}</dd>
            </div>
          </dl>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" icon={RotateCcw} onClick={onReplay}>
              Watch again
            </Button>
            {onClose ? (
              <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onClose}>
                {closeLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </Panelette>
      <Panelette title="Agent ratings">
        <ol className="flex flex-col gap-2">
          {sorted.map((a: JourneyAgent) => {
            const meta = agentMeta(agents, a.agentId);
            const isPotm = potm?.agentId === a.agentId;
            return (
              <li key={a.agentId} className={cn("flex items-center gap-3 rounded-panel px-2 py-1", isPotm && "bg-gold/10")} data-agent-rating={a.agentId}>
                <Avatar size={32} name={a.name} agent={{ seed: meta.seed, dept: meta.dept }} status={meta.status} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-body-strong">
                    <span className="truncate">{a.name}</span>
                    {isPotm ? (
                      <Chip tone="gold" icon={Trophy}>
                        Player of the match
                      </Chip>
                    ) : null}
                  </span>
                  <span className="block truncate text-small text-secondary">
                    {a.role ?? "Agent"} · {formatPercent(a.contribution, { digits: 0 })} of the attribution
                  </span>
                </span>
                <span className={cn("t-display-lg", ratingClass(a.rating * 2))} aria-label={`Rating ${a.rating} of 10`}>
                  {a.rating}
                </span>
              </li>
            );
          })}
        </ol>
      </Panelette>
    </div>
  );
}

/* ---------- The stage ---------- */

/**
 * Match Day (BUILD §11.4, DESIGN §8): Team sheet → Kick-off → Match → Rails → Goal → Full time, driven by a
 * deterministic frame schedule (AC-11.4.3). Speeds Full / Highlights / Instant; a scrubber and pause; the stage
 * stepper jumps to any stage. Reduced motion renders the static summary (AC-11.4.5).
 */
export function JourneyStage({ journey, touches, customer, agents, kit, speed: speedProp, defaultSpeed = "full", onSpeedChange, autoplay = true, onOpenEntity, entityKinds, onClose, closeLabel = "Back", currency = "EUR", overlay = "pixi", className }: JourneyStageProps) {
  const reduced = usePrefersReducedMotion();
  const [speedState, setSpeedState] = useState<ReplaySpeed>(defaultSpeed);
  const speed = speedProp ?? speedState;
  const changeSpeed = (s: ReplaySpeed) => {
    if (speedProp === undefined) setSpeedState(s);
    onSpeedChange?.(s);
  };
  const schedule = useMemo(() => buildReplaySchedule(journey, touches, speed), [journey, touches, speed]);
  const orderedTouches = useMemo(() => schedule.touchIds.map((id) => touches.find((t) => t.id === id)).filter((t): t is Touch => !!t), [schedule, touches]);
  const { time, playing, setPlaying, seek } = useReplayClock(schedule.durationMs, autoplay && !reduced, `${journey.conversionId}:${speed}`);
  const [manualStage, setManualStage] = useState<StageName | null>(null);
  const clockStage = stageAt(schedule, time);
  const stage: StageName = manualStage ?? clockStage;
  const playedIds = manualStage ? schedule.touchIds : touchesPlayedBy(schedule, time);
  const commentaryShown = manualStage ? schedule.commentary.map((_, i) => i) : commentaryShownBy(schedule, time);
  const goToStage = (s: StageName) => {
    setManualStage(s);
    setPlaying(false);
    seek(stageWindow(schedule, s).startMs);
  };
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setManualStage(null);
    if (time >= schedule.durationMs) seek(0);
    setPlaying(true);
  };
  const replay = () => {
    setManualStage(null);
    seek(0);
    setPlaying(schedule.durationMs > 0);
  };
  const vignette = { backgroundImage: "radial-gradient(ellipse at 50% 0%, color-mix(in oklab, var(--kit-primary) 10%, transparent), transparent 60%)" } as const;

  const header = (
    <header className="flex flex-wrap items-center gap-3 border-b border-subtle px-gutter py-2" style={{ ["--kit-primary" as string]: kit.primary, ["--kit-secondary" as string]: kit.secondary }}>
      <span className="inline-flex items-center gap-2">
        <Icon icon={Trophy} className="text-gold" />
        <span className="t-label text-gold">Match Day</span>
        <span className="t-display-sm">{LEVEL_WORD[journey.matchdayLevel]}</span>
        <span className="text-small text-secondary">
          {formatOrdinal(journey.nthOfKind)} {journey.kind}
        </span>
      </span>
      <ol className="mx-auto flex items-center gap-1" aria-label="Stages" data-stepper>
        {STAGE_ORDER.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <button type="button" aria-current={stage === s ? "step" : undefined} data-stage-step={s} onClick={() => goToStage(s)} className={cn("h-6 rounded-chip px-2 t-label hover:bg-white/6 hover:text-primary", stage === s && "bg-panel-alt text-primary shadow-[inset_0_-2px_0_var(--kit-primary)]")}>
              {STAGE_LABELS[s]}
            </button>
            {i < STAGE_ORDER.length - 1 ? <span aria-hidden className="h-px w-2 bg-subtle" /> : null}
          </li>
        ))}
      </ol>
      <div role="group" aria-label="Speed" className="flex items-center gap-0.5 rounded-panel bg-panel-alt p-0.5">
        {REPLAY_SPEEDS.map((s) => (
          <Button key={s} size="sm" variant="ghost" aria-pressed={speed === s} className={cn("h-6 px-2", speed === s && "bg-panel text-primary")} onClick={() => changeSpeed(s)} data-speed={s}>
            {REPLAY_SPEED_LABELS[s]}
          </Button>
        ))}
      </div>
      {!reduced && schedule.durationMs > 0 ? <IconButton icon={playing ? Pause : Play} label={playing ? "Pause" : "Play"} onClick={togglePlay} /> : null}
      <Tooltip content="Sound is off by default">
        <span className="inline-flex items-center gap-1 rounded-chip bg-panel-alt px-1.5 t-label">
          <Icon icon={VolumeX} size={12} /> Sound off
        </span>
      </Tooltip>
      {onClose ? <IconButton icon={ChevronLeft} label={closeLabel} onClick={onClose} /> : null}
    </header>
  );

  if (reduced) {
    return (
      <div className={cn("flex min-h-full flex-col bg-base", className)} style={vignette} data-journey-stage="static" data-stage={stage}>
        {header}
        <div className="flex flex-col gap-gutter p-gutter">
          <p className="text-small text-secondary">Static summary (reduced motion): every stage at once, no replay clock.</p>
          <GoalMoment journey={journey} customer={customer} kit={kit} currency={currency} reduced overlay="none" />
          <FullTime journey={journey} customer={customer} agents={agents} currency={currency} onReplay={replay} onClose={onClose} closeLabel={closeLabel} />
          <TeamSheet journey={journey} agents={agents} />
          <Rails journey={journey} customer={customer} touches={orderedTouches} currency={currency} onOpenEntity={onOpenEntity} entityKinds={entityKinds} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-full flex-col bg-base", className)} style={vignette} data-journey-stage={speed} data-stage={stage} data-time={Math.round(time)} data-schedule-hash={schedule.hash}>
      {header}
      {schedule.durationMs > 0 ? (
        <div className="flex items-center gap-3 border-b border-subtle px-gutter py-1.5">
          <span className="font-mono text-mono text-secondary tabular-nums">
            {formatReplayClock(time)} / {formatReplayClock(schedule.durationMs)}
          </span>
          <Slider
            value={[time]}
            min={0}
            max={schedule.durationMs}
            step={100}
            thumbLabels={["Replay position"]}
            onValueChange={([v]) => {
              setManualStage(null);
              seek(v ?? 0);
            }}
            className="flex-1"
          />
          <span className="t-label">{STAGE_LABELS[clockStage]}</span>
        </div>
      ) : null}
      <div className="flex-1 p-gutter">
        {stage === "team_sheet" ? <TeamSheet journey={journey} agents={agents} /> : null}
        {stage === "kick_off" ? <KickOff journey={journey} touches={orderedTouches} /> : null}
        {stage === "match" ? <MatchFeed journey={journey} touches={orderedTouches} playedIds={playedIds} commentaryShown={commentaryShown} agents={agents} onOpenEntity={onOpenEntity} entityKinds={entityKinds} reduced={reduced} /> : null}
        {stage === "rails" ? <Rails journey={journey} customer={customer} touches={orderedTouches} currency={currency} onOpenEntity={onOpenEntity} entityKinds={entityKinds} /> : null}
        {stage === "goal" ? <GoalMoment journey={journey} customer={customer} kit={kit} currency={currency} reduced={false} overlay={overlay} /> : null}
        {stage === "full_time" ? <FullTime journey={journey} customer={customer} agents={agents} currency={currency} onReplay={replay} onClose={onClose} closeLabel={closeLabel} /> : null}
      </div>
    </div>
  );
}
