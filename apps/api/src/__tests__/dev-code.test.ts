/** Development › Code: the code agents saved on code tasks (dev.code.list / files / file), per business. */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeSavedFile, SAVED_FILE_TEXT_LIMIT } from "../routers/dev";
import { createApiHarness, type ApiHarness } from "./harness";

const text = (s: string) => new TextEncoder().encode(s);

describe("dev.code", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "code" });
  }, 120_000);
  afterAll(() => hz.close());

  it("lists tasks with saved code, their files and history, and reads a file as text", async () => {
    const { businessId, taskId, agent2Id, ownerId } = hz.A;
    const first = await repos.workspaces.save(hz.db, businessId, { taskId, agentId: agent2Id, branch: `agent/${taskId}`, files: [{ path: "src/match.ts", content: text("export const match = () => true;\n") }] });
    const second = await repos.workspaces.save(hz.db, businessId, { taskId, agentId: agent2Id, files: [{ path: "src/match.ts", content: text("export const match = () => false;\n") }, { path: "logo.png", content: new Uint8Array([137, 80, 78, 71, 0, 1]) }] });
    const owner = hz.caller({ userId: ownerId });

    const list = await owner.dev.code.list({ businessId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ taskId, snapshots: 2, latest: { id: second.snapshot!.id, fileCount: 2, added: 1, changed: 1 } });

    const files = await owner.dev.code.files({ businessId, taskId });
    expect(files.branch).toBe(`agent/${taskId}`);
    expect(files.snapshot?.files.map((f) => f.path)).toEqual(["logo.png", "src/match.ts"]);
    expect(files.history.map((h) => h.id)).toEqual([second.snapshot!.id, first.snapshot!.id]);
    const older = await owner.dev.code.files({ businessId, taskId, snapshotId: first.snapshot!.id });
    expect(older.snapshot?.files.map((f) => f.path)).toEqual(["src/match.ts"]);

    expect(await owner.dev.code.file({ businessId, snapshotId: second.snapshot!.id, path: "src/match.ts" })).toMatchObject({ binary: false, truncated: false, text: "export const match = () => false;\n" });
    expect(await owner.dev.code.file({ businessId, snapshotId: first.snapshot!.id, path: "src/match.ts" })).toMatchObject({ text: "export const match = () => true;\n" });
    expect(await owner.dev.code.file({ businessId, snapshotId: second.snapshot!.id, path: "logo.png" })).toMatchObject({ binary: true, text: null, size: 6 });
    await expect(owner.dev.code.file({ businessId, snapshotId: second.snapshot!.id, path: "missing.ts" })).rejects.toThrow(/not found/);
  });

  it("keeps another business's code out of reach", async () => {
    const { businessId, taskId } = hz.A;
    const snapshot = (await repos.workspaces.latest(hz.db, businessId, taskId))!;
    const outsider = hz.caller({ userId: hz.B.ownerId });
    expect(await outsider.dev.code.list({ businessId: hz.B.businessId })).toEqual([]);
    await expect(outsider.dev.code.file({ businessId: hz.B.businessId, snapshotId: snapshot.id, path: "src/match.ts" })).rejects.toThrow(/not found/);
    await expect(outsider.dev.code.list({ businessId })).rejects.toThrow();
  });

  it("checks the task on an earlier snapshot and gives members a read-only view", async () => {
    const { businessId, taskId, task2Id, memberId, viewerId } = hz.A;
    const snapshot = (await repos.workspaces.latest(hz.db, businessId, taskId))!;
    const member = hz.caller({ userId: memberId });
    await expect(member.dev.code.files({ businessId, taskId: task2Id, snapshotId: snapshot.id })).rejects.toThrow(/not found/);
    expect((await hz.caller({ userId: viewerId }).dev.code.files({ businessId, taskId })).snapshot?.id).toBe(snapshot.id);
    await expect(member.dev.code.forget({ businessId, taskId })).rejects.toThrow(/owner|admin|administration/i);
    await expect(hz.caller({ userId: viewerId }).dev.code.forget({ businessId, taskId })).rejects.toThrow();
  });

  it("owners forget a task's saved code, audited; a task with none is not found", async () => {
    const { businessId, taskId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await owner.dev.code.forget({ businessId, taskId })).toEqual({ snapshots: 2, blobs: 3 });
    expect(await owner.dev.code.list({ businessId })).toEqual([]);
    await expect(owner.dev.code.forget({ businessId, taskId })).rejects.toThrow(/not found/);
    const audit = await repos.audit.list(hz.db, businessId, { action: "dev.code.forget" });
    expect(audit.items[0]).toMatchObject({ actorKind: "user", actorId: ownerId, target: { kind: "task", id: taskId } });
  });

  it("decodes text up to the limit and calls non-UTF-8 binary", () => {
    expect(decodeSavedFile(text("héllo"))).toEqual({ binary: false, truncated: false, text: "héllo" });
    expect(decodeSavedFile(new Uint8Array([0xff, 0xfe, 0x41]))).toMatchObject({ binary: true });
    const big = decodeSavedFile(new Uint8Array(SAVED_FILE_TEXT_LIMIT + 10).fill(65));
    expect(big).toMatchObject({ binary: false, truncated: true });
    expect(big.text).toHaveLength(SAVED_FILE_TEXT_LIMIT);
  });
});
