import { describe, expect, it } from "vitest";
import { MessageIdHeader, gmailTools } from "../gmail/tools";
import { buildMimeMessage } from "./mime";

const base = { from: "reid@northwindskincare.com", to: ["customer@example.com"], subject: "Your order", text: "Thanks!" };

describe("buildMimeMessage header safety (audit GPC-14)", () => {
  it("writes a plain reply with one In-Reply-To and one References header", () => {
    const mime = buildMimeMessage({ ...base, inReplyTo: "<a@b>", references: ["<a@b>"] });
    expect(mime).toContain("In-Reply-To: <a@b>\r\n");
    expect(mime.match(/^Bcc:/gm)).toBeNull();
  });

  it("refuses a line break in any header value instead of starting a new header", () => {
    const injected = "<a@b>\r\nBcc: hidden@evil.example";
    expect(() => buildMimeMessage({ ...base, inReplyTo: injected })).toThrow(/In-Reply-To/);
    expect(() => buildMimeMessage({ ...base, references: [injected] })).toThrow(/References/);
    expect(() => buildMimeMessage({ ...base, messageId: injected })).toThrow(/Message-ID/);
    expect(() => buildMimeMessage({ ...base, to: ["a@b.example\nBcc: x@y.example"] })).toThrow(/To/);
    expect(() => buildMimeMessage({ ...base, from: "a@b.example\r\nBcc: x@y.example" })).toThrow(/From/);
  });

  it("a subject with a line break is encoded, never written raw", () => {
    const mime = buildMimeMessage({ ...base, subject: "Hi\r\nBcc: hidden@evil.example" });
    expect(mime.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
});

describe("gmail inReplyToMessageId", () => {
  it("is a single msg-id", () => {
    expect(MessageIdHeader.safeParse("<abc.123@mail.example.com>").success).toBe(true);
    for (const bad of ["<a@b>\r\nBcc: hidden@evil.example", "<a@b> <c@d>", "abc", "<a@b>\n", "<a b@c>", ""]) expect(MessageIdHeader.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("send_message and create_draft refuse an injected reply id at the schema", () => {
    for (const name of ["send_message", "create_draft"] as const) {
      const tool = gmailTools.find((t) => t.name === name)!;
      const call = (id: string) => tool.input.safeParse({ to: ["customer@example.com"], subject: "Your order", text: "Thanks!", inReplyToMessageId: id }).success;
      expect(call("<a@b>")).toBe(true);
      expect(call("<a@b>\r\nBcc: hidden@evil.example")).toBe(false);
    }
  });
});
