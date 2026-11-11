import { describe, expect, it } from "vitest";
import { decisionWaitingEmail, notifyEmailFooter, waitedWords, type DecisionWaitingFacts } from "./notify-email";
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
      ].join("\n"),
    );
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

describe("PLATFORM_NOTIFY_LOCAL_PART", () => {
  it("defaults to hello and must be a reserved word no project can hold", () => {
    expect(loadEnv({ PLATFORM_NOTIFY_LOCAL_PART: "" }).PLATFORM_NOTIFY_LOCAL_PART).toBe("hello");
    expect(loadEnv({ PLATFORM_NOTIFY_LOCAL_PART: " Notifications " }).PLATFORM_NOTIFY_LOCAL_PART).toBe("notifications");
    expect(() => loadEnv({ PLATFORM_NOTIFY_LOCAL_PART: "northwind" })).toThrow(/reserved/);
    expect(loadEnv({ NOTIFY_EMAIL: "off" }).NOTIFY_EMAIL).toBe("off");
    expect(loadEnv({ NOTIFY_EMAIL: "" }).NOTIFY_EMAIL).toBe("on");
  });
});
