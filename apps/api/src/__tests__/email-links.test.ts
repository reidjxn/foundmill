/**
 * email.action.* and email.pause (retention plan, 2026-11-11): a one-click answer from a founder email works once, for
 * the option it was minted for, while the founder still runs the business and the note is still open; looking at the
 * link changes nothing; the pause link pauses every email for the account it was signed for.
 */
import { repos } from "@foundmill/db";
import { FOUNDER_NOTIFICATION_LIMITS } from "@foundmill/shared";
import { emailLinkSecret, newActionToken, signPauseToken } from "@foundmill/shared/email-links";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "email-links" });
}, 120_000);
afterAll(() => hz.close());

const options = [
  { id: "plan", label: "Ask the strategist for a channel plan", recommended: true, consequence: "Nothing is spent until you pick.", cost_minor: 0, reversible: true },
  { id: "wait", label: "Hold for now", recommended: false, consequence: "Nobody new hears about the product yet.", cost_minor: 0, reversible: true },
];

async function decisionNote(subject: string, opts = options) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, { type: "decision", blocks_continue: false, from_agent_id: hz.A.agentId, subject, body_md: "Where should we look first?", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: opts, free_text: true, expires_at: null }, source_event_ids: [], entity_ids: [] });
}

async function mint(itemId: string, opts: { userId?: string; optionId?: string; expiresAt?: Date } = {}) {
  const t = newActionToken();
  await repos.notifications.claim(hz.db, hz.A.businessId, {
    userId: opts.userId ?? hz.A.ownerId,
    kind: "decision_waiting",
    dedupeKey: `decision_waiting:${itemId}:${t.hash.slice(0, 8)}`,
    subject: "Waiting",
    bodyText: "",
    bodyHtml: "",
    action: { itemId, optionId: opts.optionId ?? "plan", tokenHash: t.hash, expiresAt: opts.expiresAt ?? new Date(Date.now() + FOUNDER_NOTIFICATION_LIMITS.actionTtlMs) },
  });
  return t.token;
}

describe("email.action", () => {
  it("shows what the answer does without answering, then answers once", async () => {
    const anon = hz.caller(null);
    const note = await decisionNote("Pick where to look for customers first");
    const token = await mint(note.id);
    expect(await anon.email.action.get({ token })).toMatchObject({ state: "ready", optionLabel: "Ask the strategist for a channel plan", subject: "Pick where to look for customers first" });
    expect((await repos.notifyFacts.item(hz.db, hz.A.businessId, note.id))?.state).not.toBe("answered");
    const answered = await anon.email.action.answer({ token });
    expect(answered.state).toBe("answered");
    expect((await repos.notifyFacts.item(hz.db, hz.A.businessId, note.id))?.state).toBe("answered");
    expect((await anon.email.action.answer({ token })).state).toBe("used");
    expect((await anon.email.action.get({ token })).state).toBe("used");
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "inbox.decide.from_email", limit: 5 });
    expect(audit.items[0]).toMatchObject({ actorId: hz.A.ownerId });
  });

  it("refuses an expired token, a made-up one, and a note answered in the app since", async () => {
    const anon = hz.caller(null);
    const a = await decisionNote("Expired one");
    expect((await anon.email.action.answer({ token: await mint(a.id, { expiresAt: new Date(Date.now() - 1000) }) })).state).toBe("expired");
    expect((await anon.email.action.get({ token: "x".repeat(43) })).state).toBe("unavailable");
    expect((await anon.email.action.get({ token: "not a token" })).state).toBe("unavailable");
    const b = await decisionNote("Answered in the app");
    const token = await mint(b.id);
    await hz.caller({ userId: hz.A.ownerId }).inbox.decide({ itemId: b.id, businessId: hz.A.businessId, chosenOption: "wait" } as never);
    expect((await anon.email.action.answer({ token })).state).toBe("answered");
  });

  it("never answers an option that is no longer the recommended reversible one, or for someone who left the business's owners and admins", async () => {
    const anon = hz.caller(null);
    const irreversible = await decisionNote("Irreversible", [{ ...options[0]!, reversible: false }, options[1]!]);
    expect((await anon.email.action.answer({ token: await mint(irreversible.id) })).state).toBe("unavailable");
    const wrongOption = await decisionNote("Wrong option");
    expect((await anon.email.action.answer({ token: await mint(wrongOption.id, { optionId: "wait" }) })).state).toBe("unavailable");
    const member = await decisionNote("A member's link");
    expect((await anon.email.action.answer({ token: await mint(member.id, { userId: hz.A.memberId }) })).state).toBe("unavailable");
    const sends = await decisionNote("Sends a message", [{ ...options[0]!, actions: [{ type: "send_message", params: { to: "someone@example.com" } }] } as never, options[1]!]);
    expect((await anon.email.action.answer({ token: await mint(sends.id) })).state).toBe("unavailable");
    for (const n of [irreversible, wrongOption, member, sends]) expect((await repos.notifyFacts.item(hz.db, hz.A.businessId, n.id))?.state).not.toBe("answered");
  });
});

describe("email.action and section permissions", () => {
  it("refuses an admin who may only read the Inbox, and says nothing about a dead link", async () => {
    const anon = hz.caller(null);
    await hz.h.pg.query(`update memberships set section_permissions = '{"inbox":"read"}'::jsonb where business_id = $1 and user_id = $2`, [hz.A.businessId, hz.A.adminId]);
    const note = await decisionNote("Walled admin");
    const r = await anon.email.action.get({ token: await mint(note.id, { userId: hz.A.adminId }) });
    expect(r).toEqual({ state: "unavailable", businessName: null, subject: null, optionLabel: null, consequence: null, businessId: null, itemId: null });
  });
});

describe("email.pause", () => {
  it("pauses every email for the signed account, and refuses a forged link", async () => {
    const anon = hz.caller(null);
    const token = signPauseToken(emailLinkSecret(hz.deps.env), hz.A.adminId);
    expect(await anon.email.pause({ token })).toEqual({ paused: true });
    expect((await repos.emailPrefs.get(hz.db, hz.A.adminId)).emailsPausedAt).not.toBeNull();
    expect(await anon.email.pause({ token: signPauseToken("another secret", hz.A.memberId) })).toEqual({ paused: false });
    expect((await repos.emailPrefs.get(hz.db, hz.A.memberId)).emailsPausedAt).toBeNull();
  });
});
