/**
 * LIVE is closed unless the deployment opens it (FLAGS.liveMode is false; `LIVE_MODE=1` opens it for one environment):
 * while closed, Go live and committing as LIVE are refused, every live.* procedure answers 403, and a stored "live" reads
 * as Personal; Personal always works, and switching back to Personal is never blocked (audit VLS2-X1, VGLS2-X1).
 */
import { liveModeOpen } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_CLOSED_MESSAGE } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? `${err.code}: ${err.message}` : `other:${String(err)}`;
  }
};

describe("liveModeOpen", () => {
  it("is closed unless LIVE_MODE says yes (or the flag is on)", () => {
    expect(liveModeOpen({})).toBe(false);
    expect(liveModeOpen({ LIVE_MODE: "" })).toBe(false);
    expect(liveModeOpen({ LIVE_MODE: "0" })).toBe(false);
    expect(liveModeOpen({ LIVE_MODE: "maybe" })).toBe(false);
    for (const on of ["1", "true", "YES", " on "]) expect(liveModeOpen({ LIVE_MODE: on })).toBe(true);
    expect(liveModeOpen({}, true)).toBe(true);
  });
});

describe("LIVE closed", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "livegate" });
  }, 120_000);
  afterAll(() => hz.close());

  it("refuses Go live and keeps the business Personal", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await code(owner.business.setGameMode({ businessId, gameMode: "live" }))).toBe(`FORBIDDEN: ${LIVE_CLOSED_MESSAGE}`);
    expect((await repos.businesses.get(hz.db, businessId)).gameMode).toBe("personal");
    // Personal is always allowed.
    expect(await code(owner.business.setGameMode({ businessId, gameMode: "personal" }))).toBe("OK");
  });

  it("answers 403 on every live.* procedure", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const other = hz.B.ownerId;
    const calls: Promise<unknown>[] = [
      owner.live.connections.list(),
      owner.live.connections.request({ businessId, toUserId: other }),
      owner.live.messages.threads(),
      owner.live.messages.unread(),
      owner.live.communities.list(),
      owner.live.leaderboards.list(),
      owner.live.leaderboards.positions({ businessId }),
      owner.live.profile.visibility.get(),
      owner.live.people.lookup({ userIds: [other] }),
    ];
    for (const result of await Promise.all(calls.map(code))) expect(result).toBe(`FORBIDDEN: ${LIVE_CLOSED_MESSAGE}`);
  });

  it("refuses to commit a business as LIVE", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const idea = (await owner.idea.generate({ prompt: "bookkeeping for freelancers" })).ideas[0]!;
    expect(await code(owner.idea.commit({ ideaId: idea.id, name: "Live Too Soon", archetype: "b2b_saas", gameMode: "live" }))).toBe(`FORBIDDEN: ${LIVE_CLOSED_MESSAGE}`);
  });

  it("reads a stored LIVE business as Personal and says LIVE is closed; the account features say so too", async () => {
    const { businessId, ownerId } = hz.A;
    await repos.businesses.setGameMode(hz.db, businessId, "live");
    const owner = hz.caller({ userId: ownerId });
    const got = await owner.business.get({ businessId });
    expect(got.business.gameMode).toBe("personal");
    expect(got.liveOpen).toBe(false);
    expect((await owner.founder.profile.get()).features).toEqual({ liveMode: false });
    // Switching back is never blocked.
    expect(await code(owner.business.setGameMode({ businessId, gameMode: "personal" }))).toBe("OK");
  });
});

describe("LIVE open", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "liveopen", env: { LIVE_MODE: "1" } });
  }, 120_000);
  afterAll(() => hz.close());

  it("allows Go live and the live.* procedures, and reports the stored mode", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await code(owner.business.setGameMode({ businessId, gameMode: "live" }))).toBe("OK");
    const got = await owner.business.get({ businessId });
    expect(got.business.gameMode).toBe("live");
    expect(got.liveOpen).toBe(true);
    expect(await code(owner.live.connections.list())).toBe("OK");
    expect((await owner.founder.profile.get()).features).toEqual({ liveMode: true });
  });
});
