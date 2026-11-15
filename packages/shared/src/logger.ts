import pino from "pino";
import { reportLoggedError } from "./telemetry";
const REDACT = [
  "*.apiKey", "*.api_key", "*.token", "*.secret", "*.password", "*.authorization", "req.headers.authorization", "*.ciphertext", "*.privateKey",
  // A project's Foundmill sending address (package 1.5): as config fields and as the variables themselves.
  "*.signingSecret", "*.inboundToken", "*.eventPublicKey", "*.PLATFORM_MAIL_SIGNING_SECRET", "*.PLATFORM_MAIL_INBOUND_TOKEN", "*.PLATFORM_MAIL_EVENT_PUBLIC_KEY",
];

/**
 * Deployed services write one JSON object per line whose `level` is the label ("info", "warn", "error"). Railway reads
 * the severity from a string `level` and files pino's numeric default (30, 40, 50) under info, so warnings and errors
 * never showed as such and log filters and alerts could not see them (docs/DEPLOY.md §3 "Logs").
 */
export const levelLabelFormatters = { level: (label: string) => ({ level: label }) };

/** Every error-level line is also reported to SENTRY_DSN when the service installed telemetry (./telemetry.ts). */
export const reportErrorsHook: pino.LoggerOptions["hooks"] = {
  logMethod(args, method, level) {
    if (level >= 50) reportLoggedError(args[0], args[1]);
    return method.apply(this, args);
  },
};

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info", destination?: pino.DestinationStream) {
  const pretty = destination === undefined && (process.env.APP_ENV === "development" || process.env.APP_ENV === undefined);
  const options: pino.LoggerOptions = {
    name, level, redact: { paths: REDACT, censor: "[redacted]" }, hooks: reportErrorsHook,
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : { formatters: levelLabelFormatters }),
  };
  return destination ? pino(options, destination) : pino(options);
}
export type Logger = ReturnType<typeof createLogger>;
