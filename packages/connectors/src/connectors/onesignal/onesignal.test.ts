import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { createOnesignalConnector, vendorNotes } from "./index";
import { onesignalMock } from "./mock";

const ids = ["sub-0123456789abcdef-1", "sub-0123456789abcdef-2"];

describeConnectorContract("onesignal (mock)", {
  connector: onesignalMock,
  mode: "mock",
  calls: [
    {
      tool: "send_push",
      args: { subscriptionIds: ids, title: "Needs your answer", body: "Juno (Chief of Staff): Approve batch 002 before the Ireland launch?", data: { businessId: "b1", kind: "decision" } },
      check: (r) => {
        const d = r.data as { id: string; recipients: number; errors: string[] };
        expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(d.recipients).toBe(2);
        expect(d.errors).toEqual([]);
        expect(r.costMinor).toBe(0);
      },
    },
    { tool: "send_push", args: { subscriptionIds: [], title: "x", body: "y" }, expectOk: false },
    { tool: "send_push", args: { subscriptionIds: ids, title: "", body: "y" }, expectOk: false },
    { tool: "send_push", args: { subscriptionIds: ids, title: "x", body: "y".repeat(241) }, expectOk: false },
  ],
});

describe("onesignal mock determinism", () => {
  it("answers the same id for the same notification and another for another", async () => {
    const ctx = makeToolContext(onesignalMock);
    const a = await onesignalMock.callTool("send_push", { subscriptionIds: ids, title: "New customer", body: "Bo Yun just became a paying customer" }, ctx);
    const b = await onesignalMock.callTool("send_push", { subscriptionIds: ids, title: "New customer", body: "Bo Yun just became a paying customer" }, ctx);
    const c = await onesignalMock.callTool("send_push", { subscriptionIds: ids, title: "New customer", body: "Ana Lind just became a paying customer" }, ctx);
    expect(a.data).toEqual(b.data);
    expect((a.data as { id: string }).id).not.toBe((c.data as { id: string }).id);
  });
});

describe("onesignal (live, unconfigured)", () => {
  it("throws ConfigError without ONESIGNAL_APP_ID and ONESIGNAL_API_KEY", async () => {
    const c = createOnesignalConnector({ secrets: {} });
    await expect(c.callTool("send_push", { subscriptionIds: ids, title: "x", body: "y" }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const half = createOnesignalConnector({ secrets: { onesignalAppId: "app-0000" } });
    await expect(half.callTool("send_push", { subscriptionIds: ids, title: "x", body: "y" }, makeToolContext(half, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe("onesignal (live, routed fetch)", () => {
  const seen: { auth: string | null; url: string; body: Record<string, unknown> }[] = [];
  const connectorFor = (answer: () => Response) =>
    createOnesignalConnector({
      secrets: { onesignalAppId: "app-0000-1111", onesignalApiKey: "os_v2_app_secretsecretsecretsecretsecret" },
      fetch: routedFetch({
        "POST https://api.onesignal.com/notifications": async (req, url) => {
          seen.push({ auth: req.headers.get("authorization"), url: url.toString(), body: (await req.json()) as Record<string, unknown> });
          return answer();
        },
      }),
    });

  it("sends the app id, the subscriptions, the texts and the data, with the key only in the header", async () => {
    const c = connectorFor(() => jsonResponse({ id: "ntf-1", recipients: 2 }));
    const r = await c.callTool("send_push", { subscriptionIds: ids, title: "Needs your go-ahead", body: "Set the LinkedIn Ads budget to £600 a week", data: { businessId: "b1", kind: "approval" }, collapseKey: "approval:a1" }, makeToolContext(c, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ id: "ntf-1", recipients: 2, errors: [] });
    const call = seen.at(-1)!;
    expect(call.url).toBe("https://api.onesignal.com/notifications?c=push");
    expect(call.auth).toBe("Key os_v2_app_secretsecretsecretsecretsecret");
    expect(call.body).toMatchObject({ app_id: "app-0000-1111", target_channel: "push", include_subscription_ids: ids, headings: { en: "Needs your go-ahead" }, contents: { en: "Set the LinkedIn Ads budget to £600 a week" }, data: { businessId: "b1", kind: "approval" }, collapse_id: "approval:a1" });
    expect(JSON.stringify(call.body)).not.toContain("secretsecret");
  });

  it("an empty id with errors means nothing was sent: zero recipients, the notes kept short", async () => {
    const c = connectorFor(() => jsonResponse({ id: "", errors: ["All included players are not subscribed"] }));
    const r = await c.callTool("send_push", { subscriptionIds: ids, title: "x", body: "y" }, makeToolContext(c, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ id: "", recipients: 0, errors: ["All included players are not subscribed"] });
  });

  it("a vendor failure is a vendor_error, a refused key an unauthorized, neither with the key in it", async () => {
    const down = connectorFor(() => jsonResponse({ errors: ["Internal error"] }, { status: 500 }));
    const r = await down.callTool("send_push", { subscriptionIds: ids, title: "x", body: "y" }, makeToolContext(down, { mode: "live" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ code: "vendor_error", status: 500 });
    const refused = connectorFor(() => jsonResponse({ errors: ["Access denied. Please include an 'Authorization: Key os_v2_app_secretsecretsecretsecretsecret' header"] }, { status: 401 }));
    const u = await refused.callTool("send_push", { subscriptionIds: ids, title: "x", body: "y" }, makeToolContext(refused, { mode: "live" }));
    expect(u.ok).toBe(false);
    expect(u.error?.code).toBe("unauthorized");
    expect(JSON.stringify(u.error)).not.toContain("secretsecret");
  });

  it("reads the provider's notes from an array or an object, never anything else", () => {
    expect(vendorNotes(["a", 7, "b"])).toEqual(["a", "b"]);
    expect(vendorNotes({ invalid_player_ids: ["x"] })).toEqual(["invalid_player_ids"]);
    expect(vendorNotes("nope")).toEqual([]);
    expect(vendorNotes(undefined)).toEqual([]);
  });
});

describe.skipIf(!envKeysPresent("ONESIGNAL_APP_ID", "ONESIGNAL_API_KEY"))("onesignal (live)", () => {
  it("reports health against the real app record", async () => {
    const health = await createOnesignalConnector().healthcheck({} as never);
    expect(health.status).toBe("connected");
  });
});
