/** Agent workspaces (0013): saving a code task's files per session, deduplicated contents, diffs and reads, per business. */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { isSafeWorkspacePath } from "../../repos/workspaces";
import { workspaceBlobs } from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("ws");
});
afterAll(() => r?.close());

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("workspaces", () => {
  it("accepts relative paths only", () => {
    for (const ok of ["package.json", "src/index.ts", ".gitignore", "a/b/c.d.ts"]) expect(isSafeWorkspacePath(ok)).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "a/./b", "a\\b", "a\0b", `${"x".repeat(501)}`]) expect(isSafeWorkspacePath(bad)).toBe(false);
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
});
