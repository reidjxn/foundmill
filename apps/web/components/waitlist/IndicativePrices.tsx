/**
 * The slot for the indicative prices on the public waitlist page (WP-14 T15 step 1, T14 step 4). T14 owns the figures:
 * the two paired price sets live in its pricing config behind a switch that is off, half of visitors see each, and a
 * visitor keeps the set first given, stored with the waitlist entry. Until that config exists this renders nothing;
 * T14 fills this one component from its config and marks every figure "Indicative". No price is defined here.
 */
export function IndicativePrices() {
  return null;
}
