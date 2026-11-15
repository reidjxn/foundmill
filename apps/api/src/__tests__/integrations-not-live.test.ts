/**
 * A connector that is not live cannot be connected on a person's project (WP-02 T3; audit a5 GTM-16): on staging or
 * production a mock connect would write a `mock` row that looks connected and does nothing, so `integrations.connect`
 * refuses it with `connector_not_live` and writes nothing. `integrations.list` says per catalog entry whether it can be
 * connected here (`available`). A sample project, development and test keep the mock.
 */
import { repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "intnotlive" });
}, 180_000);
afterAll(async () => {
  await hz?.close();
});

const STAGING = { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" } as const;
const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);

describe("integrations on a person's project when a connector is not live", () => {
  it("connect is refused with connector_not_live and writes nothing", async () => {
    const staging = callerWith(STAGING, { userId: hz.A.ownerId });
    await expect(staging.integrations.connect({ businessId: hz.A.businessId, connectorKey: "sendgrid", input: {} })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^SendGrid is not available yet\. Nothing was connected\.$/) });
    expect(await repos.integrations.getByKey(hz.db, hz.A.businessId, "sendgrid")).toBeNull();
  });

  it("list marks it not available; test and a sample project keep the mock", async () => {
    const staging = await callerWith(STAGING, { userId: hz.A.ownerId }).integrations.list({ businessId: hz.A.businessId });
    expect(staging.catalogue.find((c) => c.key === "sendgrid")).toMatchObject({ live: false, available: false });
    const test = await hz.caller({ userId: hz.A.ownerId }).integrations.list({ businessId: hz.A.businessId });
    expect(test.catalogue.find((c) => c.key === "sendgrid")).toMatchObject({ available: true });
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${hz.B.businessId}`);
    const sample = callerWith(STAGING, { userId: hz.B.ownerId });
    expect((await sample.integrations.list({ businessId: hz.B.businessId })).catalogue.find((c) => c.key === "sendgrid")).toMatchObject({ available: true });
    await sample.integrations.connect({ businessId: hz.B.businessId, connectorKey: "sendgrid", input: {} });
    expect(await repos.integrations.getByKey(hz.db, hz.B.businessId, "sendgrid")).toMatchObject({ status: "mock" });
  });
});
