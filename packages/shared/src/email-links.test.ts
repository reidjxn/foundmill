import { describe, expect, it } from "vitest";
import { emailLinkSecret, hashActionToken, isActionTokenShape, newActionToken, signPauseToken, verifyPauseToken } from "./email-links";

const U = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("pause tokens", () => {
  it("verify for the account they were signed for, until they expire", () => {
    const t = signPauseToken("s", U, 0, 1000);
    expect(verifyPauseToken("s", t, 500)).toBe(U);
    expect(verifyPauseToken("s", t, 2000)).toBeNull();
  });
  it("refuse another secret, a changed body and junk", () => {
    const t = signPauseToken("s", U, 0);
    expect(verifyPauseToken("other", t, 0)).toBeNull();
    const [, sig] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ u: "someone-else", e: 9e9 })).toString("base64url")}.${sig}`;
    expect(verifyPauseToken("s", forged, 0)).toBeNull();
    expect(verifyPauseToken("s", "nope", 0)).toBeNull();
    expect(verifyPauseToken("s", `${t}.x`, 0)).toBeNull();
  });
  it("need SESSION_TOKEN_SECRET in every environment: there is no built-in key anyone could read in the repository", () => {
    expect(() => emailLinkSecret({ APP_ENV: "production" })).toThrow(/SESSION_TOKEN_SECRET/);
    // The gateway signs the link and the api checks it, so a key of one process would not do; a deployed process
    // (NODE_ENV=production) claiming APP_ENV=test gets nothing either.
    for (const APP_ENV of ["development", "test"]) expect(() => emailLinkSecret({ APP_ENV })).toThrow(/SESSION_TOKEN_SECRET/);
    expect(emailLinkSecret({ APP_ENV: "production", SESSION_TOKEN_SECRET: "k" })).toBe("k");
    expect(emailLinkSecret({ APP_ENV: "test", SESSION_TOKEN_SECRET: "k" })).toBe("k");
  });
});

describe("action tokens", () => {
  it("are random, shaped, and stored only as their hash", () => {
    const a = newActionToken();
    const b = newActionToken();
    expect(a.token).not.toBe(b.token);
    expect(isActionTokenShape(a.token)).toBe(true);
    expect(a.hash).toBe(hashActionToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(isActionTokenShape("short")).toBe(false);
  });
});
