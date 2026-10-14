import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMPORT_READERS } from "@foundmill/shared";
import { IMPORT_DEADLINE_MS, IMPORT_SOURCE_KEYS, IMPORT_TIMED_OUT, buildScoutingReport, decodeJobId, encodeJobId, importJobKey, importSourceRow, importStatus, queueImportReads, sourceUri, validateConfigs, webUri, type ImportJob } from "../services/import";
import { silentLog } from "../services/log";
import { createTemporalService } from "../services/temporal";
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

  it("without a business the job only checks the values and plans the reads: nothing is claimed as read", async () => {
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
    expect(started.job.sources[0]!.steps.map((s) => s.label)).toEqual(["Check the repository name acme/ledgerly", "Read the file tree of acme/ledgerly through the GitHub App (read only; nothing is pushed)"]);
    expect(decodeJobId(importJobKey(hz.deps.env), started.job.id)).toMatchObject({ u: hz.A.ownerId, b: null });
    expect(decodeJobId(importJobKey(hz.deps.env), started.job.id).s).toHaveLength(3);
    expect(temporal.starts).toHaveLength(0);

    // 3 checks × 5 ms: wait for the schedule to pass, then the report is ready.
    await sleep(60);
    const status = await user.import.status({ jobId: started.job.id });
    expect(status.job.status).toBe("done");
    // Checked, not read: the read is planned for after commit, and no step claims it happened.
    // Linear has no reader: checked, then not read.
    expect(status.job.sources.map((s) => s.status)).toEqual(["planned", "planned", "failed"]);
    expect(status.job.sources.flatMap((s) => s.steps.map((st) => st.status))).toEqual(["done", "planned", "done", "planned", "done", "failed"]);
    expect(status.job.sources.every((s) => s.summary && /^Not read/.test(s.summary))).toBe(true);
    expect(status.report).not.toBeNull();
    const report = status.report!;
    expect(report.suggestedName).toBe("Ledgerly");
    expect(report.archetypeHint).toBe("b2b_saas");
    expect(report.neverPushed).toBe(true);
    expect(report.provenance).toBe("Estimate");
    expect(report.sources.map((s) => [s.key, s.state])).toEqual([["github", "planned"], ["stripe", "planned"], ["linear", "not_read"]]);
    // No invented counts, issues or findings for sources nothing has read.
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/\d+ (files|customers|open issues|accounts|pages|documents|orders)/);
    expect(text).not.toMatch(/Real revenue history|Cash position is known|A backlog exists|is on record|README|deployment pipeline/);
    expect(report.roadmapSeeds).toEqual([]);
    expect(report.whatExists).toHaveLength(2);
    expect(report.whatExists[0]).toMatch(/^GitHub \(acme\/ledgerly\): Not read yet/);
    // Strengths of sources still to be read are worded "once …"; Linear has no reader and is listed as missing.
    expect(report.strengths.length).toBeGreaterThan(0);
    expect(report.strengths.every((s) => s.startsWith("Once "))).toBe(true);
    expect(report.whatIsMissing[0]).toBe("Linear: Not read: the import has no reader for Linear yet.");
    expect(report.summary).toMatch(/nothing has been read yet/);
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

  it("every import source key has a reader entry, and only real reads count", () => {
    expect(Object.keys(IMPORT_READERS).sort()).toEqual([...IMPORT_SOURCE_KEYS].sort());
  });

  it("the report derives strengths only from sources that were read, and lists failed ones as missing (temporal job)", () => {
    const configs = [
      { key: "github" as const, value: "acme/ledgerly" },
      { key: "shopify" as const, value: "" },
      { key: "bank" as const, value: "" },
      { key: "registry" as const, value: "12345678" },
    ];
    const source = (key: (typeof configs)[number]["key"], value: string, status: "done" | "failed", summary: string) => ({ key, value, sourceId: null, status, steps: [], summary });
    const job: ImportJob = {
      id: "job",
      mode: "temporal",
      businessId: "b",
      workflowId: "import:b:1",
      status: "done",
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      stepMs: 1,
      sources: [
        source("github", "acme/ledgerly", "done", "Read through github (read_tree), read only."),
        source("shopify", "", "failed", "Not read: no connector for this uri."),
        source("bank", "", "failed", "Not read: gateway deny."),
        source("registry", "12345678", "done", "Read through opencorporates (search_companies), read only."),
      ],
    };
    const report = buildScoutingReport(configs, job);
    expect(report.sources.map((s) => s.state)).toEqual(["read", "not_read", "not_read", "read"]);
    expect(report.whatExists).toEqual(["GitHub (acme/ledgerly): Read through github (read_tree), read only.", "Company registry (12345678): Read through opencorporates (search_companies), read only."]);
    expect(report.whatIsMissing).toEqual(expect.arrayContaining(["Shopify: Not read: no connector for this uri.", "Bank (open banking): Not read: gateway deny.", "No revenue source: Finance starts with a management P&L and labeled estimates."]));
    // No revenue or cash claim from the failed Shopify and bank; the archetype ignores the failed Shopify.
    expect(report.strengths.join(" ")).not.toMatch(/revenue|runway|cash/i);
    expect(report.strengths).toEqual(expect.arrayContaining([expect.stringMatching(/^GitHub was read through the gateway/), expect.stringMatching(/^The company registry answered/)]));
    expect(report.archetypeHint).toBe("b2b_saas");
    expect(report.firstDecisions.find((d) => d.id === "finance")?.label).toBe("Connect a revenue or bank source later");
    expect(report.summary).toMatch(/2 sources of 4 read, 2 not read/);
  });

  it("a source that was read is credited with what its one read returned, never with history it did not import", () => {
    const configs = [
      { key: "stripe" as const, value: "" },
      { key: "bank" as const, value: "" },
      { key: "registry" as const, value: "12345678" },
      { key: "notion" as const, value: "" },
    ];
    const read = (key: (typeof configs)[number]["key"], value: string) => ({ key, value, sourceId: null, status: "done" as const, steps: [], summary: "Read through the gateway, read only." });
    const job: ImportJob = { id: "job", mode: "temporal", businessId: "b", workflowId: "import:b:2", status: "done", startedAt: new Date(0).toISOString(), finishedAt: new Date(0).toISOString(), stepMs: 1, sources: configs.map((c) => read(c.key, c.value)) };
    const strengths = buildScoutingReport(configs, job).strengths.join(" ");
    // Stripe's account and the bank's account list answered; neither read brings in revenue or transactions.
    expect(strengths).not.toMatch(/forecasts can start from real revenue|measured instead of estimated|is on record|filings can be put on record|open issues/);
    expect(strengths).toMatch(/Stripe is connected read only and its account answered\. Its revenue history was not imported/);
    expect(strengths).toMatch(/Transactions were not imported, so cash and runway stay estimates/);
    expect(strengths).toMatch(/the entity goes on record once Legal confirms the match with you/);
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
    // Stored as not read yet, with no summary until the orchestrator reads them.
    expect(rows.items.every((r) => (r.relevance as { import?: { status?: string }; summary?: string }).import?.status === "pending" && !(r.relevance as { summary?: string }).summary)).toBe(true);

    // A member of another business cannot read the job.
    await expect(hz.caller({ userId: hz.B.ownerId }).import.status({ jobId: started.job.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The orchestrator's importSource activity finishes the sources: the website's read failed, the registry is read.
    const [siteId, registryId] = args.sourceIds as [string, string];
    const site = await repos.product.getSource(hz.db, businessId, siteId);
    await repos.product.updateSource(hz.db, businessId, siteId, { fetchedAt: new Date(), relevance: { ...(site.relevance as Record<string, unknown>), imported: false, reason: "the read failed: not connected" } });
    const registry = await repos.product.getSource(hz.db, businessId, registryId);
    await repos.product.updateSource(hz.db, businessId, registryId, { fetchedAt: new Date(), relevance: { ...(registry.relevance as Record<string, unknown>), imported: true, connector: "opencorporates", tool: "search_companies" } });
    const done = await owner.import.status({ jobId: started.job.id });
    expect(done.job.status).toBe("done");
    expect(done.job.sources.map((s) => s.status)).toEqual(["failed", "done"]);
    expect(done.report?.suggestedName).toBe("Ledgerlyhq");
    expect(done.report?.whatExists).toEqual(["Company registry (12345678): Read through opencorporates (search_companies), read only."]);
    expect(done.report?.whatIsMissing[0]).toBe("Website (https://ledgerlyhq.com): Not read: the read failed: not connected.");
    const audit = await repos.audit.list(hz.db, businessId, { action: "import.start" });
    expect(audit.items).toHaveLength(1);
  });

  it("Door B commit stores the sources as not read and starts importBusiness to read them", async () => {
    const userId = await hz.h.createUser("door-b-commit@test.local");
    const caller = hz.caller({ userId, email: "door-b-commit@test.local" });
    await caller.founder.profile.update({ displayName: "Reid", experience: "first-time", targetMarkets: ["Nordics"], riskAppetite: "medium", budgetMinor: 2_500_000 });
    const started = await caller.import.start({ sources: [{ key: "github", value: "acme/ledgerly" }, { key: "bank", value: "" }], stepMs: 1 });
    await sleep(20);
    const generated = await caller.idea.generate({ prompt: "Ledgerly", archetypeHint: "b2b_saas", single: true, importJobId: started.job.id });
    const result = await caller.idea.commit({ ideaId: generated.ideas[0]!.id, name: "Ledgerly Door B", archetype: "b2b_saas", gameMode: "personal" });
    const bid = result.business.id;
    expect(result.foundations.importSourceIds).toHaveLength(2);
    const start = temporal.starts.find((s) => s.type === "importBusiness" && s.workflowId.startsWith(`import:${bid}:`));
    expect(start?.args[0]).toEqual({ businessId: bid, sourceIds: result.foundations.importSourceIds });
    expect(result.import).toMatchObject({ queued: true, workflowId: start!.workflowId });
    const rows = (await repos.product.listSources(hz.db, bid)).items;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const relevance = row.relevance as { import?: { status?: string; summary?: unknown }; summary?: unknown };
      expect(relevance.import?.status).toBe("pending");
      expect(relevance.summary).toBeUndefined();
      expect(row.fetchedAt).toBeNull();
    }
    // The report snapshotted at commit claims nothing as read.
    const foundations = await repos.foundations.get(hz.db, bid);
    expect((foundations!.importReport as { roadmapSeeds: unknown[] }).roadmapSeeds).toEqual([]);
  });

  it("without a worker, a business's import sources are marked not read instead of running forever", async () => {
    const { businessId } = hz.B;
    const offline = createTemporalService({ address: "127.0.0.1:1", namespace: "default", taskQueue: "test", log: silentLog(), disabled: true });
    const rows = [await repos.product.createSource(hz.db, businessId, importSourceRow("stripe", "")), await repos.product.createSource(hz.db, businessId, importSourceRow("github", "acme/ledgerly"))];
    const workflow = await queueImportReads({ db: hz.db, temporal: offline }, businessId, rows.map((r) => r.id));
    expect(workflow.queued).toBe(false);
    for (const row of rows) {
      const after = await repos.product.getSource(hz.db, businessId, row.id);
      const relevance = after.relevance as { imported?: boolean; reason?: string; import?: { status?: string } };
      expect(relevance.imported).toBe(false);
      expect(relevance.import?.status).toBe("failed");
      expect(relevance.reason).toMatch(/import worker was not reachable/);
    }
  });

  it("import.readAgain reads the sources that were not read once connected; read sources, other sources and other roles are refused", async () => {
    const { businessId } = hz.A;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const offline = createTemporalService({ address: "127.0.0.1:1", namespace: "default", taskQueue: "test", log: silentLog(), disabled: true });
    const [stripe, repo] = [await repos.product.createSource(hz.db, businessId, importSourceRow("stripe", "")), await repos.product.createSource(hz.db, businessId, importSourceRow("github", "acme/ledgerly"))];
    await queueImportReads({ db: hz.db, temporal: offline }, businessId, [stripe.id, repo.id]);
    // The orchestrator read the repository on a later attempt; Stripe is still not read.
    await repos.product.updateSource(hz.db, businessId, repo.id, { fetchedAt: new Date(), relevance: { ...((await repos.product.getSource(hz.db, businessId, repo.id)).relevance as Record<string, unknown>), imported: true, import: { key: "github", status: "read" } } });
    const manual = await repos.product.createSource(hz.db, businessId, { kind: "doc", uri: "https://example.com/notes", title: "Notes", relevance: { summary: "A note" } });

    await expect(hz.caller({ userId: hz.A.memberId }).import.readAgain({ businessId, sourceIds: [stripe.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.import.readAgain({ businessId, sourceIds: [repo.id] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.import.readAgain({ businessId, sourceIds: [manual.id] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const other = await repos.product.createSource(hz.db, hz.B.businessId, importSourceRow("stripe", ""));
    await expect(owner.import.readAgain({ businessId, sourceIds: [other.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const before = temporal.starts.length;
    const result = await owner.import.readAgain({ businessId, sourceIds: [stripe.id] });
    expect(result).toMatchObject({ sourceIds: [stripe.id], workflow: { queued: true } });
    const start = temporal.starts.slice(before).find((s) => s.type === "importBusiness");
    expect(start?.args[0]).toEqual({ businessId, sourceIds: [stripe.id] });
    const relevance = (await repos.product.getSource(hz.db, businessId, stripe.id)).relevance as { imported?: boolean; reason?: string; import?: { status?: string; note?: string } };
    expect(relevance.import?.status).toBe("pending");
    expect(relevance.import?.note).toBeUndefined();
    expect(relevance.imported).toBeUndefined();
    expect(relevance.reason).toBeUndefined();
    const audit = await repos.audit.list(hz.db, businessId, { action: "import.read_again" });
    expect(audit.items[0]).toMatchObject({ actorId: hz.A.ownerId, details: { sourceIds: [stripe.id], queued: true } });
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
      { key: "github", value: "acme/ledgerly", connector: "github", readOnly: true, status: "pending" },
      { key: "registry", value: "12345678", connector: "opencorporates", readOnly: true, status: "pending" },
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
    expect(running.job.sources.map((s) => [s.status, s.summary])).toEqual([["failed", "Not read: stripe.get_account failed: not connected."], ["done", "Read through shopify, read only."], ["running", null]]);
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
