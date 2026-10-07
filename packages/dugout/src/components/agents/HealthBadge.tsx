import { Activity, HeartPulse, Repeat } from "lucide-react";
import type { AgentStatus } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { formatPercent, formatRelative } from "../../lib/format";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { AgentStatusPill } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import type { HealthDetails } from "./types";

export interface HealthBadgeProps {
  status: AgentStatus;
  details?: HealthDetails;
  now?: Date;
  /** Show the details inline instead of in a tooltip. */
  inline?: boolean;
  className?: string;
}

/** The sentence a founder needs next to the pill. */
export function healthSummary(status: AgentStatus, details: HealthDetails = {}, now: Date = new Date()): string {
  const parts: string[] = [];
  if (status === "injured") parts.push(details.expectedReturnAt ? `Expected back ${formatRelative(details.expectedReturnAt, now)}` : "Reconnect the integration to see an expected return");
  if (details.reason) parts.push(details.reason);
  if (details.loopDetected) parts.push("Loop detected on the last session");
  if (details.errorRate !== undefined && details.errorRate !== null) parts.push(`Error rate ${formatPercent(details.errorRate, { digits: 1 })} over 24 h`);
  if (details.lastHeartbeatAt) parts.push(`Last heartbeat ${formatRelative(details.lastHeartbeatAt, now)}`);
  return parts.join(" · ");
}

/** Health (BUILD §9.10, §11.9): the status pill plus heartbeat, error rate, loop flag and, when injured, the expected return. */
export function HealthBadge({ status, details = {}, now = new Date(), inline, className }: HealthBadgeProps) {
  const summary = healthSummary(status, details, now);
  const pill = (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-health={status}>
      <AgentStatusPill status={status} />
      {details.loopDetected ? (
        <Chip tone="warn" icon={Repeat}>
          Loop
        </Chip>
      ) : null}
      {status === "injured" && details.expectedReturnAt ? <span className="text-small text-secondary">back {formatRelative(details.expectedReturnAt, now)}</span> : null}
    </span>
  );
  if (inline) {
    return (
      <div className="flex flex-col gap-1">
        {pill}
        {summary ? (
          <p className="flex items-start gap-1 text-small text-secondary">
            <Icon icon={status === "healthy" ? HeartPulse : Activity} size="inline" className="mt-0.5" />
            {summary}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <Tooltip content={summary || undefined}>
      <span className="inline-flex" tabIndex={summary ? 0 : -1} aria-label={summary ? `${status}: ${summary}` : undefined}>
        {pill}
      </span>
    </Tooltip>
  );
}
