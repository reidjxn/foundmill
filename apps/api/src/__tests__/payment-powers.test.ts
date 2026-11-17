/**
 * Payment powers through the api (founder, Nov 16, 2026): an owner or admin sets them, from Settings or when a vacation
 * starts; a member cannot; only `inbound` exists.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "powers", temporalClient: fakeTemporalClient() });
}, 120_000);
afterAll(() => hz.close());

const powers = async () => (await repos.businesses.get(hz.db, hz.A.businessId)).paymentPowers;

describe("business.setPaymentPowers and startHoliday's choice", () => {
  it("an admin turns the inbound power on and off; a member is refused; outbound does not exist", async () => {
    const admin = hz.caller({ userId: hz.A.adminId });
    await admin.business.setPaymentPowers({ businessId: hz.A.businessId, paymentPowers: ["inbound"] });
    expect(await powers()).toEqual(["inbound"]);
    await expect(hz.caller({ userId: hz.A.memberId }).business.setPaymentPowers({ businessId: hz.A.businessId, paymentPowers: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.business.setPaymentPowers({ businessId: hz.A.businessId, paymentPowers: ["outbound" as never] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.business.setPaymentPowers({ businessId: hz.A.businessId, paymentPowers: [] });
    expect(await powers()).toEqual([]);
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "business.set_payment_powers" })).items.length).toBe(2);
  });

  it("starting a vacation records the founder's choice", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await owner.business.startHoliday({ businessId: hz.A.businessId, until: { kind: "return" }, paymentPowers: ["inbound"] });
    expect(await powers()).toEqual(["inbound"]);
  });
});
