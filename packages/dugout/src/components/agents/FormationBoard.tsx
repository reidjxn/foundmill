import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import { CHANNEL_LINES, type ChannelKey } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { darkenHex } from "../../lib/colour";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { ChannelProfileCard } from "./ChannelProfileCard";
import { ChannelToken } from "./ChannelToken";
import { LINE_HINTS, LINE_LABELS, benchChannels, channelLabel, dropZoneAt, entranceOrder, pitchLines, type DropZone } from "./formation";
import type { ChannelTokenData } from "./types";

export const ENTRANCE_STAGGER_MS = 160;
export const ENTRANCE_DELAY_MS = 400;
const DRAG_THRESHOLD = 4;

export interface FormationBoardProps {
  channels: readonly ChannelTokenData[];
  /** Drag or Enter moves a channel between pitch and bench; the app enables/disables the engine and re-scores. */
  onToggle: (key: ChannelKey, enabled: boolean) => void;
  /** Click (or O) opens the channel profile screen. */
  onOpenChannel?: (key: ChannelKey) => void;
  onPause?: (key: ChannelKey, paused: boolean) => void;
  /** Kit colours as hex; the pitch is kit-primary darkened 35 % (DESIGN §8). Without it, a CSS mix of the kit variable. */
  kit?: { primary: string; secondary?: string };
  /** Recommended tokens walk onto the pitch after mount (default true; instant under reduced motion). */
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

/**
 * The Formation Board (BUILD §11.7, DESIGN §8): a 16:10 pitch in kit colours with four labelled lines, 56 px channel
 * tokens, the bench rail ("All 15 channels are available"), pointer drag between pitch and bench with a keyboard
 * alternative (focus a token, Enter toggles, O opens), and an entrance where recommended tokens walk onto the pitch.
 */
export function FormationBoard({ channels, onToggle, onOpenChannel, onPause, kit, animateEntrance = true, benchLabel = "All 15 channels are available", hoverCards = true, className }: FormationBoardProps) {
  const reduced = usePrefersReducedMotion();
  const hintId = useId();
  const liveId = useId();
  const animate = animateEntrance && !reduced;
  const [entered, setEntered] = useState<Set<ChannelKey>>(() => (animate ? new Set() : new Set(channels.filter((c) => c.enabled).map((c) => c.key))));
  const [walkedOn, setWalkedOn] = useState(!animate);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState("");
  const dragRef = useRef<DragState | null>(null);
  const order = useMemo(() => entranceOrder(channels), [channels]);

  // Entrance: after a short beat, tokens join the pitch one by one; anything enabled later is on the pitch at once.
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
  const lines = useMemo(() => pitchLines(effective), [effective]);
  const bench = useMemo(() => benchChannels(effective), [effective]);

  const toggle = useCallback(
    (key: ChannelKey, enabled: boolean) => {
      onToggle(key, enabled);
      setAnnounce(`${channelLabel(key)} moved to the ${enabled ? "pitch" : "bench"}.`);
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
    } else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      onOpenChannel?.(channel.key);
    }
  };

  const pitchColour = kit ? darkenHex(kit.primary, 0.35) : "color-mix(in srgb, var(--kit-primary) 65%, var(--bg-ink))";
  const pitchStyle: CSSProperties = {
    backgroundColor: pitchColour,
    backgroundImage: "repeating-linear-gradient(0deg, transparent 0 12.5%, color-mix(in srgb, var(--white) 4%, transparent) 12.5% 25%)",
  };

  const renderToken = (channel: ChannelTokenData, zone: DropZone) => {
    const dragging = drag?.key === channel.key && drag.moved;
    const style: CSSProperties | undefined = dragging ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)`, zIndex: 30, position: "relative" } : undefined;
    const token = (
      <ChannelToken
        channel={channel}
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
        transition={{ type: "spring", stiffness: 260, damping: 28, opacity: { duration: 0.32 } }}
        style={style}
        data-zone={zone}
        className="touch-none"
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
        <section aria-label="Formation Board" className={cn("flex min-w-0 flex-col gap-2", className)} data-formation-board data-walked-on={walkedOn || undefined}>
          <p id={hintId} className="sr-only">
            Drag a channel between the pitch and the bench, or focus it and press Enter to move it. Press O to open the channel.
          </p>
          <p id={liveId} aria-live="polite" className="sr-only">
            {announce}
          </p>
          <div data-drop-zone="pitch" role="group" aria-label="Pitch: starting channels" className="relative aspect-[16/10] w-full select-none overflow-hidden rounded-panel border border-subtle" style={pitchStyle}>
            {/* Line markings: white at 30 % */}
            <div aria-hidden className="pointer-events-none absolute inset-3 rounded-sm border border-white/30" />
            <div aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-white/30" />
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30" />
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-3 h-[14%] w-[36%] -translate-x-1/2 border border-t-0 border-white/30" />
            <div aria-hidden className="pointer-events-none absolute bottom-3 left-1/2 h-[14%] w-[36%] -translate-x-1/2 border border-b-0 border-white/30" />
            <div className="absolute inset-0 grid grid-rows-4">
              {lines.map((group) => (
                <div key={group.line} role="group" aria-label={`${group.label} line: ${LINE_HINTS[group.line]}`} className="relative flex items-center">
                  <span className="t-label pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-white/70" aria-hidden>
                    {LINE_LABELS[group.line]}
                  </span>
                  <div className="flex w-full items-center justify-evenly px-24">{group.channels.map((c) => renderToken(c, "pitch"))}</div>
                </div>
              ))}
            </div>
          </div>
          <div data-drop-zone="bench" role="group" aria-label={`Bench: ${benchLabel}`} className="surface-panel flex min-h-28 flex-col gap-2 p-3">
            <p className="t-label">{benchLabel}</p>
            <div className="flex flex-wrap gap-3">{bench.map((c) => renderToken(c, "bench"))}</div>
            {bench.length === 0 ? <p className="text-small text-secondary">Every channel is on the pitch.</p> : null}
          </div>
          <p className="text-small text-secondary">
            {CHANNEL_LINES.map((l) => `${LINE_LABELS[l]}: ${LINE_HINTS[l].toLowerCase()}`).join(" · ")}
          </p>
        </section>
      </LayoutGroup>
    </MotionConfig>
  );
}
