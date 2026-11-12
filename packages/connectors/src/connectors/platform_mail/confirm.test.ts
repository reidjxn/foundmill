/**
 * The follow confirmation link (package 1.6, double opt-in): signed under its own label, bound to the business, the
 * consent record and the address hash, and dead after seven days.
 */
import { describe, expect, it } from "vitest";
import { uuidFromSeed } from "../../mock-utils";
import { followConfirmNonceHash, followConfirmToken, followConfirmUrl, platformUnsubscribeToken, readFollowConfirmToken, readPlatformUnsubscribeToken, suppressionHashOfEmail } from "./index";

const SECRET = "test-platform-mail-signing-secret-0123456789";
const B = uuidFromSeed("test", "business", "confirm");
const C = uuidFromSeed("test", "consent", "confirm");
const H = suppressionHashOfEmail("maya@example.com");
const NOW = Date.UTC(2026, 10, 11, 12);
const claims = { businessId: B, consentId: C, emailHash: H, expiresAt: NOW / 1000 + 7 * 86_400, nonce: "n".repeat(43) };

describe("follow confirmation token", () => {
  it("round-trips, and is refused once expired, edited, or signed with another secret", () => {
    const token = followConfirmToken(SECRET, claims);
    expect(readFollowConfirmToken(SECRET, token, NOW)).toEqual(claims);
    expect(readFollowConfirmToken(SECRET, token, claims.expiresAt * 1000)).toBeNull();
    expect(readFollowConfirmToken("another-secret-of-at-least-32-characters", token, NOW)).toBeNull();
    const parts = token.split(".");
    for (const i of [1, 2, 3, 4, 5]) {
      const edited = [...parts];
      edited[i] = i === 4 ? String(Number(parts[4]) + 86_400) : i === 3 ? suppressionHashOfEmail("someone.else@example.com") : i === 5 ? "m".repeat(43) : uuidFromSeed("test", "other", String(i));
      expect(readFollowConfirmToken(SECRET, edited.join("."), NOW), `part ${i}`).toBeNull();
    }
    expect(readFollowConfirmToken(SECRET, "", NOW)).toBeNull();
  });

  it("never passes for an unsubscribe token, nor the other way round (separate labels)", () => {
    const unsubscribe = platformUnsubscribeToken(SECRET, B, H);
    expect(readFollowConfirmToken(SECRET, unsubscribe, NOW)).toBeNull();
    expect(readPlatformUnsubscribeToken(SECRET, followConfirmToken(SECRET, claims))).toBeNull();
  });

  it("points at ingest's confirm page and keeps only the nonce's hash on the record", () => {
    expect(followConfirmUrl("https://ingest.example/", "a.b")).toBe("https://ingest.example/mail/confirm?t=a.b");
    expect(followConfirmNonceHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(followConfirmNonceHash("abc")).not.toBe(followConfirmNonceHash("abd"));
  });
});
