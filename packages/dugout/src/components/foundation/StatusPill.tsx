import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Circle, CircleAlert, CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import type { AgentStatus } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";
import { FitText } from "./FitText";
import { hasFixedHeight } from "./Chip";

export type StatusTone = "good" | "warn" | "bad" | "info" | "neutral";

/**
 * Each tone sets --tone (tone-*), which the fill, the ring and the pulse all read: a red pill pulses red, an amber pill
 * amber, never the brand (DESIGN §5).
 */
const TONE: Record<StatusTone, { icon: IconComponent; className: string; word: string }> = {
  good: { icon: CircleCheck, className: "tone-status-good text-status-good", word: "Good" },
  warn: { icon: TriangleAlert, className: "tone-status-warn text-status-warn", word: "Warning" },
  bad: { icon: CircleX, className: "tone-status-bad text-status-bad", word: "Failing" },
  info: { icon: Info, className: "tone-status-info text-status-info", word: "Info" },
  neutral: { icon: Circle, className: "tone-secondary text-secondary", word: "Idle" },
};

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** The word. Required in spirit: colour is never the only signal. Defaults to a generic word per tone. */
  children?: ReactNode;
  /** Override the tone's default icon. */
  icon?: IconComponent;
  /** One ring pulse in the pill's own tone for live states (processing). One-shot; off under reduced motion. */
  pulse?: boolean;
  /** Fit a tight slot: the word steps down to a floor, then truncates with a tooltip. By default the words wrap. */
  fit?: boolean;
}

/**
 * Icon + word, 22 px, fully round, sentence case: the tone's text on its 12 % fill with a 30 % ring (DESIGN §8). Never
 * truncated by default. Server-safe: the pulse is CSS.
 */
export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(function StatusPill({ tone, children, icon, pulse, fit, className, ...rest }, ref) {
  const t = TONE[tone];
  const word = children ?? t.word;
  return (
    <span
      ref={ref}
      data-tone={tone}
      data-pulse={pulse || undefined}
      className={cn(
        "chip-tone inline-flex max-w-full items-center gap-1 rounded-pill border py-px pl-1.5 pr-2 align-middle",
        !hasFixedHeight(className) && "min-h-chip",
        "font-body font-medium text-label",
        t.className,
        pulse && "animate-ring-pulse",
        className,
      )}
      {...rest}
    >
      <Icon icon={icon ?? t.icon} size="inline" />
      {fit ? <FitText>{word}</FitText> : <span className="min-w-0 break-words hyphens-auto">{word}</span>}
    </span>
  );
});

/** Map an agent status (shared vocabulary) to a pill tone and word. */
export function agentStatusTone(status: AgentStatus): { tone: StatusTone; word: string; icon?: IconComponent } {
  switch (status) {
    case "healthy":
      return { tone: "good", word: "Healthy" };
    case "degraded":
      return { tone: "warn", word: "Degraded" };
    case "failing":
      return { tone: "bad", word: "Failing" };
    case "injured":
      return { tone: "bad", word: "Down", icon: CircleAlert };
    case "paused":
      return { tone: "neutral", word: "Paused" };
    case "idle":
      return { tone: "neutral", word: "Idle" };
  }
}

export function AgentStatusPill({ status, className, fit }: { status: AgentStatus; className?: string; fit?: boolean }) {
  const { tone, word, icon } = agentStatusTone(status);
  return (
    <StatusPill tone={tone} icon={icon} className={className} fit={fit}>
      {word}
    </StatusPill>
  );
}
