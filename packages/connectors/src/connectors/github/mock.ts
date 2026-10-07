import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { commitSha, fileSha, GH_MERGED_PR, GH_REPOS, MOCK_GITHUB_WEBHOOK_SECRET, MOCK_INSTALLATION_ID, MOCK_OWNER, type GhFixtureRepo } from "./fixtures/repos";
import { GITHUB_APP_SCOPES, GITHUB_KEY, GITHUB_RATE_LIMITS, githubTools, mapPullRequest, mapRepository, MAX_TREE_ENTRIES, type GhPullRequest, type PullRequestT } from "./tools";
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

export function createGithubMock() {
  const repos = new Map<string, GhFixtureRepo>(GH_REPOS.map((r) => [r.repo.full_name, { ...r, branches: { ...r.branches }, files: [...r.files] }]));
  const pulls = new Map<string, GhPullRequest[]>([[GH_REPOS[0]!.repo.full_name, [structuredClone(GH_MERGED_PR)]]]);
  const webhook = createGithubWebhook({ secret: MOCK_GITHUB_WEBHOOK_SECRET, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });

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
      list_repos: async ({ perPage, page }) => {
        const all = [...repos.values()].map((r) => mapRepository(r.repo));
        return { items: all.slice((page - 1) * perPage, page * perPage), totalCount: all.length };
      },
      read_tree: async ({ owner, repo, ref, path, recursive }) => {
        const r = find(owner, repo);
        const sha = resolveRef(r, ref);
        const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
        const seen = new Map<string, { type: "blob" | "tree"; sha: string; size: number | null }>();
        for (const f of r.files) {
          if (!f.path.startsWith(prefix)) continue;
          const rest = f.path.slice(prefix.length);
          const parts = rest.split("/");
          if (recursive) {
            for (let i = 1; i < parts.length; i++) seen.set(parts.slice(0, i).join("/"), { type: "tree", sha: stableHash(`tree:${prefix}${parts.slice(0, i).join("/")}`, 40), size: null });
            seen.set(rest, { type: "blob", sha: fileSha(f), size: Buffer.byteLength(f.content) });
          } else if (parts.length === 1) seen.set(rest, { type: "blob", sha: fileSha(f), size: Buffer.byteLength(f.content) });
          else seen.set(parts[0]!, { type: "tree", sha: stableHash(`tree:${prefix}${parts[0]}`, 40), size: null });
        }
        if (path && seen.size === 0) throw notFound(`path ${path}`);
        const entries = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, e]) => ({ path: p, ...e }));
        return { sha: path ? stableHash(`tree:${prefix}`, 40) : sha, truncated: entries.length > MAX_TREE_ENTRIES, entries: entries.slice(0, MAX_TREE_ENTRIES) };
      },
      read_file: async ({ owner, repo, path, ref }) => {
        const r = find(owner, repo);
        resolveRef(r, ref);
        const f = r.files.find((x) => x.path === path);
        if (!f) throw notFound(`file ${path}`);
        return { path, sha: fileSha(f), size: Buffer.byteLength(f.content), encoding: "utf-8" as const, content: f.content, url: `${r.repo.html_url}/blob/${ref === "HEAD" ? r.repo.default_branch : ref}/${path}` };
      },
      create_branch: async ({ owner, repo, branch, fromRef }) => {
        const r = find(owner, repo);
        const existing = r.branches[branch];
        if (existing) return { branch, sha: existing, created: false };
        const sha = resolveRef(r, fromRef ?? "HEAD");
        r.branches[branch] = sha;
        return { branch, sha, created: true };
      },
      open_pr: async ({ owner, repo, title, body, head, base, draft }) => {
        const r = find(owner, repo);
        const list = prList(r.repo.full_name);
        const open = list.find((p) => p.state === "open" && p.head.ref === head && p.base.ref === base);
        if (open) return toPr(open);
        if (!r.branches[head]) throw Object.assign(new Error(`head branch ${head} does not exist`), { status: 422 });
        if (!r.branches[base]) throw Object.assign(new Error(`base branch ${base} does not exist`), { status: 422 });
        const number = 100 + parseInt(stableHash(`pr:${r.repo.full_name}:${head}:${base}`, 6), 16) % 900;
        const pr: GhPullRequest = { number, title, body, state: "open", draft, merged: false, mergeable: true, merged_at: null, created_at: MOCK_NOW.toISOString(), html_url: `${r.repo.html_url}/pull/${number}`, head: { ref: head, sha: r.branches[head]! }, base: { ref: base, sha: r.branches[base]! }, user: { login: "fm-integration-agent[bot]" }, additions: 12, deletions: 2, changed_files: 2, merge_commit_sha: null };
        list.push(pr);
        return toPr(pr);
      },
      get_pull_request: async ({ owner, repo, prNumber }) => {
        const r = find(owner, repo);
        const pr = prList(r.repo.full_name).find((p) => p.number === prNumber);
        if (!pr) throw notFound(`pull request #${prNumber}`);
        return toPr(pr);
      },
      list_pull_requests: async ({ owner, repo, state, perPage }) => {
        const r = find(owner, repo);
        return { items: prList(r.repo.full_name).filter((p) => state === "all" || p.state === state).sort((a, b) => b.number - a.number).slice(0, perPage).map(toPr) };
      },
      merge_pr: async ({ owner, repo, prNumber, mergeMethod, commitTitle }) => {
        const r = find(owner, repo);
        const pr = prList(r.repo.full_name).find((p) => p.number === prNumber);
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
    healthcheck: async () => mockHealth(GITHUB_KEY, { repositories: repos.size }),
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
