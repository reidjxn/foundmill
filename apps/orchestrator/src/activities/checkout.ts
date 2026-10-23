/**
 * Real checkouts (founder decision 2, 2026-10-23): a code session starts from the business's Code-tab repository, not
 * from an empty directory. The archive comes through the gateway (`POST /v1/github/archive`, a token minted for
 * `github:download_archive` alone), never from GitHub directly: the task's branch `agent/<taskId>` when it exists, else
 * the default branch. The task's own saved changes are applied on top afterwards (./workspace-store `restoreWorkspace`).
 *
 * Extraction writes only regular files, each with O_CREAT | O_EXCL | O_NOFOLLOW under the fresh workspace, and refuses
 * the whole archive on an absolute path, a `..` segment or more than one top-level directory. Links (symbolic or hard)
 * are never created; `node_modules` and `.git` at any depth, the SDK's HOME entries and the start-up files the CLI,
 * git, package managers or shells read (`STARTUP_FILES`, `.claude*`) are left out, as for a restore. Caps: 60 MB
 * compressed, 8,000 files, 300 MB unpacked, 5 MB per file (a larger file is left out). Anything over a cap fails the
 * checkout, and the session starts as before with a note naming why.
 *
 * The result is the base the session's save and push are diffed against (repository, ref, commit, each file's
 * sha256), the recipients its files mention (the gateway's untrusted seed: first-party code, but a recipient first seen
 * there still needs the founder) and the credential-shaped values already in the repository (kept as they are when a
 * changed file is saved, instead of being masked into the founder's code).
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { readTarGz, TarError } from "@foundmill/connectors/connectors/github/tarball";
import { DOWNLOAD_ARCHIVE_TOOL, MAX_ARCHIVE_BYTES } from "@foundmill/connectors/connectors/github/tools";
import { repos, type Db } from "@foundmill/db";
import type { GatewayClient } from "../gateway-client";
import { collectRecipients, credentialMatches, restorablePath, scanText, type FoundRecipients } from "./workspace-store";
import { DEFAULT_SYNC_LIMITS } from "./workspace-sync";

export interface CheckoutLimits {
  maxArchiveBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  /** Entries of any kind (directories, links, files left out). */
  maxEntries: number;
}

export const CHECKOUT_LIMITS: CheckoutLimits = { maxArchiveBytes: MAX_ARCHIVE_BYTES, maxFiles: 8_000, maxTotalBytes: 300 * 1024 * 1024, maxFileBytes: DEFAULT_SYNC_LIMITS.maxFileBytes, maxEntries: 32_000 };
/** Lifetime of the token minted for the checkout's archive request(s). */
export const CHECKOUT_TOKEN_TTL_SECONDS = 300;
/** How long one archive download may take, end to end. */
export const CHECKOUT_TIMEOUT_MS = 240_000;
/** Credential-shaped values remembered from the checkout (past it, the rest are masked as usual). */
const MAX_KNOWN_SECRETS = 10_000;

/** What a session's save and push are diffed against. */
export interface CheckoutBase {
  /** `owner/name`, as the Code tab names it. */
  repo: string;
  ref: string;
  commitSha: string;
  /** Every file written into the workspace: relative path → sha256 of its content. */
  files: Map<string, string>;
  /** Credential-shaped values the checkout's files already hold. */
  knownSecrets: Set<string>;
}

export interface Checkout {
  base: CheckoutBase;
  /** The archive as the gateway served it (the acceptance run unpacks it inside the sandbox). */
  archive: Uint8Array;
  files: number;
  bytes: number;
  /** Entries not written: links, files over the size cap, start-up files, SDK entries, node_modules, .git. */
  skipped: number;
  recipients: FoundRecipients;
}

export type CheckoutResult = { status: "checked_out"; checkout: Checkout } | { status: "none"; reason: string } | { status: "failed"; repo: string; reason: string };

export interface CheckoutInput {
  businessId: string;
  agentId: string;
  sessionId: string;
  taskId: string;
}

/** The archive of `ref`, or why there is none (`missing`: the ref does not exist). */
async function fetchArchive(gateway: GatewayClient, token: string, target: { owner: string; repo: string }, ref: string): Promise<{ archive: { ref: string; sha: string; data: Uint8Array } } | { missing: true } | { error: string }> {
  const res = await gateway.downloadArchive(token, { owner: target.owner, repo: target.repo, ref }, { timeoutMs: CHECKOUT_TIMEOUT_MS, maxBytes: CHECKOUT_LIMITS.maxArchiveBytes });
  if (res.outcome === "allow" && "archive" in res) return { archive: res.archive };
  if (res.outcome === "allow") return res.error.code === "not_found" ? { missing: true } : { error: res.error.message.slice(0, 300) || "GitHub gave no archive" };
  if (res.outcome === "rate_limited") return { error: "GitHub's rate limit was reached" };
  if (res.outcome === "ask") return { error: "the checkout is waiting for the founder's approval" };
  return { error: `refused by policy${res.reasons.length ? ` (${res.reasons.join("; ").slice(0, 300)})` : ""}` };
}

/**
 * Check out the Code-tab repository into the fresh workspace `cwd`. Never throws: on failure the workspace may hold a
 * partial checkout, which the caller removes (it recreates the workspace) before starting as before.
 */
export async function checkoutRepository(deps: { db: Db; gateway: GatewayClient }, input: CheckoutInput, cwd: string, limits: CheckoutLimits = CHECKOUT_LIMITS): Promise<CheckoutResult> {
  const target = await repos.integrations.codeRepository(deps.db, input.businessId);
  if (!target) return { status: "none", reason: "no repository is chosen on the Code tab" };
  try {
    const token = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: input.agentId, sessionId: input.sessionId, allowedTools: [`github:${DOWNLOAD_ARCHIVE_TOOL}`], ttlSeconds: CHECKOUT_TOKEN_TTL_SECONDS });
    let got = await fetchArchive(deps.gateway, token.token, target, `agent/${input.taskId}`);
    if ("missing" in got) got = await fetchArchive(deps.gateway, token.token, target, "HEAD");
    if ("missing" in got) return { status: "failed", repo: target.fullName, reason: "the repository or its default branch was not found" };
    if ("error" in got) return { status: "failed", repo: target.fullName, reason: got.error };
    const { archive } = got;
    if (archive.data.byteLength > limits.maxArchiveBytes) return { status: "failed", repo: target.fullName, reason: `the archive is larger than ${Math.round(limits.maxArchiveBytes / (1024 * 1024))} MB` };
    const extracted = await extractArchive(archive.data, cwd, limits);
    const checkout: Checkout = { base: { repo: target.fullName, ref: archive.ref, commitSha: archive.sha, files: extracted.files, knownSecrets: extracted.knownSecrets }, archive: archive.data, files: extracted.files.size, bytes: extracted.bytes, skipped: extracted.skipped, recipients: extracted.recipients };
    return { status: "checked_out", checkout };
  } catch (err) {
    return { status: "failed", repo: target.fullName, reason: String((err as Error).message ?? err).slice(0, 300) };
  }
}

export interface Extracted {
  files: Map<string, string>;
  bytes: number;
  skipped: number;
  recipients: FoundRecipients;
  knownSecrets: Set<string>;
}

/** Normalised segments of an archive path, or null when the path is unsafe (absolute or with a `..` segment). */
function segmentsOf(raw: string): string[] | null {
  if (raw.startsWith("/") || raw.includes("\0")) return null;
  const segments = raw.split("/").filter((s) => s !== "" && s !== ".");
  return segments.includes("..") ? null : segments;
}

/** Write a fresh file without following links; a duplicate entry (later wins) replaces the earlier regular file. */
async function writeNew(abs: string, content: Uint8Array): Promise<void> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(abs, flags, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST" || !(await lstat(abs)).isFile()) throw err;
    await unlink(abs);
    handle = await open(abs, flags, 0o600);
  }
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

/**
 * Unpack a GitHub tarball into `cwd` (which must be empty but for SDK entries), with the rules and caps above. Throws
 * on an unsafe or over-the-cap archive; what was written by then stays for the caller to remove.
 */
export async function extractArchive(archive: Uint8Array, cwd: string, limits: CheckoutLimits = CHECKOUT_LIMITS): Promise<Extracted> {
  const root = await realpath(cwd);
  const files = new Map<string, string>();
  const recipients: FoundRecipients = { emails: new Set(), urls: new Set(), phones: new Set() };
  const knownSecrets = new Set<string>();
  let top: string | null = null;
  let bytes = 0;
  let skipped = 0;
  for await (const entry of readTarGz(archive, { maxEntries: limits.maxEntries, maxEntryBytes: limits.maxFileBytes, maxTotalBytes: limits.maxTotalBytes })) {
    const segments = segmentsOf(entry.path);
    if (!segments) throw new TarError(`the archive holds an unsafe path (${entry.path.slice(0, 120)})`);
    if (segments.length === 0) continue;
    // GitHub puts everything under one directory (owner-repo-sha/); it is stripped.
    top ??= segments[0]!;
    if (segments[0] !== top) throw new TarError("the archive has more than one top-level directory");
    const rel = segments.slice(1).join("/");
    if (rel === "" || entry.type === "directory") continue;
    if (entry.type !== "file" || entry.content === null || !restorablePath(rel)) {
      skipped++;
      continue;
    }
    if (files.size + 1 > limits.maxFiles) throw new TarError(`the repository has more than ${limits.maxFiles} files`);
    const abs = path.join(root, ...rel.split("/"));
    if (!abs.startsWith(root + path.sep)) throw new TarError(`the archive holds an unsafe path (${rel.slice(0, 120)})`);
    try {
      await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
      await writeNew(abs, entry.content);
    } catch (err) {
      // A file where the archive also has a directory (or the reverse): left out, never forced.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTDIR" || code === "EISDIR" || code === "EEXIST") {
        skipped++;
        continue;
      }
      throw err;
    }
    files.set(rel, createHash("sha256").update(entry.content).digest("hex"));
    bytes += entry.content.byteLength;
    const text = scanText(entry.content);
    collectRecipients(recipients, text);
    if (knownSecrets.size < MAX_KNOWN_SECRETS) for (const v of credentialMatches(text)) knownSecrets.add(v);
  }
  // File names are visible to the agent too.
  collectRecipients(recipients, [...files.keys()].flatMap((p) => [p, p.replace(/\.[^./]*$/, "")]).join("\n"));
  return { files, bytes, skipped, recipients, knownSecrets };
}

/** The session note for a checkout outcome. */
export function describeCheckout(result: CheckoutResult): { level: "info" | "warn"; text: string } {
  switch (result.status) {
    case "checked_out": {
      const c = result.checkout;
      return { level: "info", text: `Checked out ${c.base.repo}@${c.base.ref} (${c.files} file${c.files === 1 ? "" : "s"}, commit ${c.base.commitSha.slice(0, 7)}).` };
    }
    case "none":
      return { level: "info", text: "No repository is chosen on the Code tab: this session starts from the code saved on this task only." };
    case "failed":
      return { level: "warn", text: `Could not check out ${result.repo}: ${result.reason}. This session starts from the code saved on this task only.` };
  }
}
