/** Process-local counters and gauges exposed at `GET /health` (BUILD §15 "webhook lag / event to tile"). */

export const COUNTER_NAMES = [
  "connections_total",
  "auth_failures_total",
  "frames_in_total",
  "bad_frames_total",
  "subscriptions_total",
  "subscriptions_denied_total",
  /** Live subscriptions closed by a re-check (a membership change, or the periodic one). */
  "subscriptions_revoked_total",
  "events_in_total",
  /** Business events a reader's section walls kept from them (dropped whole); redacted ones are still sent. */
  "events_walled_total",
  "frames_out_total",
  "batches_out_total",
  "events_dropped_total",
  "heartbeat_timeouts_total",
  /** Sockets closed because their token expired before the client sent a fresh one. */
  "tokens_expired_total",
  "slow_consumers_closed_total",
  "reader_reconnects_total",
  "reader_errors_total",
] as const;
export type CounterName = (typeof COUNTER_NAMES)[number];

export const GAUGE_NAMES = ["connections_open", "subscriptions_open", "readers_open", "queued_frames"] as const;
export type GaugeName = (typeof GAUGE_NAMES)[number];

export interface MetricsSnapshot {
  counters: Record<CounterName, number>;
  gauges: Record<GaugeName, number>;
}

export class Metrics {
  private readonly counters = Object.fromEntries(COUNTER_NAMES.map((n) => [n, 0])) as Record<CounterName, number>;
  private readonly gauges = Object.fromEntries(GAUGE_NAMES.map((n) => [n, 0])) as Record<GaugeName, number>;

  inc(name: CounterName, by = 1): void {
    this.counters[name] += by;
  }
  set(name: GaugeName, value: number): void {
    this.gauges[name] = value;
  }
  add(name: GaugeName, by: number): void {
    this.gauges[name] += by;
  }
  get(name: CounterName | GaugeName): number {
    return name in this.counters ? this.counters[name as CounterName] : this.gauges[name as GaugeName];
  }
  snapshot(): MetricsSnapshot {
    return { counters: { ...this.counters }, gauges: { ...this.gauges } };
  }
}
