import { useEffect, useMemo, useRef } from "react";
import { FileCode2, Flag, FlaskConical, Hourglass, Megaphone, Pause, Play, SkipBack, SkipForward, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Button } from "../foundation/Button";
import { Icon, type IconComponent } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Slider } from "../foundation/Slider";
import { Tooltip } from "../foundation/Tooltip";
import type { AgentSessionEvent } from "./types";

export const SCRUBBER_SPEEDS = [1, 2, 4, 8] as const;
export type ScrubberSpeed = (typeof SCRUBBER_SPEEDS)[number];

export interface ScrubberMarker {
  /** ms since the session start. */
  at: number;
  kind: "phase" | "tests_pass" | "tests_fail" | "shout" | "approval" | "file" | "error";
  label: string;
}

const MARKER: Record<ScrubberMarker["kind"], { icon: IconComponent; className: string; word: string }> = {
  phase: { icon: Flag, className: "text-status-info", word: "Phase" },
  tests_pass: { icon: FlaskConical, className: "text-status-good", word: "Tests passed" },
  tests_fail: { icon: FlaskConical, className: "text-status-bad", word: "Tests failed" },
  shout: { icon: Megaphone, className: "text-kit-primary", word: "Shout" },
  approval: { icon: Hourglass, className: "text-status-warn", word: "Approval" },
  file: { icon: FileCode2, className: "text-secondary", word: "File" },
  error: { icon: TriangleAlert, className: "text-status-bad", word: "Error" },
};

/** The events worth a tick on the timeline (stdout and progress are too frequent). */
export function scrubberMarkers(events: readonly AgentSessionEvent[], startedAt: string): ScrubberMarker[] {
  const start = Date.parse(startedAt);
  const out: ScrubberMarker[] = [];
  for (const e of events) {
    const at = Math.max(0, Date.parse(e.at) - start);
    switch (e.kind) {
      case "phase_changed":
        out.push({ at, kind: "phase", label: `Phase: ${e.to}` });
        break;
      case "test_result":
        out.push({ at, kind: e.failed > 0 ? "tests_fail" : "tests_pass", label: `${e.suite || "Tests"}: ${e.passed} passed, ${e.failed} failed` });
        break;
      case "note":
        if (e.source === "shout") out.push({ at, kind: "shout", label: `Shout: ${e.text}` });
        else if (e.level === "error") out.push({ at, kind: "error", label: e.text });
        break;
      case "tool_call":
        if (e.status === "awaiting_approval") out.push({ at, kind: "approval", label: `Awaiting approval: ${e.tool}` });
        break;
      case "file_changed":
        out.push({ at, kind: "file", label: `${e.change}: ${e.path}` });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Session length in ms: ended time, else the last event, else now. */
export function sessionLengthMs(events: readonly AgentSessionEvent[], startedAt: string, endedAt?: string | null, now: Date | number = Date.now()): number {
  const start = Date.parse(startedAt);
  if (endedAt) return Math.max(0, Date.parse(endedAt) - start);
  const last = events.length ? Date.parse(events[events.length - 1]!.at) : start;
  const n = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.max(last, n) - start);
}

export function nextMarkerPosition(markers: readonly ScrubberMarker[], position: number): number | null {
  const m = markers.find((x) => x.at > position + 1);
  return m ? m.at : null;
}

export function prevMarkerPosition(markers: readonly ScrubberMarker[], position: number): number | null {
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i]!;
    if (m.at < position - 1) return m.at;
  }
  return null;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface SessionScrubberProps {
  events: readonly AgentSessionEvent[];
  startedAt: string;
  endedAt?: string | null;
  /** ms since start. */
  position: number;
  onPositionChange: (position: number) => void;
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  speed?: ScrubberSpeed;
  onSpeedChange?: (speed: ScrubberSpeed) => void;
  /** Live sessions: the end of the track moves with `now`. */
  now?: Date;
  /** Playback tick in ms (default 250; tests use fake timers). */
  tickMs?: number;
  label?: string;
  className?: string;
}

/**
 * Replay timeline for a session (BUILD §11.6): play / pause, step to the previous or next event (also `,` and `.`),
 * a slider over the session with event markers (phases, tests, shouts, approvals, files, errors), and a speed menu.
 * Playback advances `position` through `onPositionChange` so the tile can re-reduce the stream.
 */
export function SessionScrubber({ events, startedAt, endedAt, position, onPositionChange, playing = false, onPlayingChange, speed = 1, onSpeedChange, now, tickMs = 250, label = "Session replay", className }: SessionScrubberProps) {
  const length = sessionLengthMs(events, startedAt, endedAt, now ?? Date.now());
  const markers = useMemo(() => scrubberMarkers(events, startedAt), [events, startedAt]);
  const posRef = useRef(position);
  posRef.current = position;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = posRef.current + tickMs * speed;
      if (next >= length) {
        onPositionChange(length);
        onPlayingChange?.(false);
      } else onPositionChange(next);
    }, tickMs);
    return () => clearInterval(id);
  }, [playing, speed, tickMs, length, onPositionChange, onPlayingChange]);

  const step = (dir: -1 | 1) => {
    const target = dir > 0 ? nextMarkerPosition(markers, position) : prevMarkerPosition(markers, position);
    onPositionChange(target ?? (dir > 0 ? length : 0));
  };

  const clamped = Math.max(0, Math.min(length, position));

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex h-10 items-center gap-2 border-t border-subtle bg-panel px-2", className)}
      data-playing={playing || undefined}
      onKeyDown={(e) => {
        if (e.key === ",") {
          e.preventDefault();
          step(-1);
        } else if (e.key === ".") {
          e.preventDefault();
          step(1);
        }
      }}
    >
      <IconButton icon={SkipBack} label="Previous event" size="sm" onClick={() => step(-1)} />
      <IconButton icon={playing ? Pause : Play} label={playing ? "Pause replay" : "Play replay"} size="sm" pressed={playing} onClick={() => onPlayingChange?.(!playing)} disabled={!onPlayingChange} />
      <IconButton icon={SkipForward} label="Next event" size="sm" onClick={() => step(1)} />
      <span className="w-24 shrink-0 font-mono text-mono text-secondary tabular-nums" aria-live="off">
        {formatClock(clamped)} / {formatClock(length)}
      </span>
      <div className="relative min-w-0 flex-1 py-3">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-3">
          {markers.map((m, i) => {
            const meta = MARKER[m.kind];
            const left = length > 0 ? (m.at / length) * 100 : 0;
            return (
              <span key={`${m.at}-${i}`} className={cn("absolute -translate-x-1/2", meta.className)} style={{ left: `${left}%` }} data-marker={m.kind}>
                <Icon icon={meta.icon} size={10} strokeWidth={2.25} />
              </span>
            );
          })}
        </div>
        <Slider value={[clamped]} min={0} max={Math.max(1, length)} step={Math.max(1, Math.round(length / 500))} onValueChange={(v) => onPositionChange(v[0] ?? 0)} thumbLabels={["Replay position"]} aria-valuetext={formatClock(clamped)} />
        <ul className="sr-only" aria-label="Event markers">
          {markers.map((m, i) => (
            <li key={i}>
              {formatClock(m.at)} {MARKER[m.kind].word}: {m.label}
            </li>
          ))}
        </ul>
      </div>
      <Tooltip content={markers.length ? `${markers.length} events on the timeline` : "No events yet"}>
        <span className="shrink-0 text-small text-secondary tabular-nums" tabIndex={0}>
          {markers.length} marks
        </span>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 font-mono normal-case" aria-label={`Speed ${speed}×`} disabled={!onSpeedChange}>
            {speed}×
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-24">
          <DropdownMenuRadioGroup value={String(speed)} onValueChange={(v) => onSpeedChange?.(Number(v) as ScrubberSpeed)}>
            {SCRUBBER_SPEEDS.map((s) => (
              <DropdownMenuRadioItem key={s} value={String(s)}>
                {s}×
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
