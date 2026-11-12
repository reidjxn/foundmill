/**
 * `platform_notify` (packages 1.5 and 5.1): Foundmill's own email to a person. The live side sends one message on the
 * platform key with the one-click header and no custom args (no project binds to it); the mock records it; the link
 * that turns the email off names the person and the kind, signed under its own label.
 */
import { describe, expect, it } from "vitest";
import { routedFetch } from "../../http";
import { makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { uuidFromSeed } from "../../mock-utils";
import { platformUnsubscribeToken, readPlatformUnsubscribeToken, suppressionHashOfEmail } from "../platform_mail";
import { createPlatformNotifyConnector, createPlatformNotifyMock, notifyOffToken, notifyOffUrl, readNotifyOffToken } from "./index";

const SECRET = "test-platform-mail-signing-secret-0123456789";
const USER = uuidFromSeed("test", "user", "maya");
const offUrl = notifyOffUrl("https://ingest.foundmill.test", notifyOffToken(SECRET, USER, "decision_waiting"));
const mail = {
  from: { email: "hello@mail.foundmill.test", name: "Foundmill" },
  to: { email: "Maya@Example.com" },
  subject: "Northwind needs your answer",
  text: "Hi Maya,\n\nOpen it: https://foundmill.test/b/x/inbox/y",
  html: "<p>Hi Maya,</p>",
  unsubscribeUrl: offUrl,
};

describe("platform_notify", () => {
  it("sends one message on the platform key, with the one-click header and nothing that binds it to a project", async () => {
    const seen: Record<string, unknown>[] = [];
    let auth: string | null = null;
    const connector = createPlatformNotifyConnector({
      secrets: { sendgridApiKey: "SG.platform-test-key" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          auth = req.headers.get("authorization");
          seen.push((await req.json()) as Record<string, unknown>);
          return new Response(null, { status: 202, headers: { "x-message-id": "sg-notify-1" } });
        },
      }),
    });
    const r = await connector.callTool("send_notification", mail, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ messageId: "sg-notify-1" });
    expect(auth).toBe("Bearer SG.platform-test-key");
    const body = seen[0] as { from: { email: string; name: string }; reply_to?: unknown; headers: Record<string, string>; personalizations: { to: { email: string }[]; custom_args?: unknown }[]; categories: string[] };
    expect(body.from).toEqual({ email: "hello@mail.foundmill.test", name: "Foundmill" });
    expect(body.reply_to).toBeUndefined();
    expect(body.personalizations).toEqual([{ to: [{ email: "Maya@Example.com" }] }]);
    expect(body.headers).toEqual({ "List-Unsubscribe": `<${offUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(body.categories).toEqual(["foundmill-notify"]);
  });

  it("needs the platform key, and takes no extra fields (no attachments, no Bcc, no headers)", async () => {
    const keyless = createPlatformNotifyConnector({ secrets: {} });
    await expect(keyless.callTool("send_notification", mail, makeToolContext(keyless, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const mock = createPlatformNotifyMock();
    const ctx = makeToolContext(mock);
    for (const extra of [{ attachments: [{ filename: "a.pdf" }] }, { bcc: [{ email: "x@evil.example" }] }, { subject: "Two\nlines" }, { from: { email: "hello@mail.foundmill.test", name: "Foundmill\r\nBcc: x" } }]) {
      const r = await mock.callTool("send_notification", { ...mail, ...extra }, ctx);
      expect(r.ok, JSON.stringify(extra)).toBe(false);
    }
    expect(mock.sentFor(TEST_BUSINESS_ID)).toHaveLength(0);
    expect((await mock.callTool("send_notification", mail, ctx)).ok).toBe(true);
    expect(mock.sentFor(TEST_BUSINESS_ID).map((m) => [m.to, m.subject])).toEqual([["maya@example.com", "Northwind needs your answer"]]);
  });

  it("the link that turns the email off names the person and the kind, and nothing else verifies", () => {
    const token = notifyOffToken(SECRET, USER, "decision_waiting");
    expect(readNotifyOffToken(SECRET, token)).toEqual({ userId: USER, kind: "decision_waiting" });
    expect(readNotifyOffToken("another-secret-0123456789abcdef-xyz", token)).toBeNull();
    const [v, , k, sig] = token.split(".");
    expect(readNotifyOffToken(SECRET, [v, uuidFromSeed("someone", "else"), k, sig].join("."))).toBeNull();
    expect(readNotifyOffToken(SECRET, [v, USER, "weekly_summary", sig].join("."))).toBeNull();
    expect(readNotifyOffToken(SECRET, `${token}x`)).toBeNull();
    expect(readNotifyOffToken(SECRET, "")).toBeNull();
    // Its own label: a project's unsubscribe token never passes for it, nor the other way round.
    const projectToken = platformUnsubscribeToken(SECRET, TEST_BUSINESS_ID, suppressionHashOfEmail("maya@example.com"));
    expect(readNotifyOffToken(SECRET, projectToken)).toBeNull();
    expect(readPlatformUnsubscribeToken(SECRET, token)).toBeNull();
    expect(offUrl).toMatch(/^https:\/\/ingest\.foundmill\.test\/mail\/notify\/off\?t=n1\./);
  });
});
