/**
 * The workspace fingerprint behind "a code session that changed nothing is not done" (decision 3, 2026-10-23): the
 * agent's files and links count; the SDK's HOME state, node_modules and .git do not; an unreadable or oversized
 * workspace is unknown, which counts as changed.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprintWorkspace, workspaceChanged } from "../activities/workspace-fingerprint";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "fm-print-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fingerprintWorkspace", () => {
  it("changes when the agent adds, edits, removes or links a file", async () => {
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
    const start = await fingerprintWorkspace(dir);
    expect(start?.entries).toBe(1);
    expect(workspaceChanged(start, await fingerprintWorkspace(dir))).toBe(false);

    await writeFile(path.join(dir, "src", "a.ts"), "export const a = 2;\n");
    const edited = await fingerprintWorkspace(dir);
    expect(workspaceChanged(start, edited)).toBe(true);
    // Writing the same content back is no change.
    await writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
    expect(workspaceChanged(start, await fingerprintWorkspace(dir))).toBe(false);

    await writeFile(path.join(dir, "b.ts"), "");
    expect(workspaceChanged(start, await fingerprintWorkspace(dir))).toBe(true);
    await rm(path.join(dir, "b.ts"));
    expect(workspaceChanged(start, await fingerprintWorkspace(dir))).toBe(false);
    await symlink("src/a.ts", path.join(dir, "link.ts"));
    expect(workspaceChanged(start, await fingerprintWorkspace(dir))).toBe(true);
  });

  it("ignores the SDK's HOME state, dependencies and git metadata", async () => {
    await writeFile(path.join(dir, "index.ts"), "export {};\n");
    const start = await fingerprintWorkspace(dir);
    await mkdir(path.join(dir, ".claude"), { recursive: true });
    await writeFile(path.join(dir, ".claude", "settings.json"), "{}");
    await writeFile(path.join(dir, ".claude.json"), "{}");
    await mkdir(path.join(dir, ".tmp"));
    await writeFile(path.join(dir, ".tmp", "x"), "x");
    await mkdir(path.join(dir, "node_modules", "dep"), { recursive: true });
    await writeFile(path.join(dir, "node_modules", "dep", "index.js"), "");
    await mkdir(path.join(dir, "pkg", ".git"), { recursive: true });
    await writeFile(path.join(dir, "pkg", ".git", "HEAD"), "ref: refs/heads/main");
    expect(workspaceChanged(start, await fingerprintWorkspace(dir))).toBe(false);
  });

  it("is unknown (null, read as changed) past its entry cap or for a workspace that cannot be read", async () => {
    await writeFile(path.join(dir, "a"), "1");
    await writeFile(path.join(dir, "b"), "2");
    expect(await fingerprintWorkspace(dir, 1)).toBeNull();
    expect(await fingerprintWorkspace(path.join(dir, "missing"))).toBeNull();
    expect(workspaceChanged(null, await fingerprintWorkspace(dir))).toBe(true);
  });
});
