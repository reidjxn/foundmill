import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { commitSha, fileSha, GH_MERGED_PR, GH_REPOS, MOCK_GITHUB_WEBHOOK_SECRET, MOCK_INSTALLATION_ID, MOCK_OWNER, type GhFixtureRepo } from "./fixtures/repos";
import { fileWriteBuffer, GITHUB_APP_SCOPES, GITHUB_KEY, GITHUB_RATE_LIMITS, githubTools, mapPullRequest, mapRepository, MAX_TREE_ENTRIES, type GhPullRequest, type PullRequestT } from "./tools";
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

/** One business's GitHub: the fixture repositories (copied), repositories it created, branch contents and pull requests. */
function newWorld(bytesPerBusiness: number) {
  const repos = new Map<string, GhFixtureRepo>(GH_REPOS.map((r) => [r.repo.full_name, { ...r, branches: { ...r.branches }, files: [...r.files] }]));
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
      files: [],
    };
    repos.set(created.repo.full_name, created);
    return created;
  };
  return { repos, find, resolveRef, prList, branchOf, ownTree, filesAt, setTree, findOrCreate, bytes: () => stored };
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
 * the fixtures do not know creates it (empty, `main`), so mock mode works for whatever repository a business names.
 * Written files are bounded per business (the oldest written branches are dropped first) and the least recently used
 * businesses are forgotten beyond MOCK_BUSINESSES.
 */
export function createGithubMock(limits: { bytesPerBusiness?: number; bytesTotal?: number; businesses?: number } = {}) {
  const bytesTotal = limits.bytesTotal ?? MOCK_BYTES_TOTAL;
  const bytesPerBusiness = limits.bytesPerBusiness ?? MOCK_BYTES_PER_BUSINESS;
  const businesses = limits.businesses ?? MOCK_BUSINESSES;
  const worlds = new Map<string, ReturnType<typeof newWorld>>();
  const world = (businessId: string) => {
    let w = worlds.get(businessId);
    if (w) worlds.delete(businessId);
    else w = newWorld(bytesPerBusiness);
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
      create_branch: async ({ owner, repo, branch, fromRef }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.find(owner, repo);
        const existing = r.branches[branch];
        if (existing) return { branch, sha: existing, created: false };
        const sha = g.resolveRef(r, fromRef ?? "HEAD");
        r.branches[branch] = sha;
        return { branch, sha, created: true };
      },
      commit_files: async ({ owner, repo, branch, fromRef, message, files, deletions }, ctx) => {
        const g = world(ctx.businessId);
        const r = g.findOrCreate(owner, repo);
        if (branch === r.repo.default_branch) throw Object.assign(new Error(`commit_files never writes the default branch (${branch}); merge a pull request instead`), { status: 422 });
        if (!r.repo.private) throw Object.assign(new Error(`${owner}/${repo} is public; agents push only to private repositories`), { status: 422 });
        const existed = Boolean(r.branches[branch]);
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
