/** 0031: Door B sources the sign-up simulation stored as read become "not read", with the reason; real reads are untouched. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { repos } from "../repos";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("mig31");
});
afterAll(() => r?.close());

describe("0031_settings_lifecycle", () => {
  it("marks simulated import rows not read without their invented summaries, and leaves real reads alone", async () => {
    const b = r.A.businessId;
    const simulated = await repos.product.createSource(r.db, b, {
      kind: "finance",
      uri: "https://dashboard.stripe.com/",
      title: "Stripe import",
      relevance: { import: { key: "stripe", value: "", connector: "stripe", readOnly: true, status: "done", summary: "164 customers, 1 months of revenue", provenance: "Estimate" }, summary: "164 customers, 1 months of revenue", blocks: [] },
    });
    const read = await repos.product.createSource(r.db, b, {
      kind: "doc",
      uri: "https://example.com/repo",
      title: "Repository import",
      relevance: { import: { key: "website", value: "", connector: "web", readOnly: true, status: "done", summary: "kept", provenance: "Estimate" }, summary: "kept", imported: true },
    });
    const fetched = await repos.product.createSource(r.db, b, {
      kind: "doc",
      uri: "https://github.com/acme/ledgerly",
      title: "GitHub import: acme/ledgerly",
      fetchedAt: new Date("2026-10-01T10:00:00Z"),
      relevance: { import: { key: "github", value: "acme/ledgerly", connector: "github", readOnly: true, status: "done", summary: "read", provenance: "Estimate" }, summary: "read" },
    });
    const manual = await repos.product.createSource(r.db, b, { kind: "doc", uri: "https://example.com/notes", title: "Notes", relevance: { summary: "A note the founder wrote" } });
    // An earlier import.start on a business stored its rows without a status; this one was never read (no worker, or
    // the gateway threw), the next one the old orchestrator recorded, and the last is a read queued after the fix.
    const legacy = await repos.product.createSource(r.db, b, { kind: "finance", uri: "https://admin.shopify.com/", title: "Shopify import", relevance: { import: { key: "shopify", value: "", connector: "shopify", readOnly: true } } });
    const legacyRecorded = await repos.product.createSource(r.db, b, { kind: "issue", uri: "https://linear.app/", title: "Linear import", relevance: { import: { key: "linear", value: "", connector: "linear", readOnly: true }, imported: false, reason: "no connector for this uri" } });
    const queued = await repos.product.createSource(r.db, b, { kind: "doc", uri: "https://www.notion.so/", title: "Notion import", relevance: { import: { key: "notion", value: "", connector: "notion", readOnly: true, status: "pending" } } });

    const migration = readMigrations().find((m) => m.tag === "0031_settings_lifecycle")!;
    for (const statement of migration.statements) await r.db.execute(sql.raw(statement));

    const legacyAfter = (await repos.product.getSource(r.db, b, legacy.id)).relevance as Record<string, unknown>;
    expect(legacyAfter).toEqual({ import: { key: "shopify", value: "", connector: "shopify", readOnly: true, status: "failed", note: "Not read: the earlier import never recorded a read." }, imported: false, reason: "the earlier import never recorded a read" });
    expect((await repos.product.getSource(r.db, b, legacyRecorded.id)).relevance).toEqual(legacyRecorded.relevance);
    expect((await repos.product.getSource(r.db, b, queued.id)).relevance).toEqual(queued.relevance);

    const after = (await repos.product.getSource(r.db, b, simulated.id)).relevance as Record<string, unknown>;
    expect(after.summary).toBeUndefined();
    expect(after.import).toEqual({ key: "stripe", value: "", connector: "stripe", readOnly: true, status: "failed", note: "Not read: the sign-up import never read it.", provenance: "Estimate" });
    expect(after).toMatchObject({ imported: false, reason: "the sign-up import never read it", blocks: [] });
    expect(((await repos.product.getSource(r.db, b, fetched.id)).relevance as { summary?: string }).summary).toBe("read");
    expect(((await repos.product.getSource(r.db, b, read.id)).relevance as { summary?: string }).summary).toBe("kept");
    expect(((await repos.product.getSource(r.db, b, manual.id)).relevance as { summary?: string }).summary).toBe("A note the founder wrote");
  });
});
