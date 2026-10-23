import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { commitSha, fileSha, GH_MERGED_PR, GH_REPOS, MOCK_GITHUB_WEBHOOK_SECRET, MOCK_INSTALLATION_ID, MOCK_OWNER, type GhFixtureRepo } from "./fixtures/repos";
import { writeTarGz } from "./tarball";
import { branchMoved } from "./moved";
import { ciState, CI_WORKFLOW, fileWriteBuffer, githubChangedMessage, GITHUB_APP_SCOPES, GITHUB_KEY, GITHUB_RATE_LIMITS, githubTools, mapCheckRun, mapPullRequest, mapRepository, MAX_TREE_ENTRIES, type GhCheckRun, type GhPullRequest, type GhWorkflowRun, type PullRequestT } from "./tools";
import { createGithubWebhook, GITHUB_DELIVERY_HEADER, GITHUB_EVENT_HEADER, GITHUB_SIGNATURE_HEADER, githubSignature, normaliseGithubEvent, type GhWebhookPayload } from "./webhooks";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });
const conflict = (msg: string) => Object.assign(new Error(msg), { status: 409 });

/** Build a correctly signed GitHub delivery (tests and `simulate`). */
export function signedDeliveryRequest(businessId: string, event: string, payload: GhWebhookPayload, opts: { secret?: string; deliveryId?: string } = {}): Request {
  const body = JSON.stringify(payload);
  const deliveryId = opts.deliveryId ?? stableHash(["gh-delivery", event, body], 32);
  return makeWebhookRequest(`https://ingest.example/webhooks/${GITHUB_KEY}/${businessId}`, body, {
    "content-type": "application/json",
    [GITHUB_SIGNATURE_HEADER]: githubSignature(opts.secret ?? MOCK_GITHUB_WEBHOOK_SECRET, body),
    [GITHUB_DELIVERY_HEADER]: deliveryId,
    [GITHUB_EVENT_HEADER]: event,
  });
}

export function mergedPullRequestPayload(pr: GhPullRequest = GH_MERGED_PR, repo = GH_REPOS[0]!.repo): GhWebhookPayload {
  return { action: "closed", installation: { id: MOCK_INSTALLATION_ID }, repository: { full_name: repo.full_name, default_branch: repo.default_branch }, sender: { login: "reidjxn" }, pull_request: pr };
}

const blobShaOf = (path: string, content: Buffer) => stableHash(`blob:${path}:${content.toString("base64")}`, 40);

/**
 * What a repository the fixtures do not know holds on its default branch: a package.json and a couple of files, kept
 * small (under 100 bytes) so the byte budgets below stay about what agents write.
 */
export function starterFiles(repo: string): GhFixtureRepo["files"] {
  const name = repo.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 40);
  return [
    { path: "README.md", content: `# ${name}\n` },
    { path: "package.json", content: `{"name":"${name}","private":true}\n` },
    { path: "src/index.ts", content: "export {};\n" },
  ];
}

/** One business's GitHub: the fixture repositories (copied), repositories it created, branch contents and pull requests. */
function newWorld(bytesPerBusiness: number, publicRepos: ReadonlySet<string>) {
  const repos = new Map<string, GhFixtureRepo>(GH_REPOS.map((r) => [r.repo.full_name, { ...r, repo: publicRepos.has(r.repo.full_name) ? { ...r.repo, private: false } : r.repo, branches: { ...r.branches }, files: [...r.files] }]));
  /** `owner/repo@branch` → the head sha `run_checks` last dispatched CI on (the checks below exist only for that exact head). */
  const dispatched = new Map<string, string>();
  /** `owner/repo@branch` → path → bytes, for branches with their own commits (oldest written first). */
  const trees = new Map<string, Map<string, Buffer>>();
  let stored = 0;
  const treeKey = (r: GhFixtureRepo, branch: string) => `${r.repo.full_name}@${branch}`;
  const sizeOf = (t: Map<string, Buffer>) => [...t.values()].reduce((n, b) => n + b.byteLength, 0);
  const pulls = new Map<string, GhPullRequest[]>([[GH_REPOS[0]!.repo.full_name, [structuredClone(GH_MERGED_PR)]]]);

  const find = (owner: string, repo: string): GhFixtureRepo => {
    const r = repos.get(`${owner}/${repo}`);
    if (!r) throw notFound(`repository ${owner}/${repo}`);
    return r;
  };
  const resolveRef = (r: GhFixtureRepo, ref: string): string => {
    if (ref === "HEAD") return r.branches[r.repo.default_branch]!;
    const sha = r.branches[ref] ?? r.branches[ref.replace(/^refs\/heads\//, "")];
    if (sha) return sha;
    if (/^[0-9a-f]{7,40}$/.test(ref) && Object.values(r.branches).some((s) => s.startsWith(ref))) return ref;
    throw notFound(`ref ${ref} in ${r.repo.full_name}`);
  };
  const prList = (fullName: string) => pulls.get(fullName) ?? pulls.set(fullName, []).get(fullName)!;
  /** The branch a ref names (HEAD → default), or null for a commit sha. */
  const branchOf = (r: GhFixtureRepo, ref: string): string | null => {
    if (ref === "HEAD") return r.repo.default_branch;
    const name = ref.replace(/^refs\/heads\//, "");
    return r.branches[name] ? name : null;
  };
  const ownTree = (r: GhFixtureRepo, ref: string) => {
    const branch = branchOf(r, ref);
    return branch ? trees.get(treeKey(r, branch)) : undefined;
  };
  /** Files at a ref: a branch's own commits, else the repository's fixture files. */
  const filesAt = (r: GhFixtureRepo, ref: string): Map<string, Buffer> => ownTree(r, ref) ?? new Map(r.files.map((f) => [f.path, Buffer.from(f.content, "utf8")] as const));
  /** Record a branch's contents; past the byte budget the oldest written branches disappear. */
  const setTree = (r: GhFixtureRepo, branch: string, tree: Map<string, Buffer>) => {
    const key = treeKey(r, branch);
    const old = trees.get(key);
    if (old) {
      stored -= sizeOf(old);
      trees.delete(key);
    }
    trees.set(key, tree);
    stored += sizeOf(tree);
    while (stored > bytesPerBusiness && trees.size > 1) {
      const [oldestKey, oldest] = trees.entries().next().value!;
      trees.delete(oldestKey);
      stored -= sizeOf(oldest);
      const at = oldestKey.lastIndexOf("@");
      const owner = repos.get(oldestKey.slice(0, at));
      if (owner) delete owner.branches[oldestKey.slice(at + 1)];
    }
  };
  const findOrCreate = (owner: string, repo: string): GhFixtureRepo => {
    const existing = repos.get(`${owner}/${repo}`);
    if (existing) return existing;
    const created: GhFixtureRepo = {
      repo: { id: 900_000_000 + (parseInt(stableHash(`repo:${owner}/${repo}`, 6), 16) % 99_999_999), full_name: `${owner}/${repo}`, name: repo, private: true, default_branch: "main", description: null, html_url: `https://github.com/${owner}/${repo}`, pushed_at: null, language: null, owner: { login: owner } },
      branches: { main: commitSha(repo, "main") },
      files: starterFiles(repo),
    };
    repos.set(created.repo.full_name, created);
    return created;
  };
  /** Record a CI dispatch on a branch head; the oldest records go once a business holds more than MOCK_CI_DISPATCHES. */
  const recordDispatch = (r: GhFixtureRepo, branch: string, sha: string) => {
    const key = treeKey(r, branch);
    dispatched.delete(key);
    dispatched.set(key, sha);
    while (dispatched.size > MOCK_CI_DISPATCHES) dispatched.delete(dispatched.keys().next().value!);
  };
  const dispatchedSha = (r: GhFixtureRepo, branch: string) => dispatched.get(treeKey(r, branch));
  return { repos, find, resolveRef, prList, branchOf, ownTree, filesAt, setTree, findOrCreate, recordDispatch, dispatchedSha, bytes: () => stored };
}

/** CI dispatches one business's mock GitHub remembers. */
const MOCK_CI_DISPATCHES = 1_000;

/**
 * The fixed check runs a mock CI produces for a branch head once `run_checks` has dispatched it (`lint`, `typecheck`,
 * `test`, `e2e`): all succeed, except `test` fails when the mock is told the branch fails, and `e2e` is skipped. A head
 * `run_checks` has not dispatched has no check runs at all. Ids in the links derive from the head, so they are stable.
 */
export function mockCheckRuns(r: GhFixtureRepo, headSha: string, failing: boolean): GhCheckRun[] {
  const run = parseInt(stableHash(`run:${r.repo.full_name}:${headSha}`, 8), 16);
  const job = (name: string) => parseInt(stableHash(`job:${r.repo.full_name}:${headSha}:${name}`, 8), 16);
  const check = (name: string, conclusion: string): GhCheckRun => ({ name, status: "completed", conclusion, html_url: `${r.repo.html_url}/actions/runs/${run}/job/${job(name)}`, details_url: null });
  return [check("lint", "success"), check("typecheck", "success"), check("test", failing ? "failure" : "success"), check("e2e", "skipped")];
}

/**
 * What one business's mock GitHub may hold in files its agents wrote, what all of them may hold together (the least
 * recently used business is forgotten first), and how many businesses are kept at once.
 */
export const MOCK_BYTES_PER_BUSINESS = 20 * 1024 * 1024;
export const MOCK_BYTES_TOTAL = 100 * 1024 * 1024;
export const MOCK_BUSINESSES = 200;

/**
 * In-memory GitHub, one per business (what one business's agents write is never visible to another, and the fixture
 * repositories are copied for each). Branches from the fixtures share the repository's files; a branch `commit_files`
 * wrote to keeps its own contents, which `read_file` and `read_tree` show at that ref. The first write to a repository
 * the fixtures do not know creates it (`main`, with `starterFiles`), so mock mode works for whatever repository a business names.
 * Written files are bounded per business (the oldest written branches are dropped first) and the least recently used
 * businesses are forgotten beyond MOCK_BUSINESSES.
 */
export function createGithubMock(limits: { bytesPerBusiness?: number; bytesTotal?: number; businesses?: number; failingBranches?: readonly string[]; publicRepos?: readonly string[]; branchesWithChangedGithub?: readonly string[]; inaccessibleRepos?: readonly string[] } = {}) {
  const bytesTotal = limits.bytesTotal ?? MOCK_BYTES_TOTAL;
  const bytesPerBusiness = limits.bytesPerBusiness ?? MOCK_BYTES_PER_BUSINESS;
  const businesses = limits.businesses ?? MOCK_BUSINESSES;
  /** Branches whose mock CI fails (its `test` check concludes "failure"); every other branch passes. */
  const failingBranches = new Set(limits.failingBranches ?? []);
  /**
   * Branches whose `.github` tree differs from the default branch's (someone else pushed a workflow change there). Every
   * other branch shares the default branch's `.github`: `commit_files` refuses `.github` paths, so a commit through it
   * can never change the tree, and neither can this mock.
   */
  const changedGithub = new Set(limits.branchesWithChangedGithub ?? []);
  /** The sha of a branch's `.github` tree: the default branch's, unless the mock is told the branch changed it. */
  const githubTreeSha = (r: GhFixtureRepo, branch: string): string => stableHash(`github-tree:${r.repo.full_name}:${branch !== r.repo.default_branch && changedGithub.has(branch) ? branch : r.repo.default_branch}`, 40);
  /** Fixture repositories (`owner/name`) that are public; agents may not push to or run CI on them. */
  const publicRepos = new Set(limits.publicRepos ?? []);
  /** Repositories (`owner/name`, any case) the installation cannot reach: `get_repository` answers 404 for them. */
  const inaccessibleRepos = new Set((limits.inaccessibleRepos ?? []).map((r) => r.toLowerCase()));
  const worlds = new Map<string, ReturnType<typeof newWorld>>();
  const world = (businessId: string) => {
    let w = worlds.get(businessId);
    if (w) worlds.delete(businessId);
    else w = newWorld(bytesPerBusiness, publicRepos);
    worlds.set(businessId, w);
    while (worlds.size > businesses) worlds.delete(worlds.keys().next().value!);
    return w;
  };
  /** After a write: forget the least recently used other businesses until everything fits the total budget. */
  const fitTotal = (current: string) => {
    let total = [...worlds.values()].reduce((n, w) => n + w.bytes(), 0);
    for (const [key, w] of worlds) {
      if (total <= bytesTotal) break;
      if (key === current) continue;
      total -= w.bytes();
      worlds.delete(key);
    }
  };
  const webhook = createGithubWebhook({ secret: MOCK_GITHUB_WEBHOOK_SECRET, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });
  const toPr = (p: GhPullRequest): PullRequestT => mapPullRequest(p);

  const connector = buildMockConnector({
    key: GITHUB_KEY,
    displayName: "GitHub",
    phase: 1,
    auth: { kind: "app", scopes: GITHUB_APP_SCOPES },
    tools: githubTools,
    rateLimits: GITHUB_RATE_LIMITS,
    now: () => MOCK_NOW,
    webhooks: [webhook],
    handlers: {
      list_repos: async ({ perPage, page }, ctx) => {
        const g = world(ctx.businessId);
        const all = [...g.repos.values()].map((r) => mapRepository(r.repo));
        return { items: all.slice((page - 1) * perPage, page * perPage), totalCount: all.length };
      },
      read_tree: async ({ owner, repo, ref, path, recursive }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const sha = g.resolveRef(r, ref);
        const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
        const seen = new Map<string, { type: "blob" | "tree"; sha: string; size: number | null }>();
        const own = g.ownTree(r, ref);
        const listed = own ? [...own].map(([p, content]) => ({ path: p, sha: blobShaOf(p, content), size: content.byteLength })) : r.files.map((f) => ({ path: f.path, sha: fileSha(f), size: Buffer.byteLength(f.content) }));
        for (const f of listed) {
          if (!f.path.startsWith(prefix)) continue;
          const rest = f.path.slice(prefix.length);
          const parts = rest.split("/");
          if (recursive) {
            for (let i = 1; i < parts.length; i++) seen.set(parts.slice(0, i).join("/"), { type: "tree", sha: stableHash(`tree:${prefix}${parts.slice(0, i).join("/")}`, 40), size: null });
            seen.set(rest, { type: "blob", sha: f.sha, size: f.size });
          } else if (parts.length === 1) seen.set(rest, { type: "blob", sha: f.sha, size: f.size });
          else seen.set(parts[0]!, { type: "tree", sha: stableHash(`tree:${prefix}${parts[0]}`, 40), size: null });
        }
        if (path && seen.size === 0) throw notFound(`path ${path}`);
        const entries = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, e]) => ({ path: p, ...e }));
        return { sha: path ? stableHash(`tree:${prefix}`, 40) : sha, truncated: entries.length > MAX_TREE_ENTRIES, entries: entries.slice(0, MAX_TREE_ENTRIES) };
      },
      read_file: async ({ owner, repo, path, ref }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        g.resolveRef(r, ref);
        const content = g.filesAt(r, ref).get(path);
        if (!content) throw notFound(`file ${path}`);
        const text = content.toString("utf8");
        const binary = text.includes("\uFFFD");
        return { path, sha: blobShaOf(path, content), size: content.byteLength, encoding: binary ? ("base64" as const) : ("utf-8" as const), content: binary ? content.toString("base64") : text, url: `${r.repo.html_url}/blob/${ref === "HEAD" ? r.repo.default_branch : ref}/${path}` };
      },
      download_archive: async ({ owner, repo, ref }, ctx) => {
        const g = world(ctx.businessId);
        // Like the first write, the first checkout of a repository the fixtures do not know creates it (starter files).
        const r = g.findOrCreate(owner, repo);
        if (!r.repo.private) throw Object.assign(new Error(`${owner}/${repo} is public; code sessions check out only private repositories`), { status: 422 });
        const name = ref === "HEAD" ? r.repo.default_branch : ref;
        const sha = g.resolveRef(r, name);
        const files = [...g.filesAt(r, name)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, content]) => ({ path, content }));
        const archive = writeTarGz(files, { prefix: `${owner}-${repo}-${sha.slice(0, 7)}/`, comment: sha, mtime: MOCK_NOW.getTime() / 1000 });
        // `base64` is the deprecated copy for readers that do not take `archive` yet (a mock archive is a few hundred bytes).
        return { ref: name, sha, bytes: archive.length, archive, base64: archive.toString("base64") };
      },
      get_repository: async ({ owner, repo }, ctx) => {
        // Like a checkout, naming a repository the fixtures do not know creates it (private, with a stable id), unless the
        // mock is told the installation cannot reach it.
        if (inaccessibleRepos.has(`${owner}/${repo}`.toLowerCase())) throw notFound(`repository ${owner}/${repo}`);
        return mapRepository(world(ctx.businessId).findOrCreate(owner, repo).repo);
      },
      create_branch: async ({ owner, repo, branch, fromRef }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const existing = r.branches[branch];
        if (existing) return { branch, sha: existing, created: false };
        const sha = g.resolveRef(r, fromRef ?? "HEAD");
        r.branches[branch] = sha;
        return { branch, sha, created: true };
      },
      commit_files: async ({ owner, repo, branch, fromRef, message, files, deletions, expectedHeadSha }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.findOrCreate(owner, repo);
        if (branch === r.repo.default_branch) throw Object.assign(new Error(`commit_files never writes the default branch (${branch}); merge a pull request instead`), { status: 422 });
        if (!r.repo.private) throw Object.assign(new Error(`${owner}/${repo} is public; agents push only to private repositories`), { status: 422 });
        const existed = Boolean(r.branches[branch]);
        if (existed && expectedHeadSha && r.branches[branch] !== expectedHeadSha) throw branchMoved(branch, expectedHeadSha, r.branches[branch]!);
        const from = existed ? branch : (fromRef ?? "HEAD");
        const parentSha = g.resolveRef(r, from);
        const next = new Map(g.filesAt(r, from));
        let written = 0;
        for (const f of files) {
          const content = fileWriteBuffer(f);
          if (next.get(f.path)?.equals(content)) continue;
          next.set(f.path, content);
          written++;
        }
        let deleted = 0;
        for (const d of deletions) if (next.delete(d)) deleted++;
        if (written + deleted === 0) {
          if (!existed) {
            r.branches[branch] = parentSha;
            g.setTree(r, branch, next);
          }
          return { branch, created: !existed, committed: false, sha: parentSha, parentSha, filesWritten: 0, filesDeleted: 0, url: null };
        }
        // One branch never outgrows the business's budget (older branches give way to it, never the reverse).
        if ([...next.values()].reduce((n, b) => n + b.byteLength, 0) > bytesPerBusiness) throw Object.assign(new Error(`${branch} would hold more than the simulated GitHub keeps for one business (${Math.round(bytesPerBusiness / (1024 * 1024))} MB)`), { status: 413 });
        const sha = stableHash(`commit:${r.repo.full_name}:${branch}:${parentSha}:${message}:${[...next].map(([p, c]) => `${p}=${blobShaOf(p, c)}`).sort().join(",")}`, 40);
        r.branches[branch] = sha;
        g.setTree(r, branch, next);
        fitTotal(ctx.businessId);
        return { branch, created: !existed, committed: true, sha, parentSha, filesWritten: written, filesDeleted: deleted, url: `${r.repo.html_url}/commit/${sha}` };
      },
      run_checks: async ({ owner, repo, branch }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        if (branch === r.repo.default_branch) throw Object.assign(new Error(`run_checks never runs the default branch (${branch}); it runs an agent's working branch`), { status: 422 });
        if (!r.repo.private) throw Object.assign(new Error(`${owner}/${repo} is public; agents push only to private repositories`), { status: 422 });
        // The real tool dispatches `refs/heads/<branch>`; the mock resolves the same ref.
        const dispatchRef = `refs/heads/${branch}`;
        const dispatchBranch = g.branchOf(r, dispatchRef);
        const head = dispatchBranch ? r.branches[dispatchBranch] : undefined;
        if (!dispatchBranch || !head) throw Object.assign(new Error(`branch ${branch} does not exist in ${r.repo.full_name}`), { status: 422 });
        // GitHub runs the workflow file of the dispatched ref with the repository's secrets, so `.github` must be the default branch's.
        if (githubTreeSha(r, branch) !== githubTreeSha(r, r.repo.default_branch)) throw Object.assign(new Error(githubChangedMessage(branch)), { status: 422 });
        g.recordDispatch(r, dispatchBranch, head);
        return { dispatched: true as const, branch, workflow: CI_WORKFLOW };
      },
      get_checks: async ({ owner, repo, branch }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const headSha = r.branches[branch];
        if (!headSha) throw notFound(`branch ${branch} in ${r.repo.full_name}`);
        // Checks exist only for a head CI was dispatched on; a new commit on the branch starts again with none.
        const dispatched = g.dispatchedSha(r, branch) === headSha;
        const failing = failingBranches.has(branch);
        const checks = dispatched ? mockCheckRuns(r, headSha, failing).map(mapCheckRun) : [];
        // The mock's CI finishes the moment it is dispatched; before that (or on a head it was not dispatched on) there is no run.
        const run: GhWorkflowRun | null = dispatched ? { status: "completed", conclusion: failing ? "failure" : "success" } : null;
        return { headSha, state: ciState(run, checks), checks };
      },
      open_pr: async ({ owner, repo, title, body, head, base, draft }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const list = g.prList(r.repo.full_name);
        const open = list.find((p) => p.state === "open" && p.head.ref === head && p.base.ref === base);
        if (open) return toPr(open);
        if (!r.branches[head]) throw Object.assign(new Error(`head branch ${head} does not exist`), { status: 422 });
        if (!r.branches[base]) throw Object.assign(new Error(`base branch ${base} does not exist`), { status: 422 });
        const number = 100 + parseInt(stableHash(`pr:${r.repo.full_name}:${head}:${base}`, 6), 16) % 900;
        const pr: GhPullRequest = { number, title, body, state: "open", draft, merged: false, mergeable: true, merged_at: null, created_at: MOCK_NOW.toISOString(), html_url: `${r.repo.html_url}/pull/${number}`, head: { ref: head, sha: r.branches[head]! }, base: { ref: base, sha: r.branches[base]! }, user: { login: "fm-integration-agent[bot]" }, additions: 12, deletions: 2, changed_files: 2, merge_commit_sha: null };
        list.push(pr);
        return toPr(pr);
      },
      get_pull_request: async ({ owner, repo, prNumber }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const pr = g.prList(r.repo.full_name).find((p) => p.number === prNumber);
        if (!pr) throw notFound(`pull request #${prNumber}`);
        return toPr(pr);
      },
      list_pull_requests: async ({ owner, repo, state, perPage }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        return { items: g.prList(r.repo.full_name).filter((p) => state === "all" || p.state === state).sort((a, b) => b.number - a.number).slice(0, perPage).map(toPr) };
      },
      merge_pr: async ({ owner, repo, prNumber, mergeMethod, commitTitle }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const pr = g.prList(r.repo.full_name).find((p) => p.number === prNumber);
        if (!pr) throw notFound(`pull request #${prNumber}`);
        if (pr.merged) throw conflict(`pull request #${prNumber} is already merged`);
        if (pr.state !== "open") throw conflict(`pull request #${prNumber} is closed`);
        const sha = commitSha(r.repo.name, pr.base.ref, prNumber);
        pr.merged = true;
        pr.state = "closed";
        pr.merged_at = MOCK_NOW.toISOString();
        pr.merge_commit_sha = sha;
        r.branches[pr.base.ref] = sha;
        return { merged: true as const, sha, prNumber, message: `${mergeMethod === "squash" ? "Squashed and merged" : mergeMethod === "rebase" ? "Rebased and merged" : "Merged"}: ${commitTitle ?? pr.title}` };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(GITHUB_KEY, businessId, { accountLabel: `${MOCK_OWNER} (mock installation)`, externalAccountId: String(MOCK_INSTALLATION_ID), scopes: GITHUB_APP_SCOPES, config: { installationId: MOCK_INSTALLATION_ID, account: MOCK_OWNER } }),
    healthcheck: async (integration) => mockHealth(GITHUB_KEY, { repositories: world(integration.businessId).repos.size }),
    simulations: {
      // Normalises the same payload a signed delivery would carry; the replay guard is a webhook concern, so
      // re-simulating the same seed yields the same events (the Simulate panel may fire it repeatedly).
      "pr.merged": (params) => {
        const pr = { ...GH_MERGED_PR, merged_at: (params.occurredAt ?? new Date(GH_MERGED_PR.merged_at!)).toISOString(), merge_commit_sha: commitSha("northwind-site", "main", `sim:${String(params.seed ?? "default")}`) };
        return normaliseGithubEvent("pull_request", mergedPullRequestPayload(pr), params.businessId, () => MOCK_NOW);
      },
    },
  });
  return connector;
}

export const githubMock = createGithubMock();
