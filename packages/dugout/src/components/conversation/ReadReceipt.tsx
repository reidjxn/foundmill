import type { HTMLAttributes } from "react";
import { Check, CheckCheck, CircleAlert, Clock3 } from "lucide-react";
import { cn } from "../../lib/cn";
import type { DateFormatPrefs } from "../../lib/date-preferences";
import { formatTime } from "../../lib/format";
import { Icon } from "../foundation/Icon";
import type { DeskMessageState } from "./types";

export type ReadReceiptState = DeskMessageState | "read";

/** The receipt's state: `read` once the agent has answered (a time is known), else the message's own state. */
export function receiptState(
  state: DeskMessageState | undefined,
  readAt: unknown,
): ReadReceiptState {
  if (state === "sending" || state === "failed") return state;
  return readAt !== undefined && readAt !== null && readAt !== "" ? "read" : "seen";
}

/** "Sending…", "Seen", "Read 2:02 PM" (on the person's clock: `prefs`), "Not sent". */
export function receiptWords(
  state: ReadReceiptState,
  readAt?: string | Date | number | null,
  prefs?: DateFormatPrefs | null,
): string {
  switch (state) {
    case "sending":
      return "Sending…";
    case "failed":
      return "Not sent";
    case "read":
      return readAt === undefined || readAt === null ? "Read" : `Read ${formatTime(readAt, prefs)}`;
    default:
      return "Seen";
  }
}

const ICON = { sending: Clock3, seen: Check, read: CheckCheck, failed: CircleAlert } as const;

export interface ReadReceiptProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The founder message's state. */
  state?: DeskMessageState;
  /** When the agent read it (the time of its answer). Turns "Seen" into "Read 2:02 PM". */
  readAt?: string | Date | number | null;
  /** The signed-in person's time format (Settings › Preferences): pass `useDateFormat()` from the caller. 12-hour without it. */
  datePrefs?: DateFormatPrefs | null;
}

/**
 * The read receipt under the founder's last bubble (DIRECTION #6): mono, text-3, an icon and a word, so the state is
 * never carried by colour alone. Server-safe.
 */
export function ReadReceipt({ state, readAt, datePrefs, className, ...rest }: ReadReceiptProps) {
  const s = receiptState(state, readAt);
  return (
    <span
      className={cn("desk-receipt", className)}
      data-state={s}
      data-testid="read-receipt"
      {...rest}
    >
      <Icon icon={ICON[s]} size={12} />
      <span suppressHydrationWarning>{receiptWords(s, readAt, datePrefs)}</span>
    </span>
  );
}
