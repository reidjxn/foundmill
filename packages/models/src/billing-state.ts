/**
 * The platform key's billing state in this process (audit BILL-06, CML-07). When Anthropic refuses to bill a call on the
 * platform's key (no credit left, a spend limit reached) every later call fails the same way until the operator pays or
 * the month ends, so the live client records it here and the next call it does bill clears it. Services report it on
 * `/health` (`modelBilling`), next to the `alert: "model_billing"` error log, so the operator sees the cause without
 * reading every failed request. A business's own key never comes here: its account is the founder's to fund.
 */
import type { ModelBillingReason } from "./errors";

export interface PlatformBillingRefusal {
  reason: ModelBillingReason;
  /** First refusal since the platform key last billed a call. */
  since: string;
  lastAt: string;
  /** Route of the latest refused call. */
  route: string;
  /** Refusals since `since`. */
  count: number;
}

let current: PlatformBillingRefusal | null = null;

export function notePlatformBillingRefusal(reason: ModelBillingReason, route: string, at: Date = new Date()): void {
  const iso = at.toISOString();
  current = current ? { ...current, reason, route, lastAt: iso, count: current.count + 1 } : { reason, route, since: iso, lastAt: iso, count: 1 };
}

export function clearPlatformBillingRefusal(): void {
  current = null;
}

/** The refusal in force for the platform key in this process, or null when its last call was billed. */
export function platformBillingRefusal(): PlatformBillingRefusal | null {
  return current ? { ...current } : null;
}
