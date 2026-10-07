import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Circle, CircleAlert, CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import type { AgentStatus } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export type StatusTone = "good" | "warn" | "bad" | "info" | "neutral";

const TONE: Record<StatusTone, { icon: IconComponent; className: string; word: string }> = {
  good: { icon: CircleCheck, className: "bg-status-good/12 text-status-good", word: "Good" },
  warn: { icon: TriangleAlert, className: "bg-status-warn/12 text-status-warn", word: "Warning" },
  bad: { icon: CircleX, className: "bg-status-bad/12 text-status-bad", word: "Failing" },
  info: { icon: Info, className: "bg-status-info/12 text-status-info", word: "Info" },
  neutral: { icon: Circle, className: "bg-secondary/12 text-secondary", word: "Idle" },
};

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** The word. Required in spirit: colour is never the only signal. Defaults to a generic word per tone. */
  children?: ReactNode;
  /** Override the tone's default icon. */
  icon?: IconComponent;
  /** Pulse ring for live states (processing). One-shot, respects reduced motion. */
  pulse?: boolean;
}

/** Icon + word, 20 px tall, 3 px radius, text in the status colour on a 12 % tint (DESIGN §5, BUILD §5.4). */
export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(function StatusPill({ tone, children, icon, pulse, className, ...rest }, ref) {
  const t = TONE[tone];
  return (
    <span
      ref={ref}
      data-tone={tone}
      className={cn(
        "inline-flex h-chip items-center gap-1 rounded-chip px-1.5 whitespace-nowrap align-middle",
        "font-display font-semibold text-label uppercase tracking-label",
        t.className,
        pulse && "animate-ring-pulse",
        className,
      )}
      {...rest}
    >
      <Icon icon={icon ?? t.icon} size={12} />
      <span>{children ?? t.word}</span>
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
      return { tone: "bad", word: "Injured", icon: CircleAlert };
    case "paused":
      return { tone: "neutral", word: "Paused" };
    case "idle":
      return { tone: "neutral", word: "Idle" };
  }
}

export function AgentStatusPill({ status, className }: { status: AgentStatus; className?: string }) {
  const { tone, word, icon } = agentStatusTone(status);
  return (
    <StatusPill tone={tone} icon={icon} className={className}>
      {word}
    </StatusPill>
  );
}
