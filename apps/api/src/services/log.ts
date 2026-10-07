/** Request/process logger (pino). Secrets are never logged: callers pass redacted values only. */
import pino from "pino";
import type { Env } from "@foundmill/shared";

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

export function createLog(env: Pick<Env, "LOG_LEVEL" | "APP_ENV">): ApiLogger {
  return pino({
    name: "api",
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    ...(env.APP_ENV === "development" ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}

/** A silent logger for tests. */
export function silentLog(): ApiLogger {
  return pino({ level: "silent" });
}
