/**
 * An agent's proposed words for the page (WP-08 T8; 0172; services/pages.ts `usePageProposal`): a proposal never changes
 * what is public or the draft; a founder who may write uses it (the words become the draft) or dismisses it; held text
 * is refused in the hold's own words; another business never sees it.
 */
import { repos } from "@foundmill/db";
import type { ProjectPageContent } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "pageprop" });
}, 120_000);
afterAll(() => hz?.close());

const content = (): ProjectPageContent => ({ pitch: "Bike repairs at your door", about: "A van full of parts comes to the bike and fixes it where it stands.", forWhom: "", stage: "idea", showFounders: false, followForm: true } as ProjectPageContent);

let n = 0;
async function project(name: string) {
  n += 1;
  const [ownerId, viewerId] = await Promise.all(["owner", "viewer"].map((r) => hz.h.createUser(`pageprop-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: viewerId!, role: "viewer" });
  const owner = hz.caller({ userId: ownerId! });
  await owner.page.publish({ businessId: b.id, content: content() });
  return { id: b.id, owner, viewer: hz.caller({ userId: viewerId! }) };
}
const propose = (id: string, fields: Record<string, string>) => repos.pages.propose(hz.db, id, { fields, note: "The pitch repeats the name.", agentId: null as never });

describe("page.proposal", () => {
  it("waits without changing the draft or the public page, and a founder can use it", async () => {
    const b = await project("Use");
    await propose(b.id, { pitch: "Bike repairs at your door, for people who commute" });
    const waiting = await b.owner.page.get({ businessId: b.id });
    expect(waiting.proposal).toMatchObject({ fields: { pitch: "Bike repairs at your door, for people who commute" }, reason: "The pitch repeats the name." });
    expect(waiting.draft.pitch).toBe("Bike repairs at your door");
    expect(waiting.published?.pitch).toBe("Bike repairs at your door");
    const used = await b.owner.page.proposal.use({ businessId: b.id });
    expect(used.proposal).toBeNull();
    expect(used.draft.pitch).toBe("Bike repairs at your door, for people who commute");
    expect(used.published?.pitch).toBe("Bike repairs at your door");
    expect(used.changed).toBe(true);
  });

  it("dismissing drops it and touches nothing else; a new proposal replaces the old one", async () => {
    const b = await project("Dismiss");
    await propose(b.id, { about: "First idea for the about text." });
    await propose(b.id, { about: "Second idea for the about text." });
    expect((await b.owner.page.get({ businessId: b.id })).proposal?.fields.about).toBe("Second idea for the about text.");
    const after = await b.owner.page.proposal.dismiss({ businessId: b.id });
    expect(after.proposal).toBeNull();
    expect(after.draft.about).toBe(content().about);
  });

  it("refuses held words in the hold's own message, and a reader who may not write", async () => {
    const b = await project("Held");
    await propose(b.id, { about: "Write to me at someone@example.com for a quote." });
    await expect(b.owner.page.proposal.use({ businessId: b.id })).rejects.toThrow();
    expect((await b.owner.page.get({ businessId: b.id })).draft.about).toBe(content().about);
    await expect(b.viewer.page.proposal.use({ businessId: b.id })).rejects.toThrow();
  });

  it("another business never sees the proposal", async () => {
    const a = await project("Mine");
    const other = await project("Theirs");
    await propose(a.id, { pitch: "A private suggestion for this page." });
    expect((await other.owner.page.get({ businessId: other.id })).proposal).toBeNull();
  });
});
