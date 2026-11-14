/**
 * The api's half of the stream walls (security review S1).
 *
 * - A session belongs to Development and to the modules of the department its work is filed under: dev.sessions.*
 *   refuse a member walled from either, the same wall apps/stream puts on `as:<sessionId>`.
 * - Staff changes (team.humans.invite / role / remove) publish `membership.changed` through the outbox, so apps/stream
 *   re-checks that person's open subscriptions at once instead of streaming under the old access.
 */
import { repos } from "@foundmill/db";
import { MemoryRedis } from "@foundmill/events";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "stream-walls", redis: new MemoryRedis() });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

const walls = (sections: Record<string, "none" | "read" | "write">) => repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, sections);

describe("session replays follow the session's sections", () => {
  it("refuses a member walled from Development or from the module of the session's department, and nobody else", async () => {
    const businessId = hz.A.businessId;
    const sessionId = hz.A.sessionId; // works a task of the Product department
    const member = hz.caller({ userId: hz.A.memberId });
    try {
      const walled: Record<string, "none">[] = [{ product: "none" }, { development: "none" }];
      for (const sections of walled) {
        await walls(sections);
        expect(await code(member.dev.sessions.replay({ businessId, sessionId })), JSON.stringify(sections)).toBe("FORBIDDEN");
        expect(await code(member.dev.sessions.stream({ businessId, sessionId })), JSON.stringify(sections)).toBe("FORBIDDEN");
      }
      await walls({ finance: "none", crm: "none" });
      expect(await code(member.dev.sessions.replay({ businessId, sessionId }))).toBe("OK");
      expect(await member.dev.sessions.stream({ businessId, sessionId })).toMatchObject({ channel: `as:${sessionId}` });
    } finally {
      await walls({});
    }
    expect(await code(hz.caller({ userId: hz.A.viewerId }).dev.sessions.replay({ businessId, sessionId }))).toBe("OK");
  });

  it("files a session without a task under its agent's departments", async () => {
    const businessId = hz.A.businessId;
    const department = await repos.departments.create(hz.db, businessId, { name: "Money", slug: "money-walls", moduleKeys: ["finance"] });
    await repos.agents.update(hz.db, businessId, hz.A.agent2Id, { departmentIds: [department.id] });
    const session = await repos.agents.createSession(hz.db, businessId, { agentId: hz.A.agent2Id, modelKey: "sonnet" });
    expect(await repos.agents.sessionModuleKeys(hz.db, businessId, session)).toEqual(["finance"]);
    try {
      await walls({ finance: "none" });
      expect(await code(hz.caller({ userId: hz.A.memberId }).dev.sessions.replay({ businessId, sessionId: session.id }))).toBe("FORBIDDEN");
    } finally {
      await walls({});
      await repos.agents.update(hz.db, businessId, hz.A.agent2Id, { departmentIds: [] });
    }
  });
});

describe("staff changes reach apps/stream", () => {
  it("invitation.accept, team.humans.role and .remove each publish membership.changed for the person, through the outbox", async () => {
    const businessId = hz.A.businessId;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const changes = async (userId: string) =>
      (await repos.events.list(hz.db, businessId, { type: "membership.changed", limit: 200 })).items
        .filter((e) => (e.payload as { userId: string }).userId === userId)
        .map((e) => (e.payload as { change: string }).change)
        .sort();
    const newcomer = await hz.h.createUser("stream-walls-newcomer@test.local");
    // A newcomer takes a seat: on a plan with seats to spare.
    await owner.billing.changeTier({ businessId, tier: "scale" });
    try {
      const { link } = await owner.invitation.create({ businessId, role: "collaborator" });
      await hz.caller({ userId: newcomer }).invitation.accept({ confirmAdult: true, token: link.split("/i/")[1]! });
    } finally {
      await owner.billing.changeTier({ businessId, tier: "free" });
    }
    await owner.team.humans.role({ businessId, userId: newcomer, sectionPermissions: { finance: "none" } });
    await owner.team.humans.role({ businessId, userId: newcomer, role: "viewer" });
    await owner.team.humans.remove({ businessId, userId: newcomer });
    expect(await changes(newcomer)).toEqual(["added", "removed", "updated", "updated"]);
    // Nothing for a person who was not a member: there is no access to take away.
    const stranger = await hz.h.createUser("stream-walls-stranger@test.local");
    await owner.team.humans.remove({ businessId, userId: stranger });
    expect(await changes(stranger)).toEqual([]);
  });
});
