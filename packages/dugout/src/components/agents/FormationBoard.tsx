"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import { CHANNEL_LINES, type ChannelKey, type ChannelLine } from "@foundmill/shared/constants";
import { cn } from "../../lib/cn";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { Tooltip } from "../foundation/Tooltip";
import { Term } from "../guidance/Term";
import { ChannelProfileCard } from "./ChannelProfileCard";
import { Icon } from "../foundation/Icon";
import { ChannelToken } from "./ChannelToken";
import {
  BOARD_H,
  CHANNEL_ICONS,
  BOARD_W,
  FAMILY_ACCENT,
  FAMILY_QUADRANT,
  FIT_RINGS,
  HUB,
  LINE_HINTS,
  LINE_LABELS,
  RX,
  RY,
  benchChannels,
  boardLayout,
  channelLabel,
  channelLine,
  dropZoneAt,
  entranceOrder,
  pitchLines,
  signalPath,
  type BoardSlot,
  type DropZone,
} from "./formation";
import type { ChannelTokenData } from "./types";

export const ENTRANCE_STAGGER_MS = 160;
export const ENTRANCE_DELAY_MS = 400;
const DRAG_THRESHOLD = 4;

export interface FormationBoardProps {
  channels: readonly ChannelTokenData[];
  /** Drag or Enter moves a channel on or off the board; the app enables/disables the engine and re-scores. */
  onToggle: (key: ChannelKey, enabled: boolean) => void;
  /** Click (or O) opens the channel profile screen. */
  onOpenChannel?: (key: ChannelKey) => void;
  onPause?: (key: ChannelKey, paused: boolean) => void;
  /** Brand colours as hex; the hub and the board's glow take the primary. Without it, the --kit-primary variable. */
  kit?: { primary: string; secondary?: string };
  /** Recommended channels join the board one by one after mount (default true; instant under reduced motion). */
  animateEntrance?: boolean;
  benchLabel?: string;
  /** Show hover cards with the channel profile (default true). */
  hoverCards?: boolean;
  className?: string;
}

interface DragState {
  key: ChannelKey;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
  from: DropZone;
}

const pct = (v: number, of: number) => `${Math.round((v / of) * 1e6) / 1e4}%`;
const mix = (colour: string, amount: number, base = "transparent") => `color-mix(in oklab, ${colour} ${amount}%, ${base})`;

/** Where each family's wash glows, as a percent of the board (the middle of its quadrant). */
const WASH_AT: Record<ChannelLine, string> = { attack: "24% 24%", midfield: "76% 24%", defence: "24% 74%", wings: "76% 74%" };
const CORNER_CLASS: Record<"tl" | "tr" | "bl" | "br", string> = {
  tl: "left-4 top-3 items-start text-left",
  tr: "right-4 top-3 items-end text-right",
  bl: "bottom-3 left-4 items-start text-left",
  br: "bottom-3 right-4 items-end text-right",
};

/**
 * The Channel Board (BUILD §11.7, DESIGN "Channel Board"): a quadrant map around a hub in the brand colour. Each channel
 * family owns a quadrant in its accent; a running channel sits on its family's diagonal, closer to the hub the
 * stronger its fit, on rings that mark the fit bands, joined to the hub by a live signal line. Below the board, the
 * tray holds every channel that is not running, grouped by family. Pointer drag between board and tray with a
 * keyboard alternative (focus a token, Enter toggles, O opens); recommended channels join the board one by one.
 */
export function FormationBoard({ channels, onToggle, onOpenChannel, onPause, kit, animateEntrance = true, benchLabel = "All 15 channels are available", hoverCards = true, className }: FormationBoardProps) {
  const reduced = usePrefersReducedMotion();
  const hintId = useId();
  const liveId = useId();
  const svgId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const animate = animateEntrance && !reduced;
  const [entered, setEntered] = useState<Set<ChannelKey>>(() => (animate ? new Set() : new Set(channels.filter((c) => c.enabled).map((c) => c.key))));
  const [walkedOn, setWalkedOn] = useState(!animate);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hot, setHot] = useState<ChannelKey | null>(null);
  const [announce, setAnnounce] = useState("");
  const dragRef = useRef<DragState | null>(null);
  const order = useMemo(() => entranceOrder(channels), [channels]);

  // Entrance: after a short beat, channels join the board one by one; anything enabled later is on the board at once.
  useEffect(() => {
    if (walkedOn) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    order.forEach((key, i) => {
      timers.push(
        setTimeout(() => {
          setEntered((prev) => new Set(prev).add(key));
        }, ENTRANCE_DELAY_MS + i * ENTRANCE_STAGGER_MS),
      );
    });
    timers.push(setTimeout(() => setWalkedOn(true), ENTRANCE_DELAY_MS + order.length * ENTRANCE_STAGGER_MS + 50));
    return () => timers.forEach(clearTimeout);
  }, [order, walkedOn]);

  const effective = useMemo(() => (walkedOn ? channels : channels.map((c) => (c.enabled && !entered.has(c.key) ? { ...c, enabled: false } : c))), [channels, walkedOn, entered]);
  const families = useMemo(() => pitchLines(effective), [effective]);
  // Every channel has a fixed home on the map (computed from all of them, so toggling never reshuffles the others).
  const homes = useMemo(() => boardLayout(channels), [channels]);
  const slotByKey = useMemo(() => new Map(homes.map((s) => [s.key, s])), [homes]);
  const byKey = useMemo(() => new Map(effective.map((c) => [c.key, c])), [effective]);
  const slots = useMemo(() => homes.filter((h) => byKey.get(h.key)?.enabled), [homes, byKey]);
  const ghosts = useMemo(() => homes.filter((h) => !byKey.get(h.key)?.enabled), [homes, byKey]);
  const tray = useMemo(() => benchChannels(effective), [effective]);
  const running = slots.length;
  const totals = useMemo(() => {
    const t = new Map<ChannelLine, number>();
    for (const c of channels) t.set(channelLine(c.key), (t.get(channelLine(c.key)) ?? 0) + 1);
    return t;
  }, [channels]);

  const toggle = useCallback(
    (key: ChannelKey, enabled: boolean) => {
      onToggle(key, enabled);
      setAnnounce(`${channelLabel(key)} moved ${enabled ? "onto the board" : "off the board"}.`);
    },
    [onToggle],
  );

  // Pointer drag: window listeners so the drag survives leaving the token.
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const moved = d.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
      dragRef.current = { ...d, dx, dy, moved };
      setDrag(dragRef.current);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (!d.moved) {
        onOpenChannel?.(d.key);
        return;
      }
      const zone = dropZoneAt(e.clientX, e.clientY);
      if (zone && zone !== d.from) toggle(d.key, zone === "pitch");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragActive, onOpenChannel, toggle]);

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, channel: ChannelTokenData) => {
    if (e.button !== 0) return;
    const d: DragState = { key: channel.key, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, from: channel.enabled ? "pitch" : "bench" };
    dragRef.current = d;
    setDrag(d);
  };

  const onTokenKey = (e: KeyboardEvent<HTMLButtonElement>, channel: ChannelTokenData) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(channel.key, !channel.enabled);
    } else if ((e.key === "o" || e.key === "O") && onOpenChannel) {
      e.preventDefault();
      onOpenChannel(channel.key);
      setAnnounce(`${channelLabel(channel.key)} profile opened. Esc closes it.`);
    }
  };

  const brand = kit?.primary ?? "var(--kit-primary)";
  const surfaceStyle: CSSProperties = {
    backgroundColor: "var(--bg-ink)",
    backgroundImage: [
      `radial-gradient(ellipse 34% 40% at 50% ${pct(HUB.y, BOARD_H)}, ${mix(brand, 34)}, transparent 72%)`,
      ...CHANNEL_LINES.map((line) => `radial-gradient(ellipse 40% 46% at ${WASH_AT[line]}, ${mix(FAMILY_ACCENT[line], 11)}, transparent 70%)`),
      `linear-gradient(180deg, ${mix(brand, 10, "var(--bg-ink)")}, var(--bg-ink) 70%)`,
    ].join(", "),
  };

  const renderToken = (channel: ChannelTokenData, zone: DropZone, slot?: BoardSlot) => {
    const dragging = drag?.key === channel.key && drag.moved;
    const line = channelLine(channel.key);
    const placed: CSSProperties = slot ? { position: "absolute", left: `${slot.left}%`, top: `${slot.top}%` } : {};
    const style: CSSProperties = dragging ? { ...placed, transform: `translate(${drag!.dx}px, ${drag!.dy}px)`, zIndex: 30, position: slot ? "absolute" : "relative" } : placed;
    const token = (
      <ChannelToken
        channel={channel}
        accent={FAMILY_ACCENT[line]}
        fullLabel
        labelPlate={!!slot}
        className={slot ? undefined : "w-auto min-w-18"}
        dragging={dragging}
        hintId={hintId}
        onPointerDown={(e) => startDrag(e, channel)}
        onKeyDown={(e) => onTokenKey(e, channel)}
        onClick={(e) => e.preventDefault()}
      />
    );
    return (
      <motion.div
        key={channel.key}
        layoutId={`channel-${channel.key}`}
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 30, opacity: { duration: 0.32 } }}
        style={style}
        data-zone={zone}
        onPointerEnter={() => setHot(channel.key)}
        onPointerLeave={() => setHot((h) => (h === channel.key ? null : h))}
        onFocus={() => setHot(channel.key)}
        onBlur={() => setHot((h) => (h === channel.key ? null : h))}
        className={cn("touch-none", slot && "-ml-9 -mt-7", slot && (hot === channel.key ? "z-20" : "z-10"))}
      >
        {hoverCards ? (
          <HoverCard open={dragging ? false : undefined}>
            <HoverCardTrigger asChild>
              <span className="inline-flex">{token}</span>
            </HoverCardTrigger>
            <HoverCardContent side="right" className="w-80">
              <ChannelProfileCard channel={channel} onOpenChannel={onOpenChannel} onToggle={toggle} onPause={onPause} />
            </HoverCardContent>
          </HoverCard>
        ) : (
          token
        )}
      </motion.div>
    );
  };

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <section aria-label="Channel Board" className={cn("flex min-w-0 flex-col gap-3", className)} data-formation-board data-walked-on={walkedOn || undefined}>
          <p id={hintId} className="sr-only">
            Drag a channel on or off the board, or focus it and press Enter to move it. Press O to open the channel.
          </p>
          <p id={liveId} aria-live="polite" className="sr-only">
            {announce}
          </p>

          <div data-drop-zone="pitch" role="group" aria-label="Board: active channels" className="relative aspect-[16/10] w-full select-none overflow-hidden rounded-panel border border-subtle" style={surfaceStyle}>
            {/* Fine dot grid, fading out towards the edges. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `radial-gradient(${mix("var(--white)", 10)} 1px, transparent 1.5px)`,
                backgroundSize: "22px 22px",
                maskImage: `radial-gradient(ellipse 62% 66% at 50% ${pct(HUB.y, BOARD_H)}, black 40%, transparent 100%)`,
              }}
            />

            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id={`${svgId}-axis-x`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor="var(--white)" stopOpacity="0" />
                  <stop offset="0.5" stopColor="var(--white)" stopOpacity="0.14" />
                  <stop offset="1" stopColor="var(--white)" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={`${svgId}-axis-y`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--white)" stopOpacity="0" />
                  <stop offset="0.47" stopColor="var(--white)" stopOpacity="0.14" />
                  <stop offset="1" stopColor="var(--white)" stopOpacity="0" />
                </linearGradient>
                <radialGradient id={`${svgId}-core`} cx={HUB.x} cy={HUB.y} r={RY * FIT_RINGS[0]!.t} gradientUnits="userSpaceOnUse" gradientTransform={`translate(${HUB.x} ${HUB.y}) scale(${RX / RY} 1) translate(${-HUB.x} ${-HUB.y})`}>
                  <stop offset="0" stopColor={brand} stopOpacity="0.22" />
                  <stop offset="1" stopColor={brand} stopOpacity="0.04" />
                </radialGradient>
                {slots.map((s) => (
                  <linearGradient key={s.key} id={`${svgId}-sig-${s.key}`} gradientUnits="userSpaceOnUse" x1={HUB.x} y1={HUB.y} x2={s.x} y2={s.y}>
                    <stop offset="0" stopColor={brand} stopOpacity="0.15" />
                    <stop offset="0.35" stopColor={FAMILY_ACCENT[s.line]} stopOpacity="0.35" />
                    <stop offset="1" stopColor={FAMILY_ACCENT[s.line]} stopOpacity="0.95" />
                  </linearGradient>
                ))}
              </defs>

              {/* Quadrant axes through the hub. */}
              <line x1={40} x2={BOARD_W - 40} y1={HUB.y} y2={HUB.y} stroke={`url(#${svgId}-axis-x)`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <line x1={HUB.x} x2={HUB.x} y1={24} y2={BOARD_H - 24} stroke={`url(#${svgId}-axis-y)`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

              {/* Fit rings: the strongest band is lit, the outer edge is a fine dashed orbit. */}
              <ellipse cx={HUB.x} cy={HUB.y} rx={RX * FIT_RINGS[0]!.t} ry={RY * FIT_RINGS[0]!.t} fill={`url(#${svgId}-core)`} />
              {FIT_RINGS.map((ring, i) => (
                <ellipse
                  key={ring.band}
                  cx={HUB.x}
                  cy={HUB.y}
                  rx={RX * ring.t}
                  ry={RY * ring.t}
                  fill="none"
                  stroke="var(--white)"
                  strokeOpacity={i === FIT_RINGS.length - 1 ? 0.12 : 0.09 - i * 0.012}
                  strokeWidth={1}
                  strokeDasharray={i === FIT_RINGS.length - 1 ? "2 7" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {/* Signal lines from the hub to every running channel. */}
              {slots.map((s) => {
                const c = byKey.get(s.key);
                const paused = !!c?.paused;
                const lit = hot === s.key;
                const d = signalPath(s);
                return (
                  <g key={s.key} data-signal={s.key} data-paused={paused || undefined}>
                    <motion.path
                      d={d}
                      fill="none"
                      stroke={`url(#${svgId}-sig-${s.key})`}
                      strokeWidth={lit ? 2.5 : 1.5}
                      strokeLinecap="round"
                      strokeDasharray={paused ? "4 8" : undefined}
                      vectorEffect="non-scaling-stroke"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: paused ? 0.35 : lit ? 1 : 0.7 }}
                      transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                    {!paused ? (
                      <path
                        d={d}
                        fill="none"
                        stroke={FAMILY_ACCENT[s.line]}
                        strokeOpacity={lit ? 0.95 : 0.6}
                        strokeWidth={lit ? 2.5 : 1.75}
                        strokeLinecap="round"
                        strokeDasharray="2 15"
                        vectorEffect="non-scaling-stroke"
                        className={reduced ? undefined : "animate-signal"}
                      />
                    ) : null}
                  </g>
                );
              })}
            </svg>

            {/* Fit band captions on the upper axis, each just inside its ring. */}
            {FIT_RINGS.map((ring, i) => {
              const inner = i === 0 ? 0.2 : FIT_RINGS[i - 1]!.t;
              const y = HUB.y - RY * ((inner + ring.t) / 2);
              return (
                <span key={ring.band} aria-hidden className="t-label pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-chip bg-ink/70 px-1 text-white/45" style={{ left: "50%", top: pct(y, BOARD_H) }}>
                  {ring.band}
                </span>
              );
            })}

            {/* Family labels, one per corner. */}
            {families.map((g) => {
              const q = FAMILY_QUADRANT[g.line];
              const total = totals.get(g.line) ?? 0;
              return (
                <div key={g.line} aria-hidden className={cn("pointer-events-none absolute flex max-w-72 flex-col gap-0.5", CORNER_CLASS[q.corner])}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ backgroundColor: FAMILY_ACCENT[g.line] }} />
                    <span className="t-label" style={{ color: mix(FAMILY_ACCENT[g.line], 70, "var(--white)") }}>
                      {LINE_LABELS[g.line]}
                    </span>
                    <span className="text-small tabular-nums text-white/55">
                      {g.channels.length} of {total}
                    </span>
                  </span>
                  <span className="truncate text-small text-white/40">{LINE_HINTS[g.line]}</span>
                </div>
              );
            })}

            {/* Ghosts: where each channel that is not running would light up. Hovering one says what it is and how to
                start it; nothing opens while a token is being dragged over it. */}
            {ghosts.map((g) => (
              <Tooltip key={g.key} content={`${channelLabel(g.key)} · not running · drag it onto the board to start`} open={drag ? false : undefined}>
                <span
                  aria-hidden
                  data-ghost={g.key}
                  className="absolute -ml-4 -mt-4 grid size-8 place-items-center rounded-full border border-dashed"
                  data-target={drag?.moved && drag.key === g.key ? true : undefined}
                  style={
                    drag?.moved && drag.key === g.key
                      ? { left: `${g.left}%`, top: `${g.top}%`, borderStyle: "solid", borderColor: FAMILY_ACCENT[g.line], backgroundColor: mix(FAMILY_ACCENT[g.line], 22), color: "var(--white)" }
                      : { left: `${g.left}%`, top: `${g.top}%`, borderColor: mix(FAMILY_ACCENT[g.line], 38), backgroundColor: mix(FAMILY_ACCENT[g.line], 6), color: mix(FAMILY_ACCENT[g.line], 55) }
                  }
                >
                  <Icon icon={CHANNEL_ICONS[g.key]} size={14} />
                </span>
              </Tooltip>
            ))}

            {/* The hub: how many channels are running, in the brand colour, with a slow sweep. */}
            <div aria-hidden className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: "50%", top: pct(HUB.y, BOARD_H) }} data-hub>
              <div className="relative grid size-32 place-items-center">
                <div
                  className={cn("absolute inset-0 rounded-full", !reduced && "animate-orbit")}
                  style={{
                    background: `conic-gradient(from 0deg, transparent 0deg, ${mix(brand, 25, "var(--white)")} 80deg, transparent 160deg, transparent 360deg)`,
                    maskImage: "radial-gradient(closest-side, transparent 88%, black 90%, black 100%)",
                    opacity: 0.5,
                  }}
                />
                <div className="absolute inset-1 rounded-full border" style={{ borderColor: mix(brand, 45, "var(--line-subtle)") }} />
                <div
                  className="relative grid size-24 place-items-center rounded-full border"
                  style={{
                    borderColor: mix(brand, 70, "var(--white)"),
                    background: `radial-gradient(circle at 50% 35%, ${mix(brand, 85, "var(--white)")}, ${mix(brand, 60, "var(--bg-ink)")} 70%)`,
                  }}
                >
                  <span className="flex flex-col items-center leading-none">
                    <span className="t-display-lg tabular-nums text-kit-on-primary">{running}</span>
                    <span className="t-label mt-1 text-kit-on-primary/80">running</span>
                  </span>
                </div>
              </div>
            </div>
            {walkedOn && running === 0 ? (
              <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-small text-white/60" style={{ top: pct(HUB.y + 120, BOARD_H) }}>
                Drag a channel here to start it.
              </p>
            ) : null}

            {/* Running channels, grouped by family for assistive tech, placed on the map. */}
            {families.map((g) => (
              <div key={g.line} role="group" aria-label={`${g.label} channels: ${LINE_HINTS[g.line]}`} className="contents">
                {g.channels.map((c) => renderToken(c, "pitch", slotByKey.get(c.key)))}
              </div>
            ))}
          </div>

          <div data-drop-zone="bench" role="group" aria-label={`Off the board: ${benchLabel}`} className="surface-panel flex flex-col gap-3 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="t-label">{benchLabel}</p>
              <p className="text-small text-secondary">Off the board · drag one up to start it</p>
            </div>
            {tray.length === 0 ? (
              <p className="text-small text-secondary">Every channel is on the board.</p>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {CHANNEL_LINES.map((line) => {
                  const items = tray.filter((c) => channelLine(c.key) === line);
                  return (
                    <div key={line} className="flex min-w-0 flex-col gap-2 rounded-panel border border-subtle/60 bg-panel-alt/40 p-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: FAMILY_ACCENT[line] }} />
                        <span className="t-label">{LINE_LABELS[line]}</span>
                        <span className="text-small tabular-nums text-secondary">{items.length}</span>
                      </span>
                      {items.length ? <div className="flex flex-wrap gap-x-3 gap-y-3">{items.map((c) => renderToken(c, "bench"))}</div> : <p className="text-small text-secondary">All running.</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* The key under the board: fit is the defined word; the four bands are the rating ramp's own words (ScaleLabel). */}
          <p className="text-small text-secondary" data-board-key="">
            Rings mark the <Term id="fit">fit</Term> bands: {FIT_RINGS.map((r) => `${r.band} ${r.range}`).join(", ")}. A moving line is a running channel; a dashed one is paused.
          </p>
        </section>
      </LayoutGroup>
    </MotionConfig>
  );
}
