/**
 * The collab server on an ephemeral port over PGlite: AC-11.5.1 (concurrent human + agent edits never lose either
 * side), authentication + membership, read-only roles, pinned blocks, persistence through repos (version bump,
 * authored_by), the HTTP agent-edit surface and /health.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createCollabAuthenticator, mintCollabServiceToken } from "../auth";
import { createCollabClient } from "../client";
import { specDocumentName } from "../document-name";
import { docToPmDoc, pmEqual, type PmNode } from "../prosemirror";
import { createCollabServer, type CollabServer } from "../server";
import { blockTexts, RawHocuspocusClient, until } from "./protocol-client";

const JWT_SECRET = "collab-test-jwt-secret";
const SERVICE_SECRET = "collab-test-session-secret";

let h: TestHarness;
let db: Db;
let A: BusinessFixture;
let B: BusinessFixture;
let server: CollabServer;
let wsUrl: string;
let httpUrl: string;

const userToken = (userId: string) =>
  new SignJWT({ sub: userId, email: `${userId.slice(0, 8)}@test.local` }).setProtectedHeader({ alg: "HS256" }).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(JWT_SECRET));
const agentToken = (businessId: string, agentId: string) => mintCollabServiceToken({ secret: SERVICE_SECRET, businessId, agentId, service: "orchestrator" });

const paragraph = (text: string): PmNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const initialDoc: PmNode = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Problem" }] }, paragraph("Founders lose context between tools.")] };

/** Appends a paragraph to a client's doc (what a Tiptap editor does when the user types a new block). */
function appendParagraph(doc: Y.Doc, text: string, at?: number) {
  doc.transact(() => {
    const fragment = doc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, text);
    p.insert(0, [t]);
    fragment.insert(at ?? fragment.length, [p]);
  });
}

/** Types into the first text run of the block at `index`. */
function typeInto(doc: Y.Doc, index: number, offset: number, text: string) {
  doc.transact(() => {
    const block = doc.getXmlFragment("default").get(index) as Y.XmlElement;
    const run = block.get(0) as Y.XmlText;
    run.insert(offset, text);
  });
}

async function newBlock(businessId: string, content: PmNode = initialDoc, pinned = false) {
  const block = await repos.product.createBlock(db, businessId, { section: "problem", content: content as unknown as Record<string, unknown>, pinned });
  return block;
}

async function connect(token: string, documentName: string, doc?: Y.Doc) {
  const client = new RawHocuspocusClient(wsUrl, documentName, token, { doc });
  const outcome = await client.connect();
  return { client, outcome };
}

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  [A, B] = await Promise.all([createBusinessFixture(h, "collab-a"), createBusinessFixture(h, "collab-b")]);
  const auth = createCollabAuthenticator({ appEnv: "test", jwtSecret: JWT_SECRET, serviceSecret: SERVICE_SECRET });
  server = createCollabServer({ db, auth }, { debounceMs: 60, maxDebounceMs: 300 });
  const bound = await server.listen(0);
  wsUrl = `ws://127.0.0.1:${bound.port}`;
  httpUrl = `http://127.0.0.1:${bound.port}`;
}, 120_000);

afterAll(async () => {
  await server?.close();
  await h?.close();
});

describe("AC-11.5.1 concurrent human + agent edits", () => {
  it("both sides' edits survive when a human and an agent write to the same block at the same time, and the merge is persisted", async () => {
    const block = await newBlock(A.businessId);
    const name = specDocumentName(A.businessId, block.id);
    const human = await connect(await userToken(A.ownerId), name);
    const agent = await connect(await agentToken(A.businessId, A.agentId), name);
    expect(human.outcome).toBe("authenticated");
    expect(agent.outcome).toBe("authenticated");
    expect(human.client.scope).toBe("read-write");
    expect(agent.client.scope).toBe("read-write");
    await Promise.all([human.client.waitForSync(), agent.client.waitForSync()]);
    expect(docToPmDoc(human.client.doc)).toEqual(initialDoc); // loaded from spec_blocks.content
    expect(docToPmDoc(agent.client.doc)).toEqual(initialDoc);

    // Concurrent: no round trip between the two edits; both type into the same paragraph and both add blocks.
    typeInto(human.client.doc, 1, 0, "HUMAN: ");
    typeInto(agent.client.doc, 1, "Founders".length, " (agent)");
    appendParagraph(agent.client.doc, "AGENT: acceptance criteria follow.", 1);
    appendParagraph(human.client.doc, "HUMAN: closing thought.");

    const converged = () => JSON.stringify(docToPmDoc(human.client.doc)) === JSON.stringify(docToPmDoc(agent.client.doc)) && blockTexts(human.client.doc).length === 4;
    await human.client.waitUntil(converged, 8000, "both clients to converge");
    const merged = docToPmDoc(human.client.doc);
    const texts = blockTexts(human.client.doc);
    expect(texts[0]).toBe("Problem");
    expect(texts).toContain("AGENT: acceptance criteria follow.");
    expect(texts).toContain("HUMAN: closing thought.");
    const shared = texts.find((t) => t.startsWith("HUMAN: Founders"));
    expect(shared).toBe("HUMAN: Founders (agent) lose context between tools."); // both insertions, neither lost

    // Debounced persistence through repos.product.editBlock: version bumped, content = the merged document.
    // (jsonb reorders object keys, so compare structurally.)
    await until(async () => pmEqual((await repos.product.getBlock(db, A.businessId, block.id)).content, merged), 8000, "persisted merge");
    const stored = await repos.product.getBlock(db, A.businessId, block.id);
    expect(stored.version).toBeGreaterThan(block.version);
    expect(["user", "agent"]).toContain(stored.authoredByKind);
    expect([A.ownerId, A.agentId]).toContain(stored.authoredBy);

    await human.client.close();
    await agent.client.close();
  });

  it("edits made offline by a human while an agent edited the live document are merged on reconnect", async () => {
    const block = await newBlock(A.businessId);
    const name = specDocumentName(A.businessId, block.id);
    const first = await connect(await userToken(A.memberId), name);
    await first.client.waitForSync();
    const offlineDoc = first.client.doc;
    await first.client.close();
    // Laptop closed: the human keeps typing into the local Y.Doc.
    appendParagraph(offlineDoc, "OFFLINE: typed on the train.");
    typeInto(offlineDoc, 0, 7, " statement");

    // Meanwhile the agent changes the block through the server.
    const agent = await connect(await agentToken(A.businessId, A.agentId), name);
    await agent.client.waitForSync();
    appendParagraph(agent.client.doc, "AGENT: added while the human was away.");
    await until(async () => JSON.stringify((await repos.product.getBlock(db, A.businessId, block.id)).content).includes("AGENT: added"), 8000, "agent edit persisted");

    // The human reconnects with the same Y.Doc: both sides' changes are present on both ends.
    const back = await connect(await userToken(A.memberId), name, offlineDoc);
    expect(back.outcome).toBe("authenticated");
    await back.client.waitForSync();
    const has = (doc: Y.Doc, s: string) => JSON.stringify(docToPmDoc(doc)).includes(s);
    await back.client.waitUntil(() => has(back.client.doc, "AGENT: added") && has(agent.client.doc, "OFFLINE: typed") && has(agent.client.doc, "Problem statement"), 8000, "reconnect merge");
    expect(docToPmDoc(back.client.doc)).toEqual(docToPmDoc(agent.client.doc));
    await until(async () => {
      const c = JSON.stringify((await repos.product.getBlock(db, A.businessId, block.id)).content);
      return c.includes("OFFLINE: typed") && c.includes("AGENT: added") && c.includes("Problem statement");
    }, 8000, "merged persistence");
    await back.client.close();
    await agent.client.close();
  });

  it("does not bump the version when nothing changed, and records the last writer", async () => {
    const block = await newBlock(A.businessId);
    const name = specDocumentName(A.businessId, block.id);
    const reader = await connect(await userToken(A.ownerId), name);
    await reader.client.waitForSync();
    await new Promise((r) => setTimeout(r, 400));
    expect((await repos.product.getBlock(db, A.businessId, block.id)).version).toBe(block.version);
    const agent = await connect(await agentToken(A.businessId, A.agentId), name);
    await agent.client.waitForSync();
    appendParagraph(agent.client.doc, "AGENT wrote last.");
    await until(async () => (await repos.product.getBlock(db, A.businessId, block.id)).version > block.version, 8000, "agent store");
    const stored = await repos.product.getBlock(db, A.businessId, block.id);
    expect(stored.authoredByKind).toBe("agent");
    expect(stored.authoredBy).toBe(A.agentId);
    await reader.client.close();
    await agent.client.close();
  });
});

describe("authentication and authorisation", () => {
  it("denies a bad token, a non-member, a service token for another business, an unknown block and a malformed name", async () => {
    const block = await newBlock(A.businessId);
    const name = specDocumentName(A.businessId, block.id);
    const cases: Array<[string, string, string]> = [
      ["bad token", "not-a-jwt", name],
      ["member of another business", await userToken(B.ownerId), name],
      ["service token bound to business B", await agentToken(B.businessId, B.agentId), name],
      ["agent that does not exist in the business", await agentToken(A.businessId, B.agentId), name],
      ["block of business B through membership of A", await userToken(A.ownerId), specDocumentName(A.businessId, B.specBlockId)],
      ["malformed document name", await userToken(A.ownerId), "spec:nope"],
    ];
    for (const [label, token, docName] of cases) {
      const { client, outcome } = await connect(token, docName);
      expect(outcome, label).toBe("denied");
      expect(client.deniedReason, label).toBeTruthy();
      await client.close();
    }
    expect(server.hocuspocus.documents.has(name)).toBe(false);
  });

  it("viewers and advisors are read-only: their updates are rejected and never reach the document", async () => {
    const block = await newBlock(A.businessId);
    const name = specDocumentName(A.businessId, block.id);
    const viewer = await connect(await userToken(A.viewerId), name);
    expect(viewer.outcome).toBe("authenticated");
    expect(viewer.client.scope).toBe("readonly");
    await viewer.client.waitForSync();
    appendParagraph(viewer.client.doc, "VIEWER tried to write.");
    await viewer.client.waitUntil(() => viewer.client.syncStatuses.includes(false), 5000, "rejection ack");
    const live = server.hocuspocus.documents.get(name)!;
    expect(JSON.stringify(docToPmDoc(live))).not.toContain("VIEWER");
    await viewer.client.close();
    await until(async () => (await repos.product.getBlock(db, A.businessId, block.id)).version === block.version, 1000, "no version bump");
  });

  it("agents are read-only on pinned blocks while humans still write (AC-11.5.3 spirit)", async () => {
    const block = await newBlock(A.businessId, initialDoc, true);
    const name = specDocumentName(A.businessId, block.id);
    const agent = await connect(await agentToken(A.businessId, A.agentId), name);
    expect(agent.outcome).toBe("authenticated");
    expect(agent.client.scope).toBe("readonly");
    const human = await connect(await userToken(A.adminId), name);
    expect(human.client.scope).toBe("read-write");
    await Promise.all([agent.client.waitForSync(), human.client.waitForSync()]);
    appendParagraph(agent.client.doc, "AGENT must not land.");
    appendParagraph(human.client.doc, "HUMAN edit on a pinned block.");
    await human.client.waitUntil(() => JSON.stringify(docToPmDoc(agent.client.doc)).includes("HUMAN edit"), 5000, "human edit broadcast");
    const live = server.hocuspocus.documents.get(name)!;
    expect(JSON.stringify(docToPmDoc(live))).not.toContain("AGENT must not land");
    await agent.client.close();
    await human.client.close();
  });
});

describe("HTTP surface", () => {
  it("GET /health reports the service and anything else is a JSON 404", async () => {
    const res = await fetch(`${httpUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, app: "Foundmill", service: "collab" });
    expect(typeof body.documents).toBe("number");
    const missing = await fetch(`${httpUrl}/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
  });

  it("an agent edits a block through POST /v1/spec-blocks with a service token: read → edit with expectedRevision, 409 when a human changed it meanwhile, then re-apply on the fresh content", async () => {
    const block = await newBlock(A.businessId);
    const name = specDocumentName(A.businessId, block.id);
    const client = createCollabClient({ baseUrl: httpUrl, serviceSecret: SERVICE_SECRET });

    // The agent reads the stored block (nobody has it open yet).
    const first = await client.read({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id });
    expect(first).toMatchObject({ live: false, version: block.version, content: initialDoc });

    // A human opens the block and types into the paragraph the agent is about to rewrite.
    const human = await connect(await userToken(A.ownerId), name);
    await human.client.waitForSync();
    typeInto(human.client.doc, 1, 0, "HUMAN: ");
    await human.client.waitUntil(() => human.client.syncStatuses.some(Boolean), 5000, "human edit acked");

    // The agent's edit against the stale revision is refused and nothing is written.
    const stale: PmNode = { type: "doc", content: [initialDoc.content![0]!, paragraph("AGENT rewrote the paragraph."), paragraph("AGENT: a second paragraph.")] };
    await expect(client.edit({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id, content: stale, expectedRevision: first.revision })).rejects.toMatchObject({ status: 409, code: "stale_revision" });
    expect(JSON.stringify(docToPmDoc(human.client.doc))).not.toContain("AGENT");

    // It reads again (now the live document, with the human's text), re-applies its change and succeeds.
    const fresh = await client.read({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id });
    expect(fresh.live).toBe(true);
    expect(fresh.revision).not.toBe(first.revision);
    expect(JSON.stringify(fresh.content)).toContain("HUMAN: Founders lose context between tools.");
    const next: PmNode = { type: "doc", content: [...fresh.content.content!, paragraph("AGENT: a second paragraph."), paragraph("AGENT: a third.")] };
    const result = await client.edit({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id, content: next, expectedRevision: fresh.revision });
    expect(result).toMatchObject({ changed: 2, kept: 2 });
    const merged = JSON.stringify(result.content);
    expect(merged).toContain("AGENT: a second paragraph.");
    expect(merged).toContain("HUMAN: Founders lose context between tools.");
    expect(result.version).toBeGreaterThan(block.version);

    // Persisted immediately with the agent as author, and broadcast to the human's editor.
    const stored = await repos.product.getBlock(db, A.businessId, block.id);
    expect(stored.authoredByKind).toBe("agent");
    expect(stored.authoredBy).toBe(A.agentId);
    expect(JSON.stringify(stored.content)).toContain("AGENT: a third.");
    await human.client.waitUntil(() => JSON.stringify(docToPmDoc(human.client.doc)).includes("AGENT: a third."), 5000, "broadcast to human");

    const after = await client.read({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id });
    expect(after.live).toBe(true);
    expect(after.content).toEqual(docToPmDoc(human.client.doc));
    expect(after.revision).toBe(result.revision);

    // Without expectedRevision the edit is applied as a character-level merge onto whatever is there now.
    const unguarded = await client.edit({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id, content: { ...after.content, content: [...after.content.content!.slice(0, 3), paragraph("AGENT: a third, revised.")] } });
    expect(unguarded).toMatchObject({ changed: 1, kept: 3 });
    await human.client.close();
  });

  it("rejects agent edits on pinned blocks (409), bad tokens (401), other businesses (403/404) and invalid content (400)", async () => {
    const pinned = await newBlock(A.businessId, initialDoc, true);
    const client = createCollabClient({ baseUrl: httpUrl, serviceSecret: SERVICE_SECRET });
    await expect(client.edit({ businessId: A.businessId, agentId: A.agentId, specBlockId: pinned.id, content: initialDoc })).rejects.toMatchObject({ status: 409, code: "spec_block_pinned" });
    expect((await repos.product.getBlock(db, A.businessId, pinned.id)).version).toBe(pinned.version);

    const block = await newBlock(A.businessId);
    const unauth = await fetch(`${httpUrl}/v1/spec-blocks/${A.businessId}/${block.id}`, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" }, body: JSON.stringify({ content: initialDoc }) });
    expect(unauth.status).toBe(401);
    const wrongSecret = createCollabClient({ baseUrl: httpUrl, serviceSecret: "another-secret" });
    await expect(wrongSecret.read({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id })).rejects.toMatchObject({ status: 401 });
    const otherBusiness = await client.edit({ businessId: B.businessId, agentId: B.agentId, specBlockId: block.id, content: initialDoc }).catch((e: { status: number }) => e);
    expect([403, 404]).toContain((otherBusiness as { status: number }).status);
    await expect(client.edit({ businessId: A.businessId, agentId: A.agentId, specBlockId: block.id, content: { type: "paragraph" } as PmNode })).rejects.toMatchObject({ status: 400, code: "invalid_content" });
    const notJson = await fetch(`${httpUrl}/v1/spec-blocks/${A.businessId}/${block.id}`, { method: "POST", headers: { authorization: `Bearer ${await agentToken(A.businessId, A.agentId)}`, "content-type": "application/json" }, body: "{" });
    expect(notJson.status).toBe(400);
    const viewerRead = await fetch(`${httpUrl}/v1/spec-blocks/${A.businessId}/${block.id}`, { headers: { authorization: `Bearer ${await userToken(A.viewerId)}` } });
    expect(viewerRead.status).toBe(200);
    expect((await viewerRead.json()).live).toBe(false);
    const viewerWrite = await fetch(`${httpUrl}/v1/spec-blocks/${A.businessId}/${block.id}`, { method: "POST", headers: { authorization: `Bearer ${await userToken(A.viewerId)}`, "content-type": "application/json" }, body: JSON.stringify({ content: initialDoc }) });
    expect(viewerWrite.status).toBe(403);
  });
});

describe("lifecycle", () => {
  it("listens on an ephemeral port on the first available host and reports it", () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toMatch(/^ws:\/\//);
    expect(server.health()).toMatchObject({ ok: true, db: true });
  });

  it("reports ok:false with db:false when the database did not answer at boot", () => {
    const degraded = createCollabServer({ db, auth: createCollabAuthenticator({ appEnv: "test", jwtSecret: JWT_SECRET, serviceSecret: SERVICE_SECRET }), dbReady: () => false });
    expect(degraded.health()).toMatchObject({ ok: false, db: false, service: "collab" });
  });
});
