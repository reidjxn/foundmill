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
import { createPlatformNotifyConnector, createPlatformNotifyMock, invitationsOffToken, invitationsOffUrl, notifyOffToken, notifyOffUrl, readInvitationsOffToken, readNotifyOffToken } from "./index";

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

  it("a letter (WP-04 D6) carries the Reply-To it was given, and nothing else changes", async () => {
    const seen: Record<string, unknown>[] = [];
    const connector = createPlatformNotifyConnector({
      secrets: { sendgridApiKey: "SG.platform-test-key" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          seen.push((await req.json()) as Record<string, unknown>);
          return new Response(null, { status: 202, headers: { "x-message-id": "sg-notify-2" } });
        },
      }),
    });
    const r = await connector.callTool("send_notification", { ...mail, from: { ...mail.from, name: "The Foundmill team" }, replyTo: { email: "hey@foundmill.com" } }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    const body = seen[0] as { from: { name: string }; reply_to: unknown; headers: Record<string, string> };
    expect(body.reply_to).toEqual({ email: "hey@foundmill.com" });
    expect(body.from.name).toBe("The Foundmill team");
    expect(body.headers["List-Unsubscribe"]).toBe(`<${offUrl}>`);
  });

  it("an account-safety notice: no unsubscribe link or header, its own category; exactly one of the two is given", async () => {
    const mock = createPlatformNotifyMock();
    const ctx = makeToolContext(mock);
    const { unsubscribeUrl: _off, ...notice } = mail;
    expect((await mock.callTool("send_notification", { ...notice, accountSafety: true }, ctx)).ok).toBe(true);
    const [sent] = mock.sentFor(TEST_BUSINESS_ID);
    expect((sent!.body as { headers?: unknown }).headers).toBeUndefined();
    expect((sent!.body as { categories: string[] }).categories).toEqual(["foundmill-notify", "foundmill-account-safety"]);
    // The global unsubscribe list is bypassed, never the bounce or spam lists (no bypass_list_management with it).
    expect((sent!.body as { mailSettings: unknown }).mailSettings).toEqual({ bypassUnsubscribeManagement: { enable: true } });
    // Live, the SDK writes it as SendGrid's own field.
    const seen: Record<string, unknown>[] = [];
    const live = createPlatformNotifyConnector({
      secrets: { sendgridApiKey: "SG.platform-test-key" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          seen.push((await req.json()) as Record<string, unknown>);
          return new Response(null, { status: 202, headers: { "x-message-id": "sg-notice-1" } });
        },
      }),
    });
    expect((await live.callTool("send_notification", { ...notice, accountSafety: true }, makeToolContext(live, { mode: "live" }))).ok).toBe(true);
    expect(seen[0]!.mail_settings).toEqual({ bypass_unsubscribe_management: { enable: true } });
    expect(seen[0]!.headers).toBeUndefined();
    // Both, or a false flag, or neither: refused.
    for (const bad of [{ ...mail, accountSafety: true }, { ...notice, accountSafety: false }, notice]) expect((await mock.callTool("send_notification", bad, ctx)).ok, JSON.stringify(Object.keys(bad))).toBe(false);
  });

  it("needs the platform key, and takes no extra fields (no attachments, no Bcc, no headers)", async () => {
    const keyless = createPlatformNotifyConnector({ secrets: {} });
    await expect(keyless.callTool("send_notification", mail, makeToolContext(keyless, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const mock = createPlatformNotifyMock();
    const ctx = makeToolContext(mock);
    for (const extra of [{ attachments: [{ filename: "a.pdf" }] }, { bcc: [{ email: "x@evil.example" }] }, { subject: "Two\nlines" }, { from: { email: "hello@mail.foundmill.test", name: "Foundmill\r\nBcc: x" } }, { unsubscribeUrl: undefined }]) {
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

  it("every message needs its one-click link; an invitation's names the address by its hash only, under its own label", () => {
    const hash = suppressionHashOfEmail("Invited@Example.com");
    const token = invitationsOffToken(SECRET, hash);
    expect(readInvitationsOffToken(SECRET, token)).toEqual({ emailHash: hash });
    expect(token).not.toContain("invited");
    expect(readInvitationsOffToken("another-secret-0123456789abcdef-xyz", token)).toBeNull();
    const [v, , sig] = token.split(".");
    expect(readInvitationsOffToken(SECRET, [v, suppressionHashOfEmail("else@example.com"), sig].join("."))).toBeNull();
    expect(readInvitationsOffToken(SECRET, `${token}x`)).toBeNull();
    // Never valid as another token, nor another as it.
    expect(readNotifyOffToken(SECRET, token)).toBeNull();
    expect(readPlatformUnsubscribeToken(SECRET, token)).toBeNull();
    expect(readInvitationsOffToken(SECRET, notifyOffToken(SECRET, USER, "decision_waiting"))).toBeNull();
    expect(invitationsOffUrl("https://ingest.foundmill.test/", token)).toMatch(/^https:\/\/ingest\.foundmill\.test\/mail\/invitations\/off\?t=i1\./);
  });
});
