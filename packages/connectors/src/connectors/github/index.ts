/**
 * Live GitHub connector over `@octokit/app` 16 + `@octokit/rest` 22. Two ways to authenticate a call:
 * the gateway may inject an installation token as `ctx.credential.secret` (minted elsewhere), otherwise the
 * App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY) mints one for `integration.externalAccountId` (the
 * installation id). Webhooks verify with GITHUB_WEBHOOK_SECRET.
 *
 * Connecting proves ownership: GitHub sends the installer back with an installation id and an OAuth code (the App has
 * "Request user authorization (OAuth) during installation" on); connect() trades the code for a user token
 * (GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET) and accepts the installation only when that user owns its account
 * or is an active admin of its organization (the App's "Members: read" organization permission). It runs in the
 * gateway, the one service holding the App's keys, which records the verified installation (`app_installations`).
 */
import { isUtf8 } from "node:buffer";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { ForbiddenError, uuid, ValidationError } from "@foundmill/shared";
import { ConfigError, type Connector, type IntegrationRecord, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { githubMock } from "./mock";
import { branchMoved } from "./moved";
import { archiveTooLargeMessage, ciState, CI_WORKFLOW, COMPARE_FILE_PAGES, COMPARE_FILES_PER_PAGE, fileWriteBuffer, MAX_ARCHIVE_BYTES, githubChangedMessage, gitBlobSha, GITHUB_APP_SCOPES, GITHUB_KEY, GITHUB_RATE_LIMITS, githubTools, mapCheckRun, mapCompareFile, mapPullRequest, mapRepository, mapTreeEntry, MAX_FILE_BYTES, MAX_TREE_ENTRIES, type GhCheckRun, type GhCompareFile, type GhPullRequest, type GhRepository } from "./tools";
import { createGithubWebhook } from "./webhooks";

type RestOctokit = InstanceType<typeof Octokit>;
/** The parts of GitHub's installation object connecting reads. */
interface GhInstallation {
  account: { login?: string; slug?: string; id?: number; type?: string } | null;
  permissions?: Record<string, string>;
  repository_selection?: string;
}

/** The host's signed install state (apps/api services/install-state.ts): two base64url parts. */
const INSTALL_STATE = /^[A-Za-z0-9_-]{1,400}\.[A-Za-z0-9_-]{1,100}$/;
/** GitHub's OAuth codes are short hex strings; anything else is refused before it reaches GitHub. */
const OAUTH_CODE = /^[A-Za-z0-9_-]{1,100}$/;
/** How long one request to GitHub may take. */
const GITHUB_REQUEST_TIMEOUT_MS = 60_000;

/** Check runs read per branch head: 100 a page, at most 5 pages (a head with more is never reported as a success). */
const CHECKS_PER_PAGE = 100;
const MAX_CHECK_PAGES = 5;

/** commit_files calls one gateway process runs at once. */
const MAX_CONCURRENT_COMMITS = 4;

/** Text a tree entry can carry inline: valid UTF-8 with no NUL byte. */
const isText = (bytes: Buffer): boolean => isUtf8(bytes) && !bytes.includes(0);

/** commit_files calls that may wait for a slot, and for how long, before the gateway answers "busy". */
const MAX_WAITING_COMMITS = 16;
const COMMIT_WAIT_MS = 60_000;

const busy = () => Object.assign(new Error("GitHub pushes are busy on this gateway; the next session pushes this code"), { status: 503 });

/**
 * A counting semaphore: at most `size` runs at once, at most `maxWaiting` wait (in order, each for at most `waitMs`);
 * beyond that a call fails at once instead of holding its request body in memory.
 */
export function slots(size: number, maxWaiting = MAX_WAITING_COMMITS, waitMs = COMMIT_WAIT_MS): { run<T>(fn: () => Promise<T>): Promise<T> } {
  let active = 0;
  const waiting: { resolve: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
  return {
    async run(fn) {
      // A released slot passes straight to the next waiter, so a newcomer can never slip in between.
      if (active < size) active++;
      else {
        if (waiting.length >= maxWaiting) throw busy();
        await new Promise<void>((resolve, reject) => {
          const entry = {
            resolve: () => {
              clearTimeout(entry.timer);
              resolve();
            },
            timer: setTimeout(() => {
              waiting.splice(waiting.indexOf(entry), 1);
              reject(busy());
            }, waitMs),
          };
          waiting.push(entry);
        });
      }
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next) next.resolve();
        else active--;
      }
    },
  };
}

/** How long one archive download may take (up to 60 MB from codeload). */
const ARCHIVE_TIMEOUT_MS = 180_000;

/** A response body (a web stream, a Node stream, bytes or text) read into memory, refused past `max` bytes. */
export async function readCapped(body: unknown, max: number, fullName: string): Promise<Buffer> {
  const tooLarge = () => Object.assign(new Error(archiveTooLargeMessage(fullName)), { status: 413 });
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const b = body instanceof ArrayBuffer ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (b.length > max) throw tooLarge();
    return b;
  }
  if (typeof body === "string") throw Object.assign(new Error("GitHub answered the archive request with text, not an archive"), { status: 502 });
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") throw Object.assign(new Error("GitHub sent no archive"), { status: 502 });
  const chunks: Buffer[] = [];
  let total = 0;
  const iterator = (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > max) throw tooLarge();
      chunks.push(Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength));
    }
  } catch (e) {
    await iterator.return?.().catch(() => undefined);
    throw e;
  }
  return Buffer.concat(chunks, total);
}

/** Installations listed per user while checking ownership (100 per page). */
const MAX_INSTALLATION_PAGES = 10;

export function createGithubConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch: baseFetch, now, resolveBusinessId } = resolveLiveOptions(options);
  // Every GitHub request gives up after a minute, so a hung call never holds a commit slot.
  const fetch: typeof globalThis.fetch = (input, init) => baseFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS) });
  const OctokitWithFetch = Octokit.defaults({ request: { fetch }, userAgent: "foundmill-connectors/0.1" });

  const app = (): App => {
    if (!secrets.githubAppId || !secrets.githubAppPrivateKey) throw new ConfigError(GITHUB_KEY, "GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY", "create the GitHub App and paste its id and private key");
    return new App({ appId: secrets.githubAppId, privateKey: secrets.githubAppPrivateKey, Octokit: OctokitWithFetch as unknown as NonNullable<ConstructorParameters<typeof App>[0]["Octokit"]> });
  };

  const installationIdOf = (integration: IntegrationRecord): number => {
    const raw = integration.externalAccountId ?? (integration.config as { installationId?: unknown }).installationId;
    const id = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(id)) throw new ConfigError(GITHUB_KEY, "installation id", "connect the GitHub App installation for this business");
    return id;
  };

  /** Octokit for one business: injected installation token first, App-minted token otherwise. */
  const octokitFor = async (ctx: ToolContext): Promise<RestOctokit> => {
    if (ctx.credential?.secret) return new OctokitWithFetch({ auth: ctx.credential.secret });
    return (await app().getInstallationOctokit(installationIdOf(ctx.integration))) as unknown as RestOctokit;
  };

  /**
   * Who may connect an installation: trades the authorization code GitHub sent after the installation for a user token
   * and accepts the installation only when that user owns its account (a personal installation) or is an active admin
   * of its organization. Being listed in `/user/installations` is not enough: GitHub lists an installation for anyone
   * with access to one of its repositories (collaborators, org members). The token is revoked afterwards, never stored.
   */
  const installerOf = async (installationId: number, code: string): Promise<{ login: string; installation: GhInstallation }> => {
    if (!secrets.githubAppClientId || !secrets.githubAppClientSecret) throw new ConfigError(GITHUB_KEY, "GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET", "copy the GitHub App's client id and a client secret so connecting can check who installed it");
    const clientId = secrets.githubAppClientId;
    const clientSecret = secrets.githubAppClientSecret;
    const exchanged = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }) });
    const body = (await exchanged.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
    if (!exchanged.ok || typeof body.access_token !== "string") throw new ForbiddenError(`GitHub did not accept the authorization${typeof body.error === "string" ? ` (${body.error})` : ""}: install the App again from Settings › Integrations`);
    const token = body.access_token;
    try {
      const user = new OctokitWithFetch({ auth: token });
      let listed = false;
      for (let page = 1; page <= MAX_INSTALLATION_PAGES && !listed; page++) {
        const list = await user.rest.apps.listInstallationsForAuthenticatedUser({ per_page: 100, page });
        listed = list.data.installations.some((i) => i.id === installationId);
        if (list.data.installations.length < 100) break;
      }
      if (!listed) throw new ForbiddenError(`GitHub installation ${installationId} is not one you can manage`);
      const me = (await user.rest.users.getAuthenticated()).data;
      const installation = (await (app().octokit as unknown as RestOctokit).rest.apps.getInstallation({ installation_id: installationId })).data as GhInstallation;
      const account = installation.account;
      if (account?.type === "User") {
        if (account.id !== me.id) throw new ForbiddenError(`GitHub installation ${installationId} belongs to ${account.login ?? "another account"}; only that account can connect it`);
      } else if (account?.type === "Organization" && account.login) {
        const membership = await user.rest.orgs.getMembershipForAuthenticatedUser({ org: account.login }).then(
          (r) => r.data,
          () => null,
        );
        if (membership?.state !== "active" || membership.role !== "admin") throw new ForbiddenError(`Only an owner of the ${account.login} organization on GitHub can connect its installation`);
      } else {
        throw new ForbiddenError(`GitHub installation ${installationId} is not on a user or organization account`);
      }
      return { login: me.login, installation };
    } finally {
      // Best effort: the token has done its job.
      await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, { method: "DELETE", headers: { accept: "application/vnd.github+json", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/json" }, body: JSON.stringify({ access_token: token }) }).catch(() => undefined);
    }
  };

  /** commit_files calls this process runs at once (each can hold up to 10 MB); the rest wait their turn. */
  const commitSlots = slots(MAX_CONCURRENT_COMMITS);

  const defaultBranch = async (o: RestOctokit, owner: string, repo: string) => (await o.rest.repos.get({ owner, repo })).data.default_branch;
  const refSha = async (o: RestOctokit, owner: string, repo: string, ref: string): Promise<string> => {
    if (ref === "HEAD") ref = await defaultBranch(o, owner, repo);
    const res = await o.rest.repos.getCommit({ owner, repo, ref, mediaType: { format: "sha" } });
    return typeof res.data === "string" ? res.data : res.data.sha;
  };

  /** The sha of the `.github` entry in a branch's root tree, or null when the root has none. */
  const githubTreeSha = async (o: RestOctokit, owner: string, repo: string, ref: string): Promise<string | null> => {
    const commit = (await o.rest.repos.getCommit({ owner, repo, ref })).data;
    const root = await o.rest.git.getTree({ owner, repo, tree_sha: commit.commit.tree.sha });
    return root.data.tree.find((e) => e.path === ".github")?.sha ?? null;
  };

  return buildLiveConnector(
    {
      key: GITHUB_KEY,
      displayName: "GitHub",
      phase: 1,
      auth: { kind: "app", scopes: GITHUB_APP_SCOPES },
      tools: githubTools,
      rateLimits: GITHUB_RATE_LIMITS,
      now,
      webhooks: [createGithubWebhook({ secret: secrets.githubWebhookSecret ?? null, resolveBusinessId, now })],
      handlers: {
        list_repos: async ({ perPage, page }, ctx) => {
          const res = await (await octokitFor(ctx)).rest.apps.listReposAccessibleToInstallation({ per_page: perPage, page });
          return { items: (res.data.repositories as GhRepository[]).map(mapRepository), totalCount: res.data.total_count };
        },
        read_tree: async ({ owner, repo, ref, path, recursive }, ctx) => {
          const o = await octokitFor(ctx);
          let treeSha = await refSha(o, owner, repo, ref);
          if (path) {
            const sub = await o.rest.repos.getContent({ owner, repo, path, ref: treeSha });
            if (!Array.isArray(sub.data)) throw Object.assign(new Error(`${path} is not a directory`), { status: 422 });
            // The directory listing does not carry the subtree sha; resolve it from the parent tree.
            const parentPath = path.replace(/\/$/, "").split("/").slice(0, -1).join("/");
            const name = path.replace(/\/$/, "").split("/").pop();
            const parent = await o.rest.repos.getContent({ owner, repo, path: parentPath, ref: treeSha });
            const dir = Array.isArray(parent.data) ? parent.data.find((e) => e.name === name && e.type === "dir") : undefined;
            if (!dir) throw Object.assign(new Error(`${path} not found`), { status: 404 });
            treeSha = dir.sha;
          }
          const tree = await o.rest.git.getTree({ owner, repo, tree_sha: treeSha, ...(recursive ? { recursive: "1" } : {}) });
          const entries = tree.data.tree.map(mapTreeEntry).filter((e): e is NonNullable<typeof e> => e !== null);
          return { sha: tree.data.sha, truncated: Boolean(tree.data.truncated) || entries.length > MAX_TREE_ENTRIES, entries: entries.slice(0, MAX_TREE_ENTRIES) };
        },
        read_file: async ({ owner, repo, path, ref }, ctx) => {
          const o = await octokitFor(ctx);
          const res = await o.rest.repos.getContent({ owner, repo, path, ...(ref === "HEAD" ? {} : { ref }) });
          if (Array.isArray(res.data) || res.data.type !== "file") throw Object.assign(new Error(`${path} is not a file`), { status: 422 });
          if (res.data.size > MAX_FILE_BYTES) throw Object.assign(new Error(`${path} is ${res.data.size} bytes; the limit is ${MAX_FILE_BYTES}`), { status: 413 });
          const raw = Buffer.from(res.data.content ?? "", "base64");
          const text = raw.toString("utf8");
          const binary = text.includes("�");
          return { path, sha: res.data.sha, size: res.data.size, encoding: binary ? ("base64" as const) : ("utf-8" as const), content: binary ? raw.toString("base64") : text, url: res.data.html_url ?? null };
        },
        compare_refs: async ({ owner, repo, base, head }, ctx) => {
          const o = await octokitFor(ctx);
          const baseRef = base === "HEAD" ? await defaultBranch(o, owner, repo) : base;
          // GitHub answers 404 for a ref that names no commit on either side.
          const notThere = (e: { status?: number }) => Promise.reject(e.status === 404 || e.status === 422 ? Object.assign(new Error(`ref ${baseRef} or ${head} not found in ${owner}/${repo}`), { status: 404 }) : e);
          interface GhCompare { merge_base_commit: { sha: string }; base_commit: { sha: string }; ahead_by: number; behind_by: number; files?: GhCompareFile[]; commits: { sha: string }[] }
          const files: GhCompareFile[] = [];
          let truncated = false;
          let first: GhCompare | null = null;
          let headSha = "";
          for (let page = 1; page <= COMPARE_FILE_PAGES; page++) {
            const res = await o.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${baseRef}...${head}`, per_page: COMPARE_FILES_PER_PAGE, page }).catch(notThere);
            const data = res.data as unknown as GhCompare;
            if (!first) first = data;
            if (!headSha) headSha = data.commits.at(-1)?.sha ?? "";
            const got = data.files ?? [];
            files.push(...got);
            if (got.length < COMPARE_FILES_PER_PAGE) break;
            if (page === COMPARE_FILE_PAGES) truncated = true;
          }
          const summary: GhCompare = first!;
          const mergeBaseSha = summary.merge_base_commit.sha;
          return { mergeBaseSha, baseSha: summary.base_commit.sha, headSha: headSha || mergeBaseSha, aheadBy: summary.ahead_by, behindBy: summary.behind_by, files: files.map(mapCompareFile).filter((f): f is NonNullable<typeof f> => f !== null), truncated };
        },
        download_archive: async ({ owner, repo, ref }, ctx) => {
          const o = await octokitFor(ctx);
          const info = (await o.rest.repos.get({ owner, repo })).data;
          // What agents work from stays in repositories the founder controls access to, as with every write.
          if (!info.private) throw Object.assign(new Error(`${owner}/${repo} is public; code sessions check out only private repositories`), { status: 422 });
          const name = ref === "HEAD" ? info.default_branch : ref;
          // GitHub answers 422 for a ref that names no commit; either way the ref is not there.
          const sha = await refSha(o, owner, repo, name).catch((e: { status?: number }) => Promise.reject(e.status === 404 || e.status === 422 ? Object.assign(new Error(`ref ${name} not found in ${owner}/${repo}`), { status: 404 }) : e));
          // The tarball of the resolved commit, so the archive and the sha always agree. GitHub redirects to codeload;
          // the body is read as a stream and given up past the cap.
          const res = await o.request("GET /repos/{owner}/{repo}/tarball/{ref}", { owner, repo, ref: sha, request: { parseSuccessResponseBody: false, signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) } });
          const declared = Number((res.headers as Record<string, string | undefined>)["content-length"] ?? Number.NaN);
          if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) throw Object.assign(new Error(archiveTooLargeMessage(`${owner}/${repo}`)), { status: 413 });
          const archive = await readCapped(res.data as unknown, MAX_ARCHIVE_BYTES, `${owner}/${repo}`);
          // The bytes themselves, never base64: the gateway hashes them and sends them on as they are.
          return { ref: name, sha, bytes: archive.length, archive };
        },
        get_repository: async ({ owner, repo }, ctx) => mapRepository((await (await octokitFor(ctx)).rest.repos.get({ owner, repo })).data as GhRepository),
        create_branch: async ({ owner, repo, branch, fromRef }, ctx) => {
          const o = await octokitFor(ctx);
          const existing = await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
          if (existing) return { branch, sha: existing.data.object.sha, created: false };
          const sha = await refSha(o, owner, repo, fromRef ?? "HEAD");
          const created = await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha });
          return { branch, sha: created.data.object.sha, created: true };
        },
        commit_files: ({ owner, repo, branch, fromRef, message, files, deletions, expectedHeadSha }, ctx) =>
          commitSlots.run(async () => {
            const o = await octokitFor(ctx);
            const info = (await o.rest.repos.get({ owner, repo })).data;
            if (branch === info.default_branch) throw Object.assign(new Error(`commit_files never writes the default branch (${branch}); merge a pull request instead`), { status: 422 });
            // What agents write can name customers or carry business data: it goes only where the founder controls access.
            if (!info.private) throw Object.assign(new Error(`${owner}/${repo} is public; agents push only to private repositories`), { status: 422 });
            const existing = await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
            // The caller's changes are based on a head the branch no longer has: nothing is written over the other commits.
            if (existing && expectedHeadSha && existing.data.object.sha !== expectedHeadSha) throw branchMoved(branch, expectedHeadSha, existing.data.object.sha);
            const parentSha = existing ? existing.data.object.sha : await refSha(o, owner, repo, fromRef ?? info.default_branch);
            const baseTree = (await o.rest.git.getCommit({ owner, repo, commit_sha: parentSha })).data.tree.sha;
            // What the branch holds now, so unchanged files are not uploaded and only existing paths are deleted.
            const current = await o.rest.git.getTree({ owner, repo, tree_sha: baseTree, recursive: "1" });
            const known = current.data.truncated ? null : new Map(current.data.tree.filter((e) => e.type === "blob" && e.path && e.sha).map((e) => [e.path!, e.sha!] as const));
            const writes = files.map((f) => ({ path: f.path, bytes: fileWriteBuffer(f) })).filter((f) => known?.get(f.path) !== gitBlobSha(f.bytes));
            const removals = known ? deletions.filter((d) => known.has(d)) : deletions;
            const result = (sha: string, committed: boolean, url: string | null) => ({ branch, created: !existing, committed, sha, parentSha, filesWritten: committed ? writes.length : 0, filesDeleted: committed ? removals.length : 0, url });
            if (writes.length === 0 && removals.length === 0) {
              if (!existing) await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: parentSha });
              return result(parentSha, false, null);
            }
            // Text goes inline in the tree (one request however many files); only binary files need a blob each.
            type Entry = { path: string; mode: "100644"; type: "blob" } & ({ content: string } | { sha: string | null });
            const entries: Entry[] = writes.filter((f) => isText(f.bytes)).map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.bytes.toString("utf8") }));
            const binary = writes.filter((f) => !isText(f.bytes));
            let next = 0;
            const upload = async () => {
              while (next < binary.length) {
                const f = binary[next++]!;
                const blob = await o.rest.git.createBlob({ owner, repo, content: f.bytes.toString("base64"), encoding: "base64" });
                entries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.data.sha });
              }
            };
            await Promise.all(Array.from({ length: Math.min(4, binary.length) }, upload));
            for (const d of removals) entries.push({ path: d, mode: "100644", type: "blob", sha: null });
            const tree = await o.rest.git.createTree({ owner, repo, base_tree: baseTree, tree: entries });
            if (tree.data.sha === baseTree) {
              if (!existing) await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: parentSha });
              return result(parentSha, false, null);
            }
            const commit = await o.rest.git.createCommit({ owner, repo, message, tree: tree.data.sha, parents: [parentSha] });
            // Fast-forward only: if the branch moved since it was read, GitHub refuses and nothing is overwritten (with
            // expectedHeadSha the refusal is the typed branch_moved).
            if (existing)
              await o.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false }).catch(async (e: { status?: number }) => {
                if (expectedHeadSha && e.status === 422) {
                  const now = await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }).then((r) => r.data.object.sha, () => null);
                  if (now && now !== parentSha) throw branchMoved(branch, expectedHeadSha, now);
                }
                throw e;
              });
            else await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
            return result(commit.data.sha, true, commit.data.html_url ?? `${info.html_url}/commit/${commit.data.sha}`);
          }),
        run_checks: async ({ owner, repo, branch }, ctx) => {
          const o = await octokitFor(ctx);
          const info = (await o.rest.repos.get({ owner, repo })).data;
          if (branch === info.default_branch) throw Object.assign(new Error(`run_checks never runs the default branch (${branch}); it runs an agent's working branch`), { status: 422 });
          // Same rule as commit_files: what agents work on stays in repositories the founder controls access to.
          if (!info.private) throw Object.assign(new Error(`${owner}/${repo} is public; agents push only to private repositories`), { status: 422 });
          // GitHub answers 204 (older API) or 200 with the run id (newer); any 2xx means the run was queued, and a missing branch, a missing ci.yml or one without `workflow_dispatch` is a 404/422 that surfaces as the tool error.
          // GitHub runs the copy of ci.yml on the dispatched ref, with the repository's secrets: it must be the default branch's copy.
          // `.github` (workflows and local actions) has to be the very same tree on both; a tree on one side only counts as a difference.
          const [onBranch, onDefault] = [await githubTreeSha(o, owner, repo, branch), await githubTreeSha(o, owner, repo, info.default_branch)];
          if (onBranch !== onDefault) throw Object.assign(new Error(githubChangedMessage(branch)), { status: 422 });
          await o.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: CI_WORKFLOW, ref: `refs/heads/${branch}` });
          return { dispatched: true as const, branch, workflow: CI_WORKFLOW };
        },
        get_checks: async ({ owner, repo, branch }, ctx) => {
          const o = await octokitFor(ctx);
          const headSha = (await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })).data.object.sha;
          const runs: GhCheckRun[] = [];
          let total = 0;
          for (let page = 1; page <= MAX_CHECK_PAGES; page++) {
            const res = await o.rest.checks.listForRef({ owner, repo, ref: headSha, per_page: CHECKS_PER_PAGE, page });
            total = res.data.total_count;
            runs.push(...res.data.check_runs);
            if (res.data.check_runs.length < CHECKS_PER_PAGE || runs.length >= total) break;
          }
          const checks = runs.map(mapCheckRun);
          // Check runs from other workflows or apps can be green before CI has run on this head: the CI workflow's own newest run decides first.
          const ci = (await o.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: CI_WORKFLOW, head_sha: headSha, per_page: 1 })).data.workflow_runs[0];
          return { headSha, state: ciState(ci, checks, runs.length >= total), checks };
        },
        open_pr: async ({ owner, repo, title, body, head, base: givenBase, draft }, ctx) => {
          const o = await octokitFor(ctx);
          const base = givenBase === "HEAD" ? await defaultBranch(o, owner, repo) : givenBase;
          const open = await o.rest.pulls.list({ owner, repo, state: "open", head: `${owner}:${head}`, base, per_page: 1 });
          if (open.data[0]) return mapPullRequest((await o.rest.pulls.get({ owner, repo, pull_number: open.data[0].number })).data as GhPullRequest);
          const res = await o.rest.pulls.create({ owner, repo, title, body, head, base, draft });
          return mapPullRequest(res.data as GhPullRequest);
        },
        get_pull_request: async ({ owner, repo, prNumber }, ctx) => mapPullRequest((await (await octokitFor(ctx)).rest.pulls.get({ owner, repo, pull_number: prNumber })).data as GhPullRequest),
        list_pull_requests: async ({ owner, repo, state, perPage }, ctx) => ({ items: ((await (await octokitFor(ctx)).rest.pulls.list({ owner, repo, state, per_page: perPage, sort: "created", direction: "desc" })).data as GhPullRequest[]).map(mapPullRequest) }),
        merge_pr: async ({ owner, repo, prNumber, mergeMethod, commitTitle, commitMessage }, ctx) => {
          const res = await (await octokitFor(ctx)).rest.pulls.merge({ owner, repo, pull_number: prNumber, merge_method: mergeMethod, commit_title: commitTitle, commit_message: commitMessage });
          if (!res.data.merged) throw Object.assign(new Error(res.data.message || "merge refused"), { status: 405 });
          return { merged: true as const, sha: res.data.sha, prNumber, message: res.data.message };
        },
      },
      connect: async (businessId, input) => {
        const given = (typeof input === "object" && input ? input : {}) as { installationId?: unknown; code?: unknown; state?: unknown };
        const installationId = Number(given.installationId);
        if (given.installationId === undefined) {
          // First step: the founder installs the App on GitHub (a consent only they can give). The host signs `state`
          // for this founder and business; GitHub hands it back with the installation id and an authorization code.
          if (!secrets.githubAppSlug) throw new ConfigError(GITHUB_KEY, "GITHUB_APP_SLUG", "set the GitHub App's URL name so Connect can open its installation page");
          if (typeof given.state !== "string" || !INSTALL_STATE.test(given.state)) throw new ValidationError("Connecting GitHub needs a signed state from the api");
          const createdAt = now().toISOString();
          const installUrl = `https://github.com/apps/${encodeURIComponent(secrets.githubAppSlug)}/installations/new?state=${encodeURIComponent(given.state)}`;
          return { id: uuid(), businessId, connectorKey: GITHUB_KEY, status: "disconnected", scopes: [], accountLabel: null, externalAccountId: null, config: { consentUrl: installUrl }, credentialRef: null, expiresAt: null, lastHealthAt: null, createdAt };
        }
        if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new ValidationError("installationId must be a positive integer");
        // The App's own key can read every installation of the App, whoever owns it, so an id alone proves nothing.
        // The authorization code GitHub sends after installing names the person who installed it; the installation
        // must be one they can administer.
        if (typeof given.code !== "string" || !OAUTH_CODE.test(given.code)) throw new ValidationError("GitHub did not send an authorization code: install the App again from Settings › Integrations");
        const { login: verifiedBy, installation } = await installerOf(installationId, given.code);
        const label = installation.account?.login ?? installation.account?.slug ?? `installation ${installationId}`;
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: GITHUB_KEY, status: "connected", scopes: Object.entries(installation.permissions ?? {}).map(([k, v]) => `${k}:${v}`), accountLabel: label, externalAccountId: String(installationId), config: { installationId, account: label, repositorySelection: installation.repository_selection, verifiedBy, verifiedAt: createdAt }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        try {
          const o = (await app().getInstallationOctokit(installationIdOf(integration))) as unknown as RestOctokit;
          const res = await o.rest.apps.listReposAccessibleToInstallation({ per_page: 1 });
          return healthResult("connected", startedAt, { now, details: { repositories: res.data.total_count } });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    githubMock,
  );
}

export { branchMoved } from "./moved";
export { githubMock, createGithubMock, signedDeliveryRequest, mergedPullRequestPayload } from "./mock";
export { githubTools, GITHUB_KEY } from "./tools";
export { createGithubWebhook, githubSignature, normaliseGithubEvent } from "./webhooks";
