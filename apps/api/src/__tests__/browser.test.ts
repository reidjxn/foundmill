/**
 * The hosted browser's founder side (founder, Nov 22, 2026): connecting a site is the founder's own sign-in and its live
 * view is never stored; Working now lists, takes over, hands back and stops sessions; Stop all agents ends them too; a
 * hard-gate note reads its screenshot for members of its own project only.
 */
import { openApprovalItem, repos } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@foundmill/shared";
import { createCaller } from "../router";
import type { ApiDeps, CallerUser } from "../context";
import type { GatewayBrowserSession, GatewayConnectResult } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

const LIVE_VIEW = "https://live.browser.test/view/SECRET-LIVE-VIEW-TOKEN";
let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "browser" });
}, 180_000);
afterAll(async () => {
  await hz?.close();
});

const connectResult = (status: "connected" | "disconnected", config: Record<string, unknown>): GatewayConnectResult => ({
  mode: "live",
  record: { status, scopes: [], accountLabel: "Signed in to Carrd", externalAccountId: null, config, expiresAt: null },
  integrationId: null,
  credential: status === "connected" ? { stored: true, credentialId: "11111111-1111-4111-8111-111111111111", hint: "••••" } : null,
});
const liveCaller = (user: CallerUser, gateway: Partial<ApiDeps["gateway"]> = {}) => createCaller({ ...hz.deps, env: { ...hz.deps.env, LIVE_CONNECTORS: "browser_carrd" }, gateway: { ...hz.deps.gateway, ...gateway } }, user);
const session = (over: Partial<GatewayBrowserSession> = {}): GatewayBrowserSession => ({ siteKey: "carrd", siteName: "Carrd", liveViewUrl: LIVE_VIEW, url: "https://carrd.co/dashboard", startedAt: "2026-11-22T10:00:00.000Z", steps: 2, held: null, signIn: false, simulated: false, ...over });

describe("integrations.connect for a hosted-browser site", () => {
  it("answers the live view for this request only: it is in no integrations row and no audit row", async () => {
    const { businessId, ownerId } = hz.A;
    const connect = vi.fn(async (_b: string, _c: string, input: Record<string, unknown>) => (input.done === true ? connectResult("connected", { siteKey: "carrd" }) : input.cancel === true ? connectResult("disconnected", { step: "canceled" }) : connectResult("disconnected", { step: "sign_in", liveViewUrl: LIVE_VIEW })));
    const caller = liveCaller({ userId: ownerId }, { connect });

    const first = await caller.integrations.connect({ businessId, connectorKey: "browser_carrd", input: {} });
    expect(first.signIn).toEqual({ liveViewUrl: LIVE_VIEW });
    expect(JSON.stringify(first.record)).not.toContain("SECRET-LIVE-VIEW-TOKEN");
    expect(first.integration).toBeNull();

    const rows = await repos.integrations.list(hz.db, businessId);
    const audits = await repos.audit.list(hz.db, businessId, { limit: 200 });
    expect(JSON.stringify(rows)).not.toContain("SECRET-LIVE-VIEW-TOKEN");
    expect(JSON.stringify(audits.items)).not.toContain("SECRET-LIVE-VIEW-TOKEN");
    expect(audits.items.some((a) => a.action === "integrations.browser_sign_in")).toBe(true);
    // Nothing the database holds at all carries it.
    const anywhere = await hz.db.execute(sql`select count(*)::int as n from audit_log where details::text like '%SECRET-LIVE-VIEW%'`);
    expect((anywhere as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ?? (anywhere as unknown as { n: number }[])[0]?.n).toBe(0);
  });

  it("passes cancel and done through to the gateway; only done saves the connection", async () => {
    const { businessId, ownerId } = hz.A;
    const connect = vi.fn(async (_b: string, _c: string, input: Record<string, unknown>) => (input.done === true ? connectResult("connected", { siteKey: "carrd" }) : connectResult("disconnected", { step: "canceled" })));
    const caller = liveCaller({ userId: ownerId }, { connect });

    const canceled = await caller.integrations.connect({ businessId, connectorKey: "browser_carrd", input: { cancel: true } });
    expect(connect).toHaveBeenLastCalledWith(businessId, "browser_carrd", { cancel: true });
    expect(canceled.signIn).toBeNull();
    expect(await repos.integrations.getByKey(hz.db, businessId, "browser_carrd")).toBeNull();

    const done = await caller.integrations.connect({ businessId, connectorKey: "browser_carrd", input: { done: true } });
    expect(connect).toHaveBeenLastCalledWith(businessId, "browser_carrd", { done: true });
    expect(done.integration).toMatchObject({ connectorKey: "browser_carrd", status: "connected" });
  });

  it("is an administration step like connecting any integration", async () => {
    await expect(liveCaller({ userId: hz.A.memberId }).integrations.connect({ businessId: hz.A.businessId, connectorKey: "browser_carrd", input: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("in mock mode the sign-in is simulated: the first step saves nothing and Done connects it", async () => {
    const { businessId, ownerId } = hz.B;
    const caller = hz.caller({ userId: ownerId });
    const first = await caller.integrations.connect({ businessId, connectorKey: "browser_carrd", input: {} });
    expect(first.signIn).toBeNull();
    expect(first.record.status).toBe("disconnected");
    expect(await repos.integrations.getByKey(hz.db, businessId, "browser_carrd")).toBeNull();
    await caller.integrations.connect({ businessId, connectorKey: "browser_carrd", input: { cancel: true } });
    expect(await repos.integrations.getByKey(hz.db, businessId, "browser_carrd")).toBeNull();
    await caller.integrations.connect({ businessId, connectorKey: "browser_carrd", input: { done: true } });
    expect(await repos.integrations.getByKey(hz.db, businessId, "browser_carrd")).toMatchObject({ status: "mock" });
  });

  it("the catalogue names each site and its state", async () => {
    const list = await hz.caller({ userId: hz.A.ownerId }).integrations.list({ businessId: hz.A.businessId });
    expect(list.catalogue.find((c) => c.key === "browser_carrd")?.browser).toEqual({ siteKey: "carrd", name: "Carrd", state: "ask_first" });
    expect(list.catalogue.find((c) => c.key === "github")?.browser).toBeNull();
  });
});

describe("browser sessions on Working now", () => {
  it("lists the project's sessions and asks the gateway to take over, hand back and stop", async () => {
    const { businessId, ownerId } = hz.A;
    const calls: string[] = [];
    const caller = liveCaller(
      { userId: ownerId },
      {
        browserSessions: async (b) => (calls.push(`list:${b}`), { sessions: [session()] }),
        browserTakeOver: async (b, s) => (calls.push(`takeover:${b}:${s}`), { held: true }),
        browserHandBack: async (b, s) => (calls.push(`handback:${b}:${s}`), { handedBack: true }),
        browserStop: async (b, s) => (calls.push(`stop:${b}:${s}`), { stopped: 1 }),
      },
    );
    expect(await caller.browser.sessions({ businessId })).toEqual({ canControl: true, sessions: [session()] });
    expect(await caller.browser.takeOver({ businessId, siteKey: "carrd" })).toEqual({ held: true });
    expect(await caller.browser.handBack({ businessId, siteKey: "carrd" })).toEqual({ handedBack: true });
    expect(await caller.browser.stop({ businessId, siteKey: "carrd" })).toEqual({ stopped: 1 });
    expect(calls).toEqual([`list:${businessId}`, `takeover:${businessId}:carrd`, `handback:${businessId}:carrd`, `stop:${businessId}:carrd`]);
    const audits = await repos.audit.list(hz.db, businessId, { limit: 200 });
    for (const action of ["browser.take_over", "browser.hand_back", "browser.stop"]) expect(audits.items.some((a) => a.action === action)).toBe(true);
    expect(JSON.stringify(audits.items)).not.toContain("SECRET-LIVE-VIEW-TOKEN");
  });

  it("a viewer sees the sessions without their live view and cannot take over or stop", async () => {
    const { businessId, ownerId, memberId } = hz.A;
    await hz.caller({ userId: ownerId }).team.humans.role({ businessId, userId: memberId, role: "viewer" });
    const takeOver = vi.fn(async () => ({ held: true }));
    const caller = liveCaller({ userId: memberId }, { browserSessions: async () => ({ sessions: [session()] }), browserTakeOver: takeOver });
    expect(await caller.browser.sessions({ businessId })).toEqual({ canControl: false, sessions: [session({ liveViewUrl: null })] });
    await expect(caller.browser.takeOver({ businessId, siteKey: "carrd" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(takeOver).not.toHaveBeenCalled();
  });

  it("a collaborator may stop a session but never holds the page: no live view, no take over (security review)", async () => {
    const { businessId, ownerId, memberId } = hz.A;
    await hz.caller({ userId: ownerId }).team.humans.role({ businessId, userId: memberId, role: "collaborator" });
    const takeOver = vi.fn(async () => ({ held: true }));
    const stop = vi.fn(async () => ({ stopped: 1 }));
    const caller = liveCaller({ userId: memberId }, { browserSessions: async () => ({ sessions: [session()] }), browserTakeOver: takeOver, browserHandBack: async () => ({ handedBack: true }), browserStop: stop });
    expect(await caller.browser.sessions({ businessId })).toEqual({ canControl: false, sessions: [session({ liveViewUrl: null })] });
    await expect(caller.browser.takeOver({ businessId, siteKey: "carrd" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.browser.handBack({ businessId, siteKey: "carrd" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(takeOver).not.toHaveBeenCalled();
    expect(await caller.browser.stop({ businessId, siteKey: "carrd" })).toEqual({ stopped: 1 });
  });

  it("with no gateway to ask, the list is empty and the controls say it is not available here", async () => {
    const { businessId, ownerId } = hz.A;
    const caller = liveCaller({ userId: ownerId }, { browserSessions: undefined, browserTakeOver: undefined, browserHandBack: undefined, browserStop: undefined });
    expect((await caller.browser.sessions({ businessId })).sessions).toEqual([]);
    await expect(caller.browser.takeOver({ businessId, siteKey: "carrd" })).rejects.toMatchObject({ message: "The hosted browser is not available here." });
    const unreachable = liveCaller({ userId: ownerId }, { browserSessions: async () => { throw new AppError("gateway_unreachable", "no", 503); }, browserStop: async () => { throw new AppError("gateway_unreachable", "no", 503); } });
    expect((await unreachable.browser.sessions({ businessId })).sessions).toEqual([]);
    await expect(unreachable.browser.stop({ businessId, siteKey: "carrd" })).rejects.toMatchObject({ message: "The hosted browser is not available here." });
  });
});

describe("browserStep.get", () => {
  it("answers the step with its screenshot to its own project's members, and not-found to any other project", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { id } = await repos.browserSteps.record(hz.db, hz.A.businessId, { siteKey: "carrd", tool: "click", target: "Buy now", class: "hard_gate", why: "A purchase", url: "https://carrd.co/checkout", amount: "$29.00", screenshot: png, simulated: false });
    const own = await hz.caller({ userId: hz.A.ownerId }).browserStep.get({ businessId: hz.A.businessId, stepId: id });
    expect(own).toMatchObject({ siteKey: "carrd", target: "Buy now", class: "hard_gate", url: "https://carrd.co/checkout", amount: "$29.00", simulated: false });
    expect(own.screenshotDataUrl).toBe(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
    // Business B's member asking inside B for A's step, and asking for A itself.
    await expect(hz.caller({ userId: hz.B.ownerId }).browserStep.get({ businessId: hz.B.businessId, stepId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(hz.caller({ userId: hz.B.ownerId }).browserStep.get({ businessId: hz.A.businessId, stepId: id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Stop all agents and the hosted browser", () => {
  it("asks the gateway to end every session of the project, and a gateway that fails never fails the stop", async () => {
    const stopped: (string | undefined)[][] = [];
    const ok = liveCaller({ userId: hz.A.ownerId }, { browserStop: async (b, s) => (stopped.push([b, s]), { stopped: 2 }) });
    await ok.business.stopAllAgents({ businessId: hz.A.businessId });
    expect(stopped).toEqual([[hz.A.businessId, undefined]]);
    const audit = (await repos.audit.list(hz.db, hz.A.businessId, { action: "business.stop_all_agents" })).items[0]!;
    expect(audit.details).toMatchObject({ browserSessionsStopped: 2, browserReached: true });

    const failing = liveCaller({ userId: hz.B.ownerId }, { browserStop: async () => { throw new AppError("gateway_unreachable", "down", 503); } });
    const result = await failing.business.stopAllAgents({ businessId: hz.B.businessId });
    expect(result.pausedAgents).toBeGreaterThanOrEqual(1);
    expect(await repos.businesses.stopState(hz.db, hz.B.businessId)).toMatchObject({ stopped: true });
    const b = (await repos.audit.list(hz.db, hz.B.businessId, { action: "business.stop_all_agents" })).items[0]!;
    expect(b.details).toMatchObject({ browserSessionsStopped: 0, browserReached: false });
  });
});

describe("a hosted-browser hard stop in the Inbox", () => {
  it("names the step its own session recorded, so the note can show the page before the press", async () => {
    const db = hz.db;
    const A = hz.A.businessId;
    const task = await repos.tasks.create(db, A, { kind: "ops", title: "Publish the page", goalMd: "x", assigneeAgentId: hz.A.agentId, status: "running" });
    const session = await repos.agents.createSession(db, A, { agentId: hz.A.agentId, taskId: task.id, modelKey: "sonnet" });
    const step = await repos.browserSteps.record(db, A, { sessionId: session.id, siteKey: "carrd", tool: "click", target: "Buy now", class: "hard_gate", why: "A purchase", url: "https://carrd.co/checkout", screenshot: new Uint8Array([137, 80, 78, 71]) });
    const approval = await repos.approvals.create(db, A, { agentId: hz.A.agentId, sessionId: session.id, connectorKey: "browser_carrd", tool: "click", args: { ref: "p1e3" }, reasons: ["hard gate"] });
    const { item } = await openApprovalItem(db, A, approval, { agentId: hz.A.agentId, agentName: "Web Lead", connectorName: "Carrd (website)" });
    const seen = await hz.caller({ userId: hz.A.ownerId }).inbox.get({ businessId: A, itemId: item.id });
    expect(seen.approval?.browserStep).toEqual({ stepId: step.id, siteKey: "carrd" });
  });
});
