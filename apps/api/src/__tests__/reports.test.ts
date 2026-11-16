/**
 * report.create and operator.reports.* (docs/NETWORK.md F21; 0115). A person reports a person, a public profile or a
 * message, optionally blocking them; every answer reads the same whatever was stored; ten a day; it works with the
 * people layer closed; the queue is the operators' alone (NOT_FOUND for everyone else, a founder included).
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

const content = {
  headline: "Bakes bread",
  about: "",
  strengths: [],
  wantsToLearn: [],
  lookingFor: "on_my_own" as const,
  place: "",
};

describe("reports", () => {
  let hz: ApiHarness;
  let operator: string;
  let ana: string;
  let ben: string;
  let messageId: string;

  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "reports" });
    operator = await hz.h.createUser("operator@reports.test");
    // The list as an operator would set it: spaces, upper case and a stray value are all tolerated.
    hz.deps.env.OPERATOR_USER_IDS = ` not-an-id, ${operator.toUpperCase()} `;
    ana = hz.A.ownerId;
    ben = hz.B.ownerId;
    for (const [id, name] of [
      [ana, "Ana"],
      [ben, "Ben"],
      [operator, "Op"],
    ] as const)
      if (!(await repos.founders.get(hz.db, id)))
        await repos.founders.upsert(hz.db, id, { displayName: name });
    await repos.personProfiles.save(hz.db, ben, { handle: "ben-reports", content });
    await repos.personProfiles.publish(hz.db, ben);
    const link = await repos.social.requestConnection(hz.db, ben, ana);
    await repos.social.respondConnection(hz.db, ana, link.id, "accepted");
    const thread = await repos.social.startThread(hz.db, ben, [ana], null);
    messageId = (await repos.social.sendMessage(hz.db, ben, thread.id, "Pay me off the platform"))
      .id;
  }, 120_000);
  afterAll(() => hz.close());
  beforeEach(() => hz.limits.reset());

  const open = async () => repos.reports.listOpen(hz.db);

  it("stores one row for each kind, and a second report of the same thing stores none", async () => {
    const me = hz.caller({ userId: ana });
    expect(
      await me.report.create({
        target: { kind: "profile", handle: "ben-reports" },
        reason: "impersonation",
      }),
    ).toEqual({ reported: true, blocked: false });
    expect(
      await me.report.create({ target: { kind: "person", userId: ben }, reason: "spam" }),
    ).toEqual({ reported: true, blocked: false });
    expect(
      await me.report.create({
        target: { kind: "message", messageId },
        reason: "asks_for_money",
        note: "Asked for cash",
      }),
    ).toEqual({ reported: true, blocked: false });
    expect(
      await me.report.create({ target: { kind: "person", userId: ben }, reason: "harassment" }),
    ).toEqual({ reported: true, blocked: false });
    const rows = await open();
    expect(rows.map((r) => [r.targetKind, r.targetUserId])).toEqual([
      ["profile", ben],
      ["person", ben],
      ["message", ben],
    ]);
    // The message's words are kept with the report, as evidence.
    expect(rows[2]).toMatchObject({
      note: "Asked for cash",
      messageBody: "Pay me off the platform",
      openAboutPerson: 3,
    });
  });

  it("self, an unknown handle, an unknown person and a message the reporter never saw store nothing and answer the same", async () => {
    const before = (await open()).length;
    const outsider = hz.caller({ userId: ben });
    const me = hz.caller({ userId: ana });
    for (const p of [
      me.report.create({ target: { kind: "person", userId: ana }, reason: "spam" }),
      me.report.create({ target: { kind: "profile", handle: "no-such-person" }, reason: "spam" }),
      me.report.create({ target: { kind: "profile", handle: "Not A Handle!!" }, reason: "spam" }),
      me.report.create({
        target: { kind: "person", userId: "00000000-0000-4000-8000-000000000000" },
        reason: "spam",
      }),
      outsider.report.create({ target: { kind: "message", messageId }, reason: "spam" }),
    ])
      expect(await p).toEqual({ reported: true, blocked: false });
    // With "Also block", the answer echoes the ask whether or not anyone was found.
    for (const p of [
      me.report.create({
        target: { kind: "person", userId: "00000000-0000-4000-8000-000000000000" },
        reason: "spam",
        block: true,
      }),
      me.report.create({
        target: { kind: "profile", handle: "no-such-person" },
        reason: "spam",
        block: true,
      }),
      outsider.report.create({
        target: { kind: "message", messageId },
        reason: "spam",
        block: true,
      }),
    ])
      expect(await p).toEqual({ reported: true, blocked: true });
    expect((await open()).length).toBe(before);
  });

  it("blocks in the same step when asked", async () => {
    const me = hz.caller({ userId: ben });
    expect(
      await me.report.create({
        target: { kind: "person", userId: ana },
        reason: "harassment",
        block: true,
      }),
    ).toEqual({ reported: true, blocked: true });
    expect((await repos.social.blockedWith(hz.db, ben, [ana])).has(ana)).toBe(true);
    await repos.social
      .listConnections(hz.db, ben, { status: "blocked" })
      .then(async ([c]) => c && repos.social.removeConnection(hz.db, ben, c.id));
  });

  it("the eleventh report of a day is refused", async () => {
    const me = hz.caller({ userId: ana });
    let last = "OK";
    for (let i = 0; i < 11; i++)
      last = await code(
        me.report.create({ target: { kind: "profile", handle: `nobody-${i}` }, reason: "spam" }),
      );
    expect(last).toBe("TOO_MANY_REQUESTS");
  });

  it("works with the people layer closed (LIVE_MODE unset in this harness)", async () => {
    expect(hz.deps.env.LIVE_MODE).toBeUndefined();
    expect(await code(hz.caller({ userId: ana }).live.connections.list())).toBe("FORBIDDEN");
    hz.limits.reset();
    expect(
      await code(
        hz
          .caller({ userId: ben })
          .report.create({ target: { kind: "message", messageId }, reason: "spam" }),
      ),
    ).toBe("OK");
  });

  it("the Report control on /u/<handle>: for a signed-in visitor, never for the page's own person or a signed-out one", async () => {
    expect(
      await hz.caller({ userId: ana }).report.canReportProfile({ handle: "ben-reports" }),
    ).toEqual({ canReport: true });
    expect(
      await hz.caller({ userId: ben }).report.canReportProfile({ handle: "ben-reports" }),
    ).toEqual({ canReport: false });
    expect(await hz.caller(null).report.canReportProfile({ handle: "ben-reports" })).toEqual({
      canReport: false,
    });
    expect(
      await hz.caller({ userId: ana }).report.canReportProfile({ handle: "no-such-person" }),
    ).toEqual({ canReport: false });
  });

  it("the queue is NOT_FOUND for a founder and for a visitor; an operator lists and resolves", async () => {
    expect(await code(hz.caller({ userId: ana }).operator.reports.list())).toBe("NOT_FOUND");
    expect(
      await code(
        hz.caller({ userId: ana }).operator.reports.resolve({
          reportId: "00000000-0000-4000-8000-000000000000",
          resolution: "no_action",
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await code(hz.caller(null).operator.reports.list())).toBe("UNAUTHORIZED");
    const op = hz.caller({ userId: operator, email: "operator@reports.test" });
    const { reports, counts } = await op.operator.reports.list();
    expect(reports.length).toBeGreaterThan(0);
    expect(counts.open).toBe(reports.length);
    for (const r of reports)
      expect(await op.operator.reports.resolve({ reportId: r.id, resolution: "warned" })).toEqual({
        resolved: true,
      });
    expect(
      await op.operator.reports.resolve({ reportId: reports[0]!.id, resolution: "warned" }),
    ).toEqual({ resolved: false });
    expect((await op.operator.reports.list()).reports).toEqual([]);
  });
});
