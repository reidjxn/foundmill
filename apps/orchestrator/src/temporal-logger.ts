/**
 * The Temporal SDK's own log lines (worker state, the workflow bundle, activity failures) through the orchestrator's
 * pino logger. The SDK's default logger writes every level to stderr, which Railway files as errors: each boot showed
 * about twenty "errors" that were INFO lines, while the app's real warnings showed as info (PH-3). Installed once per
 * process, before the first connection, by `installTemporalRuntime`.
 */
import { Runtime, type LogLevel, type LogMetadata, type Logger as TemporalLogger } from "@temporalio/worker";
import type { Logger } from "@foundmill/shared/logger";

type PinoMethod = "trace" | "debug" | "info" | "warn" | "error";

const METHOD: Record<LogLevel, PinoMethod> = { TRACE: "trace", DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error" };

export function temporalLogger(log: Pick<Logger, PinoMethod>): TemporalLogger {
  const write = (level: LogLevel) => (message: string, meta?: LogMetadata) => {
    log[METHOD[level] ?? "info"]({ temporal: true, ...(meta ?? {}) }, message);
  };
  return { log: (level, message, meta) => write(level)(message, meta), trace: write("TRACE"), debug: write("DEBUG"), info: write("INFO"), warn: write("WARN"), error: write("ERROR") };
}

export interface TemporalRuntimeOptions {
  /** OTLP endpoint for the SDK's metrics (worker slots, schedule-to-start latency, failures); unset exports nothing. */
  otlpEndpoint?: string | null;
  /** OTLP headers (`OTEL_EXPORTER_OTLP_HEADERS`, `key=value,…`), e.g. Grafana Cloud's Authorization. */
  otlpHeaders?: Record<string, string>;
  serviceName?: string;
}

/**
 * Install the process's Temporal Runtime: logs through pino; no signal handling of its own (the orchestrator's SIGTERM
 * handler stops polling, hands sessions off and then shuts the workers down, docs/DEPLOY.md §3); and, when an OTLP
 * endpoint is set, the SDK's metrics exported over OTLP/HTTP for the dashboards (BUILD §15).
 */
export function installTemporalRuntime(log: Pick<Logger, PinoMethod>, options: TemporalRuntimeOptions = {}): Runtime {
  const endpoint = options.otlpEndpoint?.replace(/\/+$/, "");
  return Runtime.install({
    logger: temporalLogger(log),
    shutdownSignals: [],
    ...(endpoint
      ? { telemetryOptions: { metrics: { metricPrefix: "temporal_", globalTags: { service: options.serviceName ?? "orchestrator" }, otel: { url: `${endpoint}/v1/metrics`, http: true, headers: options.otlpHeaders ?? {}, metricsExportInterval: "15s" } } } }
      : {}),
  });
}
