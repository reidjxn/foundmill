import { describe, expect, it } from "vitest";
import { decisionWaitingEmail, notifyEmailFooter, waitedWords, withoutLinks, type DecisionWaitingFacts } from "./notify-email";
import { loadEnv } from "./env";

const facts = (over: Partial<DecisionWaitingFacts> = {}): DecisionWaitingFacts => ({
  personName: "Maya",
  projectName: "Northwind",
  agentName: "Avery, Product Lead",
  holdsContinue: false,
  noteSubject: "Which price should the first plan have?",
  waitedMs: 26 * 3_600_000,
  link: "https://foundmill.com/b/b1/inbox/i1",
  offLink: "https://ingest.foundmill.com/mail/notify/off?t=n1.x",
  appName: "Foundmill",
  postalAddress: "Box 1, 11422 Stockholm, Sweden",
  ...over,
});

describe("the email when something has waited a day for an answer", () => {
  it("addresses the person by name, says who asked and how long ago, and gives one link and the way out", () => {
    const e = decisionWaitingEmail(facts());
    expect(e.subject).toBe("Northwind needs your answer");
    expect(e.text).toBe(
      [
        "Hi Maya,",
        "",
        "Avery, Product Lead asked you something 26 hours ago and the team is waiting on it:",
        "“Which price should the first plan have?”",
        "",
        "Open it: https://foundmill.com/b/b1/inbox/i1",
        "",
        "Replies to this email don't reach the team, so answer in the app.",
        "",
        "--",
        "You get this because you are part of Northwind on Foundmill. Turn these emails off: https://ingest.foundmill.com/mail/notify/off?t=n1.x",
        "Postal address: Foundmill, Box 1, 11422 Stockholm, Sweden.",
      ].join("\n"),
    );
    // Foundmill's own address in every email it sends (US CAN-SPAM), in both parts.
    expect(e.html).toContain("<br>Postal address: Foundmill, Box 1, 11422 Stockholm, Sweden.</p>");
    expect(e.html).toContain('<a href="https://foundmill.com/b/b1/inbox/i1">Open it</a>');
    expect(e.html).toContain('<a href="https://ingest.foundmill.com/mail/notify/off?t=n1.x">Turn these emails off</a>');
  });

  it("says the team stopped for a hard stop, names the project when no agent asked, and greets without a name when there is none", () => {
    expect(decisionWaitingEmail(facts({ holdsContinue: true })).text).toContain("The team stopped 26 hours ago and is waiting on you:");
    expect(decisionWaitingEmail(facts({ agentName: null })).text).toContain("Something in Northwind has waited 26 hours for your answer:");
    expect(decisionWaitingEmail(facts({ personName: null })).text.startsWith("Hi,\n")).toBe(true);
    expect(waitedWords(24 * 3_600_000)).toBe("24 hours");
    expect(waitedWords(50 * 3_600_000)).toBe("2 days");
  });

  it("keeps the subject on one line and escapes everything it puts in HTML", () => {
    const e = decisionWaitingEmail(facts({ projectName: "Evil\r\nBcc: x@evil.example", noteSubject: '<script>alert("x")</script>', personName: "<b>Maya</b>" }));
    expect(e.subject).toBe("Evil Bcc: (address) needs your answer");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("Hi &lt;b&gt;Maya&lt;/b&gt;,");
    expect(notifyEmailFooter("A".repeat(300), "Foundmill", "x").length).toBeLessThan(220);
  });

  it("cuts links and addresses from the words the team wrote, so the one link is the app's", () => {
    const e = decisionWaitingEmail(facts({ noteSubject: "Log in at https://evil.example/login or www.evil.example and mail pay@evil.example now", projectName: "Shop www.x.example" }));
    expect(e.text).toContain("“Log in at (link) or (link) and mail (address) now”");
    expect(e.subject).toBe("Shop (link) needs your answer");
    expect(e.text.match(/https?:\/\//g)).toHaveLength(2);
  });
});

describe("no link, domain or address in the words the team and the founders wrote (security review, Nov 11, 2026)", () => {
  it.each([
    ["Log in at evil.com/login today", "Log in at (link) today"],
    ["Write to foundmill-support.com", "Write to (link)"],
    ["Check xn--fundmill-xyz.com/verify now", "Check (link) now"],
    ["See hxxp://x", "See (link)"],
    ["Get ftp://x", "Get (link)"],
    ["Mail mailto:a@b.co", "Mail (link)"],
    ["Call tel:+15551234", "Call (link)"],
    ["Open xhttps://evil.com", "Open (link)"],
    ["Visit evil。com", "Visit (link)"],
    ["Visit evil．com/x or evil｡com", "Visit (link) or (link)"],
    ["Visit ｅｖｉｌ.ｃｏｍ", "Visit (link)"],
    ["Visit www.evil.co.uk:8443/a?b=c#d", "Visit (link)"],
    ["Visit пример.рф", "Visit (link)"],
    ["Write to help@evil.example", "Write to (address)"],
    ["Open https://evil.example/login", "Open (link)"],
  ])("%s", (input, output) => {
    expect(withoutLinks(input)).toBe(output);
  });

  it.each(["Cash is £2,300, runway 2 months", "e.g. the U.S. launch", "version 3.5", "Ship v2.0 by 3:45 PM, i.e. before the U.K. opens", "Ph.D. students, a.m. or p.m., 1.5x the spend", "Which price should the first plan have?"])(
    "keeps prose: %s",
    (prose) => {
      expect(withoutLinks(prose)).toBe(prose);
    },
  );

  it("cuts them from the project's name, the agent's name and the note everywhere they appear, the Subject header included", () => {
    const e = decisionWaitingEmail(facts({ projectName: "PayPal.com Security", agentName: "support.evil.com", noteSubject: "Verify at evil。com/login", personName: "Maya at evil.com" }));
    expect(e.subject).toBe("(link) Security needs your answer");
    expect(e.text).toContain("Hi Maya at (link),");
    expect(e.text).toContain("(link) asked you something 26 hours ago");
    expect(e.text).toContain("“Verify at (link)”");
    expect(e.text).toContain("You get this because you are part of (link) Security on Foundmill.");
    for (const part of [e.subject, e.text, e.html]) expect(part).not.toMatch(/paypal|evil/i);
    expect(decisionWaitingEmail(facts({ projectName: "PayPal.com Security", agentName: null })).text).toContain("Something in (link) Security has waited");
    expect(notifyEmailFooter("PayPal.com Security", "Foundmill", "x")).toBe("You get this because you are part of (link) Security on Foundmill. Turn these emails off: x");
  });
});

describe("PLATFORM_NOTIFY_LOCAL_PART", () => {
  it("defaults to hello and must be a reserved word no project can hold", () => {
    expect(loadEnv({ PLATFORM_NOTIFY_LOCAL_PART: "" }).PLATFORM_NOTIFY_LOCAL_PART).toBe("hello");
    expect(loadEnv({ PLATFORM_NOTIFY_LOCAL_PART: " Notifications " }).PLATFORM_NOTIFY_LOCAL_PART).toBe("notifications");
    expect(() => loadEnv({ PLATFORM_NOTIFY_LOCAL_PART: "northwind" })).toThrow(/reserved/);
    expect(loadEnv({ NOTIFY_EMAIL: "off" }).NOTIFY_EMAIL).toBe("off");
    expect(loadEnv({ NOTIFY_EMAIL: "" }).NOTIFY_EMAIL).toBe("on");
    expect(loadEnv({}).PLATFORM_NOTIFY_DAILY_CEILING).toBe(1_000);
    expect(loadEnv({ PLATFORM_NOTIFY_DAILY_CEILING: "250" }).PLATFORM_NOTIFY_DAILY_CEILING).toBe(250);
  });
});
