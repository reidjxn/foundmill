/**
 * Continue button state (BUILD §5.4, AC-11.3.3), computed from `inbox.list` (blocking items → "Respond · N"),
 * the current holiday (`business.get`), unviewed wins (customer_won items) and the cycle status (processing).
 *
 * Priority: holiday › blocked › matchday › processing › idle.
 * - Holiday first: on holiday the only action is "Come back" (the Chief of Staff runs cycles).
 * - Blocked beats everything else: Continue is disabled until red items are answered (AC-11.3.3).
 * - A won customer waits for its Customer Update ("Go to Journey") before the next cycle.
 */
import type { ContinueState } from "@foundmill/dugout";
import type { InboxItemType, InboxState } from "@foundmill/shared";

export interface ContinueInboxItem {
  id: string;
  type: InboxItemType;
  state: InboxState;
  blocksContinue: boolean;
}

export interface ContinueInputs {
  /** `blocking` from inbox.list (count of unanswered blocking items). */
  blocking: number;
  /** First page of inbox items; used for the Customer Update rule and "jump to first red item". */
  items?: readonly ContinueInboxItem[];
  holiday?: { untilAt?: Date | string | null; untilCondition?: { text?: string } | string | null } | null;
  cycle?: { running: boolean } | null;
}

export function unviewedWin(items: readonly ContinueInboxItem[] | undefined): ContinueInboxItem | undefined {
  return items?.find((i) => i.type === "customer_won" && i.state === "unread");
}

export function firstBlockingItem(items: readonly ContinueInboxItem[] | undefined): ContinueInboxItem | undefined {
  return items?.find((i) => i.blocksContinue && (i.state === "unread" || i.state === "read"));
}

function holidayUntilLabel(h: NonNullable<ContinueInputs["holiday"]>): string | undefined {
  if (h.untilAt) return undefined;
  if (typeof h.untilCondition === "string") return h.untilCondition;
  return h.untilCondition?.text ?? "until I return";
}

export function computeContinueState(input: ContinueInputs): ContinueState {
  if (input.holiday) return { kind: "holiday", until: input.holiday.untilAt ?? null, untilLabel: holidayUntilLabel(input.holiday) };
  if (input.blocking > 0) return { kind: "blocked", count: input.blocking };
  if (unviewedWin(input.items)) return { kind: "matchday" };
  if (input.cycle?.running) return { kind: "processing" };
  return { kind: "idle" };
}
