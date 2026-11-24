/**
 * The hosted browser through the gateway pipeline (founder, Nov 22, 2026), on one site of the site list over recorded
 * pages:
 * - reading a page runs and comes back untrusted, metered and audited; a field the founder can change back runs too,
 *   although the write tools' own hints say "ask": the step is classified from the page;
 * - a step that publishes, and one the classifier cannot name, runs with no approval in every mode (founder, Nov 23, 2026);
 * - "Buy now", and the same step labeled "Continue", is denied as a hard gate in every mode: nothing is pressed, the
 *   founder gets one task with what would be pressed and the amount, and the session waits for them;
 * - a never site's address is refused whatever the session token says;
 * - with no saved sign-in it is 409, and a signed-out one says "Sign in again" once;
 * - the founder's routes list, take over, hand back and stop; Stop all agents ends the session.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BrowserSessions, browserSite, catalogTool, createBrowserConnector, createMockBrowser, toolRecommendationNote, RecommendToolArgs, type BrowserStepRecord, type MockBrowserControl } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { signServiceToken } from "../tokens";
import type { AllowResponse, CallResponse, DenyResponse } from "../types";
import { setupGateway, silentLog, TEST_SECRET, type GatewayFixture } from "./harness";
import { browserHost } from "../browser";

const SITE = browserSite("wave")!;
const KEY = "browser_wave";

interface Fixture extends GatewayFixture {
  sessions: BrowserSessions;
  control: MockBrowserControl;
  steps: BrowserStepRecord[];
  tok: string;
  call(tool: string, args?: unknown): Promise<CallResponse>;
  read(tool: "open_page" | "read_page", args?: unknown): Promise<{ url: string; elements: { ref: string; label: string }[]; text: string; needsFounder: string | null }>;
  post(path: string, body: unknown, svc?: string): Promise<{ status: number; json: Record<string, unknown> }>;
}

let open: GatewayFixture | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function setup(businessMode: "augmented" | "assisted" | "automated" = "assisted", opts: { signIn?: boolean } = {}): Promise<Fixture> {
  const { driver, control } = createMockBrowser();
  const sessions = new BrowserSessions(driver);
  const steps: BrowserStepRecord[] = [];
  const connector = createBrowserConnector(SITE, { secrets: {}, browser: { sessions, recordStep: async (s) => (steps.push(s), `step-${steps.length}`) } });
  const g = (open = await setupGateway({ mode: "live", businessMode, connectors: [connector] }));
  g.deps.browserSessions = sessions;
  if (opts.signIn !== false) {
    const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: KEY, status: "connected", authKind: "oauth", accountLabel: "Signed in to Wave", settings: { config: { siteKey: "wave" } } });
    await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "oauth", secret: await driver.createContext() });
  }
  const tok = await g.token({ allowedTools: [`${KEY}:*`] });
  const call = (tool: string, args: unknown = {}) => g.client.call(tok, { connector: KEY, tool, args });
  return Object.assign(g, {
    sessions,
    control,
    steps,
    tok,
    call,
    async read(tool: "open_page" | "read_page", args: unknown = {}) {
      const r = await call(tool, args);
      expect(r.outcome, JSON.stringify(r)).toBe("allow");
      const result = (r as AllowResponse).result;
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.untrusted).toBe(true);
      return (result.data as { content: { url: string; elements: { ref: string; label: string }[]; text: string; needsFounder: string | null } }).content;
    },
    async post(path: string, body: unknown, svc = "api") {
      const res = await fetch(`${g.server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
  });
}

const ref = (p: { elements: { ref: string; label: string }[] }, label: string) => p.elements.find((e) => e.label === label)!.ref;
const ok = (r: CallResponse) => {
  expect(r.outcome, JSON.stringify(r)).toBe("allow");
  expect((r as AllowResponse).result.ok, JSON.stringify(r)).toBe(true);
};

describe("steps are classified from the page before they run", () => {
  it("assisted: a read, a reversible change and a step that publishes all run with no approval", async () => {
    const g = await setup("assisted");
    let p = await g.read("open_page", { url: "/products/new" });
    ok(await g.call("fill", { ref: ref(p, "Product name"), value: "Cedar candle" }));
    p = await g.read("read_page");
    ok(await g.call("click", { ref: ref(p, "Save product") }));
    expect(g.control.saved(g.businessId, "wave")).toEqual({ product_name: "Cedar candle" });
    p = await g.read("read_page");
    ok(await g.call("click", { ref: ref(p, "Publish product") }));
    expect(g.steps.map((s) => `${s.tool}:${s.class}`)).toEqual(["fill:reversible", "click:reversible", "click:outward"]);
  });

  it("only the founder approves a step on a website: it is never routed to an agent the Responsibilities matrix names (security review)", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/products/new" });
    // A ref the gateway cannot read keeps the strictest hints, so it asks.
    expect((await g.call("click", { ref: "pdeadbeefe0" })).outcome).toBe("ask");
    const rows = await g.h.pg.query<{ decision_type: string | null }>("select decision_type from approvals where business_id = $1", [g.businessId]);
    expect(rows.rows).toEqual([{ decision_type: null }]);
  });

  it("a ref the gateway cannot read asks first: the write tools' own hints stand", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/settings/business" });
    expect((await g.call("click", { ref: "pdeadbeefe0" })).outcome).toBe("ask");
  });

  it("automated: a step that publishes runs", async () => {
    const g = await setup("automated");
    const p = await g.read("open_page", { url: "/products/new" });
    ok(await g.call("click", { ref: ref(p, "Publish product") }));
  });

  // Founder, Nov 23, 2026: "They should never have to approve individual steps."
  for (const mode of ["augmented", "assisted", "automated"] as const) {
    it(`${mode}: a step the classifier cannot name runs with no approval and is recorded`, async () => {
      const g = await setup(mode);
      const p = await g.read("open_page", { url: "/" });
      ok(await g.call("click", { ref: ref(p, "Got it") }));
      expect(g.steps.map((s) => `${s.tool}:${s.class}`)).toEqual(["click:unknown"]);
      const asks = await g.h.pg.query("select id from approvals where business_id = $1", [g.businessId]);
      expect(asks.rows).toEqual([]);
    });
  }

  for (const mode of ["augmented", "assisted", "automated"] as const) {
    it(`${mode}: Buy now, and the same step labeled Continue, is the founder's own press`, async () => {
      const g = await setup(mode);
      for (const [path, label] of [["/plan", "Buy now"], ["/setup/step-3", "Continue"]] as const) {
        const p = await g.read("open_page", { url: path });
        const r = (await g.call("click", { ref: ref(p, label) })) as DenyResponse;
        expect(r.outcome, `${mode} ${label}: ${JSON.stringify(r)}`).toBe("deny");
        expect(r.policyIds).toContain("hard-gate");
        expect(r.approvalId).toBeTruthy();
        expect(r.humanAction).toMatchObject({ connector: KEY, tool: "click", title: `Press "${label}" in Wave yourself`, reason: "hard_gate" });
        expect(r.humanAction?.instructions).toContain("$29.00");
        // Held for the founder, and the page did not move.
        expect(g.sessions.list(g.businessId)[0]?.held?.why).toBe("hard_gate");
        expect(g.sessions.handBack(g.businessId, "wave")).toBe(true);
        expect((await g.read("read_page")).url).toBe(`https://next.waveapps.com${path}`);
      }
      expect(g.steps.map((s) => s.class)).toEqual(["hard_gate", "hard_gate"]);
      // The founder hears of each stop in the Inbox; the approval keeps what the founder needs, never the ref.
      const rows = await g.h.pg.query<{ args: Record<string, unknown>; subject: string; decision_type: string | null }>("select a.args, i.subject, a.decision_type from approvals a join inbox_items i on i.id = a.inbox_item_id where a.business_id = $1 order by a.created_at", [g.businessId]);
      expect(rows.rows.map((r) => r.subject)).toEqual(['Press "Buy now" in Wave yourself', 'Press "Continue" in Wave yourself']);
      for (const r of rows.rows) {
        expect(r.decision_type).toBeNull();
        expect(r.args).toMatchObject({ siteKey: "wave", amount: "$29.00", stepId: expect.any(String) });
        expect(r.args).not.toHaveProperty("ref");
      }
      expect(g.steps.every((s) => s.amount === "$29.00" && s.screenshot)).toBe(true);
    });
  }

  it("request_founder never runs: the founder gets one task and the session waits", async () => {
    const g = await setup("automated");
    const p = await g.read("open_page", { url: "/verify" });
    expect(p.needsFounder).toBe("captcha");
    const r = (await g.call("request_founder", { need: "captcha", sentence: "The site asks to confirm a person is here." })) as DenyResponse;
    expect(r.outcome).toBe("deny");
    expect(r.humanAction?.title).toBe("The team needs you in Wave");
    expect(g.sessions.list(g.businessId)[0]?.held).toMatchObject({ why: "request" });
  });
});

describe("where a session may be", () => {
  it("refuses a never site and any other site, whatever the session token says", async () => {
    const g = await setup("automated");
    for (const url of ["https://www.chase.com/", "https://www.linkedin.com/feed", "https://example.org/"]) {
      const r = (await g.call("open_page", { url })) as AllowResponse;
      expect(r.result.ok, url).toBe(false);
      expect(r.result.error?.code, url).toBe("left_site");
    }
    // Nothing was opened for it: no session was started.
    expect(g.sessions.list(g.businessId)).toHaveLength(0);
  });

  it("is 409 with no saved sign-in, and says Sign in again once for a signed-out one", async () => {
    const none = await setup("assisted", { signIn: false });
    await expect(none.call("open_page", { url: "/" })).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    await none.close();
    const g = await setup("assisted");
    g.control.signOut(g.businessId, "wave");
    const r = (await g.call("open_page", { url: "/settings/tax" })) as AllowResponse;
    expect(r.result.error?.code).toBe("sign_in_again");
    expect(g.sessions.list(g.businessId)).toHaveLength(0);
  });
});

describe("the founder watches, takes over, hands back and stops", () => {
  it("lists the session, pauses the agent while the founder has the page, and resumes on hand back", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/settings/business" });
    const listed = await g.post("/v1/browser/sessions", { businessId: g.businessId });
    expect(listed.json.sessions).toMatchObject([{ siteKey: "wave", siteName: "Wave", held: null, simulated: false }]);
    expect((await g.post("/v1/browser/takeover", { businessId: g.businessId, siteKey: "wave" })).json).toEqual({ held: true });
    const waiting = (await g.call("read_page")) as AllowResponse;
    expect(waiting.result.error?.code).toBe("founder_has_page");
    expect((await g.post("/v1/browser/handback", { businessId: g.businessId, siteKey: "wave" })).json).toEqual({ handedBack: true });
    await g.read("read_page");
  });

  it("only the api asks, and another project sees and stops nothing", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/" });
    expect((await g.post("/v1/browser/sessions", { businessId: g.businessId }, "orchestrator")).status).toBe(403);
    const other = "00000000-0000-4000-8000-0000000000b2";
    expect((await g.post("/v1/browser/sessions", { businessId: other })).json.sessions).toEqual([]);
    expect((await g.post("/v1/browser/stop", { businessId: other })).json).toEqual({ stopped: 0 });
    expect((await g.post("/v1/browser/takeover", { businessId: other, siteKey: "wave" })).json).toEqual({ held: false });
    expect(g.sessions.list(g.businessId)).toHaveLength(1);
  });

  it("Stop all agents ends the session: by the api's stop, and by the next refused call", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/" });
    expect((await g.post("/v1/browser/stop", { businessId: g.businessId })).json).toEqual({ stopped: 1 });
    expect(g.sessions.list(g.businessId)).toHaveLength(0);
    await g.read("open_page", { url: "/" });
    await g.h.pg.query("update businesses set agents_stopped_at = now(), agents_stopped_reason = 'kill_switch' where id = $1", [g.businessId]);
    expect((await g.call("read_page")).outcome).toBe("deny");
    expect(g.sessions.list(g.businessId)).toHaveLength(0);
  });
});

describe("a bot check (founder, Nov 24, 2026: user solves captchas, no auto-solving)", () => {
  it("writes one note for the founder, emailed as a waiting decision, and not again while it waits", async () => {
    const g = await setup("assisted");
    const warned: string[] = [];
    const host = browserHost(g.db, { ...silentLog, warn: (o: unknown) => void warned.push(JSON.stringify(o)) }, null);
    await repos.agents.create(g.db, g.businessId, { name: "Chief of Staff", agentType: "chief_of_staff", layer: "assistant", modelKey: "sonnet", initialVersion: { instructions: { role: "chief" }, tools: [] } });
    const input = { businessId: g.businessId, siteKey: "wave", siteName: "Wave", need: "captcha" as const, simulated: false };
    await host.needsFounder!(input);
    await host.needsFounder!(input);
    const notes = await repos.inbox.openBySubject(g.db, g.businessId, "Wave needs you to solve a check");
    expect(warned).toEqual([]);
    expect(notes).toHaveLength(1);
    expect((notes[0]!.decision as { key: string }).key).toBe("browser_check:wave");
    expect(notes[0]!.bodyMd).toContain("press Take over, solve the check, then press Hand back");
    expect((await repos.events.list(g.db, g.businessId, { type: "inbox.item_created", limit: 5 })).items).toHaveLength(1);
  });
});

describe("a quiet saved sign-in (Part D)", () => {
  it("each use moves its deletion date to 30 days from now, at most once an hour", async () => {
    const at = { now: new Date("2026-11-22T12:00:00Z") };
    const g = await setup("assisted");
    const row = (await repos.integrations.getByKey(g.db, g.businessId, KEY))!;
    const host = browserHost(g.db, silentLog, null, () => at.now);
    await host.used!(g.businessId, KEY);
    const first = (await repos.credentials.latest(g.db, g.businessId, row.id))!.meta.expiresAt;
    expect(new Date(first!).toISOString()).toBe("2026-12-22T12:00:00.000Z");
    at.now = new Date("2026-11-22T12:30:00Z");
    await host.used!(g.businessId, KEY);
    expect((await repos.credentials.latest(g.db, g.businessId, row.id))!.meta.expiresAt).toEqual(first);
    at.now = new Date("2026-11-23T12:00:00Z");
    await host.used!(g.businessId, KEY);
    expect(new Date((await repos.credentials.latest(g.db, g.businessId, row.id))!.meta.expiresAt!).toISOString()).toBe("2026-12-23T12:00:00.000Z");
  });

  it("a new saved sign-in is stored with that date", async () => {
    const g = await setup("assisted", { signIn: false });
    const connector = g.deps.registry.get(KEY, "live");
    await connector.connect(g.businessId, {});
    const done = await connector.connect(g.businessId, { done: true });
    expect(Math.round((new Date(done.credentialToStore!.expiresAt!).getTime() - Date.now()) / 86_400_000)).toBe(30);
  });
});

describe("Part D, D4: the scenarios end to end", () => {
  it("a website-only pick: the note says the browser route, the founder signs in, and a three-step setup is read back", async () => {
    // The recommendation: the catalog's route wins over what the agent wrote.
    const note = toolRecommendationNote(RecommendToolArgs.parse({ category: "invoicing_accounting", pick: { name: "Wave", route: "link", why: "Free invoices.", whyNow: "Two shops asked this week.", cost: "$0 a month" }, alternatives: [{ name: "Xero", line: "$20 a month." }, { name: "QuickBooks Online", line: "$35 a month." }], sources: [{ url: "https://www.waveapps.com/pricing", title: "Wave pricing" }] }));
    expect(note.pick.route).toBe("browser");
    expect(catalogTool("wave")?.connectorKey).toBe(KEY);
    // The founder signs in: no saved sign-in until Done.
    const g = await setup("assisted", { signIn: false });
    const connector = g.deps.registry.get(KEY, "live");
    expect((await connector.connect(g.businessId, {})).credentialToStore).toBeUndefined();
    const done = await connector.connect(g.businessId, { done: true });
    const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: KEY, status: "connected", authKind: "oauth", accountLabel: done.accountLabel, settings: { config: done.config } });
    await storeCredential(g.db, g.vault, g.businessId, row.id, done.credentialToStore!);
    // Three changes, each read back.
    for (const [path, field, value, save] of [["/settings/business", "Business name", "Northwind Candles", "Save"], ["/settings/tax", "Default tax rate", "8.25", "Save"], ["/products/new", "Product name", "Cedar candle", "Save product"]] as const) {
      let p = await g.read("open_page", { url: path });
      ok(await g.call("fill", { ref: ref(p, field), value }));
      p = await g.read("read_page");
      ok(await g.call("click", { ref: ref(p, save) }));
      expect((await g.read("open_page", { url: path })).text, path).toContain(`${field}: ${value}`);
    }
    expect(g.control.saved(g.businessId, "wave")).toEqual({ business_name: "Northwind Candles", tax_rate: "8.25", product_name: "Cedar candle" });
    expect(g.steps.filter((s) => s.class === "reversible")).toHaveLength(6);
  });

  it("one project never uses another project's saved sign-in", async () => {
    const opened: { businessId: string; contextId: string }[] = [];
    const g = await setup("assisted");
    const open = g.sessions.driver.open.bind(g.sessions.driver);
    g.sessions.driver.open = async (input) => (opened.push({ businessId: input.businessId, contextId: input.contextId }), open(input));
    const mine = (await repos.credentials.latest(g.db, g.businessId, (await repos.integrations.getByKey(g.db, g.businessId, KEY))!.id, "secret"))!;
    expect(mine).toBeTruthy();
    // A second project with its own saved sign-in.
    const other = await repos.businesses.create(g.db, { name: "Other Project", businessMode: "assisted" });
    const agent = await repos.agents.create(g.db, other.id, { name: "Other Worker", agentType: "developer", modelKey: "sonnet", initialVersion: { instructions: { role: "worker" }, tools: [] } });
    const otherRow = await repos.integrations.upsert(g.db, other.id, { connectorKey: KEY, status: "connected", authKind: "oauth", settings: { config: { siteKey: "wave" } } });
    await storeCredential(g.db, g.vault, other.id, otherRow.id, { kind: "oauth", secret: "other-projects-sign-in" });
    const session = (await repos.agents.createSession(g.db, other.id, { agentId: agent.id, modelKey: "sonnet" })).id;
    const otherTok = (await g.client.mintSessionToken({ businessId: other.id, agentId: agent.id, sessionId: session, allowedTools: [`${KEY}:*`], kitMode: false })).token;
    await g.read("open_page", { url: "/" });
    await g.client.call(otherTok, { connector: KEY, tool: "open_page", args: { url: "/" } });
    expect(opened.map((o) => o.businessId)).toEqual([g.businessId, other.id]);
    expect(opened[1]!.contextId).toBe("other-projects-sign-in");
    expect(opened[0]!.contextId).not.toBe("other-projects-sign-in");
    // Each project sees, holds and stops only its own session.
    expect(g.sessions.list(g.businessId)).toHaveLength(1);
    expect(g.sessions.list(other.id)).toHaveLength(1);
    expect((await g.post("/v1/browser/stop", { businessId: other.id })).json).toEqual({ stopped: 1 });
    expect(g.sessions.list(g.businessId)).toHaveLength(1);
  });

  it("Stop all agents ends a running browser session within seconds", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/settings/business" });
    const started = Date.now();
    expect((await g.post("/v1/browser/stop", { businessId: g.businessId })).json).toEqual({ stopped: 1 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(g.sessions.list(g.businessId)).toEqual([]);
  });
});
