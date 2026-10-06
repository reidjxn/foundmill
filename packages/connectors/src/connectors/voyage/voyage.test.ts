import { describe, expect, it } from "vitest";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { createVoyageConnector } from "./index";
import { voyageMock } from "./mock";

const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));

describeConnectorContract("voyage (mock)", {
  connector: voyageMock,
  mode: "mock",
  calls: [
    {
      tool: "embed",
      args: { input: ["Northwind Skincare launches a retinol serum", "Ledgerly closes its books in 4 minutes"] },
      check: (r) => {
        const d = r.data as { dimension: number; embeddings: number[][]; totalTokens: number };
        expect(d.dimension).toBe(1024);
        expect(d.embeddings).toHaveLength(2);
        expect(d.embeddings[0]).toHaveLength(1024);
        expect(norm(d.embeddings[0]!)).toBeCloseTo(1, 5);
        expect(d.embeddings[0]).not.toEqual(d.embeddings[1]);
        expect(d.totalTokens).toBeGreaterThan(0);
      },
    },
    { tool: "embed", args: { input: ["x"], outputDimension: 256 }, check: (r) => expect((r.data as { embeddings: number[][] }).embeddings[0]).toHaveLength(256) },
    { tool: "embed", args: { input: [] }, expectOk: false },
    { tool: "list_models", args: {} },
  ],
});

describe("voyage mock determinism", () => {
  it("embeds the same text identically across calls and differently per model", async () => {
    const ctx = makeToolContext(voyageMock);
    const a = await voyageMock.callTool("embed", { input: ["hello"] }, ctx);
    const b = await voyageMock.callTool("embed", { input: ["hello"] }, ctx);
    const c = await voyageMock.callTool("embed", { input: ["hello"], model: "voyage-3.5-lite" }, ctx);
    expect(a.data).toEqual(b.data);
    expect((a.data as { embeddings: number[][] }).embeddings[0]).not.toEqual((c.data as { embeddings: number[][] }).embeddings[0]);
    expect(a.costMinor).toBeGreaterThanOrEqual(0);
  });
});

describe("voyage (live, unconfigured)", () => {
  it("throws ConfigError without VOYAGE_API_KEY", async () => {
    const c = createVoyageConnector({ secrets: {} });
    await expect(c.callTool("embed", { input: ["x"] }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("VOYAGE_API_KEY"))("voyage (live)", () => {
  describeConnectorContract("voyage live", { connector: createVoyageConnector(), mode: "live", deterministic: false, calls: [{ tool: "embed", args: { input: ["ping"], outputDimension: 256 } }] });
});
