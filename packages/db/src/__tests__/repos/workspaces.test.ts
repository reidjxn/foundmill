/** Agent workspaces (0013): saving a code task's files per session, deduplicated contents, diffs and reads, per business. */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { isSafeWorkspacePath } from "../../repos/workspaces";
import { agentSessions, workspaceBlobs } from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("ws");
});
afterAll(() => r?.close());

const text = (s: string) => new TextEncoder().encode(s);
const sha = (s: string) => createHash("sha256").update(text(s)).digest("hex");
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("workspaces", () => {
  it("accepts relative paths only", () => {
    for (const ok of ["package.json", "src/index.ts", ".gitignore", "a/b/c.d.ts"]) expect(isSafeWorkspacePath(ok)).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "a/./b", "a\\b", "a\0b", `${"x".repeat(501)}`, "a\nb.ts", "invoice\u202Efdp.ts", "a\u2066b", "x\u007f"]) expect(isSafeWorkspacePath(bad)).toBe(false);
  });

  it("saves a session's files, skips unchanged sessions, counts what changed and stores each content once", async () => {
    const { businessId, taskId, agentId } = r.A;
    expect(await repos.workspaces.latest(r.db, businessId, taskId)).toBeNull();
    const first = await r.svc((tx) =>
      repos.workspaces.save(tx, businessId, { taskId, agentId, branch: `agent/${taskId}`, files: [{ path: "src/index.ts", content: text("export const a = 1;\n") }, { path: "package.json", content: text("{}") }, { path: "copy.json", content: text("{}") }] }),
    );
    expect(first).toMatchObject({ saved: true, added: 3, changed: 0, removed: 0 });
    expect(first.snapshot?.files.map((f) => f.path)).toEqual(["copy.json", "package.json", "src/index.ts"]);
    expect(first.snapshot).toMatchObject({ fileCount: 3, branch: `agent/${taskId}` });
    // Identical contents ("{}" twice) are one blob.
    const blobs = await r.db.select({ sha: workspaceBlobs.sha256 }).from(workspaceBlobs).where(eq(workspaceBlobs.businessId, businessId));
    expect(blobs).toHaveLength(2);

    const same = await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "package.json", content: text("{}") }, { path: "copy.json", content: text("{}") }, { path: "src/index.ts", content: text("export const a = 1;\n") }] }));
    expect(same).toMatchObject({ saved: false, added: 0, changed: 0, removed: 0 });
    expect(same.snapshot?.id).toBe(first.snapshot?.id);

    const second = await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "src/index.ts", content: text("export const a = 2;\n") }, { path: "package.json", content: text("{}") }, { path: "src/new.ts", content: text("x") }] }));
    expect(second).toMatchObject({ saved: true, added: 1, changed: 1, removed: 1 });
    expect((await repos.workspaces.latest(r.db, businessId, taskId))?.id).toBe(second.snapshot?.id);
    const history = await repos.workspaces.listSnapshots(r.db, businessId, taskId);
    expect(history.map((s) => s.id)).toEqual([second.snapshot!.id, first.snapshot!.id]);
    expect(history[0]).not.toHaveProperty("files");

    const read = await repos.workspaces.readFiles(r.db, businessId, second.snapshot!);
    expect(read.map((f) => [f.path, decode(f.content)])).toEqual([
      ["package.json", "{}"],
      ["src/index.ts", "export const a = 2;\n"],
      ["src/new.ts", "x"],
    ]);
    // The earlier snapshot still reads its own version.
    expect(decode((await repos.workspaces.readFiles(r.db, businessId, first.snapshot!, ["src/index.ts"]))[0]!.content)).toBe("export const a = 1;\n");
  });

  it("refuses unsafe or duplicate paths and keeps businesses apart", async () => {
    const { businessId, task2Id } = r.A;
    await expect(r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId: task2Id, files: [{ path: "../escape.sh", content: text("x") }] }))).rejects.toThrow(/Invalid workspace/);
    await expect(r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId: task2Id, files: [{ path: "a.txt", content: text("1") }, { path: "a.txt", content: text("2") }] }))).rejects.toThrow(/twice/);
    // The same content in business B is B's own blob; A's snapshots are not B's.
    await r.svc((tx) => repos.workspaces.save(tx, r.B.businessId, { taskId: r.B.taskId, files: [{ path: "package.json", content: text("{}") }] }));
    const bBlobs = await r.db.select({ sha: workspaceBlobs.sha256 }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, r.B.businessId)));
    expect(bBlobs).toHaveLength(1);
    expect(await repos.workspaces.latest(r.db, r.B.businessId, r.A.taskId)).toBeNull();
    const aTasks = await repos.workspaces.listTasks(r.db, businessId);
    expect(aTasks.map((t) => t.taskId)).toEqual([r.A.taskId]);
    expect(aTasks[0]).toMatchObject({ snapshots: 2, latest: { fileCount: 3 } });
  });

  it("carries over files a session never had, keeps the newest saves and sweeps contents nothing uses", async () => {
    const { businessId } = r.A;
    const taskId = r.A.taskIds[0]!;
    const save = (files: Record<string, string>, opts: { carryOver?: boolean } = {}) => r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: Object.entries(files).map(([path, c]) => ({ path, content: text(c) })), ...opts }, { keepSnapshots: 2, keepYoungerThanMs: 0 }));
    await save({ "a.ts": "shared", "old.ts": "only-in-the-first" });
    // A session whose restore failed saves only what it wrote: the earlier files stay and nothing counts as removed.
    const carried = await save({ "b.ts": "b" }, { carryOver: true });
    expect(carried).toMatchObject({ saved: true, added: 1, changed: 0, removed: 0, pruned: 0 });
    expect(carried.snapshot?.files.map((f) => f.path)).toEqual(["a.ts", "b.ts", "old.ts"]);
    const third = await save({ "a.ts": "shared" });
    expect(third).toMatchObject({ saved: true, removed: 2, pruned: 1 });
    expect((await repos.workspaces.listSnapshots(r.db, businessId, taskId)).map((x) => x.id)).toEqual([third.snapshot!.id, carried.snapshot!.id]);
    const blobFor = async (c: string) => (await r.db.select({ id: workspaceBlobs.id }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), eq(workspaceBlobs.sha256, sha(c))))).length;
    // "only-in-the-first" is still in the carried snapshot; after one more save it is used by nothing and goes.
    expect(await blobFor("only-in-the-first")).toBe(1);
    await save({ "a.ts": "shared", "c.ts": "c" });
    expect(await blobFor("only-in-the-first")).toBe(0);
    expect(await blobFor("shared")).toBe(1);
  });

  it("refuses a save that would take the business past its quota, writing nothing", async () => {
    const { businessId } = r.A;
    const taskId = r.A.taskIds[1]!;
    const refused = await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "big.bin", content: new Uint8Array(4096) }] }, { quotaBytes: 1024 }));
    expect(refused).toMatchObject({ saved: false, snapshot: null, refused: expect.stringMatching(/limit/) });
    expect(await repos.workspaces.latest(r.db, businessId, taskId)).toBeNull();
    expect(await r.db.select({ id: workspaceBlobs.id }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), eq(workspaceBlobs.sizeBytes, 4096)))).toHaveLength(0);
  });

  it("keeps every save of the last day however many there are", async () => {
    const { businessId } = r.A;
    const taskId = r.A.taskIds[4]!;
    for (const n of [1, 2, 3, 4]) await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "a.ts", content: text(`v${n}`) }] }, { keepSnapshots: 2 }));
    expect(await repos.workspaces.listSnapshots(r.db, businessId, taskId)).toHaveLength(4);
  });

  it("a session that started before the task's code was forgotten cannot save it back", async () => {
    const { businessId, ownerId } = r.A;
    const taskId = r.A.taskIds[5]!;
    const [early] = await r.db.insert(agentSessions).values({ businessId, agentId: r.A.agentId, versionId: r.A.agentVersionId, taskId }).returning({ id: agentSessions.id });
    await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "leak.txt", content: text("sk_live_restored") }] }));
    await r.as(ownerId, (tx) => repos.workspaces.forgetTask(tx, businessId, taskId));
    const back = await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, sessionId: early!.id, files: [{ path: "leak.txt", content: text("sk_live_restored") }] }));
    expect(back).toMatchObject({ saved: false, refused: expect.stringMatching(/forgotten after the session started/) });
    expect(await repos.workspaces.latest(r.db, businessId, taskId)).toBeNull();
    // A session that starts after the forget saves its own work.
    const [late] = await r.db.insert(agentSessions).values({ businessId, agentId: r.A.agentId, versionId: r.A.agentVersionId, taskId }).returning({ id: agentSessions.id });
    expect(await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, sessionId: late!.id, files: [{ path: "fresh.ts", content: text("x") }] }))).toMatchObject({ saved: true });
  });

  it("owners and admins forget a task's saved code; members cannot; shared contents stay", async () => {
    const { businessId } = r.A;
    const taskId = r.A.taskIds[2]!;
    const other = r.A.taskIds[3]!;
    await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "x.ts", content: text("forget-me") }, { path: "s.ts", content: text("kept-elsewhere") }] }));
    await r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId: other, files: [{ path: "s.ts", content: text("kept-elsewhere") }] }));
    expect(await r.as(r.A.memberId, (tx) => repos.workspaces.forgetTask(tx, businessId, taskId))).toEqual({ snapshots: 0, blobs: 0 });
    expect(await r.as(r.B.ownerId, (tx) => repos.workspaces.forgetTask(tx, businessId, taskId))).toEqual({ snapshots: 0, blobs: 0 });
    expect(await repos.workspaces.latest(r.db, businessId, taskId)).not.toBeNull();
    expect(await r.as(r.A.adminId, (tx) => repos.workspaces.forgetTask(tx, businessId, taskId))).toEqual({ snapshots: 1, blobs: 1 });
    expect(await repos.workspaces.latest(r.db, businessId, taskId)).toBeNull();
    const read = await repos.workspaces.readFiles(r.db, businessId, (await repos.workspaces.latest(r.db, businessId, other))!);
    expect(read.map((f) => decode(f.content))).toEqual(["kept-elsewhere"]);
  });

  it("records pushes and finds the last save that reached a repository", async () => {
    const { businessId } = r.A;
    const taskId = r.A.taskIds[6]!;
    const save = (c: string) => r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "a.ts", content: text(c) }] }));
    const one = (await save("1")).snapshot!;
    const two = (await save("2")).snapshot!;
    expect(await repos.workspaces.lastPushed(r.db, businessId, taskId, "acme/shop")).toBeNull();
    await r.svc((tx) => repos.workspaces.recordPush(tx, businessId, one.id, { repo: "acme/shop", branch: `agent/${taskId}`, commitSha: "c1", url: "https://github.com/acme/shop/commit/c1" }));
    await r.svc((tx) => repos.workspaces.recordPush(tx, businessId, two.id, { repo: "acme/shop", branch: `agent/${taskId}`, error: "GitHub refused: not a fast forward" }));
    expect((await repos.workspaces.lastPushed(r.db, businessId, taskId, "acme/shop"))?.id).toBe(one.id);
    expect(await repos.workspaces.lastPushed(r.db, businessId, taskId, "acme/other")).toBeNull();
    const [latest] = await repos.workspaces.listSnapshots(r.db, businessId, taskId);
    expect(latest).toMatchObject({ id: two.id, pushedCommitSha: null, pushError: "GitHub refused: not a fast forward" });
    // Members cannot write push records.
    await r.as(r.A.memberId, (tx) => repos.workspaces.recordPush(tx, businessId, two.id, { repo: "acme/shop", branch: "x", commitSha: "forged", url: null }));
    expect((await repos.workspaces.getSnapshot(r.db, businessId, two.id))?.pushedCommitSha).toBeNull();
  });

  it("reads and sets the repository code tasks push to, only once GitHub is connected, pushing only when turned on", async () => {
    const { businessId, ownerId } = r.A;
    expect(await repos.integrations.codeRepository(r.db, businessId)).toBeNull();
    await expect(r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, "acme/shop"))).rejects.toThrow(/connect GitHub/);
    // A repository named anywhere but the founder's choice (a connector's config) is not a push target.
    await r.svc((tx) => repos.integrations.upsert(tx, businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: { externalAccountId: "42", config: { installationId: 42, repo: "acme/from-connect", writeEnabled: true } } }));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toBeNull();

    await r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, "acme/shop"));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ fullName: "acme/shop", owner: "acme", repo: "shop", status: "connected", writeEnabled: false });
    await r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, "acme/shop", { pushEnabled: true }));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ fullName: "acme/shop", writeEnabled: true });
    // The connect() settings stay alongside the choice.
    expect((await repos.integrations.getByKey(r.db, businessId, "github"))?.settings).toMatchObject({ externalAccountId: "42", repo: "acme/shop", writeEnabled: true });
    for (const bad of ["not a repo", "acme/..", "acme/.", "-acme/shop"]) await expect(r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, bad))).rejects.toThrow(/owner\/name/);
    // Stop pushing: no repository, and pushing off, with no fallback to anything else.
    await r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, null));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toBeNull();
    expect((await repos.integrations.getByKey(r.db, businessId, "github"))?.settings).not.toHaveProperty("writeEnabled");
    expect(await repos.integrations.codeRepository(r.db, r.B.businessId)).toBeNull();
  });

  it("pins GitHub's id of the Code-tab repository: on choosing it, or once for one chosen before pinning, never across businesses", async () => {
    const { businessId, ownerId } = r.A;
    const before = (await repos.integrations.getByKey(r.db, businessId, "github"))!.settings as Record<string, unknown>;
    await r.svc((tx) => repos.integrations.upsert(tx, businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: { externalAccountId: "42" } }));
    await r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, "acme/shop", { repoId: 1001 }));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ fullName: "acme/shop", repoId: 1001 });
    // Choosing another repository without a verified id drops the pin; with one, replaces it.
    await r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, "acme/site"));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ fullName: "acme/site", repoId: null });
    await expect(r.as(ownerId, (tx) => repos.integrations.setCodeRepository(tx, businessId, "acme/site", { repoId: -3 }))).rejects.toThrow(/repoId/);

    // The gateway pins an unpinned choice once, only while the Code tab still names that repository.
    expect(await r.svc((tx) => repos.integrations.pinCodeRepositoryId(tx, businessId, { fullName: "acme/other", repoId: 7 }))).toBe(false);
    expect(await r.svc((tx) => repos.integrations.pinCodeRepositoryId(tx, businessId, { fullName: "Acme/Site", repoId: 2002 }))).toBe(true);
    expect(await r.svc((tx) => repos.integrations.pinCodeRepositoryId(tx, businessId, { fullName: "acme/site", repoId: 3003 }))).toBe(false);
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ fullName: "acme/site", repoId: 2002 });
    // A forged settings value is not a pin.
    await r.svc((tx) => repos.integrations.upsert(tx, businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: { externalAccountId: "42", repo: "acme/site", repoId: "2002" } }));
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ repoId: null });

    // Cross-tenant: business B's owner can neither pin nor read A's repository, and B's own pin leaves A's alone.
    expect(await r.as(r.B.ownerId, (tx) => repos.integrations.pinCodeRepositoryId(tx, businessId, { fullName: "acme/site", repoId: 666 }))).toBe(false);
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ repoId: null });
    await r.svc((tx) => repos.integrations.upsert(tx, r.B.businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: { externalAccountId: "77", repo: "acme/site" } }));
    expect(await r.svc((tx) => repos.integrations.pinCodeRepositoryId(tx, r.B.businessId, { fullName: "acme/site", repoId: 4004 }))).toBe(true);
    expect(await repos.integrations.codeRepository(r.db, businessId)).toMatchObject({ repoId: null });
    expect(await repos.integrations.codeRepository(r.db, r.B.businessId)).toMatchObject({ repoId: 4004 });
    await r.svc((tx) => repos.integrations.upsert(tx, r.B.businessId, { connectorKey: "github", status: "disconnected", authKind: "app", settings: {} }));
    await r.svc((tx) => repos.integrations.upsert(tx, businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: before }));
  });

  it("0068: a save on a checkout stores only the diff against it, counted against the checkout, and keeps its base when a later session could not check out", async () => {
    const { businessId } = r.A;
    const taskId = r.A.taskIds[7]!;
    const base = { repo: "acme/shop", ref: "main", commitSha: "a".repeat(40) };
    const save = (input: Partial<Parameters<typeof repos.workspaces.save>[2]>) => r.svc((tx) => repos.workspaces.save(tx, businessId, { taskId, files: [], ...input }));
    // Nothing changed on the checkout: nothing is saved.
    expect(await save({ base, removedPaths: [] })).toMatchObject({ saved: false, snapshot: null });
    const first = await save({ base, files: [{ path: "src/a.ts", content: text("changed"), inBase: true }, { path: "src/new.ts", content: text("new"), inBase: false }], removedPaths: ["old.txt"] });
    expect(first).toMatchObject({ saved: true, added: 1, changed: 1, removed: 1 });
    expect(first.snapshot).toMatchObject({ baseRepo: "acme/shop", baseRef: "main", baseCommitSha: base.commitSha, removedPaths: ["old.txt"], fileCount: 2 });
    // The same diff on the same commit is unchanged; on a new commit (the pushed branch) it is a new save.
    expect(await save({ base, files: [{ path: "src/a.ts", content: text("changed"), inBase: true }, { path: "src/new.ts", content: text("new"), inBase: false }], removedPaths: ["old.txt"] })).toMatchObject({ saved: false });
    const moved = { ...base, ref: `agent/${taskId}`, commitSha: "b".repeat(40) };
    const second = await save({ base: moved, files: [], removedPaths: [] });
    expect(second).toMatchObject({ saved: true, added: 0, changed: 0, removed: 0 });
    expect(second.snapshot).toMatchObject({ baseRef: `agent/${taskId}`, fileCount: 0, removedPaths: [] });
    await expect(save({ base, files: [{ path: "x.ts", content: text("x") }], removedPaths: ["x.ts"] })).rejects.toThrow(/both saved and removed/);
    await expect(save({ base: { ...base, commitSha: "not-a-sha" } })).rejects.toThrow(/Invalid workspace/);

    // A session that could not check out works on the saved changes alone: its save keeps the base and the removals.
    await save({ base: moved, files: [{ path: "src/a.ts", content: text("v2"), inBase: true }], removedPaths: ["gone.md"] });
    const inherited = await save({ files: [{ path: "src/a.ts", content: text("v3") }, { path: "extra.ts", content: text("e") }] });
    expect(inherited.snapshot).toMatchObject({ baseCommitSha: moved.commitSha, baseRef: moved.ref, removedPaths: ["gone.md"], fileCount: 2 });
    // ...unless the file is back.
    expect((await save({ files: [{ path: "gone.md", content: text("back") }] })).snapshot).toMatchObject({ removedPaths: [] });
    // null saves a whole workspace with no base.
    expect((await save({ base: null, files: [{ path: "a.ts", content: text("a") }] })).snapshot).toMatchObject({ baseCommitSha: null, removedPaths: [] });
    // Business B never sees A's checkout base.
    expect(await r.as(r.B.ownerId, (tx) => repos.workspaces.listSnapshots(tx, businessId, taskId))).toEqual([]);
    expect((await r.as(r.A.memberId, (tx) => repos.workspaces.listSnapshots(tx, businessId, taskId)))[1]).toMatchObject({ baseRepo: "acme/shop" });
  });

  it("members read workspaces through RLS; they cannot write them", async () => {
    const { businessId, memberId, taskId } = r.A;
    const seen = await r.as(memberId, (tx) => repos.workspaces.latest(tx, businessId, taskId));
    expect(seen?.fileCount).toBe(3);
    const files = await r.as(memberId, (tx) => repos.workspaces.readFiles(tx, businessId, seen!));
    expect(files).toHaveLength(3);
    await expect(r.as(memberId, (tx) => repos.workspaces.save(tx, businessId, { taskId, files: [{ path: "x.txt", content: text("y") }] }))).rejects.toThrow();
    const outsider = await r.as(r.B.ownerId, (tx) => repos.workspaces.latest(tx, businessId, taskId));
    expect(outsider).toBeNull();
  });

  it("stores screenshots outside any snapshot, once per content and within the quota (design check, item 13)", async () => {
    const { businessId } = r.A;
    const shots = [text("png-one"), text("png-two"), text("png-one")];
    const shas = await r.svc((tx) => repos.workspaces.putBlobs(tx, businessId, shots));
    expect(shas).toEqual([sha("png-one"), sha("png-two"), sha("png-one")]);
    const rows = await r.db.select({ sha: workspaceBlobs.sha256 }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), eq(workspaceBlobs.sha256, sha("png-one"))));
    expect(rows).toHaveLength(1);
    // Past the quota (or empty) a content is not stored, and says so with null.
    expect(await r.svc((tx) => repos.workspaces.putBlobs(tx, businessId, [text("png-three"), new Uint8Array()], { quotaBytes: 1 }))).toEqual([null, null]);
    // Another business does not see them.
    const other = await r.db.select({ sha: workspaceBlobs.sha256 }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, r.B.businessId), eq(workspaceBlobs.sha256, sha("png-two"))));
    expect(other).toHaveLength(0);
  });
});
