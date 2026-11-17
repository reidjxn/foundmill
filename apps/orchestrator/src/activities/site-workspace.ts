/**
 * Site sessions (WP-07 T3). A project with no repository of its own, where SITES_DOMAIN is set, builds a static site
 * hosted by Foundmill. Each code session starts from the site as it stands (the newest preview release, or the
 * starter), saves only what it changed against that base (the ordinary save with a base: `saveWorkspace`), and when it
 * ends `done` its changes are applied to the newest release and saved as a new release: `preview` for the founder to
 * open and publish, or `held` when screening flags it. Two tasks that changed the same file from the same base: the
 * second is handed back (`needs_update`) and starts again from the newest release.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { screenSiteFiles, siteHeldSentence, starterFiles, type SiteFlag } from "@foundmill/agents";
import { repos, type Executor, type SiteRelease, type WorkspaceManifestEntry } from "@foundmill/db";
import { siteFileType, sitePreviewUrl, siteSlugProblem, sitesDomain, sitesEnabled } from "@foundmill/shared/sites";
import { suffixPageSlug, suggestPageSlug } from "@foundmill/shared";
import { emitEvent } from "../events";
import type { CheckoutBase } from "./checkout";
import { restorablePath } from "./workspace-store";

/** The `repo` a site base carries (`owner/name` shape, as a save requires): a save against it is a site save, never pushed anywhere. */
export const SITE_BASE_REPO = "foundmill-sites/site";

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Whether this business's code tasks build its Foundmill site: Sites on, no repository connected, not a sample. */
export async function isSiteProject(db: Executor, env: { SITES_DOMAIN?: string | undefined }, businessId: string): Promise<boolean> {
  if (!sitesEnabled(env)) return false;
  const [business, repository] = await Promise.all([repos.businesses.get(db, businessId, { includeArchived: true }), repos.integrations.codeRepository(db, businessId)]);
  return !business.isDemo && repository === null;
}

/** The starter's manifest and bytes (stored as blobs of the business, so a release that keeps them can be served). */
function starterEntries(): Array<WorkspaceManifestEntry & { content: Uint8Array }> {
  return starterFiles().map((f) => {
    const content = new TextEncoder().encode(f.content);
    return { path: f.path, sha256: sha256(content), size: content.byteLength, content };
  });
}

/**
 * Writes the site as it stands into `cwd` and returns the base the session's save is measured against: the newest
 * preview release (`ref: r<number>`), else the starter (`ref: starter`).
 */
export async function siteCheckout(db: Executor, businessId: string, cwd: string, at: Date): Promise<{ base: CheckoutBase; releaseId: string | null; note: string }> {
  const latest = await repos.sites.latestRelease(db, businessId);
  const entries = latest ? await repos.workspaces.readFiles(db, businessId, { files: latest.files }) : starterEntries();
  for (const e of entries) {
    if (!restorablePath(e.path)) throw new Error(`site release holds a path that cannot be restored: ${e.path}`);
    const target = join(cwd, e.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, e.content);
  }
  const files = new Map(entries.map((e) => [e.path, e.sha256]));
  const base: CheckoutBase = { repo: SITE_BASE_REPO, ref: latest ? `r${latest.number}` : "starter", commitSha: latest ? latest.contentHash : sha256(entries.map((e) => `${e.path}:${e.sha256}\n`).sort().join("")), files, knownSecrets: new Map(), packageScripts: new Map(), checkedOutAt: at };
  const note = latest ? `Started from version ${latest.number} of the site (${entries.length} file${entries.length === 1 ? "" : "s"}).` : `Started from the site's starter page (${entries.length} files).`;
  return { base, releaseId: latest?.id ?? null, note };
}

/**
 * The task's changes applied to the newest release (pure). A path conflicts when the task changed or removed it and the
 * newest release no longer has at that path what the task started from.
 */
export function applySiteChanges(latest: readonly WorkspaceManifestEntry[], baseFiles: ReadonlyMap<string, string>, changed: readonly WorkspaceManifestEntry[], removed: readonly string[]): { files: WorkspaceManifestEntry[] } | { conflict: string[] } {
  const now = new Map(latest.map((f) => [f.path, f]));
  const conflict = [...changed.map((f) => f.path), ...removed].filter((path) => (now.get(path)?.sha256 ?? null) !== (baseFiles.get(path) ?? null));
  if (conflict.length > 0) return { conflict: [...new Set(conflict)].sort() };
  for (const path of removed) now.delete(path);
  for (const f of changed) now.set(f.path, f);
  return { files: [...now.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

/** The note for a site task's prompt, in place of the repository note (`codeTaskNote`). */
export function siteTaskNote(): string {
  return [
    "Work inside your working directory; it holds the project's site as it stands now. The site is static: HTML, CSS and images only. Do not write JavaScript, a server, a package.json or tests; none of them are served.",
    "When your session ends the platform saves your changes as a new version of the site and gives the founder a preview link; the founder decides what goes live. Never block the task because you cannot run or open the site yourself.",
    'A sign-up form is `<form method="post" action="/_fm/follow">` with one `<input type="email" name="email" required>`; the platform asks the visitor for consent and sends the confirmation email. Do not add other fields, scripts, embeds or links that are not https.',
    'A pay button is `<a href="/_fm/pay/<key>">` for a key that `list_pay_links` returns; never write a payment address into a page.',
  ].join("\n\n");
}

export type SiteReleaseOutcome =
  | { status: "release"; release: SiteRelease; flags: SiteFlag[] }
  | { status: "conflict"; paths: string[] }
  | { status: "nothing" };

export interface BuildSiteReleaseInput {
  businessId: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  agentName: string;
}

/** The site's address: the business's own slug made into one, with a suffix when another site holds it. */
async function ensureSite(db: Executor, businessId: string): Promise<void> {
  if (await repos.sites.get(db, businessId)) return;
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  let slug = suggestPageSlug(business.slug || business.name);
  if (siteSlugProblem(slug)) slug = suffixPageSlug(slug, "site");
  try {
    await repos.sites.ensure(db, businessId, { slug });
  } catch {
    await repos.sites.ensure(db, businessId, { slug: suffixPageSlug(slug, businessId.replace(/-/g, "").slice(0, 6)) });
  }
}

/**
 * After a site task's session ends done: its saved changes on top of the newest release, screened, saved as release
 * N+1 (idempotent on the session: a retried finish returns the same release). Emits `site.release_created` and, for a
 * preview, `deploy.succeeded` (`environment: "preview"`); the first preview since the last publish writes the Product
 * lead's note in Needs you.
 */
export async function buildSiteRelease(db: Executor, env: { SITES_DOMAIN?: string | undefined }, input: BuildSiteReleaseInput): Promise<SiteReleaseOutcome> {
  const domain = sitesDomain(env);
  if (!domain) return { status: "nothing" };
  const snapshot = await repos.workspaces.latest(db, input.businessId, input.taskId);
  if (!snapshot || snapshot.sessionId !== input.sessionId || snapshot.baseRepo !== SITE_BASE_REPO) return { status: "nothing" };
  // A retried finish (Temporal retries the activity): the release this session already made, once.
  const already = (await repos.sites.listReleases(db, input.businessId, 100)).find((r) => r.sessionId === input.sessionId);
  if (already) return { status: "release", release: already, flags: Array.isArray(already.screening?.flags) ? (already.screening.flags as SiteFlag[]) : [] };
  await ensureSite(db, input.businessId);
  const latest = await repos.sites.latestRelease(db, input.businessId);
  const starter = starterEntries();
  // The starter's bytes become blobs of the business the first time, so a release that keeps a starter file serves it.
  if (!latest) await repos.workspaces.putBlobs(db, input.businessId, starter.map((e) => e.content));
  const latestFiles: WorkspaceManifestEntry[] = latest ? latest.files : starter.map(({ path, sha256: s, size }) => ({ path, sha256: s, size }));
  const baseFiles = new Map<string, string>();
  if (snapshot.baseRef === "starter") for (const e of starter) baseFiles.set(e.path, e.sha256);
  else {
    const number = Number(snapshot.baseRef?.replace(/^r/, ""));
    const baseRelease = (await repos.sites.listReleases(db, input.businessId, 100)).find((r) => r.number === number);
    for (const f of baseRelease?.files ?? []) baseFiles.set(f.path, f.sha256);
  }
  const applied = applySiteChanges(latestFiles, baseFiles, snapshot.files, snapshot.removedPaths);
  if ("conflict" in applied) return { status: "conflict", paths: applied.conflict };

  // Screening reads the text of every page, drawing and stylesheet (strictly UTF-8: a file that is not cannot pass).
  const texty = applied.files.filter((f) => /\.(html|svg|css)$/i.test(f.path));
  const contents = new Map((await repos.workspaces.readFiles(db, input.businessId, { files: texty })).map((e) => [e.path, e.content]));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const { flags } = screenSiteFiles(
    applied.files.map((f) => {
      const bytes = contents.get(f.path);
      let text: string | undefined;
      if (bytes && siteFileType(f.path)) {
        try {
          text = decoder.decode(bytes);
        } catch {
          text = undefined;
        }
      }
      return { path: f.path, size: f.size, ...(text !== undefined ? { text } : {}) };
    }),
  );
  const state = flags.length > 0 ? "held" : "preview";
  const release = await repos.sites.saveRelease(db, input.businessId, { files: applied.files, state, screening: { flags }, taskId: input.taskId, sessionId: input.sessionId, agentId: input.agentId, parentReleaseId: latest?.id ?? null });
  const previewUrl = release.state === "preview" ? sitePreviewUrl(domain, release.previewToken) : null;
  const site = (await repos.sites.get(db, input.businessId))!;
  const actor = { kind: "agent", id: input.agentId } as const;
  await emitEvent(db, { businessId: input.businessId, type: "site.release_created", actor, payload: { siteId: site.id, releaseId: release.id, number: release.number, taskId: input.taskId, fileCount: release.fileCount, totalBytes: release.totalBytes, state: release.state as "preview" | "held", previewUrl } }, { idempotencyKey: `site.release_created:${release.id}` });
  if (previewUrl) {
    await emitEvent(db, { businessId: input.businessId, type: "deploy.succeeded", actor, payload: { taskId: input.taskId, environment: "preview", provider: "foundmill", url: previewUrl, commitSha: release.contentHash, branch: null, durationMs: null } }, { idempotencyKey: `deploy.preview:${release.id}` });
    await repos.sites.writeReadyNote(db, input.businessId, { agentId: input.agentId, agentName: input.agentName, previewUrl });
  }
  return { status: "release", release, flags };
}

/** The sentence a held release leaves for the next session (the task's block detail). */
export const heldReleaseNote = (flags: readonly SiteFlag[]): string => `${siteHeldSentence(flags)} Fix: ${flags.slice(0, 5).map((f) => `${f.path || "the site"}: ${f.detail}`).join("; ")}.`;
