/**
 * Who may mint a session token, and for what (WP-11 T11; A7-15, A7-16, SEC-17): only the orchestrator and the api mint,
 * nobody gets the bare `*`, the api gets one named tool outside a session; and a tool with no policy hints entry is
 * refused at the call, audited, instead of counting as internal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { mintRefusal } from "../app";
import { MISSING_POLICY_HINTS_POLICY_ID } from "../pipeline";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_CONNECTOR, TEST_SECRET, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway();
}, 120_000);
afterAll(async () => {
  await g.close();
});

async function mint(svc: string, body: { sessionId: string | null; allowedTools: string[]; kitMode?: boolean }) {
  const res = await fetch(`${g.server.url}/v1/session-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` },
    body: JSON.stringify({ businessId: g.businessId, agentId: g.agentId, kitMode: false, ...body }),
  });
  return { status: res.status, body: (await res.json()) as { token?: string; error?: { code: string } } };
}

describe("POST /v1/session-tokens: who may mint what", () => {
  it.each([
    ["ingest", { sessionId: null, allowedTools: [`${TEST_CONNECTOR}:note`] }, "forbidden_service"],
    ["composer", { sessionId: null, allowedTools: [`${TEST_CONNECTOR}:note`] }, "forbidden_service"],
    ["orchestrator", { sessionId: null, allowedTools: ["*"] }, "mint_scope_refused"],
    ["api", { sessionId: "SESSION", allowedTools: [`${TEST_CONNECTOR}:note`] }, "mint_scope_refused"],
    ["api", { sessionId: null, allowedTools: [`${TEST_CONNECTOR}:note`, `${TEST_CONNECTOR}:spend`] }, "mint_scope_refused"],
    ["api", { sessionId: null, allowedTools: [] }, "mint_scope_refused"],
    ["api", { sessionId: null, allowedTools: ["github:*"] }, "mint_scope_refused"],
    ["api", { sessionId: null, allowedTools: [`${TEST_CONNECTOR}:note`], kitMode: true }, "mint_scope_refused"],
  ] as const)("%s with %j is refused (%s)", async (svc, body, code) => {
    const r = await mint(svc, { ...body, sessionId: body.sessionId === "SESSION" ? g.sessionId : body.sessionId, allowedTools: [...body.allowedTools] });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe(code);
  });

  it("still mints for the api's one tool outside a session, and for the orchestrator's session and platform steps", async () => {
    expect((await mint("api", { sessionId: null, allowedTools: [`${TEST_CONNECTOR}:note`] })).status).toBe(201);
    expect((await mint("orchestrator", { sessionId: g.sessionId, allowedTools: [`${TEST_CONNECTOR}:*`, "platform:*"] })).status).toBe(201);
    expect((await mint("orchestrator", { sessionId: null, allowedTools: [`${TEST_CONNECTOR}:*`] })).status).toBe(201);
  });

  it("mintRefusal is a pure rule", () => {
    expect(mintRefusal("orchestrator", { sessionId: "s", allowedTools: ["github:*"], kitMode: true })).toBeNull();
    expect(mintRefusal("stream", { sessionId: null, allowedTools: ["a:b"], kitMode: false })?.code).toBe("forbidden_service");
  });
});

describe("a tool with no policy hints entry", () => {
  it("is denied with missing-policy-hints and an audit row", async () => {
    const connector = g.deps.registry.get(TEST_CONNECTOR, "mock");
    const hints = connector.policyHints as Record<string, unknown>;
    const saved = hints.note;
    delete hints.note;
    try {
      const token = await g.token({ allowedTools: [`${TEST_CONNECTOR}:note`] });
      const r = await g.client.call(token, { connector: TEST_CONNECTOR, tool: "note", args: { text: "x" } });
      expect(r.outcome).toBe("deny");
      expect((r as { policyIds: string[] }).policyIds).toEqual([MISSING_POLICY_HINTS_POLICY_ID]);
      const rows = (await repos.audit.list(g.db, g.businessId, { action: "tool.call", limit: 20 })).items;
      expect(rows.some((row) => JSON.stringify(row).includes(MISSING_POLICY_HINTS_POLICY_ID))).toBe(true);
    } finally {
      hints.note = saved;
    }
  });
});
