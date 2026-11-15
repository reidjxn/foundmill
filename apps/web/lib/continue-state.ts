/**
 * Continue button state (BUILD §5.4, AC-11.3.3), computed from `inbox.list` (blocking items → "Respond · N"),
 * the current holiday (`business.get`), unviewed wins (customer_won items) and `cycle.status` (processing).
 * The API's `cycle.continueState` applies the same rules server-side; the shell computes it locally so the
 * button follows the stream and optimistic updates without a round trip.
 *
 * Priority: holiday › a hard stop › processing › idle.
 * - Holiday first: on holiday the only action is "Come back" (the Chief of Staff runs cycles).
 * - Only a hard stop blocks (credits used up, a revoked key; 0071): a decision waits in Needs you without stopping the team.
 * - A won customer is good news in the Inbox; since Nov 7, 2026 it no longer turns Continue into "Go to Journey".
 * - Processing lasts the whole run one press starts (Nov 7, 2026): between cycles too, the button keeps Pause.
 */
import type { ContinueState } from "@foundmill/dugout";
import { vacationUntilLabel, type InboxItemType, type InboxState } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";

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
  /**
   * From `cycle.status` (kept current by the stream); a paused cycle shows Continue again (it resumes). `run`: a run is
   * open, so new cycles start on their own (processing between cycles too).
   */
  cycle?: { running: boolean; paused?: boolean; run?: boolean } | null;
}

export function unviewedWin(items: readonly ContinueInboxItem[] | undefined): ContinueInboxItem | undefined {
  return items?.find((i) => i.type === "customer_won" && i.state === "unread");
}

export function firstBlockingItem(items: readonly ContinueInboxItem[] | undefined): ContinueInboxItem | undefined {
  return items?.find((i) => i.blocksContinue && (i.state === "unread" || i.state === "read"));
}

/**
 * Where "Respond · N" goes: the Inbox's Respond tab, open on the first red item when the inbox page is loaded (the
 * tooltip says "Press to open the first"; the tab shows the rest). The shell can show the count from business.get
 * before inbox.list has answered, so without the list it still lands on the tab that holds the waiting notes (B1).
 */
export function respondHref(businessId: string, items: readonly ContinueInboxItem[] | undefined): string {
  const first = firstBlockingItem(items);
  return `${routes.inbox(businessId, first?.id)}?tab=respond`;
}

/**
 * What a vacation lasts until, as words that follow "until" ("you return", "MRR hits 10k"): the top bar puts "until" in
 * front, so a stored "until I return" or a typed "until the launch ships" must not say it twice (audit VOL-X2).
 */
export function untilWords(text: string | null | undefined): string {
  const t = (text ?? "").trim().replace(/^until\s+/i, "");
  return !t || /^i return$/i.test(t) ? "you return" : t;
}

function holidayUntilLabel(h: NonNullable<ContinueInputs["holiday"]>): string | undefined {
  if (h.untilAt) return undefined;
  // The bar adds "until" itself, so the founder's sentence loses its own ("Until until I return", audit VOL-X2).
  return vacationUntilLabel(typeof h.untilCondition === "string" ? h.untilCondition : h.untilCondition?.text);
}

/**
 * The "While you were away" note a finished vacation wrote (`holiday.ended` from the orchestrator carries its id; the
 * API's own `holiday.ended`, sent the moment the founder comes back, carries none yet). Null for anything else.
 */
export function awayReportId(event: { type: string; payload?: Record<string, unknown> | null }): string | null {
  if (event.type !== "holiday.ended") return null;
  const id = event.payload?.reportInboxItemId;
  return typeof id === "string" && id ? id : null;
}

/** Where "Go to Journey" goes: the won customer's Customer Update when the server named its journey, else its note. */
export function journeyHref(businessId: string, state: { kind: string; journeyId?: string | null; itemId?: string | null } | null | undefined, fallbackItemId?: string | null): string {
  if (state?.kind === "matchday" && state.journeyId) return routes.journey(businessId, state.journeyId);
  const itemId = (state?.kind === "matchday" ? state.itemId : null) ?? fallbackItemId ?? null;
  return itemId ? routes.inbox(businessId, itemId) : routes.inbox(businessId);
}

export function computeContinueState(input: ContinueInputs): ContinueState {
  if (input.holiday) return { kind: "holiday", until: input.holiday.untilAt ?? null, untilLabel: holidayUntilLabel(input.holiday) };
  if (input.blocking > 0) return { kind: "blocked", count: input.blocking };
  const cycle = input.cycle;
  if (!cycle || (cycle.running && cycle.paused)) return { kind: "idle" };
  if (cycle.run) return { kind: "processing", run: true };
  if (cycle.running) return { kind: "processing" };
  return { kind: "idle" };
}
