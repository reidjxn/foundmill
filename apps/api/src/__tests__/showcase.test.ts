/**
 * Showcase videos of real projects (services/showcase.ts; migration 0105), end to end through the api's procedures:
 *
 *   - only the house's owners ask; only an eligible project is asked (a sample, a hidden milestone, a recent ask and a
 *     project whose founders switched the setting off are refused);
 *   - the video waits while Runway is not connected on the house; a simulated clip never goes out for a yes; the ask
 *     goes out only once the media is final, to every founder, each with their own note;
 *   - one founder's no, withdrawal or departure overrides the others' yes; every founder's yes writes the house's draft;
 *   - the share gate refuses an edited draft, a new founder, a private page, a hidden milestone and a lapsed approval;
 *   - a withdrawal sets the draft aside, deletes the media and tells the house where a share was opened;
 *   - no event carries a founder's answer.
 */
import { HOUSE_BUSINESS_ID } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { SHOWCASE_APPROVAL_TTL_MS, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiGatewayClient, GatewayToolCallOutcome, GatewayToolCallRequest } from "../services/gateway";
import { advanceShowcase, settleShowcaseRuns, showcaseShareGate } from "../services/showcase";
import { createApiHarness, type ApiHarness } from "./harness";

/** A Runway double behind the gateway's generic tool call: what the gateway would answer, by tool name. */
const runway = {
  calls: [] as GatewayToolCallRequest[],
  mode: "real" as "real" | "simulated" | "ask",
  reset() {
    this.calls = [];
    this.mode = "real";
  },
  async toolCall(input: GatewayToolCallRequest): Promise<GatewayToolCallOutcome> {
    runway.calls.push(input);
    if (input.tool === "generate_video_from_image") {
      if (runway.mode === "ask") return { outcome: "ask", approvalId: "00000000-0000-4000-8000-0000000000aa", reasons: ["spends money"] };
      return { outcome: "allow", auditId: "a", result: { ok: true, data: { untrusted: true, content: { taskId: `0000000${runway.calls.length}-0000-4000-8000-000000000000`.slice(-36).padStart(36, "0"), estimatedCredits: 25 } }, ...(runway.mode === "simulated" ? { simulated: true as const, notice: "Simulated" } : {}) } };
    }
    const taskId = (input.args as { taskId: string }).taskId;
    return { outcome: "allow", auditId: "a", result: { ok: true, data: { untrusted: true, content: { taskId, status: "SUCCEEDED", outputUrls: [`https://cdn.runway.test/${taskId}.mp4`], urlsExpireAt: new Date(Date.now() + 86_400_000).toISOString() } }, ...(runway.mode === "simulated" ? { simulated: true as const } : {}) } };
  },
};

let hz: ApiHarness;
let houseOwner: string;
let houseMember: string;
beforeAll(async () => {
  const refuse = () => {
    throw new Error("gateway not running in tests");
  };
  const gateway = new Proxy({ toolCall: runway.toolCall } as unknown as ApiGatewayClient, { get: (t, p) => (p in t ? (t as never)[p] : refuse) });
  hz = await createApiHarness({ prefix: "showcase", gateway });
  [houseOwner, houseMember] = await Promise.all([hz.h.createUser("showcase-house-owner@test.local"), hz.h.createUser("showcase-house-member@test.local")]);
  await repos.businesses.create(hz.db, { id: HOUSE_BUSINESS_ID, name: "Foundmill House", archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, HOUSE_BUSINESS_ID, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, HOUSE_BUSINESS_ID, { userId: houseOwner, role: "owner" });
  await repos.memberships.add(hz.db, HOUSE_BUSINESS_ID, { userId: houseMember, role: "member" });
  const agent = (await hz.db.execute(sql`insert into agents (business_id, name, agent_type, layer) values (${HOUSE_BUSINESS_ID}, 'House social', 'engineer', 'worker') returning id`)) as unknown as { rows: { id: string }[] };
  await hz.db.execute(sql`insert into channels (business_id, channel_key, line, enabled, owner_agent_id) values (${HOUSE_BUSINESS_ID}, 'social', 'midfield', true, ${agent.rows[0]!.id}) on conflict do nothing`);
  await hz.db.execute(sql`update channels set owner_agent_id = ${agent.rows[0]!.id} where business_id = ${HOUSE_BUSINESS_ID} and channel_key = 'social'`);
}, 120_000);
afterAll(() => hz?.close());
beforeEach(async () => {
  runway.reset();
  hz.limits.reset();
  await connectRunway(true);
});

async function connectRunway(on: boolean) {
  await hz.db.execute(sql`delete from integrations where business_id = ${HOUSE_BUSINESS_ID} and connector_key = 'runway'`);
  if (on) await hz.db.execute(sql`insert into integrations (business_id, connector_key, status, auth_kind) values (${HOUSE_BUSINESS_ID}, 'runway', 'connected', 'api_key')`);
}

const page = (): ProjectPageContent => ({ pitch: "Sourdough, baked each morning", about: "Small batches.", forWhom: "", stage: "building", showFounders: false, followForm: true });
const house = () => hz.caller({ userId: houseOwner });
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string; cause?: { code?: string } }) => err.cause?.code ?? err.code ?? "unknown");

let n = 0;
/** A project with a public page and its page-live milestone shown; `cofounder` adds a second founder; `collaborator` a third person. */
async function project(name: string, options: { cofounder?: boolean; demo?: boolean } = {}) {
  n += 1;
  const [ownerId, cofounderId, collaboratorId] = await Promise.all(["owner", "cofounder", "collaborator"].map((r) => hz.h.createUser(`showcase-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  if (options.cofounder) await repos.memberships.add(hz.db, b.id, { userId: cofounderId!, role: "cofounder" });
  await repos.memberships.add(hz.db, b.id, { userId: collaboratorId!, role: "collaborator" });
  const owner = hz.caller({ userId: ownerId! });
  await owner.page.publish({ businessId: b.id, content: page() });
  const milestone = (await repos.journeys.listMilestones(hz.db, b.id)).find((m) => (m.ref as { trophyKey?: string } | null)?.trophyKey === "page_live")!;
  await owner.journey.showMilestone({ businessId: b.id, milestoneId: milestone.id });
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  return { id: b.id, ownerId: ownerId!, cofounderId: cofounderId!, collaboratorId: collaboratorId!, owner, cofounder: hz.caller({ userId: cofounderId! }), collaborator: hz.caller({ userId: collaboratorId! }), milestoneId: milestone.id };
}

/** The request made, its video made (two steps: start, then follow), and the asks sent. */
async function askedFor(p: Awaited<ReturnType<typeof project>>) {
  const req = await house().showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: p.id });
  await settleShowcaseRuns();
  await advanceShowcase({ db: hz.db, gateway: hz.deps.gateway, env: hz.deps.env, log: hz.deps.log }, req.id);
  return req;
}
const step = (requestId: string) => advanceShowcase({ db: hz.db, gateway: hz.deps.gateway, env: hz.deps.env, log: hz.deps.log }, requestId);
const requestRow = async (id: string) => (await repos.showcase.requestById(hz.db, id))!;
const noteOf = async (businessId: string, userId: string) => (await hz.db.execute(sql`select id from inbox_items where business_id = ${businessId} and for_user_id = ${userId}`)) as unknown as { rows: { id: string }[] };
const askOf = async (who: Awaited<ReturnType<typeof project>>["owner"], businessId: string, userId: string) => who.showcase.ask({ businessId, inboxItemId: (await noteOf(businessId, userId)).rows[0]!.id });
const events = async (businessId: string, prefix: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type.startsWith(prefix)).map((o) => ({ type: o.event.type, payload: o.event.payload }));

describe("who asks, and who may be asked", () => {
  it("only an owner of the house asks: a house member, a project's founder and an outsider are refused", async () => {
    const p = await project("Askers");
    expect(await code(hz.caller({ userId: houseMember }).showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: p.id }))).toBe("forbidden");
    expect(await code(p.owner.showcase.request({ businessId: p.id, subjectBusinessId: p.id }))).toBe("forbidden");
    expect(await code(p.owner.showcase.candidates({ businessId: p.id }))).toBe("forbidden");
    expect((await house().showcase.candidates({ businessId: HOUSE_BUSINESS_ID })).find((c) => c.businessId === p.id)).toMatchObject({ eligible: true, why: null });
  });

  it("refuses a sample, a project whose milestone is hidden, a recent ask and a project whose founders switched the setting off", async () => {
    const sample = await project("Sample", { demo: true });
    expect(await code(house().showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: sample.id }))).toBe("showcase_not_eligible");
    const hidden = await project("Hidden");
    await hidden.owner.journey.hideMilestone({ businessId: hidden.id, milestoneId: hidden.milestoneId });
    expect(await code(house().showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: hidden.id }))).toBe("showcase_not_eligible");
    const off = await project("Off");
    expect((await off.collaborator.showcase.setting.get({ businessId: off.id })).canChange).toBe(false);
    expect(await code(off.collaborator.showcase.setting.set({ businessId: off.id, mayAsk: false }))).toBe("forbidden");
    expect(await off.owner.showcase.setting.get({ businessId: off.id })).toEqual({ mayAsk: true, chosen: false, canChange: true });
    await off.owner.showcase.setting.set({ businessId: off.id, mayAsk: false });
    expect(await code(house().showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: off.id }))).toBe("showcase_not_eligible");
    const recent = await project("Recent");
    const req = await house().showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: recent.id });
    await settleShowcaseRuns();
    await house().showcase.withdraw({ businessId: HOUSE_BUSINESS_ID, requestId: req.id });
    expect(await code(house().showcase.request({ businessId: HOUSE_BUSINESS_ID, subjectBusinessId: recent.id }))).toBe("showcase_not_eligible");
  });
});

describe("the video, and the ask once it is final", () => {
  it("waits while Runway is not connected on the house: no call, no ask", async () => {
    await connectRunway(false);
    const p = await project("Waiting");
    const req = await askedFor(p);
    expect(runway.calls).toEqual([]);
    expect(await requestRow(req.id)).toMatchObject({ state: "asking", askedAt: null, media: { waiting: "not_connected" } });
    expect((await noteOf(p.id, p.ownerId)).rows).toEqual([]);
  });

  it("waits for the house's approval when the gateway asks before spending", async () => {
    runway.mode = "ask";
    const p = await project("Approval");
    const req = await askedFor(p);
    expect(runway.calls.map((c) => [c.connector, c.tool])).toContainEqual(["runway", "generate_video_from_image"]);
    expect((await requestRow(req.id)).askedAt).toBeNull();
    expect((await noteOf(p.id, p.ownerId)).rows).toEqual([]);
  });

  it("a simulated clip never goes out for a yes", async () => {
    runway.mode = "simulated";
    const p = await project("Simulated");
    const req = await askedFor(p);
    await step(req.id);
    expect(await requestRow(req.id)).toMatchObject({ state: "asking", askedAt: null, media: { waiting: "simulated" } });
    expect((await noteOf(p.id, p.ownerId)).rows).toEqual([]);
  });

  it("once real and final, every founder gets their own note; a collaborator gets none and reads nothing", async () => {
    const p = await project("Final", { cofounder: true });
    const req = await askedFor(p);
    // Each clip is made from the card's tall image on Foundmill's own key, through the generic tool call.
    expect(runway.calls[0]).toMatchObject({ businessId: HOUSE_BUSINESS_ID, connector: "runway", tool: "generate_video_from_image", args: { promptImageUrl: expect.stringMatching(/\/m\/.+\/story-image$/), ratio: "720:1280" } });
    const row = await requestRow(req.id);
    expect(row.askedAt).not.toBeNull();
    expect(row.preview.video!.clips).toHaveLength(1);
    expect((await noteOf(p.id, p.ownerId)).rows).toHaveLength(1);
    expect((await noteOf(p.id, p.cofounderId)).rows).toHaveLength(1);
    expect((await noteOf(p.id, p.collaboratorId)).rows).toEqual([]);
    const mine = await askOf(p.owner, p.id, p.ownerId);
    expect(mine).toMatchObject({ state: "asking", answer: null, canAnswer: true, preview: { link: expect.stringMatching(/\/p\/.+\/story\?via=p\./), networks: expect.arrayContaining(["instagram"]) } });
    // The owner cannot open the cofounder's note, and a collaborator cannot open any ask.
    expect(await code(p.owner.showcase.ask({ businessId: p.id, inboxItemId: (await noteOf(p.id, p.cofounderId)).rows[0]!.id }))).toBe("not_found");
    expect(await code(p.collaborator.showcase.ask({ businessId: p.id, consentId: mine.consentId }))).toBe("forbidden");
    // The generic Inbox answer is refused: the ask is answered from the note.
    expect(await code(p.owner.inbox.decide({ businessId: p.id, itemId: (await noteOf(p.id, p.ownerId)).rows[0]!.id, chosenOption: null, freeText: "yes" } as never))).toBe("showcase_answer_here");
    expect(await events(p.id, "showcase.")).toEqual([{ type: "showcase.asked", payload: { requestId: req.id } }]);
  });
});

describe("the answers: one founder's no, withdrawal or departure overrides the others' yes", () => {
  it("a solo founder's yes approves and writes the house's draft", async () => {
    const p = await project("Solo");
    const req = await askedFor(p);
    const mine = await askOf(p.owner, p.id, p.ownerId);
    expect(await p.owner.showcase.answer({ businessId: p.id, consentId: mine.consentId, answer: "yes" })).toMatchObject({ answer: "yes", state: "approved", canWithdraw: true });
    const row = await requestRow(req.id);
    expect(row).toMatchObject({ state: "approved", assetId: expect.any(String) });
    const gate = await showcaseShareGate(hz.db, HOUSE_BUSINESS_ID, row.assetId!, new Date());
    expect(gate?.refusal).toBeNull();
    expect((await events(HOUSE_BUSINESS_ID, "showcase.")).filter((e) => (e.payload as { requestId: string }).requestId === req.id).map((e) => e.type)).toEqual(["showcase.requested", "showcase.approved"]);
  });

  it("one no declines, whatever the other said; nothing carries who said what", async () => {
    const p = await project("Declined", { cofounder: true });
    const req = await askedFor(p);
    const a = await askOf(p.owner, p.id, p.ownerId);
    const b = await askOf(p.cofounder, p.id, p.cofounderId);
    await p.owner.showcase.answer({ businessId: p.id, consentId: a.consentId, answer: "yes" });
    expect((await requestRow(req.id)).state).toBe("asking");
    await p.cofounder.showcase.answer({ businessId: p.id, consentId: b.consentId, answer: "no" });
    expect(await requestRow(req.id)).toMatchObject({ state: "declined", withdrawReason: "declined", assetId: null });
    const all = [...(await events(p.id, "showcase.")), ...(await events(HOUSE_BUSINESS_ID, "showcase."))];
    expect(JSON.stringify(all)).not.toMatch(new RegExp(`${p.ownerId}|${p.cofounderId}|"answer"`));
    expect(await events(p.id, "showcase.settled")).toEqual([{ type: "showcase.settled", payload: { requestId: req.id, state: "declined" } }]);
    // Each founder still reads only their own answer.
    const ownRow = await p.owner.showcase.ask({ businessId: p.id, consentId: a.consentId });
    expect(ownRow).toMatchObject({ answer: "yes", state: "declined", canAnswer: false });
    expect(Object.keys(ownRow)).not.toContain("answers");
  });

  it("one founder's withdrawal after everyone said yes withdraws the video: the draft set aside, the media deleted, the house told where it was shared", async () => {
    const p = await project("Withdrawn", { cofounder: true });
    const req = await askedFor(p);
    const a = await askOf(p.owner, p.id, p.ownerId);
    const b = await askOf(p.cofounder, p.id, p.cofounderId);
    await p.owner.showcase.answer({ businessId: p.id, consentId: a.consentId, answer: "yes" });
    await p.cofounder.showcase.answer({ businessId: p.id, consentId: b.consentId, answer: "yes" });
    const approved = await requestRow(req.id);
    expect(approved.state).toBe("approved");
    // The house opened a share of the draft on a network the founders were shown.
    expect(await house().share.opened({ businessId: HOUSE_BUSINESS_ID, kind: "draft", refId: approved.assetId, network: "instagram", target: "tap" })).toEqual({ recorded: true });
    // Not on a network they were not shown.
    expect(await code(house().share.opened({ businessId: HOUSE_BUSINESS_ID, kind: "draft", refId: approved.assetId, network: "reddit", target: "tap" }))).toBe("forbidden");
    await p.cofounder.showcase.withdrawMine({ businessId: p.id, consentId: b.consentId });
    const row = await requestRow(req.id);
    expect(row).toMatchObject({ state: "withdrawn", withdrawReason: "founder_withdrew" });
    expect(row.preview.video!.clips.every((c) => c.url === null)).toBe(true);
    expect((await repos.showcase.draft(hz.db, HOUSE_BUSINESS_ID, approved.assetId!))!.approvalState).toBe("rejected");
    const takeDown = (await hz.db.execute(sql`select subject, body_md from inbox_items where business_id = ${HOUSE_BUSINESS_ID} and subject like 'Take the video about%'`)) as unknown as { rows: { subject: string; body_md: string }[] };
    expect(takeDown.rows.at(-1)?.body_md).toMatch(/instagram/);
    expect(await code(house().share.opened({ businessId: HOUSE_BUSINESS_ID, kind: "draft", refId: approved.assetId, network: "instagram", target: "tap" }))).toBe("showcase_share_refused");
  });

  it("a founder who joins after the yes withdraws it: they were never asked", async () => {
    const p = await project("Joined");
    const req = await askedFor(p);
    await p.owner.showcase.answer({ businessId: p.id, consentId: (await askOf(p.owner, p.id, p.ownerId)).consentId, answer: "yes" });
    const assetId = (await requestRow(req.id)).assetId!;
    await repos.memberships.add(hz.db, p.id, { userId: p.cofounderId, role: "cofounder" });
    expect((await showcaseShareGate(hz.db, HOUSE_BUSINESS_ID, assetId, new Date()))?.refusal).toBe("founders_changed");
    await step(req.id);
    expect(await requestRow(req.id)).toMatchObject({ state: "withdrawn", withdrawReason: "founders_changed" });
  });

  it("a founder who leaves while asking withdraws it", async () => {
    const p = await project("Left", { cofounder: true });
    const req = await askedFor(p);
    await p.owner.showcase.answer({ businessId: p.id, consentId: (await askOf(p.owner, p.id, p.ownerId)).consentId, answer: "yes" });
    await hz.db.execute(sql`delete from memberships where business_id = ${p.id} and user_id = ${p.cofounderId}`);
    await step(req.id);
    expect(await requestRow(req.id)).toMatchObject({ state: "withdrawn", withdrawReason: "founders_changed" });
  });
});

describe("the share gate and the other ways a video is withdrawn", () => {
  async function approved(name: string) {
    const p = await project(name);
    const req = await askedFor(p);
    await p.owner.showcase.answer({ businessId: p.id, consentId: (await askOf(p.owner, p.id, p.ownerId)).consentId, answer: "yes" });
    return { p, req, assetId: (await requestRow(req.id)).assetId! };
  }

  it("refuses an edited draft: any edit needs a new ask", async () => {
    const { assetId } = await approved("Edited");
    await hz.db.execute(sql`update assets set body = body || ' And more.' where id = ${assetId}`);
    expect((await showcaseShareGate(hz.db, HOUSE_BUSINESS_ID, assetId, new Date()))?.refusal).toBe("draft_changed");
  });

  it("refuses after the approval lapses, and the sweep expires it", async () => {
    const { req, assetId } = await approved("Lapsed");
    const later = new Date(Date.now() + SHOWCASE_APPROVAL_TTL_MS + 1000);
    expect((await showcaseShareGate(hz.db, HOUSE_BUSINESS_ID, assetId, later))?.refusal).toBe("approval_lapsed");
    await advanceShowcase({ db: hz.db, gateway: hz.deps.gateway, env: hz.deps.env, log: hz.deps.log, now: () => later }, req.id);
    expect(await requestRow(req.id)).toMatchObject({ state: "expired", withdrawReason: "approval_lapsed" });
  });

  it("the page going private withdraws it", async () => {
    const { p, req, assetId } = await approved("Private");
    await p.owner.page.unpublish({ businessId: p.id });
    await settleShowcaseRuns();
    expect(await requestRow(req.id)).toMatchObject({ state: "withdrawn", withdrawReason: "page_private" });
    expect((await showcaseShareGate(hz.db, HOUSE_BUSINESS_ID, assetId, new Date()))?.refusal).toBe("not_approved");
  });

  it("the milestone being hidden withdraws it", async () => {
    const { p, req } = await approved("HiddenLater");
    await p.owner.journey.hideMilestone({ businessId: p.id, milestoneId: p.milestoneId });
    await settleShowcaseRuns();
    expect(await requestRow(req.id)).toMatchObject({ state: "withdrawn", withdrawReason: "milestone_hidden" });
  });

  it("an unanswered ask expires after 14 days", async () => {
    const p = await project("Expiry");
    const req = await askedFor(p);
    await advanceShowcase({ db: hz.db, gateway: hz.deps.gateway, env: hz.deps.env, log: hz.deps.log, now: () => new Date(Date.now() + 15 * 86_400_000) }, req.id);
    expect(await requestRow(req.id)).toMatchObject({ state: "expired", withdrawReason: "expired" });
  });

  it("switching the setting off withdraws an open ask", async () => {
    const p = await project("SwitchedOff");
    const req = await askedFor(p);
    await p.owner.showcase.setting.set({ businessId: p.id, mayAsk: false });
    expect(await requestRow(req.id)).toMatchObject({ state: "withdrawn", withdrawReason: "setting_off" });
  });
});
