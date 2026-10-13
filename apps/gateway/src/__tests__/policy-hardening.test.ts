/**
 * Gateway policy hardening (audit GPC-08, GPC-09, SECX-9):
 *  - a DNS change that routes or authenticates the domain's email is a hard gate in every mode, decided by the gateway
 *    from the call's arguments, and the connector refuses a record whose type or name the agent misstates;
 *  - the spend policy sees the cost the connector derives from the arguments, never only what the agent reports, and a
 *    spending tool nobody can price asks first;
 *  - an agent cannot unlock a kit-mode channel by an argument of the call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_MODES } from "@foundmill/shared";
import { cloudflareDnsMock, e2bMock, mockIntegrationRecord } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { policyAmountMinor } from "../pipeline";
import { securitySettingsChange } from "../security-settings";
import { CallContextInput } from "../types";
import { setupGateway, silentLog, TEST_CONNECTOR, type GatewayFixture } from "./harness";
import type { AllowResponse, AskResponse, CallResponse, DenyResponse } from "../types";

const NW = "0b5b1a2c3d4e5f60718293a4b5c6d7e8";
const MX = { zoneId: NW, type: "MX", recordName: "northwindskincare.com" };

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway();
  g.deps.registry.register(cloudflareDnsMock).register(e2bMock);
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(async () => {
  cloudflareDnsMock.reset();
  await repos.businesses.setBusinessMode(g.db, g.businessId, "assisted");
  await repos.agents.setAutonomy(g.db, g.businessId, g.agentId, {});
  await repos.businesses.setSpendCap(g.db, g.businessId, null);
});

const asDeny = (r: CallResponse): DenyResponse => {
  expect(r.outcome).toBe("deny");
  return r as DenyResponse;
};
const asAsk = (r: CallResponse): AskResponse => {
  expect(r.outcome).toBe("ask");
  return r as AskResponse;
};
const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

const dns = (tool: string, args: Record<string, unknown>) => g.token({ allowedTools: ["cloudflare_dns:*"] }).then((token) => g.client.call(token, { connector: "cloudflare_dns", tool, args }));
const records = async (type?: string) => ((await cloudflareDnsMock.callTool("list_records", { zoneId: NW, ...(type ? { type } : {}) }, { businessId: g.businessId, agentId: g.agentId, sessionId: g.sessionId, integration: mockIntegrationRecord("cloudflare_dns", g.businessId), log: silentLog, mode: "mock" })).data as { items: { id: string; type: string; name: string; content: string }[] }).items;

describe("securitySettingsChange", () => {
  it("recognises mail routing, zone control and email authentication", () => {
    const hit = (tool: string, args: Record<string, unknown>) => securitySettingsChange("cloudflare_dns", tool, args) !== null;
    for (const type of ["MX", "NS", "CAA"]) expect(hit("create_record", { zoneId: NW, type, name: "x.example.com", content: "v" }), type).toBe(true);
    expect(hit("create_record", { zoneId: NW, type: "TXT", name: "example.com", content: "v=spf1 include:_spf.google.com ~all" })).toBe(true);
    expect(hit("create_record", { zoneId: NW, type: "TXT", name: "_dmarc.example.com", content: "anything" })).toBe(true);
    expect(hit("create_record", { zoneId: NW, type: "CNAME", name: "s1._domainkey.example.com", content: "s1.domainkey.u1.sendgrid.net" })).toBe(true);
    expect(hit("update_record", { zoneId: NW, recordId: "a", type: "TXT", recordName: "example.com", ttl: 60 })).toBe(true);
    expect(hit("delete_record", { zoneId: NW, recordId: "a", type: "NS", recordName: "example.com" })).toBe(true);
    // A change that does not say what it changes cannot be read, so it is held.
    expect(hit("update_record", { zoneId: NW, recordId: "a", ttl: 60 })).toBe(true);
  });

  it("leaves ordinary records and other connectors alone", () => {
    expect(securitySettingsChange("cloudflare_dns", "create_record", { zoneId: NW, type: "A", name: "preview.example.com", content: "1.2.3.4" })).toBeNull();
    expect(securitySettingsChange("cloudflare_dns", "create_record", { zoneId: NW, type: "CNAME", name: "www.example.com", content: "cname.vercel-dns.com" })).toBeNull();
    expect(securitySettingsChange("cloudflare_dns", "update_record", { zoneId: NW, recordId: "a", type: "A", recordName: "www.example.com", content: "5.6.7.8" })).toBeNull();
    expect(securitySettingsChange("cloudflare_dns", "list_records", { zoneId: NW, type: "MX" })).toBeNull();
    expect(securitySettingsChange("gmail", "send_message", { type: "MX" })).toBeNull();
  });
});

describe("DNS changes that route or authenticate email", () => {
  it.each(BUSINESS_MODES)("are denied as a hard gate in %s mode, queued for the founder, and never reach the connector", async (mode) => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
    const before = await records();
    const attempts: [string, Record<string, unknown>][] = [
      ["update_record", { ...MX, recordId: before.find((r) => r.type === "MX")!.id, content: "mx.attacker.example" }],
      ["create_record", { zoneId: NW, type: "NS", name: "northwindskincare.com", content: "ns.attacker.example" }],
      ["create_record", { zoneId: NW, type: "TXT", name: "_dmarc.northwindskincare.com", content: "v=DMARC1; p=none; rua=mailto:x@attacker.example" }],
      ["delete_record", { zoneId: NW, recordId: before.find((r) => r.type === "TXT" && r.name.startsWith("_dmarc"))!.id, type: "TXT", recordName: "_dmarc.northwindskincare.com" }],
    ];
    for (const [tool, args] of attempts) {
      const r = asDeny(await dns(tool, args));
      expect(r.policyIds, tool).toEqual(["hard-gate-security-settings"]);
      expect(r.humanAction, tool).toMatchObject({ connector: "cloudflare_dns", tool, reason: "hard_gate" });
      expect(r.humanAction?.instructions).toMatch(/DNS provider/);
      expect(r.approvalId).toBeDefined();
      const ev = (await repos.events.list(g.db, g.businessId, { type: "approval.requested" })).items.find((e) => (e.payload as { approvalId?: string }).approvalId === r.approvalId);
      expect(ev?.payload).toMatchObject({ hardGate: true, connectorKey: "cloudflare_dns", tool });
    }
    expect(await records()).toEqual(before);
  });

  it("cannot be slipped through by calling a security record by another type: the connector checks the record itself", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
    const mx = (await records("MX"))[0]!;
    const r = asAllow(await dns("update_record", { zoneId: NW, recordId: mx.id, type: "A", recordName: "northwindskincare.com", content: "mx.attacker.example" }));
    expect(r.result.ok).toBe(false);
    expect(r.result.error?.message).toContain("not a A record");
    expect((await records("MX"))[0]).toMatchObject({ id: mx.id, content: "aspmx.l.google.com" });
  });

  it("ordinary records follow the business mode: assisted and augmented ask first, automated runs", async () => {
    const record = { zoneId: NW, type: "A", name: "preview.northwindskincare.com", content: "76.76.21.22" };
    for (const mode of ["augmented", "assisted"] as const) {
      await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
      asAsk(await dns("create_record", record));
    }
    expect((await records("A")).some((r) => r.name === record.name)).toBe(false);
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
    expect(asAllow(await dns("create_record", record)).result.ok).toBe(true);
    expect((await records("A")).some((r) => r.name === record.name)).toBe(true);
  });
});

describe("the spend policy reads the cost the connector derives", () => {
  const sandbox = (timeoutSeconds: number, context?: { amountMinor?: number }) => g.token({ allowedTools: ["e2b:*"] }).then((token) => g.client.call(token, { connector: "e2b", tool: "create_sandbox", args: { timeoutSeconds }, ...(context ? { context } : {}) }));

  it("denies a sandbox that costs more than the agent's spend cap even when the agent reports no amount", async () => {
    await repos.agents.setAutonomy(g.db, g.businessId, g.agentId, { spendCapMinor: 100 });
    const r = asDeny(await sandbox(86_400));
    expect(r.policyIds).toEqual(["spend-cap-exceeded"]);
    // A cap of zero is a "no spend" cap.
    await repos.agents.setAutonomy(g.db, g.businessId, g.agentId, { spendCapMinor: 0 });
    expect(asDeny(await sandbox(300)).policyIds).toEqual(["spend-cap-exceeded"]);
  });

  it("asks when the derived cost is above the approval threshold, and a lower reported amount does not hide it", async () => {
    await repos.agents.setAutonomy(g.db, g.businessId, g.agentId, { approvalThresholdMinor: 500 });
    const r = asAsk(await sandbox(86_400, { amountMinor: 1 }));
    expect(r.policyIds).toEqual(["assisted-ask-above-threshold"]);
  });

  it("runs a sandbox whose derived cost is within the caps", async () => {
    asAllow(await sandbox(300));
  });

  it("policyAmountMinor: the larger of the declared and the reported cost; an unpriced spending tool asks", () => {
    const base = { spendsMoney: true, thresholdMinor: 25_000 };
    expect(policyAmountMinor({ ...base, declaredMinor: 1_440, reportedMinor: 0 })).toBe(1_440);
    expect(policyAmountMinor({ ...base, declaredMinor: 10, reportedMinor: 900 })).toBe(900);
    expect(policyAmountMinor({ ...base, declaredMinor: null, reportedMinor: 0 })).toBe(25_001);
    expect(policyAmountMinor({ ...base, declaredMinor: null, reportedMinor: 99_999 })).toBe(99_999);
    expect(policyAmountMinor({ spendsMoney: true, declaredMinor: null, reportedMinor: 0, thresholdMinor: undefined })).toBeGreaterThan(25_000);
    // Tools that do not spend are not priced up.
    expect(policyAmountMinor({ spendsMoney: false, declaredMinor: null, reportedMinor: 0, thresholdMinor: 25_000 })).toBe(0);
  });
});

describe("kit mode is the session's, not the call's", () => {
  it("drops a kitMode argument from the call context", () => {
    expect(CallContextInput.parse({ kitMode: true })).not.toHaveProperty("kitMode");
  });

  it("a call that sends kitMode: true does not get the kit-mode behavior of a kit-mode session", async () => {
    const token = await g.token();
    // The test connector has no kit-mode tool; the context is accepted and the field is ignored, not an error.
    const r = await g.client.call(token, { connector: TEST_CONNECTOR, tool: "note", args: { text: "x" }, context: { kitMode: true } as never });
    expect(r.outcome).toBe("allow");
  });
});
