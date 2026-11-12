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

  it("redacts the sending address's secrets, as config fields and as variables", () => {
    const { lines, stream } = capture();
    createLogger("ingest", "info", stream).info({ platformMail: { domain: "mail.foundmill.com", signingSecret: "s".repeat(32), inboundToken: "t", eventPublicKey: "k" }, env: { PLATFORM_MAIL_SIGNING_SECRET: "s", PLATFORM_MAIL_INBOUND_TOKEN: "t", PLATFORM_MAIL_EVENT_PUBLIC_KEY: "k" } }, "boot");
    expect(lines[0]).toMatchObject({ platformMail: { domain: "mail.foundmill.com", signingSecret: "[redacted]", inboundToken: "[redacted]", eventPublicKey: "[redacted]" }, env: { PLATFORM_MAIL_SIGNING_SECRET: "[redacted]", PLATFORM_MAIL_INBOUND_TOKEN: "[redacted]", PLATFORM_MAIL_EVENT_PUBLIC_KEY: "[redacted]" } });
  });
});
