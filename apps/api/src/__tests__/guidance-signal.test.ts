/**
 * founder.preferences.signal (docs/UX_AUDIT_AND_PLAN.md §11): the guided layer's product signals land as guidance.*
 * events in the business the founder was in, through the outbox, with the founder as the actor. Another business is
 * FORBIDDEN, a malformed signal is BAD_REQUEST, and an example membership writes nothing into the demo's log.
 */
import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "guidance-signal" });
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

const latest = async (businessId: string, type: string) => (await repos.events.list(hz.db, businessId, { type: type as never, limit: 5 })).items[0];

describe("founder.preferences.signal", () => {
  it("writes each signal as a guidance.* event with the founder as the actor", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.tour_completed", tourId: "home", steps: 4 } })).toMatchObject({ written: true });
    expect((await latest(hz.A.businessId, "guidance.tour_completed"))?.payload).toEqual({ tourId: "home", steps: 4 });
    expect((await latest(hz.A.businessId, "guidance.tour_completed"))?.actor).toEqual({ kind: "user", id: hz.A.ownerId });

    await owner.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.tour_skipped", tourId: "inbox", atStep: 2, steps: 4 } });
    expect((await latest(hz.A.businessId, "guidance.tour_skipped"))?.payload).toEqual({ tourId: "inbox", atStep: 2, steps: 4 });

    await owner.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.explainer_dismissed", screenId: "finance/runway" } });
    expect((await latest(hz.A.businessId, "guidance.explainer_dismissed"))?.payload).toEqual({ screenId: "finance/runway" });

    await owner.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.term_opened", termId: "runway" } });
    expect((await latest(hz.A.businessId, "guidance.term_opened"))?.payload).toEqual({ termId: "runway", screenId: null });
  });

  it("guidance.turned_off carries how far the founder had come, read from their preferences", async () => {
    const member = hz.caller({ userId: hz.A.memberId });
    await member.founder.preferences.update({ toursDone: { home: true, inbox: true }, explainersSeen: { home: true } });
    await member.founder.preferences.update({ guidance: "off" });
    await member.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.turned_off", from: "settings" } });
    const ev = await latest(hz.A.businessId, "guidance.turned_off");
    expect(ev?.payload).toEqual({ from: "settings", toursDone: 2, explainersSeen: 1 });
    expect(ev?.actor).toEqual({ kind: "user", id: hz.A.memberId });
  });

  it("refuses a business the caller does not belong to, and a malformed signal", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await code(owner.founder.preferences.signal({ businessId: hz.B.businessId, signal: { type: "guidance.term_opened", termId: "runway" } }))).toBe("FORBIDDEN");
    expect(await latest(hz.B.businessId, "guidance.term_opened")).toBeUndefined();
    expect(await code(owner.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.term_opened", termId: "Net burn" } }))).toBe("BAD_REQUEST");
    expect(await code(owner.founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.turned_off", from: "profile" as never } }))).toBe("BAD_REQUEST");
    expect(await code(hz.caller(null).founder.preferences.signal({ businessId: hz.A.businessId, signal: { type: "guidance.term_opened", termId: "runway" } }))).toBe("UNAUTHORIZED");
  });

  it("an example membership writes nothing into the demo business's log", async () => {
    const visitor = await hz.h.createUser("guidance-signal-visitor@test.local");
    await repos.memberships.openExample(hz.db, hz.B.businessId, visitor);
    expect(await hz.caller({ userId: visitor }).founder.preferences.signal({ businessId: hz.B.businessId, signal: { type: "guidance.tour_completed", tourId: "example-start", steps: 1 } })).toEqual({ written: false });
    expect(await latest(hz.B.businessId, "guidance.tour_completed")).toBeUndefined();
  });
});
