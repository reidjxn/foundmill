import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_AUDIENCE, TOKEN_ISSUER, createGatewayClient, createOfflineGatewayClient, signServiceToken } from "../gateway-client";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

describe("gateway client", () => {
  it("signs an HS256 service JWT with the gateway's issuer and service audience", () => {
    const now = () => new Date("2026-10-05T08:00:00.000Z");
    const token = signServiceToken("s3cret-s3cret-s3cret", "orchestrator", 60, now);
    const [h, p, sig] = token.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "HS256", typ: "JWT" });
    const payload = decode(p);
    expect(payload).toMatchObject({ svc: "orchestrator", iss: TOKEN_ISSUER, aud: SERVICE_AUDIENCE, iat: 1_791_187_200, exp: 1_791_187_260 });
    expect(typeof payload.jti).toBe("string");
    expect(sig).toBe(createHmac("sha256", "s3cret-s3cret-s3cret").update(`${h}.${p}`).digest("base64url"));
    expect(() => signServiceToken("", "orchestrator")).toThrow(/SESSION_TOKEN_SECRET/);
  });

  it("mints session tokens through POST /v1/session-tokens with a Bearer service token and builds MCP urls", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ token: "sess", expiresAt: "2026-10-05T12:00:00.000Z", jti: "j" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createGatewayClient({ baseUrl: "http://gateway.test/", serviceSecret: "x".repeat(32), fetch: fetchStub });
    const minted = await client.mintSessionToken({ businessId: "b", agentId: "a", sessionId: "s", allowedTools: ["gmail:*"] });
    expect(minted.token).toBe("sess");
    expect(calls[0]!.url).toBe("http://gateway.test/v1/session-tokens");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer eyJ/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ businessId: "b", agentId: "a", sessionId: "s", allowedTools: ["gmail:*"] });
    expect(client.mcpUrl("gmail")).toBe("http://gateway.test/mcp/gmail");
    expect(client.sessionHeaders("sess")).toEqual({ authorization: "Bearer sess" });
  });

  it("returns policy outcomes on 403/429 instead of throwing, and throws on transport errors", async () => {
    const client = createGatewayClient({ baseUrl: "http://gateway.test", serviceSecret: "x".repeat(32), fetch: async () => new Response(JSON.stringify({ outcome: "deny", reasons: ["hard gate"] }), { status: 403 }) });
    expect((await client.call("t", { connector: "stripe", tool: "create_payout", args: {} })).outcome).toBe("deny");
    const down = createGatewayClient({ baseUrl: "http://gateway.test", serviceSecret: "x".repeat(32), fetch: async () => { throw new Error("ECONNREFUSED"); } });
    await expect(down.health()).rejects.toMatchObject({ code: "gateway_unreachable" });
  });

  it("offline client records mints and answers allow", async () => {
    const offline = createOfflineGatewayClient();
    const minted = await offline.mintSessionToken({ businessId: "b", agentId: "a", sessionId: "s", allowedTools: [] });
    expect(minted.token).toMatch(/^offline\./);
    expect((await offline.call(minted.token, { connector: "gmail", tool: "send_message", args: {} })).outcome).toBe("allow");
    expect(offline.minted).toHaveLength(1);
    expect(offline.calls).toHaveLength(1);
  });

  it("downloads an archive as bytes from POST /v1/github/archive, reads JSON outcomes, and refuses one over its cap", async () => {
    const tarball = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    const seen: { url: string; auth: string | null; body: string }[] = [];
    const client = createGatewayClient({
      baseUrl: "http://gateway.test",
      serviceSecret: "x".repeat(32),
      fetch: async (url, init) => {
        const body = String(init?.body ?? "");
        seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
        const ref = (JSON.parse(body) as { ref: string }).ref;
        if (ref === "missing") return new Response(JSON.stringify({ outcome: "allow", result: { ok: false, error: { code: "not_found", message: "ref missing not found" } } }), { status: 200, headers: { "content-type": "application/json" } });
        if (ref === "denied") return new Response(JSON.stringify({ outcome: "deny", reasons: ["paused"] }), { status: 403, headers: { "content-type": "application/json" } });
        return new Response(tarball, { status: 200, headers: { "content-type": "application/gzip", "x-foundmill-archive-ref": encodeURIComponent("agent/t1"), "x-foundmill-archive-sha": "a".repeat(40) } });
      },
    });
    const ok = await client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "agent/t1" });
    expect(ok).toEqual({ outcome: "allow", archive: { ref: "agent/t1", sha: "a".repeat(40), data: tarball } });
    expect(seen[0]).toEqual({ url: "http://gateway.test/v1/github/archive", auth: "Bearer sess", body: JSON.stringify({ owner: "acme", repo: "shop", ref: "agent/t1" }) });
    expect(await client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "missing" })).toEqual({ outcome: "allow", error: { code: "not_found", message: "ref missing not found" } });
    expect(await client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "denied" })).toEqual({ outcome: "deny", reasons: ["paused"] });
    await expect(client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "main" }, { maxBytes: 4 })).rejects.toMatchObject({ code: "archive_too_large" });
  });

  it("streams an archive into a new 0600 file when asked, chunk by chunk, and removes it past the cap", async () => {
    const chunks = [new Uint8Array([31, 139, 8, 0]), new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6])];
    const body = () => new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } });
    const client = createGatewayClient({ baseUrl: "http://gateway.test", serviceSecret: "x".repeat(32), fetch: async () => new Response(body(), { status: 200, headers: { "content-type": "application/gzip", "x-foundmill-archive-ref": "main", "x-foundmill-archive-sha": "b".repeat(40) } }) });
    const dir = await mkdtemp(path.join(os.tmpdir(), "fm-gw-archive-"));
    try {
      const file = path.join(dir, "archive.tgz");
      const r = await client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "HEAD" }, { file });
      expect(r).toEqual({ outcome: "allow", archive: { ref: "main", sha: "b".repeat(40), file, bytes: 10 } });
      expect(new Uint8Array(await readFile(file))).toEqual(new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4, 5, 6]));
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      // Never over a file (or a link) already there.
      await expect(client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "HEAD" }, { file })).rejects.toMatchObject({ code: "EEXIST" });
      await rm(file);
      await symlink(path.join(dir, "elsewhere"), file);
      await expect(client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "HEAD" }, { file })).rejects.toThrow();
      await expect(stat(path.join(dir, "elsewhere"))).rejects.toThrow();
      await rm(file);
      // Over the cap while streaming: refused and the partial file is gone.
      await expect(client.downloadArchive("sess", { owner: "acme", repo: "shop", ref: "HEAD" }, { file, maxBytes: 6 })).rejects.toMatchObject({ code: "archive_too_large" });
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("offline client serves archives from the GitHub mock", async () => {
    const offline = createOfflineGatewayClient();
    const minted = await offline.mintSessionToken({ businessId: "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60", agentId: "a", sessionId: "s", allowedTools: ["github:download_archive"] });
    const r = await offline.downloadArchive(minted.token, { owner: "acme", repo: "shop", ref: "HEAD" });
    expect(r.outcome === "allow" && "archive" in r && r.archive.ref).toBe("main");
    expect((await offline.downloadArchive(minted.token, { owner: "acme", repo: "shop", ref: "agent/none" })).outcome === "allow").toBe(true);
    expect(offline.archives).toHaveLength(2);
  });
});
