/**
 * Connecting a live GitHub App installation (integrations.connect with LIVE_CONNECTORS=github): the api signs the state
 * that rides through GitHub's installation page, accepts it back only from the same founder for the same business, and
 * leaves the installation check to the gateway (which holds the App's keys). Nothing is written until it is verified.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiGatewayClient, GatewayIntegrationRecord } from "../services/gateway";
import { signInstallState, verifyInstallState } from "../services/install-state";
import { createApiHarness, TEST_SESSION_TOKEN_SECRET, type ApiHarness } from "./harness";

const calls: { kind: "connect" | "health"; businessId: string; connector: string; input?: Record<string, unknown> }[] = [];
let nextInstallation = 48213377;

const verified = (installationId: number): GatewayIntegrationRecord => ({ status: "connected", scopes: ["contents:write"], accountLabel: `org-${installationId}`, externalAccountId: String(installationId), config: { installationId, account: `org-${installationId}`, verifiedBy: "founder-login", verifiedAt: "2026-10-09T10:00:00.000Z" }, expiresAt: null });

const gateway: ApiGatewayClient = {
  async connect(businessId, connector, input) {
    calls.push({ kind: "connect", businessId, connector, input });
    if (input.installationId === undefined) return { mode: "live", record: { status: "disconnected", scopes: [], accountLabel: null, externalAccountId: null, config: { consentUrl: `https://github.com/apps/foundmill-agents/installations/new?state=${String(input.state)}` }, expiresAt: null }, integrationId: null, credential: null };
    return { mode: "live", record: verified(input.installationId as number), integrationId: null, credential: null };
  },
  async health(businessId, connector) {
    calls.push({ kind: "health", businessId, connector });
    return { ok: true, status: "connected", details: { repositories: 3 } };
  },
  async createCheckout() {
    throw new Error("no checkouts in these tests");
  },
  async checkDomains() {
    throw new Error("no domain checks in these tests");
  },
  async generatePortrait() {
    throw new Error("no portraits in these tests");
  },
  async repository(_businessId, owner, repo) {
    return { mode: "live", repository: { id: 7_700_001, fullName: `${owner}/${repo}`, private: true, defaultBranch: "main" } };
  },
  async sendPush() {
    throw new Error("no push in these tests");
  },
  async validateKey() {
    throw new Error("no key checks in these tests");
  },
  async registryLookup() {
    throw new Error("no registry lookups in these tests");
  },
  async confirmFollow() {
    throw new Error("no follow confirmations in these tests");
  },
  async notifyEmail() {
    throw new Error("no notify email in these tests");
  },
  async synthesizeSpeech() {
    throw new Error("no speech in these tests");
  },
  async transcribeSpeech() {
    throw new Error("no speech in these tests");
  },
};

describe("integrations.connect for a live GitHub App", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "ghconnect", gateway, env: { LIVE_CONNECTORS: "github" } });
  }, 120_000);
  afterAll(() => hz.close());
  beforeEach(() => {
    calls.length = 0;
  });

  const start = async (userId: string, businessId: string) => {
    const r = await hz.caller({ userId }).integrations.connect({ businessId, connectorKey: "github", input: {} });
    const state = new URL(r.consentUrl!).searchParams.get("state")!;
    return { r, state };
  };

  it("hands back the installation page with a signed state and writes nothing", async () => {
    const { businessId, ownerId } = hz.A;
    const { r, state } = await start(ownerId, businessId);
    expect(r).toMatchObject({ integration: null, founderConsentRequired: true, record: { status: "disconnected" } });
    expect(calls).toEqual([{ kind: "connect", businessId, connector: "github", input: { state } }]);
    expect(() => verifyInstallState(TEST_SESSION_TOKEN_SECRET, state, { userId: ownerId, businessId })).not.toThrow();
    expect(await repos.integrations.getByKey(hz.db, businessId, "github")).toBeNull();
  });

  it("connects the installation once the gateway verified it, passing the code but never the state", async () => {
    const { businessId, ownerId } = hz.A;
    const { state } = await start(ownerId, businessId);
    calls.length = 0;
    const installationId = nextInstallation++;
    const r = await hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "github", input: { installationId, code: "c0de", state } });
    expect(calls).toEqual([{ kind: "connect", businessId, connector: "github", input: { installationId, code: "c0de" } }]);
    expect(r.integration).toMatchObject({ status: "connected", accountLabel: `org-${installationId}`, settings: { externalAccountId: String(installationId), config: { verifiedBy: "founder-login" } } });
    expect(r.consentUrl).toBeNull();
  });

  it("refuses a state from another founder, another business, a forged or an expired one, before asking GitHub", async () => {
    const { businessId, ownerId, adminId } = hz.A;
    const finish = (userId: string, bid: string, state: string) => hz.caller({ userId }).integrations.connect({ businessId: bid, connectorKey: "github", input: { installationId: 1, code: "c0de", state } });

    const { state } = await start(ownerId, businessId);
    calls.length = 0;
    // Someone else's link: the founder of A clicking an installation another person started (the one-click attack).
    await expect(finish(adminId, businessId, state)).rejects.toThrow(/started by someone else or for another business/);
    // The owner of B starting an installation and finishing it for A (B's owner has no role in A anyway).
    const b = await start(hz.B.ownerId, hz.B.businessId);
    calls.length = 0;
    await expect(finish(ownerId, businessId, b.state)).rejects.toThrow(/started by someone else or for another business/);
    const [body, sig] = state.split(".");
    // A signature with its first character changed (never the last two: they carry 10 bits, so "AA" there is the same
    // signature once in 1,024 runs and the forged link was then, rightly, accepted).
    await expect(finish(ownerId, businessId, `${body}.${sig![0] === "A" ? "B" : "A"}${sig!.slice(1)}`)).rejects.toThrow(/not valid/);
    await expect(finish(ownerId, businessId, `${Buffer.from(JSON.stringify({ b: businessId, u: ownerId, exp: 4102444800, n: "forgedforged" })).toString("base64url")}.${sig}`)).rejects.toThrow(/not valid/);
    const old = signInstallState(TEST_SESSION_TOKEN_SECRET, { userId: ownerId, businessId }, new Date(Date.now() - 16 * 60_000));
    await expect(finish(ownerId, businessId, old)).rejects.toThrow(/expired/);
    await expect(hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "github", input: { installationId: 1, state } })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("starting again leaves a connected installation alone; a different installation forgets the chosen repository", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const current = (await repos.integrations.getByKey(hz.db, businessId, "github"))!;
    await owner.dev.code.setRepository({ businessId, repository: "acme/shop" });

    const { r, state } = await start(ownerId, businessId);
    expect(r.integration).toMatchObject({ id: current.id, status: "connected" });
    expect((await repos.integrations.getByKey(hz.db, businessId, "github"))!.settings).toMatchObject({ repo: "acme/shop", externalAccountId: current.settings && (current.settings as { externalAccountId: string }).externalAccountId });

    const same = Number((current.settings as { externalAccountId: string }).externalAccountId);
    await owner.integrations.connect({ businessId, connectorKey: "github", input: { installationId: same, code: "c0de", state } });
    expect((await repos.integrations.getByKey(hz.db, businessId, "github"))!.settings).toMatchObject({ repo: "acme/shop" });

    const again = await start(ownerId, businessId);
    await owner.integrations.connect({ businessId, connectorKey: "github", input: { installationId: nextInstallation++, code: "c0de", state: again.state } });
    expect((await repos.integrations.getByKey(hz.db, businessId, "github"))!.settings).not.toHaveProperty("repo");
    expect(await owner.dev.code.repository({ businessId })).toMatchObject({ connected: true, status: "connected", repository: null, simulated: false });
  });

  it("checks a live App connector's health through the gateway", async () => {
    const { businessId, ownerId } = hz.A;
    const row = (await repos.integrations.getByKey(hz.db, businessId, "github"))!;
    const r = await hz.caller({ userId: ownerId }).integrations.health({ businessId, integrationId: row.id });
    expect(r.health).toMatchObject({ ok: true, status: "connected" });
    expect(calls).toEqual([{ kind: "health", businessId, connector: "github" }]);
  });
});
