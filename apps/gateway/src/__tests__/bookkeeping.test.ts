/**
 * A vendor action never runs and then fails on the gateway's own bookkeeping (audit report GPC-04 / VARB-X1): plan
 * actions and imports minted tokens for invented session ids, the connector ran, and booking the usage (or queuing the
 * approval) then failed its foreign key with a 500, no audit row and the raw tool arguments in the log; Temporal retried
 * and ran the side effect again. Session ids are now checked at mint, a call outside any agent session says so with
 * `sessionId: null`, and nothing after the vendor call can turn it into a failure.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import type { GatewayLogger } from "../pipeline";
import type { AllowResponse, CallResponse, DenyResponse } from "../types";
import { SAFE_EMAIL, setupGateway, silentLog, type GatewayFixture } from "./harness";

let g: GatewayFixture;
const logged: { level: "warn" | "error"; fields: unknown; msg: unknown }[] = [];
const capture: GatewayLogger = {
  ...silentLog,
  warn: (fields: unknown, msg?: unknown) => void logged.push({ level: "warn", fields, msg }),
  error: (fields: unknown, msg?: unknown) => void logged.push({ level: "error", fields, msg }),
  child: () => capture,
};

beforeAll(async () => {
  g = await setupGateway();
  g.deps.log = capture;
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(() => {
  g.seen.length = 0;
  logged.length = 0;
});

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};
const asDeny = (r: CallResponse): DenyResponse => {
  expect(r.outcome).toBe("deny");
  return r as DenyResponse;
};

describe("session ids on a token", () => {
  it("refuses to mint for a session that does not exist, so no vendor call can run under it", async () => {
    const invented = randomUUID();
    await expect(g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: invented, allowedTools: ["test:*"] })).rejects.toMatchObject({ status: 404, code: "session_not_found" });
    const minted = await repos.audit.list(g.db, g.businessId, { action: "gateway.session_token.minted" });
    expect(minted.items.some((a) => (a.target as { sessionId?: string }).sessionId === invented)).toBe(false);
    expect(g.seen).toHaveLength(0);
  });

  it("refuses another agent's session", async () => {
    const other = await repos.agents.create(g.db, g.businessId, { name: "Other Worker", agentType: "developer", modelKey: "sonnet", initialVersion: { instructions: { role: "worker" }, tools: [] } });
    const theirs = (await repos.agents.createSession(g.db, g.businessId, { agentId: other.id, modelKey: "sonnet" })).id;
    await expect(g.client.mintSessionToken({ businessId: g.businessId, agentId: g.agentId, sessionId: theirs, allowedTools: ["test:*"] })).rejects.toMatchObject({ status: 403, code: "session_agent_mismatch" });
  });
});

describe("calls outside any agent session (sessionId null: plan actions, imports)", () => {
  it("run, are audited and booked without a session, and queue a hard gate for the founder", async () => {
    const token = await g.token({ sessionId: null });
    const sent = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "plan action" } }));
    expect(sent.result).toMatchObject({ ok: true, data: { sent: true, to: SAFE_EMAIL } });
    const audit = await repos.audit.get(g.db, g.businessId, sent.auditId);
    expect(audit.details).toMatchObject({ outcome: "allow", resultOk: true, sessionId: null });
    const usage = await repos.usage.list(g.db, g.businessId, { agentId: g.agentId, kind: "tool" });
    const booked = usage.items.find((u) => (u.details as { auditId?: string }).auditId === sent.auditId);
    expect(booked).toMatchObject({ sessionId: null, costMinor: 7 });

    const gated = asDeny(await g.client.call(token, { connector: "test", tool: "pay_out", args: { amountMinor: 5000 } }));
    expect(gated.policyIds).toContain("hard-gate");
    expect(gated.approvalId).toBeTruthy();
    expect(await repos.approvals.get(g.db, g.businessId, gated.approvalId!)).toMatchObject({ sessionId: null, connectorKey: "test", tool: "pay_out" });
    expect(logged.filter((l) => l.level === "error")).toEqual([]);
  });

  it("keep their untrusted-recipient register per token", async () => {
    const first = await g.token({ sessionId: null });
    asAllow(await g.client.call(first, { connector: "test", tool: "read_inbox", args: { id: "m-1" } }));
    const blocked = asDeny(await g.client.call(first, { connector: "test", tool: "send_message", args: { to: "supplier@untrusted.example" } }));
    expect(blocked.policyIds).toEqual(["untrusted-recipient"]);
    // Another token outside a session never read that content.
    asAllow(await g.client.call(await g.token({ sessionId: null }), { connector: "test", tool: "send_message", args: { to: "supplier@untrusted.example" } }));
  });
});

describe("after the vendor call", () => {
  it("a failure to book the usage never turns the executed call into an error, and the log carries no arguments", async () => {
    await g.h.pg.exec(`
      create function fm_test_fail_usage() returns trigger language plpgsql as $$ begin raise exception 'usage ledger unavailable'; end $$;
      create trigger fm_test_fail_usage before insert on usage_ledger for each row execute function fm_test_fail_usage();
    `);
    try {
      const secretBody = "Our margin floor is 38% (confidential)";
      const r = asAllow(await g.client.call(await g.token(), { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: secretBody } }));
      expect(r.result).toMatchObject({ ok: true, data: { sent: true } });
      expect(g.seen.filter((s) => s.tool === "send_message")).toHaveLength(1);
      // Audited before, and independently of, the booking.
      expect((await repos.audit.get(g.db, g.businessId, r.auditId)).details).toMatchObject({ outcome: "allow", resultOk: true, sessionId: g.sessionId });
      const errors = logged.filter((l) => l.level === "error");
      expect(errors.map((l) => l.msg)).toEqual(["tool call executed but its usage could not be booked"]);
      expect(JSON.stringify(logged)).not.toContain(secretBody);
      expect(JSON.stringify(logged)).not.toContain(SAFE_EMAIL);
    } finally {
      await g.h.pg.exec("drop trigger fm_test_fail_usage on usage_ledger; drop function fm_test_fail_usage();");
    }
  });
});
