/**
 * legal.incorporate.founderSubmitted checks tenancy before it signals anything (audit ARB-01 / api-services-01): an admin
 * of another business naming this business's incorporation gets "not found" and no workflow is signaled; an
 * incorporation that is not waiting for the founder is refused; the real submit signals the row's own workflow.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "incorporation", temporalClient: temporal });
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

describe("legal.incorporate.founderSubmitted", () => {
  it("never signals another business's workflow, and only once the incorporation awaits the founder", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const started = await owner.legal.incorporate.start({ businessId: hz.A.businessId, route: "kit", jurisdiction: "gb", entityType: "ltd", legalName: "Alpha Ltd" });
    const incorporationId = started.incorporation.id;
    expect(started.workflow.queued).toBe(true);
    const signalsTo = () => temporal.signals.filter((s) => s.workflowId === `incorporation:${incorporationId}`);

    // An admin (here, B's owner) routing A's incorporation id through their own business: not found, nothing signaled.
    expect(await code(hz.caller({ userId: hz.B.ownerId }).legal.incorporate.founderSubmitted({ businessId: hz.B.businessId, incorporationId }))).toBe("NOT_FOUND");
    expect(signalsTo()).toEqual([]);

    // A's own owner, before the pack is ready for review: refused, nothing signaled.
    expect(await code(owner.legal.incorporate.founderSubmitted({ businessId: hz.A.businessId, incorporationId }))).toBe("BAD_REQUEST");
    expect(signalsTo()).toEqual([]);

    await repos.legal.updateIncorporation(hz.db, hz.A.businessId, incorporationId, { status: "awaiting_founder" });
    const submitted = await owner.legal.incorporate.founderSubmitted({ businessId: hz.A.businessId, incorporationId });
    expect(submitted.incorporation.status).toBe("submitted");
    expect(signalsTo()).toHaveLength(1);
    expect(signalsTo()[0]).toMatchObject({ signal: "founderSubmit", args: [{ kind: "submitted", by: hz.A.ownerId }] });

    // Submitting twice is refused (the first submit moved it on).
    expect(await code(owner.legal.incorporate.founderSubmitted({ businessId: hz.A.businessId, incorporationId }))).toBe("BAD_REQUEST");
    expect(signalsTo()).toHaveLength(1);
  });
});
