/**
 * Door B `importSource` / `finishImport` (BUILD §11.1, §9.4 importBusiness): each source is read with the one
 * read-only call its key names, and the row records what was read or why it was not. Nothing the gateway did not
 * return is ever marked imported: a refused call, a tool that answered with an error and a gateway that threw are all
 * "not read", with the reason.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMiscActivities, gatewayErrorReason, importCall, readOutcome } from "../activities/misc";
import { GatewayClientError } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "import" });
}, 120_000);
afterAll(() => t?.close());

const row = (key: string, value: string, uri: string | null) => ({ kind: "doc" as const, uri, title: `${key} import${value ? `: ${value}` : ""}`, relevance: { import: { key, value, readOnly: true, status: "pending" } } });
const relevanceOf = async (id: string) => (await repos.product.getSource(t.db, t.businessId, id)).relevance as { imported?: boolean; reason?: string; connector?: string; tool?: string; import?: { status?: string; note?: string } };
const via = { connector: "github", tool: "read_tree" };

describe("importSource", () => {
  it("reads each source with its reader's tool and arguments, and records the read on the row", async () => {
    const acts = createMiscActivities(t.deps);
    const repo = await repos.product.createSource(t.db, t.businessId, row("github", "acme/ledgerly", "https://github.com/acme/ledgerly"));
    const registry = await repos.product.createSource(t.db, t.businessId, row("registry", "12345678", "https://opencorporates.com/companies?q=12345678"));
    const before = t.gateway.calls.length;
    const results = [await acts.importSource({ businessId: t.businessId, sourceId: repo.id }), await acts.importSource({ businessId: t.businessId, sourceId: registry.id })];
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(results[0]!.summary).toBe("github import: acme/ledgerly: read through github (read_tree), read only");
    expect(t.gateway.calls.slice(before)).toEqual([
      { connector: "github", tool: "read_tree", args: { owner: "acme", repo: "ledgerly" } },
      { connector: "opencorporates", tool: "search_companies", args: { q: "12345678" } },
    ]);
    expect(t.gateway.minted.at(-1)?.allowedTools).toEqual(["opencorporates:search_companies"]);
    const read = await relevanceOf(repo.id);
    expect(read).toMatchObject({ imported: true, connector: "github", tool: "read_tree", import: { status: "read", note: "Read through github (read_tree), read only." } });
    expect(read.reason).toBeUndefined();
    expect((await repos.product.getSource(t.db, t.businessId, repo.id)).fetchedAt).toBeInstanceOf(Date);
  });

  it("records a source with no reader, one the gateway refuses, a failed tool and a thrown error as not read with the reason", async () => {
    const tracker = await repos.product.createSource(t.db, t.businessId, row("linear", "", "https://linear.app/"));
    const bank = await repos.product.createSource(t.db, t.businessId, row("bank", "", "https://link.tink.com/"));
    const repo = await repos.product.createSource(t.db, t.businessId, row("github", "acme/missing", "https://github.com/acme/missing"));
    const stripe = await repos.product.createSource(t.db, t.businessId, row("stripe", "", "https://dashboard.stripe.com/"));
    const before = t.gateway.calls.length;
    const refusing = createMiscActivities({ ...t.deps, gateway: { ...t.gateway, call: async () => ({ outcome: "deny" as const, reasons: ["tink is not connected"] }) } });
    const failing = createMiscActivities({ ...t.deps, gateway: { ...t.gateway, call: async () => ({ outcome: "allow" as const, result: { ok: false, error: { code: "not_found", message: "Not Found" }, untrusted: false, costMinor: 0 } }) } });
    const throwing = createMiscActivities({
      ...t.deps,
      gateway: {
        ...t.gateway,
        call: async () => {
          throw new GatewayClientError("integration_not_connected", "Stripe is not connected for this business", 409);
        },
      },
    });
    const none = await refusing.importSource({ businessId: t.businessId, sourceId: tracker.id });
    const denied = await refusing.importSource({ businessId: t.businessId, sourceId: bank.id });
    const failed = await failing.importSource({ businessId: t.businessId, sourceId: repo.id });
    const thrown = await throwing.importSource({ businessId: t.businessId, sourceId: stripe.id });
    expect(none).toMatchObject({ ok: false, summary: "linear import: not read, the import has no reader for this source yet" });
    expect(denied).toMatchObject({ ok: false, summary: expect.stringMatching(/the gateway refused the read \(tink is not connected\)$/) });
    expect(failed).toMatchObject({ ok: false, summary: expect.stringMatching(/the read failed: Not Found$/) });
    expect(thrown).toMatchObject({ ok: false, summary: expect.stringMatching(/Stripe is not connected for this business; connect it in Settings › Integrations$/) });
    expect(t.gateway.calls.length).toBe(before); // nothing called for the source with no reader (and the other gateways are stubs)
    expect(await relevanceOf(tracker.id)).toMatchObject({ imported: false, reason: "the import has no reader for this source yet", import: { status: "failed", note: "Not read: the import has no reader for this source yet." } });
    expect(await relevanceOf(bank.id)).toMatchObject({ imported: false, connector: "tink", tool: "list_accounts", import: { status: "failed" } });
    expect(await relevanceOf(repo.id)).toMatchObject({ imported: false, connector: "github", reason: "the read failed: Not Found", import: { status: "failed" } });
    expect(await relevanceOf(stripe.id)).toMatchObject({ imported: false, connector: "stripe", tool: "get_account", import: { status: "failed" } });
    for (const id of [tracker.id, bank.id, repo.id, stripe.id]) expect((await repos.product.getSource(t.db, t.businessId, id)).fetchedAt).toBeNull();

    // Read again once connected: the row is read and the stale reason goes.
    const ok = await createMiscActivities(t.deps).importSource({ businessId: t.businessId, sourceId: stripe.id });
    expect(ok.ok).toBe(true);
    const after = await relevanceOf(stripe.id);
    expect(after).toMatchObject({ imported: true, import: { status: "read" } });
    expect(after.reason).toBeUndefined();
  });

  it("finishImport says how many sources were read, lists the ones that were not and closes a read that never recorded", async () => {
    const acts = createMiscActivities(t.deps);
    const stuck = await repos.product.createSource(t.db, t.businessId, row("notion", "", "https://www.notion.so/"));
    const { inboxItemId } = await acts.finishImport({
      businessId: t.businessId,
      results: [
        { sourceId: "00000000-0000-4000-8000-000000000001", ok: true, summary: "GitHub import: read through github (read_tree), read only" },
        { sourceId: "00000000-0000-4000-8000-000000000002", ok: false, summary: "Linear import: not read, the import has no reader for this source yet" },
        { sourceId: stuck.id, ok: false, summary: "failed: activity timed out" },
      ],
    });
    const item = await repos.inbox.get(t.db, t.businessId, inboxItemId!);
    expect(item.subject).toBe("Import finished: 1 of 3 sources read");
    expect(item.bodyMd).toContain("- Linear import: not read, the import has no reader for this source yet");
    expect(item.bodyMd).toContain("Settings › Integrations");
    expect(item.bodyMd).toContain("Read now");
    expect(await relevanceOf(stuck.id)).toMatchObject({ imported: false, reason: "the read did not finish (activity timed out)", import: { status: "failed" } });
    // The closed read is named in the note like every other source, never as a bare "failed: …".
    expect(item.bodyMd).toContain("- notion import: not read, the read did not finish (activity timed out)");
    expect(item.bodyMd).not.toContain("failed: activity timed out");
  });

  it("importCall falls back to the URI for rows stored before the key was, and refuses what it cannot read", () => {
    expect(importCall({}, "https://github.com/acme/ledgerly", "x")).toEqual({ connector: "github", tool: "read_tree", args: { owner: "acme", repo: "ledgerly" } });
    expect(importCall({}, "https://dashboard.stripe.com/", "x")).toEqual({ connector: "stripe", tool: "get_account", args: {} });
    expect(importCall({}, "https://opencorporates.com/companies?q=Acme%20Ltd", "x")).toEqual({ connector: "opencorporates", tool: "search_companies", args: { q: "Acme Ltd" } });
    expect(importCall({ key: "website", value: "https://ledgerlyhq.com" }, "https://ledgerlyhq.com", "x")).toBeNull();
    expect(importCall({}, "https://linear.app/", "x")).toBeNull();
  });

  it("readOutcome only counts an allowed call whose tool succeeded; gatewayErrorReason words what the founder can do", () => {
    expect(readOutcome({ outcome: "allow", result: { ok: true, data: {} } }, via)).toEqual({ ok: true, ...via });
    expect(readOutcome({ outcome: "allow", result: { untrusted: true, content: null, mock: true } }, via)).toEqual({ ok: true, ...via });
    expect(readOutcome({ outcome: "allow", result: { ok: false, error: { code: "vendor_error" } } }, via)).toMatchObject({ ok: false, reason: "the read failed: vendor_error" });
    expect(readOutcome({ outcome: "ask", approvalId: "a" }, via)).toMatchObject({ ok: false, reason: expect.stringMatching(/approval first, so nothing was read/) });
    expect(readOutcome({ outcome: "rate_limited", retryAfterSeconds: 30 }, via)).toMatchObject({ ok: false, reason: expect.stringMatching(/rate limit/) });
    expect(gatewayErrorReason(new GatewayClientError("gateway_unreachable", "fetch failed", 503))).toBe("the gateway could not be reached");
    expect(gatewayErrorReason(new Error("boom"))).toBe("gateway error: boom");
  });
});
