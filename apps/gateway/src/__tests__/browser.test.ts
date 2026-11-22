/**
 * The hosted browser through the gateway pipeline (founder, Nov 22, 2026), on one site of the site list over recorded
 * pages:
 * - reading a page runs and comes back untrusted, metered and audited; a field the founder can change back runs too,
 *   although the write tools' own hints say "ask": the step is classified from the page;
 * - a step that publishes asks first in augmented and assisted mode;
 * - "Buy now", and the same step labeled "Continue", is denied as a hard gate in every mode: nothing is pressed, the
 *   founder gets one task with what would be pressed and the amount, and the session waits for them;
 * - a never site's address is refused whatever the session token says;
 * - with no saved sign-in it is 409, and a signed-out one says "Sign in again" once;
 * - the founder's routes list, take over, hand back and stop; Stop all agents ends the session.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BrowserSessions, browserSite, createBrowserConnector, createMockBrowser, type BrowserStepRecord, type MockBrowserControl } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { signServiceToken } from "../tokens";
import type { AllowResponse, CallResponse, DenyResponse } from "../types";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

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
  it("assisted: a read and a reversible change run; a step that publishes asks first and presses nothing", async () => {
    const g = await setup("assisted");
    let p = await g.read("open_page", { url: "/products/new" });
    ok(await g.call("fill", { ref: ref(p, "Product name"), value: "Cedar candle" }));
    p = await g.read("read_page");
    ok(await g.call("click", { ref: ref(p, "Save product") }));
    expect(g.control.saved(g.businessId, "wave")).toEqual({ product_name: "Cedar candle" });
    p = await g.read("read_page");
    const publish = await g.call("click", { ref: ref(p, "Publish product") });
    expect(publish.outcome, JSON.stringify(publish)).toBe("ask");
    expect(g.steps.map((s) => `${s.tool}:${s.class}`)).toEqual(["fill:reversible", "click:reversible"]);
  });

  it("only the founder approves a step on a website: it is never routed to an agent the Responsibilities matrix names (security review)", async () => {
    const g = await setup("assisted");
    const p = await g.read("open_page", { url: "/products/new" });
    expect((await g.call("click", { ref: ref(p, "Publish product") })).outcome).toBe("ask");
    const rows = await g.h.pg.query<{ decision_type: string | null }>("select decision_type from approvals where business_id = $1", [g.businessId]);
    expect(rows.rows).toEqual([{ decision_type: null }]);
  });

  it("a ref the gateway cannot read asks first: the write tools' own hints stand", async () => {
    const g = await setup("assisted");
    await g.read("open_page", { url: "/settings/business" });
    expect((await g.call("click", { ref: "pdeadbeefe0" })).outcome).toBe("ask");
  });

  it("automated: a step that publishes runs, but one the gateway cannot classify still asks first", async () => {
    const g = await setup("automated");
    const p = await g.read("open_page", { url: "/products/new" });
    ok(await g.call("click", { ref: ref(p, "Publish product") }));
    await g.read("open_page", { url: "/setup/step-3" });
    // A stale ref cannot be read from the page at all.
    const stale = await g.call("click", { ref: "pdeadbeefe0" });
    expect(stale.outcome, JSON.stringify(stale)).toBe("ask");
    expect(JSON.stringify(stale)).toContain("unclassified-step-asks");
  });

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
