/** Saved code tasks (activities/workspace-store.ts): what a session saves and what the next one gets back. */
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restorablePath, restoreWorkspace, saveWorkspace } from "../activities/workspace-store";
import { DEFAULT_SYNC_LIMITS } from "../activities/workspace-sync";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
const dirs: string[] = [];
const freshDir = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "fm-store-"));
  dirs.push(d);
  return d;
};

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "store" });
});
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  await t?.close();
});

describe("restorablePath", () => {
  it("keeps the agent's files and refuses the SDK's state, dependencies, git metadata and unsafe paths", () => {
    for (const ok of ["src/a.ts", ".gitignore", "docs/.config/x"]) expect(restorablePath(ok)).toBe(true);
    for (const no of [".claude/settings.json", ".claude.json", ".tmp/x", "node_modules/a.js", "pkg/node_modules/a.js", ".git/HEAD", "../x", "/etc/passwd"]) expect(restorablePath(no)).toBe(false);
  });
});

describe("saveWorkspace / restoreWorkspace", () => {
  it("round-trips a task's files between sessions and refuses an oversized workspace", async () => {
    const owner = { businessId: t.businessId, taskId: t.codeTaskId, sessionId: await openSessionRow(t, t.workerId, t.codeTaskId), agentId: t.workerId, branch: `agent/${t.codeTaskId}` };
    const first = await freshDir();
    await mkdir(path.join(first, "src"), { recursive: true });
    await writeFile(path.join(first, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(first, "package.json"), "{}");
    await writeFile(path.join(first, ".claude.json"), "{}");
    await symlink("/etc/hostname", path.join(first, "host.txt"));
    const saved = await saveWorkspace(t.db, owner, first);
    expect(saved).toMatchObject({ status: "saved", files: 2, added: 2 });
    expect(await saveWorkspace(t.db, owner, first)).toMatchObject({ status: "unchanged" });

    const next = await freshDir();
    const restored = await restoreWorkspace(t.db, t.businessId, t.codeTaskId, next);
    expect(restored).toMatchObject({ files: 2 });
    expect(restored.savedAt).toBeInstanceOf(Date);
    expect((await readdir(next)).sort()).toEqual(["package.json", "src"]);
    expect(await readFile(path.join(next, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");

    expect(await restoreWorkspace(t.db, t.businessId, t.fixture.task2Id, await freshDir())).toEqual({ files: 0, bytes: 0, savedAt: null });

    const big = await freshDir();
    await writeFile(path.join(big, "a.bin"), Buffer.alloc(10));
    expect(await saveWorkspace(t.db, owner, big, { ...DEFAULT_SYNC_LIMITS, maxFileBytes: 4 })).toEqual({ status: "refused", reason: expect.stringMatching(/^a\.bin is larger than/) });
  });
});
