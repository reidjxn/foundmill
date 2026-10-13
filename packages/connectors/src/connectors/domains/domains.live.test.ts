import { describe, expect, it } from "vitest";
import type { FetchLike } from "../../http";
import { createDomainLookup } from "./rdap";

// Not in CI: `DOMAIN_TEST_LIVE=1 pnpm --filter @foundmill/connectors test domains.live` asks the real registry (no key needed).
describe.skipIf(process.env.DOMAIN_TEST_LIVE !== "1")("domains (live registry)", () => {
  it("example.com is taken and a random 20-character .com is available", async () => {
    const random = Array.from({ length: 20 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
    const out = await createDomainLookup({ fetch: globalThis.fetch as FetchLike, now: () => new Date() }).check(["example.com", `${random}.com`]);
    expect(out[0]).toMatchObject({ status: "taken", provenance: "Registry", estimate: false });
    expect(out[1]).toMatchObject({ status: "available", provenance: "Registry", estimate: false });
  }, 20_000);
});
