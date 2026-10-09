import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildScoutingReport, decodeJobId, importJobKey, sourceUri, validateConfigs, webUri } from "../services/import";
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

  it("import.sources lists the read-only catalogue", async () => {
    const list = await hz.caller({ userId: hz.A.ownerId }).import.sources();
    expect(list.map((s) => s.key)).toContain("github");
    expect(list.every((s) => s.readOnly)).toBe(true);
  });
});
