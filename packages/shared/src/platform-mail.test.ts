import { describe, expect, it } from "vitest";
import { loadEnv, PLATFORM_MAIL_SECRET_MIN_LENGTH, platformMailDomain, platformMailLive, platformMailMode, platformMailSigningSecret } from "./env";
import { FOLLOW_CONFIRMATION_MAIL_CLASS, isMailLocalPart, isPostalAddressDecision, mailLocalPartReserved, MAIL_RESERVED_LOCAL_PARTS, normalizePostalAddress, platformMailAddress, platformMailCountLine, platformMailLocalPartOf, PLATFORM_MAIL_REFUSALS, POSTAL_ADDRESS_NOTE, postalAddressLine, postalAddressProblem, projectMailClass } from "./platform-mail";

describe("the Foundmill sending address", () => {
  it("is off without a domain, simulated while SendGrid is mock, live where SendGrid is live", () => {
    const base = { INTEGRATIONS_MODE: "mock" as const, LIVE_CONNECTORS: "" };
    expect(platformMailDomain({})).toBeNull();
    expect(platformMailLive({ ...base, PLATFORM_MAIL_DOMAIN: "mail.foundmill.com" })).toBe(false);
    expect(platformMailMode({ ...base, LIVE_CONNECTORS: "github, sendgrid" })).toBe("live");
    expect(platformMailLive({ ...base, LIVE_CONNECTORS: "sendgrid", PLATFORM_MAIL_DOMAIN: "mail.foundmill.com" })).toBe(true);
    expect(platformMailLive({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" })).toBe(false);
  });

  it("reads its variables with their defaults and refuses a domain that is not one", () => {
    const env = loadEnv({ APP_ENV: "test", PLATFORM_MAIL_DOMAIN: " Mail.Foundmill.com " });
    expect(env.PLATFORM_MAIL_DOMAIN).toBe("mail.foundmill.com");
    expect(env.PLATFORM_MAIL_DAILY_CAP).toBe(50);
    expect(env.PLATFORM_MAIL_DAILY_CEILING).toBe(2_000);
    expect(loadEnv({ APP_ENV: "test", PLATFORM_MAIL_DOMAIN: "" }).PLATFORM_MAIL_DOMAIN).toBeUndefined();
    expect(() => loadEnv({ APP_ENV: "test", PLATFORM_MAIL_DOMAIN: "https://mail.foundmill.com" })).toThrow(/PLATFORM_MAIL_DOMAIN/);
  });

  it("local parts have a page address's shape and are never a role address", () => {
    expect(isMailLocalPart("evergreen-candles")).toBe(true);
    for (const bad of ["ab", "Abc", "a.b", "-abc", ...MAIL_RESERVED_LOCAL_PARTS]) expect(isMailLocalPart(bad), bad).toBe(false);
    expect(platformMailAddress("Evergreen", "Mail.Foundmill.com")).toBe("evergreen@mail.foundmill.com");
  });

  it("refuses a role word as one of the local part's parts too, not only as the whole name", () => {
    for (const word of ["support", "help", "security", "admin", "billing", "accounts", "account", "verify", "verification", "noreply", "no-reply", "do-not-reply", "donotreply", "notifications", "notification", "alerts", "postmaster", "abuse", "mailer-daemon", "info", "team", "hello", "contact", "sales", "payments", "password", "login"]) {
      expect(MAIL_RESERVED_LOCAL_PARTS, word).toContain(word);
    }
    for (const bad of ["paypal-security", "acme-no-reply", "billing-dept", "my-bank-login-help", "shop-support"]) {
      expect(mailLocalPartReserved(bad), bad).toBe(true);
      expect(isMailLocalPart(bad), bad).toBe(false);
    }
    expect(mailLocalPartReserved("paypal.security")).toBe(true);
    // A word that only contains a role word is not one of its parts.
    for (const fine of ["teamwork-studio", "infoxpress", "helpful-hands", "salesforce-tips", "contacts-co"]) expect(isMailLocalPart(fine), fine).toBe(true);
  });

  it("refuses to boot with the domain set and no real signing secret, outside development and test", () => {
    const domain = "mail.foundmill.com";
    const long = "s".repeat(PLATFORM_MAIL_SECRET_MIN_LENGTH);
    for (const appEnv of ["staging", "production"] as const) {
      expect(() => platformMailSigningSecret({ APP_ENV: appEnv, PLATFORM_MAIL_DOMAIN: domain }), appEnv).toThrow(/PLATFORM_MAIL_SIGNING_SECRET/);
      expect(() => platformMailSigningSecret({ APP_ENV: appEnv, PLATFORM_MAIL_DOMAIN: domain, PLATFORM_MAIL_SIGNING_SECRET: "s".repeat(31) }), appEnv).toThrow(/at least 32/);
      expect(platformMailSigningSecret({ APP_ENV: appEnv, PLATFORM_MAIL_DOMAIN: domain, PLATFORM_MAIL_SIGNING_SECRET: ` ${long} ` })).toBe(long);
      // Off: nothing to sign, nothing to check.
      expect(platformMailSigningSecret({ APP_ENV: appEnv })).toBeNull();
    }
    for (const appEnv of ["development", "test"] as const) expect(platformMailSigningSecret({ APP_ENV: appEnv, PLATFORM_MAIL_DOMAIN: domain })).toBeNull();
  });

  it("finds the local part at the domain only, sub-addresses included", () => {
    expect(platformMailLocalPartOf("Evergreen <evergreen@mail.foundmill.com>", "mail.foundmill.com")).toBe("evergreen");
    expect(platformMailLocalPartOf("evergreen+re-42@MAIL.foundmill.com", "mail.foundmill.com")).toBe("evergreen");
    expect(platformMailLocalPartOf("evergreen@foundmill.com", "mail.foundmill.com")).toBeNull();
    expect(platformMailLocalPartOf("evergreen@mail.foundmill.com.evil.example", "mail.foundmill.com")).toBeNull();
  });

  it("speaks in plain words", () => {
    expect(platformMailCountLine(1_200, 2_000)).toBe("1,200 of 2,000 sent today");
    expect(PLATFORM_MAIL_REFUSALS.daily_cap(50)).toBe("This project has sent its 50 messages for today. Nothing was sent; sending opens again at midnight UTC.");
  });
});

describe("commercial or transactional (CAN-SPAM), in one place", () => {
  it("is commercial unless a declared reply or receipt has its proof", () => {
    expect(projectMailClass({ purpose: undefined, wroteFirst: true, paid: true })).toBe("commercial");
    expect(projectMailClass({ purpose: "marketing", wroteFirst: true, paid: true })).toBe("commercial");
    expect(projectMailClass({ purpose: "reply", wroteFirst: true, paid: false })).toBe("transactional");
    expect(projectMailClass({ purpose: "reply", wroteFirst: false, paid: true })).toBe("commercial");
    expect(projectMailClass({ purpose: "receipt", wroteFirst: false, paid: true })).toBe("transactional");
    expect(projectMailClass({ purpose: "receipt", wroteFirst: true, paid: false })).toBe("commercial");
    expect(FOLLOW_CONFIRMATION_MAIL_CLASS).toBe("transactional");
  });

  it("the refusal says plainly that nothing was sent and why", () => {
    expect(PLATFORM_MAIL_REFUSALS.no_postal_address.startsWith("Not sent: the founder has not added a postal address yet.")).toBe(true);
  });
});

describe("the founders' postal address", () => {
  it("is one tidy line, a PO box included", () => {
    expect(normalizePostalAddress("  PO Box 1234\nSpringfield, IL 62701\r\n\nUSA.  ")).toBe("PO Box 1234, Springfield, IL 62701, USA");
    expect(normalizePostalAddress("12 Main St,,  Springfield ,\n, USA")).toBe("12 Main St, Springfield, USA");
    expect(postalAddressLine("PO Box 1234, Springfield, IL 62701")).toBe("Postal address: PO Box 1234, Springfield, IL 62701.");
    expect(postalAddressProblem("PO Box 1234, Springfield, IL 62701, USA")).toBeNull();
  });

  it("refuses what is not a postal address", () => {
    expect(postalAddressProblem("home")).toMatch(/whole address/);
    expect(postalAddressProblem("x".repeat(301) + " 1")).toMatch(/under 300/);
    expect(postalAddressProblem("see https://example.com 12")).toMatch(/not a web or email address/);
    expect(postalAddressProblem("write to me@example.com 12")).toMatch(/not a web or email address/);
    expect(postalAddressProblem("<b>12 Main St</b>, Springfield")).toMatch(/ordinary punctuation/);
    expect(postalAddressProblem("12 Main St\u0007 Springfield")).toMatch(/ordinary punctuation/);
    expect(postalAddressProblem("Main Street, Springfield")).toMatch(/number/);
  });

  it("marks its note by key", () => {
    expect(isPostalAddressDecision({ key: POSTAL_ADDRESS_NOTE.key, options: [] })).toBe(true);
    expect(isPostalAddressDecision({ key: "project_page.ready" })).toBe(false);
    expect(isPostalAddressDecision(null)).toBe(false);
  });
});
