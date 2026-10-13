import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMPORT_DEADLINE_MS, IMPORT_TIMED_OUT, buildScoutingReport, decodeJobId, encodeJobId, importJobKey, importStatus, sourceUri, validateConfigs, webUri } from "../services/import";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("import.start / import.status — Door B (BUILD §11.1, AC-11.1.5)", () => {
  let hz: ApiHarness;
  const temporal = fakeTemporalClient();
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "import", temporalClient: temporal });
  }, 120_000);
  afterAll(() => hz.close());

  it("validates the typed values the way the picker does", () => {
    expect(validateConfigs([{ key: "github", value: "acme" }])).toHaveProperty("github");
    expect(validateConfigs([{ key: "github", value: "https://github.com/acme/ledgerly.git" }])).toEqual({});
    expect(validateConfigs([{ key: "website", value: "ledgerly" }])).toHaveProperty("website");
    expect(validateConfigs([{ key: "website", value: "ledgerlyhq.com" }])).toEqual({});
    expect(validateConfigs([{ key: "registry", value: "1" }])).toHaveProperty("registry");
    expect(validateConfigs([{ key: "stripe", value: "" }])).toEqual({});
  });

  it("without a business the job runs server-side and deterministically; the report never pushes and is an Estimate", async () => {
    const user = hz.caller({ userId: hz.A.ownerId });
    const sources = [
      { key: "github" as const, value: "acme/ledgerly" },
      { key: "stripe" as const, value: "" },
      { key: "linear" as const, value: "" },
    ];
    await expect(user.import.start({ sources: [{ key: "github", value: "nope" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const started = await user.import.start({ sources, stepMs: 5 });
    expect(started.job.mode).toBe("local");
    expect(started.job.businessId).toBeNull();
    expect(started.workflow).toBeNull();
    expect(started.job.sources.map((s) => s.key)).toEqual(["github", "stripe", "linear"]);
    expect(started.job.sources[0]!.steps.at(-1)!.label).toMatch(/nothing was pushed/i);
    expect(decodeJobId(importJobKey(hz.deps.env), started.job.id)).toMatchObject({ u: hz.A.ownerId, b: null });
    expect(decodeJobId(importJobKey(hz.deps.env), started.job.id).s).toHaveLength(3);
    expect(temporal.starts).toHaveLength(0);

    // 12 steps × 5 ms: wait for the schedule to pass, then the report is ready.
    await sleep(120);
    const status = await user.import.status({ jobId: started.job.id });
    expect(status.job.status).toBe("done");
    expect(status.job.sources.every((s) => s.status === "done" && s.summary)).toBe(true);
    expect(status.report).not.toBeNull();
    const report = status.report!;
    expect(report.suggestedName).toBe("Ledgerly");
    expect(report.archetypeHint).toBe("b2b_saas");
    expect(report.neverPushed).toBe(true);
    expect(report.provenance).toBe("Estimate");
    expect(report.whatExists).toHaveLength(3);
    expect(report.whatExists[0]).toMatch(/nothing pushed/);
    expect(report.roadmapSeeds.length).toBeGreaterThanOrEqual(5);
    expect(report.firstDecisions.filter((d) => d.recommended)).toHaveLength(1);
    expect(report.firstDecisions.find((d) => d.id === "roadmap")?.label).toMatch(/open issues/);
    // Same inputs → the same report (AC: deterministic mock), on a second status call and from the pure builder.
    const again = await user.import.status({ jobId: started.job.id });
    expect(again.report).toEqual(report);
    expect(buildScoutingReport(sources)).toEqual(report);
    await expect(user.import.status({ jobId: "not-a-job-id" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("job ids are signed and bound to the account that started them (L1)", async () => {
    const user = hz.caller({ userId: hz.A.ownerId });
    const started = await user.import.start({ sources: [{ key: "github", value: "acme/ledgerly" }], stepMs: 1 });
    const [body, sig] = started.job.id.split(".");
    expect(sig).toBeTruthy();
    // Someone else's account cannot read it.
    await expect(hz.caller({ userId: hz.B.ownerId }).import.status({ jobId: started.job.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // An edited token (another repository) fails the signature; an unsigned one is refused outright.
    const token = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<string, unknown>;
    const edited = Buffer.from(JSON.stringify({ ...token, s: [{ k: "github", v: "acme/secret", id: null }] })).toString("base64url");
    await expect(user.import.status({ jobId: `${edited}.${sig}` })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(user.import.status({ jobId: body! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() => decodeJobId("another-secret-0123456789", started.job.id)).toThrow();
    // The same source twice is refused; production without SESSION_TOKEN_SECRET refuses to sign at all.
    await expect(user.import.start({ sources: [{ key: "stripe", value: "" }, { key: "stripe", value: "" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(() => importJobKey({ APP_ENV: "production", SESSION_TOKEN_SECRET: undefined })).toThrow(/SESSION_TOKEN_SECRET/);
  });

  it("only web links become a source's uri", () => {
    expect(webUri("https://ledgerlyhq.com")).toBe("https://ledgerlyhq.com");
    expect(webUri("javascript:alert(1)")).toBeNull();
    expect(webUri("data:text/html,x")).toBeNull();
    expect(webUri("not a url")).toBeNull();
    expect(sourceUri("website", "javascript:alert(1)")).toBeNull();
    expect(sourceUri("github", "acme/ledgerly")).toBe("https://github.com/acme/ledgerly");
  });

  it("with a business: sources rows are written and importBusiness starts on Temporal; status follows the orchestrator's updates", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    await expect(hz.caller({ userId: hz.A.memberId }).import.start({ businessId, sources: [{ key: "website", value: "https://ledgerlyhq.com" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const started = await owner.import.start({ businessId, sources: [{ key: "website", value: "https://ledgerlyhq.com" }, { key: "registry", value: "12345678" }] });
    expect(started.job.mode).toBe("temporal");
    expect(started.workflow?.queued).toBe(true);
    expect(started.job.status).toBe("running");
    expect(started.report).toBeNull();
    const start = temporal.starts.at(-1)!;
    expect(start.type).toBe("importBusiness");
    expect(start.workflowId).toMatch(new RegExp(`^import:${businessId}:`));
    const args = start.args[0] as { businessId: string; sourceIds: string[] };
    expect(args.businessId).toBe(businessId);
    expect(args.sourceIds).toHaveLength(2);
    const rows = await repos.product.listSources(hz.db, businessId, { limit: 50 });
    expect(rows.items.map((r) => r.id).sort()).toEqual([...args.sourceIds].sort());
    expect(rows.items.find((r) => r.kind === "legal")).toBeTruthy();
    expect(rows.items.find((r) => r.uri === "https://ledgerlyhq.com")).toBeTruthy();

    // A member of another business cannot read the job.
    await expect(hz.caller({ userId: hz.B.ownerId }).import.status({ jobId: started.job.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The orchestrator's importSource activity finishes the sources.
    for (const id of args.sourceIds) {
      const row = await repos.product.getSource(hz.db, businessId, id);
      await repos.product.updateSource(hz.db, businessId, id, { fetchedAt: new Date(), relevance: { ...(row.relevance as Record<string, unknown>), imported: true, connector: "web", tool: "fetch" } });
    }
    const done = await owner.import.status({ jobId: started.job.id });
    expect(done.job.status).toBe("done");
    expect(done.job.sources.every((s) => s.status === "done")).toBe(true);
    expect(done.report?.suggestedName).toBe("Ledgerlyhq");
    expect(done.report?.whatExists[0]).toMatch(/imported through web/);
    const audit = await repos.audit.list(hz.db, businessId, { action: "import.start" });
    expect(audit.items).toHaveLength(1);
  });

  it("a business import refuses a source no connector reads, and stores what the orchestrator routes on", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const before = (await repos.product.listSources(hz.db, businessId, { limit: 100 })).items.length;
    await expect(owner.import.start({ businessId, sources: [{ key: "linear", value: "" }, { key: "stripe", value: "" }] })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/Linear cannot be imported into a business yet/) });
    expect((await repos.product.listSources(hz.db, businessId, { limit: 100 })).items).toHaveLength(before);
    const started = await owner.import.start({ businessId, sources: [{ key: "github", value: "acme/ledgerly" }, { key: "registry", value: "12345678" }] });
    const rows = (await repos.product.listSources(hz.db, businessId, { limit: 100 })).items.filter((r) => started.job.sources.some((s) => s.sourceId === r.id));
    expect(rows.map((r) => (r.relevance as { import: { key: string; value: string; connector: string } }).import).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "github", value: "acme/ledgerly", connector: "github", readOnly: true },
      { key: "registry", value: "12345678", connector: "opencorporates", readOnly: true },
    ]);
    // The preview job (no business) still lists every source, including the two without a connector.
    const preview = await owner.import.start({ sources: [{ key: "linear", value: "" }, { key: "jira", value: "" }], stepMs: 1 });
    expect(preview.job.mode).toBe("local");
  });

  it("every source reaches a terminal state: failures carry their reason, finishedAt is when the last one finished, a silent run times out", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const t0 = new Date("2026-10-12T10:00:00.000Z");
    const started = await owner.import.start({ businessId, sources: [{ key: "stripe", value: "" }, { key: "shopify", value: "" }, { key: "bank", value: "" }] });
    const [stripe, shopify, bank] = started.job.sources.map((s) => s.sourceId!);
    const key = importJobKey(hz.deps.env);
    const decoded = decodeJobId(key, started.job.id);
    const jobId = encodeJobId(key, { ...decoded, t: t0.getTime() });
    // One source failed (the orchestrator wrote the reason), one succeeded, one is still running: the job is running.
    await repos.product.updateSource(hz.db, businessId, stripe!, { relevance: { imported: false, reason: "stripe.get_account failed: not connected", finishedAt: "2026-10-12T10:00:05.000Z" } });
    await repos.product.updateSource(hz.db, businessId, shopify!, { fetchedAt: new Date("2026-10-12T10:00:09.000Z"), relevance: { imported: true, connector: "shopify", read: "3 orders", finishedAt: "2026-10-12T10:00:09.000Z" } });
    const running = await importStatus({ db: hz.db, key }, jobId, hz.A.ownerId, new Date("2026-10-12T10:01:00.000Z"));
    expect(running.job.status).toBe("running");
    expect(running.job.finishedAt).toBeNull();
    expect(running.job.sources.map((s) => [s.status, s.summary])).toEqual([["failed", "stripe.get_account failed: not connected"], ["done", "imported through shopify: 3 orders"], ["running", null]]);
    // Past the deadline the silent source is a failure and the job finishes, at the last real finish time plus the deadline.
    const late = await importStatus({ db: hz.db, key }, jobId, hz.A.ownerId, new Date(t0.getTime() + IMPORT_DEADLINE_MS + 1000));
    expect(late.job.status).toBe("done");
    expect(late.job.sources[2]).toMatchObject({ status: "failed", summary: IMPORT_TIMED_OUT });
    expect(late.job.finishedAt).toBe(new Date(t0.getTime() + IMPORT_DEADLINE_MS).toISOString());
    expect(late.report).not.toBeNull();
    // The orchestrator finished the last one: finishedAt is that time, and does not move with the poll.
    await repos.product.updateSource(hz.db, businessId, bank!, { relevance: { imported: false, reason: "no bank link", finishedAt: "2026-10-12T10:00:30.000Z" } });
    const a = await importStatus({ db: hz.db, key }, jobId, hz.A.ownerId, new Date("2026-10-12T10:02:00.000Z"));
    const b = await importStatus({ db: hz.db, key }, jobId, hz.A.ownerId, new Date("2026-10-12T11:02:00.000Z"));
    expect(a.job.finishedAt).toBe("2026-10-12T10:00:30.000Z");
    expect(b.job.finishedAt).toBe(a.job.finishedAt);
    expect(a.job.status).toBe("done");
  });

  it("import.sources lists the read-only catalogue", async () => {
    const list = await hz.caller({ userId: hz.A.ownerId }).import.sources();
    expect(list.map((s) => s.key)).toContain("github");
    expect(list.every((s) => s.readOnly)).toBe(true);
  });
});
