/**
 * The standing solo guard (docs/NETWORK.md §10, WP-12 T0): a freshly committed project with one person says nothing on
 * Today, in its visit view or in its notes that nudges the founder to add someone or counts people at zero. Run with
 * the people layer closed (`LIVE_MODE` unset, as production was) and open (`LIVE_MODE=1`). Every later task that adds
 * copy a solo founder can read adds a case here.
 */
import { projectPageReadyNote } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { soloGuardViolations, starterPageDraft } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

/** Every string in a value, so a new field added to a view is read without this test changing. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe.each([
  ["LIVE_MODE unset", {}],
  ["LIVE_MODE=1", { LIVE_MODE: "1" }],
] as const)("solo guard, %s", (_label, env) => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: `solo-guard-${Object.keys(env).length}`, env });
  }, 120_000);
  afterAll(() => hz?.close());

  it("a freshly committed one-person project reads clean on Today, the visit view and every note", async () => {
    const userId = await hz.h.createUser("solo@test.local");
    const caller = hz.caller({ userId, email: "solo@test.local" });
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Sam", experience: "first-time", skills: { engineering: 14 }, targetMarkets: ["US"], riskAppetite: "medium", budgetMinor: 0 });
    const idea = (await caller.idea.generate({ prompt: "bookkeeping for freelancers" })).ideas[0]!;
    const { business, chiefOfStaffId } = await caller.idea.commit({ ideaId: idea.id, name: "Solo Guard Test", archetype: "b2b_saas", gameMode: "personal", kit: { primary: "#1B4FD8", secondary: "#F5C400" } });
    const businessId = business.id;

    // The page note the team writes in the first session, as the orchestrator writes it.
    const note = projectPageReadyNote();
    await repos.pages.writeTeamDraft(hz.db, businessId, { draft: starterPageDraft({ businessName: "Solo Guard Test", founderWords: "Bookkeeping for freelancers." }), slug: "solo-guard-test", agentId: chiefOfStaffId, source: "starter", reason: null, note });

    const members = await repos.memberships.list(hz.db, businessId);
    expect(members).toHaveLength(1);

    const today = await caller.today.get({ businessId });
    const visit = await caller.today.visit({ businessId });
    const inbox = await caller.inbox.list({ businessId, limit: 50 });
    expect(inbox.items.length).toBeGreaterThan(1);

    const read = [...strings(today), ...strings(visit), ...inbox.items.flatMap((i) => [i.subject, i.bodyMd])];
    expect(read.flatMap((s) => soloGuardViolations(s).map((hit) => `${hit} in "${s.slice(0, 80)}"`))).toEqual([]);
  });
});
