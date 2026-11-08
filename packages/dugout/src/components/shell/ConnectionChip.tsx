import type { HTMLAttributes } from "react";
import { Clock, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";

/**
 * The live connection's trouble: trying to come back, or not coming back by itself for now; or, with Builder view off,
 * the one quiet word a long outage earns ("Updates may be late"), whichever of the two it is.
 */
export type ConnectionState = "reconnecting" | "paused" | "late";

export interface ConnectionChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  state: ConnectionState;
  /** The tooltip: what the founder sees meanwhile (e.g. how often screens refresh). A sensible default per state. */
  detail?: string;
}

const WORD: Record<ConnectionState, string> = { reconnecting: "Reconnecting…", paused: "Live updates paused", late: "Updates may be late" };
const ICON = { reconnecting: RefreshCw, paused: WifiOff, late: Clock } as const;
/** The defaults say that nothing is lost (UX plan §7.7): the team's work and notes are on the server; only this screen may lag. */
const DETAIL: Record<ConnectionState, string> = {
  reconnecting: "The live connection dropped. Nothing is lost. What you see may be out of date until it is back.",
  paused: "Live updates are paused. Nothing is lost. What you see may be out of date; screens still refresh on their own.",
  late: "Nothing is lost: the team keeps working. What you see may be a little behind; screens still refresh on their own.",
};

/**
 * Glass on the slab, in the warning ring: the live connection is down, so a screen may be stale (audit RES-11). Icon +
 * word, announced politely; nothing moves by itself. The app shows it only after a short grace, so a blip never flashes.
 */
export function ConnectionChip({ state, detail, className, ...rest }: ConnectionChipProps) {
  return (
    <Tooltip content={detail ?? DETAIL[state]}>
      <span role="status" aria-live="polite" aria-label={WORD[state]} data-connection={state} data-chip="" data-testid="connection-chip" className={cn("kitbar-glass", className)} {...rest}>
        <Icon icon={ICON[state]} size="inline" />
        <span className="kitbar-chip-word">{WORD[state]}</span>
      </span>
    </Tooltip>
  );
}
