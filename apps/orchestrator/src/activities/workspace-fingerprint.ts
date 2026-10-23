/**
 * Did a code session change anything? A fingerprint of the workspace's files (relative path and content hash of every
 * regular file, the target of every link) is taken once the workspace is ready and again when the agent is done; a
 * session whose two fingerprints match wrote nothing (decision 3, 2026-10-23: such a session is never `done`).
 *
 * The walk skips what is never the agent's work, as the save and the acceptance copy do (./workspace-sync): the SDK's
 * HOME state at the top level, `node_modules` and `.git` anywhere. It reads, never writes, and stops at
 * FINGERPRINT_MAX_ENTRIES: past that it returns null ("unknown"), which callers read as changed.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { isSdkHomeEntry, NEVER_SYNCED_DIRS } from "./workspace-sync";

/** Entries past which a workspace is not fingerprinted (the result is null: unknown, read as changed). */
export const FINGERPRINT_MAX_ENTRIES = 20_000;

export interface WorkspaceFingerprint {
  /** sha256 over every entry, in path order. */
  digest: string;
  /** Files and links fingerprinted. */
  entries: number;
}

export async function fingerprintWorkspace(cwd: string, maxEntries = FINGERPRINT_MAX_ENTRIES): Promise<WorkspaceFingerprint | null> {
  const total = createHash("sha256");
  let entries = 0;
  const walk = async (dir: string, relDir: string): Promise<boolean> => {
    const listed = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of listed) {
      if (relDir === "" && isSdkHomeEntry(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (NEVER_SYNCED_DIRS.includes(entry.name)) continue;
        if (!(await walk(abs, rel))) return false;
        continue;
      }
      let part: string | null = null;
      if (entry.isFile()) part = `f:${createHash("sha256").update(await readFile(abs)).digest("hex")}`;
      else if (entry.isSymbolicLink()) part = `l:${await readlink(abs)}`;
      if (part === null) continue;
      entries += 1;
      if (entries > maxEntries) return false;
      total.update(`${rel}\0${part}\n`);
    }
    return true;
  };
  try {
    if (!(await walk(cwd, ""))) return null;
  } catch {
    return null;
  }
  return { digest: total.digest("hex"), entries };
}

/** Whether the workspace changed between two fingerprints; an unknown one (null) counts as changed. */
export function workspaceChanged(before: WorkspaceFingerprint | null, after: WorkspaceFingerprint | null): boolean {
  if (!before || !after) return true;
  return before.digest !== after.digest;
}
