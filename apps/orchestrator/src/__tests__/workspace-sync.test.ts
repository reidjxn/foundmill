/**
 * Code-task workspace sync (activities/workspace-sync.ts): what of the host workspace reaches the sandbox before the
 * acceptance run, and what never does.
 */
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SYNC_LIMITS, readWorkspace, syncWorkspaceToSandbox } from "../activities/workspace-sync";

let cwd: string;
let outside: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "fm-sync-ws-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "fm-sync-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "not yours");
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const put = async (rel: string, content: string | Buffer = "x") => {
  await mkdir(path.dirname(path.join(cwd, rel)), { recursive: true });
  await writeFile(path.join(cwd, rel), content);
};

function recordingSandbox() {
  const files = new Map<string, Uint8Array>();
  return { files, async writeFile(p: string, content: string | Uint8Array) { files.set(p, typeof content === "string" ? new TextEncoder().encode(content) : content); } };
}

describe("readWorkspace", () => {
  it("lists the agent's regular files, sorted, without the SDK's HOME state, dependencies, git metadata or symlinks", async () => {
    await put("package.json", "{}");
    await put("src/b.ts");
    await put("src/a.ts");
    await put("src/.config/app.json"); // a project's own dot-directory below the top level is kept
    await put(".gitignore", "node_modules\n"); // project dotfiles at the top level are kept
    await put(".claude/projects/session.jsonl");
    await put(".claude.json");
    await put(".claude.json.backup");
    await put(".tmp/scratch");
    await put(".cache/x");
    await put("node_modules/dep/index.js");
    await put("packages/web/node_modules/dep/index.js");
    await put(".git/HEAD");
    await symlink(path.join(outside, "secret.txt"), path.join(cwd, "src", "linked.txt"));
    await symlink(outside, path.join(cwd, "linked-dir"));
    await link(path.join(outside, "secret.txt"), path.join(cwd, "src", "hardlinked.txt"));

    const listing = await readWorkspace(cwd);
    expect(listing.refused).toBeNull();
    expect(listing.files.map((f) => f.rel)).toEqual([".gitignore", "package.json", "src/.config/app.json", "src/a.ts", "src/b.ts"]);
    expect(listing.skipped).toBe(3); // two symlinks and the hard link
    expect(new TextDecoder().decode(listing.files.find((f) => f.rel === "package.json")!.content)).toBe("{}");
  });

  it("refuses over each cap with a reason", async () => {
    await put("a.txt", "12345");
    await put("b.txt", "12345");
    await put("c.txt", "12345");
    expect((await readWorkspace(cwd, { ...DEFAULT_SYNC_LIMITS, maxFiles: 2 })).refused).toBe("the workspace has more than 2 files");
    expect((await readWorkspace(cwd, { ...DEFAULT_SYNC_LIMITS, maxFileBytes: 4 })).refused).toMatch(/^a\.txt is larger than/);
    expect((await readWorkspace(cwd, { ...DEFAULT_SYNC_LIMITS, maxTotalBytes: 12 })).refused).toMatch(/^the workspace is larger than/);
    expect((await readWorkspace(cwd, { ...DEFAULT_SYNC_LIMITS, maxFiles: 3, maxTotalBytes: 15 })).refused).toBeNull();
  });

  it("an empty workspace lists nothing", async () => {
    expect(await readWorkspace(cwd)).toEqual({ files: [], skipped: 0, refused: null });
  });
});

describe("syncWorkspaceToSandbox", () => {
  it("writes every listed file with its relative path and exact bytes", async () => {
    const binary = Buffer.from([0, 1, 2, 250, 255]);
    await put("package.json", '{"name":"x"}');
    await put("assets/logo.png", binary);
    for (let i = 0; i < 20; i++) await put(`src/f${i}.ts`, `export const n = ${i};\n`);
    await put(".claude.json", "{}");
    const sandbox = recordingSandbox();
    const result = await syncWorkspaceToSandbox(cwd, sandbox, { ...DEFAULT_SYNC_LIMITS, concurrency: 4 });
    expect(result.refused).toBeNull();
    expect(result.files).toBe(22);
    expect([...sandbox.files.keys()].sort()).toEqual(["assets/logo.png", "package.json", ...Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`)].sort());
    expect(Buffer.from(sandbox.files.get("assets/logo.png")!)).toEqual(binary);
    expect(new TextDecoder().decode(sandbox.files.get("src/f7.ts"))).toBe("export const n = 7;\n");
    expect(result.bytes).toBe([...sandbox.files.values()].reduce((n, b) => n + b.byteLength, 0));
  });

  it("writes nothing when the workspace is over a cap", async () => {
    await put("a.txt", "12345");
    await put("b.txt", "12345");
    const sandbox = recordingSandbox();
    const result = await syncWorkspaceToSandbox(cwd, sandbox, { ...DEFAULT_SYNC_LIMITS, maxFiles: 1 });
    expect(result).toMatchObject({ files: 0, bytes: 0, refused: "the workspace has more than 1 files" });
    expect(sandbox.files.size).toBe(0);
  });
});
