/**
 * An example business's paying customers and every charge they make, day by day. The Ribbon's paying customers, its
 * revenue and the payments its day card lists all come from here, so they agree with one another and with the
 * milestone cards beside the Ribbon.
 *
 * Customers: the running count passes through anchors (the `customer_N` milestone cards and the business's own
 * `counts`), the Nth customer paying on the anchor's own day, along a smooth monotone curve that the team's activity
 * (weekly rhythm, launches, the dip) and a little noise shape from day to day. Named payments (the milestone cards',
 * the Customer Update's and the business's large ones) each take a slot on their own day.
 *
 * Charges: a subscriber pays their plan's price every month until they cancel, and a customer on a yearly plan pays a
 * year up front and renews or not each year; a shopper's first order is a basket, some come back for more, and a store
 * reorders a share of its opening order every few weeks. Revenue on a day is every charge on that day: cash, as the
 * product's own Ribbon counts it.
 *
 * Pure and deterministic. Each customer draws from their own seeded stream (by their place in line), so moving a count
 * leaves every other customer's plan, renewals and reorders as they were.
 */
import { createRng, hashSeed, mulberry32, type Rng } from "@foundmill/dugout/lib/seed";
import type { GeneratedJourneyData } from "@foundmill/dugout/components/journey/fixtures";
import type { ExampleCustomers, ExampleOrderBilling, ExampleSubscriptionBilling, ExampleWeighted } from "./types";

type Conversion = GeneratedJourneyData["conversions"][number];

const DAY_MS = 86_400_000;

/** A first payment the ledger must place on its day, under its name and at its value. */
export interface LedgerNamedPayment {
  day: string;
  name: string;
  amountMinor: number;
  /** A yearly plan paid up front, or a store's opening order: billed as one. */
  large: boolean;
}

export interface LedgerInput {
  seed: string;
  currency: string;
  /** Every day from kick-off to today (YYYY-MM-DD, UTC calendar days), in order. */
  days: readonly string[];
  /** The team's activity per day (agent hours): the day-to-day shape of new customers, signups and activations. */
  activity: readonly number[];
  /** Cumulative paying customers at the end of a day; the last is today. */
  anchors: ReadonlyArray<{ day: string; count: number }>;
  named: readonly LedgerNamedPayment[];
  /** Names for everyone else, in turn. */
  names: readonly string[];
  funnel: ExampleCustomers["funnel"];
  billing: ExampleCustomers["billing"];
  /** The day the first reorder of all comes (the "First reorder" milestone); shoppers' reorders only. */
  firstReorderOn?: string;
}

export interface Ledger {
  /** Signups, activations and first payments, day by day (each kind in time order within its day). */
  conversions: Conversion[];
  /** First payments, in the order customers paid: the Nth customer is `payments[N - 1]`. */
  payments: Conversion[];
  signups: number[];
  activations: number[];
  /** New paying customers per day. */
  newCustomers: number[];
  /** Paying customers so far, at the end of each day. */
  customers: number[];
  /** Every charge per day: first payments, renewals, reorders. */
  revenueMinor: number[];
  /** The part of `revenueMinor` that is not a first payment (renewals, reorders, store reorders), and how many. */
  repeatMinor: number[];
  repeatCount: number[];
  /** Of those, stores' reorders (a business that sells goods). */
  storeMinor: number[];
  storeCount: number[];
  /** Monthly recurring revenue at the end of each day (subscriptions; yearly plans count a twelfth). Null for orders. */
  mrrMinor: number[] | null;
  /** The first day a customer paid again (a renewal or a reorder), if any. */
  firstRepeatDay: string | null;
}

/* ---------- Small pure helpers ---------- */

/** UUID-shaped ids from a seed and a counter: unique, deterministic and cheap to make by the ten thousand. */
function idMaker(seed: string): () => string {
  const prefix = hashSeed(seed).toString(16).padStart(8, "0");
  let k = 0;
  return () => `${prefix}-0000-4000-8000-${(k++).toString(16).padStart(12, "0")}`;
}

/** "07:05" for minute 425 of the day (made once per minute of the day). */
const CLOCK: string[] = [];
const clock = (minute: number) => (CLOCK[minute] ??= `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);

/**
 * The day (as an index from kick-off) `months` calendar months after day `i`, the day of the month kept where the
 * month has it (Jan 31 plus a month is Feb 28).
 */
function monthsLater(kickoffMs: number, i: number, months: number): number {
  const start = new Date(kickoffMs + i * DAY_MS);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const last = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  return Math.round((Date.UTC(y, m + months, Math.min(start.getUTCDate(), last)) - kickoffMs) / DAY_MS);
}

function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (rng.next() + rng.next() + rng.next() - 1.5) * 2));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

/** One customer's own stream of draws. */
type Draws = Pick<Rng, "next">;

function weighted(rng: Draws, items: readonly ExampleWeighted[]): number {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng.next() * total;
  for (const i of items) {
    r -= i.weight;
    if (r < 0) return i.minor;
  }
  return items[items.length - 1]!.minor;
}

/** Monotone cubic interpolation (Fritsch–Carlson): a smooth curve through the points that never runs backwards. */
function monotoneCurve(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0]!;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1]! - xs[i]!);
    delta.push((ys[i + 1]! - ys[i]!) / h[i]!);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = delta[i - 1]!;
    const b = delta[i]!;
    if (a <= 0 || b <= 0) continue;
    const w1 = 2 * h[i]! + h[i - 1]!;
    const w2 = h[i]! + 2 * h[i - 1]!;
    m[i] = (w1 + w2) / (w1 / a + w2 / b);
  }
  return (x) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / h[i]!;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h[i]! * m[i + 1]!;
  };
}

/* ---------- New customers per day ---------- */

/**
 * How many customers pay for the first time on each day: through every anchor exactly (the anchor's Nth customer on
 * its day), at least as many on a day as the named payments it carries, and otherwise along the smooth curve.
 */
function newCustomersPerDay(input: LedgerInput, rng: Rng): { perDay: number[]; rate: (i: number) => number; firstSale: number } {
  const { days, activity } = input;
  const n = days.length;
  const index = new Map(days.map((d, i) => [d, i]));
  const at = (day: string, what: string) => {
    const i = index.get(day);
    if (i === undefined) throw new Error(`${what} ${day} is outside the Journey (${days[0]} to ${days[n - 1]})`);
    return i;
  };
  const anchors = [...input.anchors].map((a) => ({ i: at(a.day, "Customer count on"), count: a.count })).sort((a, b) => a.i - b.i);
  if (anchors.at(-1)?.i !== n - 1) throw new Error(`The customer counts must end on today (${days[n - 1]})`);
  for (let k = 1; k < anchors.length; k++) if (anchors[k]!.count <= anchors[k - 1]!.count) throw new Error(`Customer counts must grow: ${days[anchors[k]!.i]} has ${anchors[k]!.count}`);
  const firstSale = anchors[0]!.i;
  // The smooth running count, zero the day before the first sale.
  const curve = monotoneCurve([firstSale - 1, ...anchors.map((a) => a.i)], [0, ...anchors.map((a) => a.count)]);
  const rate = (i: number) => Math.max(0, curve(i) - curve(i - 1));
  // Day-to-day shape: activity against its own 29-day average (weekly rhythm, launches, the dip), with noise.
  const shape = activity.map((a, i) => {
    let sum = 0;
    let w = 0;
    for (let j = Math.max(0, i - 14); j <= Math.min(n - 1, i + 14); j++) {
      sum += activity[j]!;
      w++;
    }
    return (sum > 0 ? a / (sum / w) : 1) * (0.45 + rng.next() * 1.1);
  });
  const cumulative: number[] = new Array(n).fill(0);
  let from = -1;
  let before = 0;
  for (const a of anchors) {
    const expected: number[] = [];
    let total = 0;
    for (let i = from + 1; i <= a.i; i++) {
      const e = (rate(i) + 1e-6) * shape[i]!;
      expected.push(e);
      total += e;
    }
    let running = 0;
    for (let i = from + 1; i <= a.i; i++) {
      running += expected[i - from - 1]!;
      cumulative[i] = i === a.i ? a.count : Math.min(a.count - 1, Math.round(before + ((a.count - before) * running) / total));
    }
    from = a.i;
    before = a.count;
  }
  const perDay = cumulative.map((c, i) => c - (i > 0 ? cumulative[i - 1]! : 0));
  // A named payment needs a customer on its day: borrow one from the nearest day of the same stretch between anchors.
  const need = new Map<number, number>();
  for (const p of input.named) {
    const i = at(p.day, `${p.name}'s payment on`);
    need.set(i, (need.get(i) ?? 0) + 1);
  }
  const anchorDays = new Set(anchors.map((a) => a.i));
  for (const [day, wanted] of need) {
    const k = anchors.findIndex((a) => a.i >= day);
    const lo = k > 0 ? anchors[k - 1]!.i + 1 : 0;
    const hi = anchors[k]!.i;
    const spare = (i: number) => perDay[i]! - (need.get(i) ?? 0) - (anchorDays.has(i) ? 1 : 0);
    for (let gap = 1; perDay[day]! < wanted; gap++) {
      if (day - gap < lo && day + gap > hi) throw new Error(`No customer to move to ${days[day]}: add a customer count there`);
      for (const i of [day - gap, day + gap]) {
        if (i < lo || i > hi || perDay[day]! >= wanted || spare(i) <= 0) continue;
        perDay[i]! -= 1;
        perDay[day]! += 1;
      }
    }
  }
  return { perDay, rate, firstSale };
}

/* ---------- Charges after the first payment ---------- */

interface Charges {
  add(dayIndex: number, amountMinor: number, store?: boolean): void;
  mrr(fromIndex: number, toIndex: number, monthlyMinor: number): void;
}

function subscriptionCharges(billing: ExampleSubscriptionBilling, n: number, kickoffMs: number, i: number, amountMinor: number, large: boolean, rng: Draws, charges: Charges) {
  const months = large ? 12 : 1;
  // Paid periods: one, then each renewal while the customer stays.
  let periods = 1;
  const stays = large ? (billing.yearlyRenewal ?? 1 - billing.monthlyChurn) : 1 - billing.monthlyChurn;
  while (rng.next() < stays && periods < 200) periods++;
  for (let k = 1; k < periods; k++) {
    const at = monthsLater(kickoffMs, i, k * months);
    if (at >= n) break;
    charges.add(at, amountMinor);
  }
  charges.mrr(i, Math.min(n, monthsLater(kickoffMs, i, periods * months)), large ? amountMinor / 12 : amountMinor);
}

function orderCharges(billing: ExampleOrderBilling, n: number, keepFrom: number, i: number, amountMinor: number, large: boolean, rng: Draws, charges: Charges, firstGap: number | null) {
  if (large) {
    // A store reorders a share of its opening order every few weeks.
    const [d0, d1] = billing.storeReorders.days;
    const [s0, s1] = billing.storeReorders.share;
    for (let at = i + d0 + Math.floor(rng.next() * (d1 - d0 + 1)); at < n; at += d0 + Math.floor(rng.next() * (d1 - d0 + 1))) {
      charges.add(at, Math.round(amountMinor * (s0 + rng.next() * (s1 - s0))), true);
    }
    return;
  }
  const r = billing.reorders;
  if (firstGap === null && rng.next() >= r.share) return;
  let at = i + (firstGap ?? r.days[0] + Math.floor(rng.next() * (r.days[1] - r.days[0] + 1)));
  while (at < n) {
    charges.add(at, weighted(rng, r.baskets));
    const keep = keepFrom >= 0 && at >= keepFrom ? r.keepFrom!.keep : r.keep;
    if (rng.next() >= keep) break;
    at += r.days[0] + Math.floor(rng.next() * (r.days[1] - r.days[0] + 1));
  }
}

/* ---------- The ledger ---------- */

export function buildLedger(input: LedgerInput): Ledger {
  const { days, billing, funnel } = input;
  const n = days.length;
  const shapeRng = createRng(`${input.seed}:shape`);
  const { perDay, rate, firstSale } = newCustomersPerDay(input, shapeRng);

  const revenueMinor: number[] = new Array(n).fill(0);
  const repeatMinor: number[] = new Array(n).fill(0);
  const repeatCount: number[] = new Array(n).fill(0);
  const storeMinor: number[] = new Array(n).fill(0);
  const storeCount: number[] = new Array(n).fill(0);
  const mrrDelta: number[] = new Array(n + 1).fill(0);
  let firstRepeat = Infinity;
  const charges: Charges = {
    add(at, amount, store) {
      revenueMinor[at]! += amount;
      repeatMinor[at]! += amount;
      repeatCount[at]! += 1;
      if (store) {
        storeMinor[at]! += amount;
        storeCount[at]! += 1;
      }
      if (at < firstRepeat) firstRepeat = at;
    },
    mrr(fromIndex, toIndex, monthly) {
      mrrDelta[fromIndex]! += monthly;
      mrrDelta[Math.min(n, Math.max(fromIndex, toIndex))]! -= monthly;
    },
  };

  // Named payments by day, placed in the last slots of their day (the Nth customer of a `customer_N` card is the last).
  const namedByDay = new Map<string, LedgerNamedPayment[]>();
  for (const p of input.named) namedByDay.set(p.day, [...(namedByDay.get(p.day) ?? []), p]);
  const kickoffMs = Date.parse(`${days[0]}T00:00:00.000Z`);
  const firstReorder = input.firstReorderOn ? days.indexOf(input.firstReorderOn) : -1;
  const keepFrom = billing.kind === "orders" && billing.reorders.keepFrom ? days.indexOf(billing.reorders.keepFrom.day) : -1;

  const nextId = idMaker(`${input.seed}:conversion`);
  const nextEntity = idMaker(`${input.seed}:entity`);
  const timeRng = createRng(`${input.seed}:times`);
  const funnelRng = createRng(`${input.seed}:funnel`);
  const conversions: Conversion[] = [];
  const payments: Conversion[] = [];
  const signups: number[] = new Array(n).fill(0);
  const activations: number[] = new Array(n).fill(0);
  const customers: number[] = new Array(n).fill(0);
  let nameTurn = 0;
  let priceTurn = 0;
  let count = 0;
  const nextName = () => input.names[nameTurn++ % input.names.length]!;
  const conversion = (day: string, kind: Conversion["kind"], name: string, amountMinor: number, minute: number): Conversion => ({
    id: nextId(),
    entityId: nextEntity(),
    entityName: name,
    kind,
    amountMinor,
    currency: input.currency,
    occurredAt: `${day}T${clock(minute)}:00.000Z`,
    firstPayment: kind === "payment",
  });
  const minutes = (k: number) => Array.from({ length: k }, () => 7 * 60 + Math.floor(timeRng.next() * 13 * 60)).sort((a, b) => a - b);

  // Signups and activations run ahead of payments by the funnel's lead (from launch day, before the first sale too).
  const ahead = (i: number, lead: number) => rate(Math.min(n - 1, Math.max(firstSale + 1, i + lead)));
  for (let i = 0; i < n; i++) {
    const day = days[i]!;
    const wave = input.activity[i]! / Math.max(1e-9, input.activity.slice(Math.max(0, i - 14), i + 15).reduce((s, a, _, arr) => s + a / arr.length, 0));
    signups[i] = poisson(funnelRng, funnel.signups * ahead(i, funnel.leadDays) * wave);
    activations[i] = poisson(funnelRng, funnel.activations * ahead(i, Math.round(funnel.leadDays / 2)) * wave);
    for (const m of minutes(signups[i]!)) conversions.push(conversion(day, "signup", nextName(), 0, m));
    for (const m of minutes(activations[i]!)) conversions.push(conversion(day, "activation", nextName(), 0, m));

    const named = namedByDay.get(day) ?? [];
    const slots = minutes(perDay[i]!);
    slots.forEach((minute, slot) => {
      const own = named[slot - (slots.length - named.length)];
      const index = count++;
      const rng: Draws = { next: mulberry32(hashSeed(`${input.seed}:customer:${index}`)) };
      let amountMinor: number;
      let large = false;
      if (own) {
        amountMinor = own.amountMinor;
        large = own.large;
      } else if (billing.kind === "subscription") {
        amountMinor = billing.monthlyMinor[priceTurn++ % billing.monthlyMinor.length]!;
      } else {
        amountMinor = weighted(rng, billing.firstOrders);
      }
      const paid = conversion(day, "payment", own?.name ?? nextName(), amountMinor, minute);
      conversions.push(paid);
      payments.push(paid);
      revenueMinor[i]! += amountMinor;
      if (billing.kind === "subscription") subscriptionCharges(billing, n, kickoffMs, i, amountMinor, large, rng, charges);
      else orderCharges(billing, n, keepFrom, i, amountMinor, large, rng, charges, index === 0 && firstReorder > i ? firstReorder - i : null);
    });
    customers[i] = count;
  }

  let mrr = 0;
  const mrrMinor = billing.kind === "subscription" ? mrrDelta.slice(0, n).map((d) => Math.round((mrr += d))) : null;
  return {
    conversions,
    payments,
    signups,
    activations,
    newCustomers: perDay,
    customers,
    revenueMinor,
    repeatMinor,
    repeatCount,
    storeMinor,
    storeCount,
    mrrMinor,
    firstRepeatDay: Number.isFinite(firstRepeat) ? days[firstRepeat]! : null,
  };
}
