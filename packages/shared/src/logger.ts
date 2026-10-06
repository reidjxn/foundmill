import pino from "pino";
const REDACT = ["*.apiKey", "*.api_key", "*.token", "*.secret", "*.password", "*.authorization", "req.headers.authorization", "*.ciphertext", "*.privateKey"];
export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info") {
  const pretty = process.env.APP_ENV === "development" || process.env.APP_ENV === undefined;
  return pino({
    name, level, redact: { paths: REDACT, censor: "[redacted]" },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}
export type Logger = ReturnType<typeof createLogger>;
