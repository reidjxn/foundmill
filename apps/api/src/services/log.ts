/** Request/process logger (pino). Secrets are never logged: callers pass redacted values only. */
import pino from "pino";
import type { Env } from "@foundmill/shared";
import { levelLabelFormatters, reportErrorsHook } from "@foundmill/shared/logger";

export type ApiLogger = pino.Logger;

const REDACT_PATHS = [
  "req.headers.authorization",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.token",
  "*.password",
  "*.ciphertext",
  "*.dataKeyCiphertext",
];

/**
 * Pretty lines in development; elsewhere one JSON object per line with the level as its label ("warn", "error"), which
 * is what Railway reads as the line's severity (a numeric pino level is filed under info). Error lines are also
 * reported to SENTRY_DSN once main() installed telemetry.
 */
export function createLog(env: Pick<Env, "LOG_LEVEL" | "APP_ENV">, destination?: pino.DestinationStream): ApiLogger {
  const options: pino.LoggerOptions = {
    name: "api",
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    hooks: reportErrorsHook,
    ...(env.APP_ENV === "development" && !destination ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : { formatters: levelLabelFormatters }),
  };
  return destination ? pino(options, destination) : pino(options);
}

/** A silent logger for tests. */
export function silentLog(): ApiLogger {
  return pino({ level: "silent" });
}
