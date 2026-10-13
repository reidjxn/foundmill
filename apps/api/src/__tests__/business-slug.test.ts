/** The demo businesses' slugs are reserved for them: nobody else can take "northwind-skincare" or "ledgerly" (audit api-services-21). */
import { LEDGERLY_SLUG, NORTHWIND_SLUG } from "@foundmill/db/seed";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "slug" });
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

describe("business.update slug", () => {
  it("refuses a demo slug for any other business and accepts an ordinary one", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await code(owner.business.update({ businessId, slug: NORTHWIND_SLUG }))).toBe("CONFLICT");
    expect(await code(owner.business.update({ businessId, slug: LEDGERLY_SLUG }))).toBe("CONFLICT");
    expect(await code(owner.business.update({ businessId, slug: "slug-test-co" }))).toBe("OK");
  });
});
