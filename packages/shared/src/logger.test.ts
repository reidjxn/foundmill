import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, stream: { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) } };
}

describe("createLogger", () => {
  it("writes the level as its label, which Railway reads as the line's severity", () => {
    const { lines, stream } = capture();
    const log = createLogger("ingest", "info", stream);
    log.info({}, "listening");
    log.warn({ reason: "no redis" }, "nonce store uses memory");
    log.error({}, "credit balance is too low");
    log.debug({}, "below the level");
    expect(lines.map((l) => l.level)).toEqual(["info", "warn", "error"]);
    expect(lines[1]).toMatchObject({ name: "ingest", msg: "nonce store uses memory", reason: "no redis" });
  });

  it("still redacts secrets", () => {
    const { lines, stream } = capture();
    createLogger("gateway", "info", stream).info({ call: { apiKey: "sk-live-1", token: "t" } }, "call");
    expect(lines[0]).toMatchObject({ call: { apiKey: "[redacted]", token: "[redacted]" } });
  });
});
