import { describe, expect, it } from "vitest";
import { loadEnv, platformMailDomain, platformMailLive, platformMailMode } from "./env";
import { isMailLocalPart, MAIL_RESERVED_LOCAL_PARTS, platformMailAddress, platformMailCountLine, platformMailLocalPartOf, PLATFORM_MAIL_REFUSALS } from "./platform-mail";

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
