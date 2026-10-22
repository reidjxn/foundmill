/**
 * Service-only connectors (packages/connectors `SERVICE_ONLY_CONNECTORS`: `openai_images`, the faces of anthropomorphic
 * agents on the platform key): Settings › Integrations never lists one, and `integrations.connect` refuses one in mock and
 * live mode alike, storing nothing. The registry still serves it (the api draws the mock placeholder with it).
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let mock: ApiHarness;
let live: ApiHarness;
beforeAll(async () => {
  mock = await createApiHarness({ prefix: "intsvconly" });
  live = await createApiHarness({ prefix: "intsvconly-live", env: { LIVE_CONNECTORS: "openai_images" } });
}, 180_000);
afterAll(async () => {
  await mock?.close();
  await live?.close();
});

describe("openai_images is the platform's, never a business's", () => {
  it("is in the registry but not in the catalog Settings › Integrations offers", async () => {
    expect(mock.deps.connectors.has("openai_images")).toBe(true);
    const list = await mock.caller({ userId: mock.A.ownerId }).integrations.list({ businessId: mock.A.businessId });
    expect(list.catalogue.map((c) => c.key)).not.toContain("openai_images");
    expect(list.catalogue.length).toBeGreaterThan(5);
  });

  it("integrations.connect refuses it, mock or live, and stores nothing", async () => {
    for (const hz of [mock, live]) {
      await expect(hz.caller({ userId: hz.A.ownerId }).integrations.connect({ businessId: hz.A.businessId, connectorKey: "openai_images", input: {} })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("run by the platform itself") });
      expect(await repos.integrations.getByKey(hz.db, hz.A.businessId, "openai_images")).toBeNull();
    }
  });
});
