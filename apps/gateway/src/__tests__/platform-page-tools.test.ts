/**
 * `read_public_page` and `propose_page_edit` (WP-08 T8): an agent reads its own project's page and proposes new words
 * that wait; a proposal never touches the draft or the published copy; limits and an empty proposal are refused; another
 * project's page is never read or changed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import type { PlatformCaller } from "@foundmill/connectors";
import { createDbPlatformHost } from "../platform-host";
import { silentLog } from "./harness";

let h: TestHarness;
let db: Db;
let a: PlatformCaller;
let b: PlatformCaller;

const content = { pitch: "Bike repairs at your door", about: "A van full of parts comes to the bike and fixes it where it stands.", forWhom: "People whose bike broke on the way to work", stage: "idea" as const, showFounders: false, followForm: true };

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  const callerFor = async (name: string): Promise<PlatformCaller> => {
    const biz = await repos.businesses.create(db, { name });
    const agent = await repos.agents.create(db, biz.id, { name: "Sam", agentType: "frontend_engineer", modelKey: "sonnet" });
    const session = await repos.agents.createSession(db, biz.id, { agentId: agent.id, modelKey: "sonnet" });
    return { businessId: biz.id, agentId: agent.id, sessionId: session.id };
  };
  a = await callerFor("Bikes");
  b = await callerFor("Elsewhere");
  await repos.pages.saveDraft(db, a.businessId, { draft: content, slug: "bikes-at-your-door", userId: null as never });
  await repos.pages.publish(db, a.businessId, { content, slug: "bikes-at-your-door", userId: null as never, at: new Date("2026-11-12T10:00:00Z") });
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe("page tools", () => {
  const host = () => createDbPlatformHost({ db, log: silentLog });

  it("reads the live page with its limits, and says why a short page is not listed", async () => {
    const page = await host().readPublicPage(a);
    expect(page).toMatchObject({ published: true, path: "/p/bikes-at-your-door", fields: { pitch: content.pitch, stage: "idea" }, listed: false, notListedReason: "short_about", limits: { pitch: 140, about: 1500, forWhom: 300 }, publishedOn: "2026-11-12" });
  });

  it("a proposal waits: the draft and the published copy do not change; a new one replaces it", async () => {
    await host().proposePageEdit(a, { fields: { pitch: "Bike repairs at your door, for people who commute" }, reason: "It names who it is for." });
    await host().proposePageEdit(a, { fields: { about: "We fix bikes where they stand." }, reason: "A clearer first sentence." });
    const row = (await repos.pages.get(db, a.businessId))!;
    expect(row.proposed).toEqual({ about: "We fix bikes where they stand." });
    expect(row.proposedNote).toBe("A clearer first sentence.");
    expect(row.proposedByAgentId).toBe(a.agentId);
    expect(row.draft.pitch).toBe(content.pitch);
    expect(row.published?.pitch).toBe(content.pitch);
    const events = (await repos.events.outboxPending(db, a.businessId)).filter((o) => o.event.type === "page.change_proposed");
    expect(events.map((e) => e.event.payload)).toEqual([{ agentId: a.agentId, fields: ["pitch"] }, { agentId: a.agentId, fields: ["about"] }]);
  });

  it("refuses an empty proposal and a field over its limit, and never touches another project", async () => {
    await expect(host().proposePageEdit(a, { fields: {}, reason: "nothing" })).rejects.toThrow(/at least one/);
    await expect(host().proposePageEdit(a, { fields: { pitch: "x".repeat(141) }, reason: "too long" })).rejects.toThrow();
    // Project B has no page row: nothing to change.
    await expect(host().proposePageEdit(b, { fields: { pitch: "A pitch for nothing" }, reason: "no page" })).rejects.toThrow(/no page/);
    expect((await host().readPublicPage(b)).published).toBe(false);
    expect((await repos.pages.get(db, a.businessId))!.proposed).toEqual({ about: "We fix bikes where they stand." });
  });
});
