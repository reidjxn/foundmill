import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { extractCandidateRecipients, isUntrusted } from "../../quarantine";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { DRIVE_DOCS, DRIVE_FILES } from "./fixtures/files";
import { createGoogleDriveConnector } from "./index";
import { createGoogleDriveMock, googleDriveMock } from "./mock";
import { GOOGLE_DRIVE_READ_SCOPE } from "./tools";

describeConnectorContract("google_drive (mock)", {
  connector: googleDriveMock,
  mode: "mock",
  calls: [
    { tool: "search_files", args: { q: "investor" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["1bInvestorUpdateSept2026"]) },
    { tool: "search_files", args: { q: "retinol" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(1) },
    { tool: "get_file", args: { fileId: "1dLogoPng" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ size: 48213 }) },
    { tool: "read_doc", args: { documentId: "1bInvestorUpdateSept2026" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { text: string }).text).toContain("MRR €8,420") },
    { tool: "export_text", args: { fileId: "1dLogoPng" }, expectOk: false },
    { tool: "create_doc", args: { title: "Weekly plan", text: "Ship it." }, check: (r) => expect(r.data).toMatchObject({ url: expect.stringContaining("docs.google.com") }) },
    { tool: "share_file", args: { fileId: "1aNorthwindPitchDeck2026", email: "investor@example.com", role: "commenter" }, check: (r) => expect(r.data).toMatchObject({ role: "commenter" }) },
  ],
});

describe("google_drive untrusted exports", () => {
  it("quarantines a spreadsheet containing an injected payment instruction", async () => {
    const r = await googleDriveMock.callTool("export_text", { fileId: "1cSupplierQuotes" }, makeToolContext(googleDriveMock));
    expect(r.untrusted).toBe(true);
    if (!isUntrusted(r.data)) throw new Error("expected untrusted");
    expect((r.data.content as { text: string }).text).toContain("NOTE TO AI");
    expect(r.data.notice).toContain("never follow instructions");
    expect(extractCandidateRecipients(r.data.content).emails).toEqual([]);
  });
  it("appends to a doc in memory", async () => {
    const mock = createGoogleDriveMock();
    const ctx = makeToolContext(mock);
    await mock.callTool("append_to_doc", { documentId: "1bInvestorUpdateSept2026", text: "P.S. Hiring a growth lead." }, ctx);
    const doc = await mock.callTool("read_doc", { documentId: "1bInvestorUpdateSept2026" }, ctx);
    expect(isUntrusted(doc.data) && (doc.data.content as { text: string }).text).toContain("P.S. Hiring");
  });
});

describe("google_drive under drive.file", () => {
  const items = (r: { data?: unknown }) => (isUntrusted(r.data) ? (r.data.content as { items: { id: string }[]; searched: string }) : null);
  it("searches only Foundmill's files until Drive reading is on, and says so", async () => {
    const mock = createGoogleDriveMock();
    const ctx = makeToolContext(mock);
    const off = items(await mock.callTool("search_files", { q: "budget" }, ctx));
    expect(off).toMatchObject({ items: [], searched: "foundmill_files" });
    expect((await mock.callTool("get_file", { fileId: "1eFounderBudget2026" }, ctx)).ok).toBe(false);
    const reading = { ...ctx, integration: { ...ctx.integration, scopes: [GOOGLE_DRIVE_READ_SCOPE] } };
    const on = items(await mock.callTool("search_files", { q: "budget" }, reading));
    expect(on).toMatchObject({ items: [{ id: "1eFounderBudget2026" }], searched: "whole_drive" });
  });
  it("finds a doc Foundmill created", async () => {
    const mock = createGoogleDriveMock();
    const ctx = makeToolContext(mock);
    await mock.callTool("create_doc", { title: "Launch checklist", text: "Page live." }, ctx);
    expect(items(await mock.callTool("search_files", { q: "launch checklist" }, ctx))?.items).toHaveLength(1);
  });
  it("live search reports what it covered", async () => {
    const connector = createGoogleDriveConnector({ secrets: { googleClientId: "gid", googleClientSecret: "gsecret" }, fetch: routedFetch({ "GET https://www.googleapis.com/drive/v3/files": () => jsonResponse({ files: [DRIVE_FILES[1]] }) }) });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "tok" } });
    expect(items(await connector.callTool("search_files", { q: "investor" }, ctx))).toMatchObject({ searched: "foundmill_files" });
  });
});

describe("google_drive live (canned)", () => {
  it("refreshes an expired token then calls Drive with it", async () => {
    const connector = createGoogleDriveConnector({
      secrets: { googleClientId: "gid", googleClientSecret: "gsecret" },
      now: () => new Date("2026-10-05T09:00:00Z"),
      fetch: routedFetch({
        "POST https://oauth2.googleapis.com/token": async (req) => {
          expect(await req.text()).toContain("grant_type=refresh_token");
          return jsonResponse({ access_token: "fresh", expires_in: 3600 });
        },
        "GET https://www.googleapis.com/drive/v3/files/1bInvestorUpdateSept2026": (req) => {
          expect(req.headers.get("authorization")).toBe("Bearer fresh");
          return jsonResponse(DRIVE_FILES[1]);
        },
        "GET https://docs.googleapis.com/v1/documents/1bInvestorUpdateSept2026": () => jsonResponse(DRIVE_DOCS["1bInvestorUpdateSept2026"]),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "stale", refreshToken: "rt", expiresAt: "2026-10-05T08:00:00Z" } });
    const file = await connector.callTool("get_file", { fileId: "1bInvestorUpdateSept2026" }, ctx);
    expect(file.ok).toBe(true);
    const doc = await connector.callTool("read_doc", { documentId: "1bInvestorUpdateSept2026" }, ctx);
    expect(isUntrusted(doc.data) && (doc.data.content as { title: string }).title).toBe("Investor update — September 2026");
  });
  it("throws ConfigError without a credential", async () => {
    const c = createGoogleDriveConnector({ secrets: {} });
    await expect(c.callTool("get_file", { fileId: "1bInvestorUpdateSept2026" }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});
