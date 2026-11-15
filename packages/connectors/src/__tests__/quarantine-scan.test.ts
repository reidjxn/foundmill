/**
 * The address scan of untrusted content (quarantine.ts `emailsInText`, `extractCandidateRecipients`) is linear in the
 * size of the content and finds exactly what the old pattern found; `readableContent` shows the reader text, not bytes.
 */
import { describe, expect, it } from "vitest";
import { emailsInText, extractCandidateRecipients, isBinaryText, readableContent } from "../quarantine";

/** The pattern the scan replaces: correct, but quadratic on a long run of local-part characters with no `@`. */
const OLD_EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const old = (t: string) => t.match(OLD_EMAIL_RE) ?? [];

const FOUR_MB = 4 * 1024 * 1024;
/**
 * Time bounds: strict on a developer's machine, wider on a loaded CI runner (as packages/policy's evaluate test does).
 * Either way they catch the old quadratic pattern, which took 11 s for 94 KB and would take minutes for 4 MB.
 */
const SCAN_MS = process.env.CI ? 2_500 : 500;
const FIELD_MS = process.env.CI ? 5_000 : 1_000;
const silence = "A".repeat(FOUR_MB);
const noise = Buffer.from(Array.from({ length: (FOUR_MB * 3) / 4 }, (_, i) => (i * 7919 + (i >> 7)) % 256)).toString("base64");

describe("emailsInText", () => {
  it("finds exactly what the old pattern found", () => {
    const corpus = [
      "write to maya@northwind.example or audit@hallbergs-compliance.example.",
      "a@b.com5 a@b.co.x a@b.c x@y.z.co user.name+tag@sub-domain.example.org",
      "a@b.com@c.org", "@@@a@@b.co", "nap@evil.example\\nnext@line.example", "no address here", "trailing@", "@leading.com",
      "x@-.co", "1@2.34", "UPPER@CASE.COM and mixed@Case.Org", "a.@.b.cd", "%+-@x.yz", "a@b..cd", "one@two.three.four.five",
      "café@bad.com ok@good.com", "a@b.cd.ef.g", "a@b.c1.de",
    ];
    for (const t of corpus) expect(emailsInText(t), t).toEqual(old(t));
    // Random strings over the characters that matter.
    const alphabet = "ab.@-_%+Z9 \n.co";
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    for (let i = 0; i < 3000; i++) {
      const t = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      expect(emailsInText(t), JSON.stringify(t)).toEqual(old(t));
    }
  });

  it("is linear: 4 MB of base64 (one run with no @, and noisy) in well under a second", () => {
    for (const [name, t] of [["silence", silence], ["noise", noise], ["at signs", "a@".repeat(FOUR_MB / 2)], ["dots", `x@${"a.".repeat(FOUR_MB / 2)}`]] as const) {
      const started = performance.now();
      emailsInText(t);
      expect(performance.now() - started, name).toBeLessThan(SCAN_MS);
    }
  });
});

describe("extractCandidateRecipients on a large media result", () => {
  it("scans a 4 MB base64 field in well under a second and still finds the address beside it", () => {
    const started = performance.now();
    const found = extractCandidateRecipients({ mime: "audio/wav", base64: silence, note: "Questions: help@northwind.example" });
    expect(performance.now() - started).toBeLessThan(FIELD_MS);
    expect(found.emails).toEqual(["help@northwind.example"]);
    const random = performance.now();
    extractCandidateRecipients({ base64: noise });
    expect(performance.now() - random).toBeLessThan(FIELD_MS);
  });

  it("reads no bytes as text", () => {
    expect(extractCandidateRecipients({ archive: new Uint8Array(FOUR_MB).fill(64) })).toEqual({ emails: [], urls: [], phones: [] });
  });
});

describe("readableContent", () => {
  it("replaces binary values with a note of their size and keeps every other field", () => {
    const view = readableContent({ mime: "audio/mpeg", base64: silence, bytes: 12, voiceId: "MockVoiceNorthwind01", nested: [{ archive: new Uint8Array(3), text: "keep me" }] }) as Record<string, unknown>;
    expect(view).toEqual({ mime: "audio/mpeg", base64: `[binary data, ${FOUR_MB} characters of base64, not shown]`, bytes: 12, voiceId: "MockVoiceNorthwind01", nested: [{ archive: "[binary data, 3 bytes, not shown]", text: "keep me" }] });
    expect(JSON.stringify(view).length).toBeLessThan(400);
  });

  it("leaves prose alone, however long, and short base64-looking words", () => {
    const prose = "Write to us at hello@example.com. ".repeat(100);
    expect(isBinaryText(prose)).toBe(false);
    expect(isBinaryText("QUJD")).toBe(false);
    expect(isBinaryText(noise)).toBe(true);
    expect(readableContent({ body: prose, id: "QUJD" })).toEqual({ body: prose, id: "QUJD" });
  });
});
