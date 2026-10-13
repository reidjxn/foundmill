/**
 * Dugout's HolidayDialog settings → the API's `business.startHoliday` input. The dialog's wake-event keys are UI
 * vocabulary (docs/DECISIONS.md "Hard gates are locked in HolidayDialog"); the API wants platform event types.
 * `sign_contracts` is stripped here too (the API strips it again; hard gates never travel).
 */
import { endOfLocalDay, type HolidaySettings, type HolidayWakeEvent } from "@foundmill/dugout";
import type { EventType } from "@foundmill/shared";

export const WAKE_EVENT_TO_EVENT_TYPE: Record<HolidayWakeEvent, EventType | null> = {
  kill_switch: null, // the kill switch ends a holiday through business.endHoliday({ reason: "kill_switch" }), not an event
  credential_failure: "credential.expiring",
  legal_deadline: "filing.due",
  runway_warning: "runway.threshold_crossed",
  customer_won: "customer.converted",
  hard_gate_queued: "approval.requested",
  agent_failing: "agent.health_changed",
};

export interface StartHolidayInput {
  until: { kind: "date"; date: Date } | { kind: "condition"; condition: string } | { kind: "return" };
  authority: HolidaySettings["authority"];
  budgetCeilingMinor: number | null;
  currency: string;
  wakeEvents: EventType[];
}

export function toStartHolidayInput(settings: HolidaySettings, fallbackCurrency = "EUR"): StartHolidayInput {
  // The picked day lasts until it is over in the founder's own zone (not midnight UTC, which ends it the evening before).
  const until: StartHolidayInput["until"] = settings.until.kind === "date" ? { kind: "date", date: endOfLocalDay(settings.until.date) ?? new Date(settings.until.date) } : settings.until.kind === "condition" ? { kind: "condition", condition: settings.until.condition } : { kind: "return" };
  const wakeEvents = [...new Set(settings.wakeEvents.map((w) => WAKE_EVENT_TO_EVENT_TYPE[w]).filter((e): e is EventType => e !== null))];
  return {
    until,
    authority: settings.authority.filter((d) => d !== "sign_contracts"),
    budgetCeilingMinor: settings.budgetCeiling?.amountMinor ?? null,
    currency: settings.budgetCeiling?.currency ?? fallbackCurrency,
    wakeEvents,
  };
}
