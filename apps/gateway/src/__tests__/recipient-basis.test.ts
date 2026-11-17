/**
 * No email without a basis (WP-08 T10; recipient-basis.ts): the basis the gateway finds at send time, in order consent,
 * relationship, recorded, none; which contacts count as the founder's own; the addresses a mail goes to.
 */
import { emailEntityId } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mailRecipientEmails, recipientBasis, sourceIsFounderMade, weakestBasis } from "../recipient-basis";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway({ businessMode: "automated" });
}, 120_000);
afterAll(() => g?.close());

const now = new Date();
const event = (type: "lead.replied" | "payment.received", payload: Record<string, unknown>, entityIds: string[] = [], occurredAt = now) =>
  g.h.pg.query("insert into events (business_id, type, actor, payload, entity_ids, occurred_at) values ($1, $2, '{\"kind\":\"system\",\"id\":\"test\"}'::jsonb, $3::jsonb, $4::uuid[], $5)", [g.businessId, type, JSON.stringify(payload), entityIds, occurredAt]);

describe("recipientBasis", () => {
  it("none for an address nobody recorded, wrote from or paid from", async () => {
    expect(await recipientBasis(g.db, g.businessId, "stranger@example.com", now)).toBe("none");
    expect(await recipientBasis(g.db, g.businessId, "  ", now)).toBe("none");
  });

  it("consent for a confirmed follow, case and spaces aside; a pending or withdrawn one is no consent", async () => {
    await g.mailable("Follower@Example.com");
    expect(await recipientBasis(g.db, g.businessId, " follower@example.com ", now)).toBe("consent");
    await g.h.pg.query("update contact_consents set withdrawn_at = now() where business_id = $1", [g.businessId]);
    // The contact keeps lawful basis "consent", which counts only through a live consent row.
    expect(await recipientBasis(g.db, g.businessId, "follower@example.com", now)).toBe("none");
  });

  it("relationship for a verified reply or a payment within the window, and not after it", async () => {
    await event("lead.replied", { sentiment: "positive" }, [emailEntityId("writer@example.com")]);
    expect(await recipientBasis(g.db, g.businessId, "writer@example.com", now)).toBe("relationship");
    await event("lead.replied", { sentiment: "unsubscribe" }, [emailEntityId("quit@example.com")]);
    expect(await recipientBasis(g.db, g.businessId, "quit@example.com", now)).toBe("none");
    await event("payment.received", { customer: { email: "Payer@Example.com" } });
    expect(await recipientBasis(g.db, g.businessId, "payer@example.com", now)).toBe("relationship");
    await event("payment.received", { customer: { email: "old@example.com" } }, [], new Date(now.getTime() - 40 * 86_400_000));
    expect(await recipientBasis(g.db, g.businessId, "old@example.com", now)).toBe("none");
  });

  it("recorded only for a contact the founder added with a lawful basis; a channel's, an agent's or the Composer's is none", async () => {
    await g.mailable("added@example.com", "recorded");
    expect(await recipientBasis(g.db, g.businessId, "added@example.com", now)).toBe("recorded");
    const add = (email: string, source: string | null, lawfulBasis: string | null) => repos.entities.create(g.db, g.businessId, { kind: "person", displayName: email, identifiers: { email }, ...(source ? { source } : {}), ...(lawfulBasis ? { lawfulBasis } : {}) });
    await add("found@example.com", "lead_generation", "legitimate_interest");
    await add("agent@example.com", "agent", "legitimate_interest");
    await add("composer@example.com", "composer:unverified:00000000-0000-4000-8000-000000000000", "legitimate_interest");
    await add("nobasis@example.com", "user", null);
    for (const e of ["found@example.com", "agent@example.com", "composer@example.com", "nobasis@example.com"]) expect(await recipientBasis(g.db, g.businessId, e, now), e).toBe("none");
  });

  it("an address first seen in a web page still has none once the untrusted register lapses (a5 §7 item 16)", async () => {
    await g.recipients.clear(g.businessId);
    expect(await recipientBasis(g.db, g.businessId, "from.a.web.page@example.com", now)).toBe("none");
  });
});

describe("helpers", () => {
  it("only the founder's own sources count; an unknown one fails closed", () => {
    for (const s of [null, "lead_generation", "email_automation", "page", "agent", "agent:researcher", "squad", "team", "composer:unverified:x", "something_new"]) expect(sourceIsFounderMade(s), String(s)).toBe(false);
    for (const s of ["user", "manual", "stripe", "first_ten", "invite"]) expect(sourceIsFounderMade(s), s).toBe(true);
  });

  it("weakestBasis", () => {
    expect(weakestBasis([])).toBeUndefined();
    expect(weakestBasis(["consent", "relationship"])).toBe("relationship");
    expect(weakestBasis(["consent", "none", "recorded"])).toBe("none");
  });

  it("mailRecipientEmails reads who the mail goes to, never the sender", () => {
    expect(mailRecipientEmails({ from: { email: "hello@project.example" }, to: { email: "Anna@Example.com" }, text: "write to bob@example.com" })).toEqual(["anna@example.com"]);
    expect(mailRecipientEmails({ to: ["a@example.com", "b@example.com"], cc: ["a@example.com"], bcc: ["c@example.com"] }).sort()).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    expect(mailRecipientEmails({ listIds: ["l1"] })).toEqual([]);
    // The whole value, as the tool sends it: a scanner would read "brien@corp.example" here.
    expect(mailRecipientEmails({ to: { email: "O'Brien@Corp.example" } })).toEqual(["o'brien@corp.example"]);
    expect(mailRecipientEmails({ to: "Sam <sam@example.com>" })).toEqual(["sam@example.com"]);
  });
});
