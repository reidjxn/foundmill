/**
 * Live GitHub connector over `@octokit/app` 16 + `@octokit/rest` 22. Two ways to authenticate a call:
 * the gateway may inject an installation token as `ctx.credential.secret` (minted elsewhere), otherwise the
 * App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY) mints one for `integration.externalAccountId` (the
 * installation id). Webhooks verify with GITHUB_WEBHOOK_SECRET.
 */
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type IntegrationRecord, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { githubMock } from "./mock";
import { fileWriteBuffer, gitBlobSha, GITHUB_APP_SCOPES, GITHUB_KEY, GITHUB_RATE_LIMITS, githubTools, mapPullRequest, mapRepository, mapTreeEntry, MAX_FILE_BYTES, MAX_TREE_ENTRIES, type GhPullRequest, type GhRepository } from "./tools";
import { createGithubWebhook } from "./webhooks";

type RestOctokit = InstanceType<typeof Octokit>;

export function createGithubConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, resolveBusinessId } = resolveLiveOptions(options);
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

  const defaultBranch = async (o: RestOctokit, owner: string, repo: string) => (await o.rest.repos.get({ owner, repo })).data.default_branch;
  const refSha = async (o: RestOctokit, owner: string, repo: string, ref: string): Promise<string> => {
    if (ref === "HEAD") ref = await defaultBranch(o, owner, repo);
    const res = await o.rest.repos.getCommit({ owner, repo, ref, mediaType: { format: "sha" } });
    return typeof res.data === "string" ? res.data : res.data.sha;
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
        create_branch: async ({ owner, repo, branch, fromRef }, ctx) => {
          const o = await octokitFor(ctx);
          const existing = await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
          if (existing) return { branch, sha: existing.data.object.sha, created: false };
          const sha = await refSha(o, owner, repo, fromRef ?? "HEAD");
          const created = await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha });
          return { branch, sha: created.data.object.sha, created: true };
        },
        commit_files: async ({ owner, repo, branch, fromRef, message, files, deletions }, ctx) => {
          const o = await octokitFor(ctx);
          const info = (await o.rest.repos.get({ owner, repo })).data;
          if (branch === info.default_branch) throw Object.assign(new Error(`commit_files never writes the default branch (${branch}); merge a pull request instead`), { status: 422 });
          const existing = await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
          const parentSha = existing ? existing.data.object.sha : await refSha(o, owner, repo, fromRef ?? info.default_branch);
          const baseTree = (await o.rest.git.getCommit({ owner, repo, commit_sha: parentSha })).data.tree.sha;
          // What the branch holds now, so unchanged files are not uploaded and only existing paths are deleted.
          const current = await o.rest.git.getTree({ owner, repo, tree_sha: baseTree, recursive: "1" });
          const known = current.data.truncated ? null : new Map(current.data.tree.filter((e) => e.type === "blob" && e.path && e.sha).map((e) => [e.path!, e.sha!] as const));
          const writes = files.filter((f) => known?.get(f.path) !== gitBlobSha(fileWriteBuffer(f)));
          const removals = known ? deletions.filter((d) => known.has(d)) : deletions;
          const result = (sha: string, committed: boolean, url: string | null) => ({ branch, created: !existing, committed, sha, parentSha, filesWritten: committed ? writes.length : 0, filesDeleted: committed ? removals.length : 0, url });
          if (writes.length === 0 && removals.length === 0) {
            if (!existing) await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: parentSha });
            return result(parentSha, false, null);
          }
          const entries: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
          let next = 0;
          const upload = async () => {
            while (next < writes.length) {
              const f = writes[next++]!;
              const blob = await o.rest.git.createBlob({ owner, repo, content: fileWriteBuffer(f).toString("base64"), encoding: "base64" });
              entries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.data.sha });
            }
          };
          await Promise.all(Array.from({ length: Math.min(8, writes.length) }, upload));
          for (const d of removals) entries.push({ path: d, mode: "100644", type: "blob", sha: null });
          const tree = await o.rest.git.createTree({ owner, repo, base_tree: baseTree, tree: entries });
          if (tree.data.sha === baseTree) {
            if (!existing) await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: parentSha });
            return result(parentSha, false, null);
          }
          const commit = await o.rest.git.createCommit({ owner, repo, message, tree: tree.data.sha, parents: [parentSha] });
          // Fast-forward only: if the branch moved since it was read, GitHub refuses and nothing is overwritten.
          if (existing) await o.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false });
          else await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
          return result(commit.data.sha, true, commit.data.html_url ?? `${info.html_url}/commit/${commit.data.sha}`);
        },
        open_pr: async ({ owner, repo, title, body, head, base, draft }, ctx) => {
          const o = await octokitFor(ctx);
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
        const installationId = typeof input === "object" && input ? Number((input as { installationId?: unknown }).installationId) : Number.NaN;
        if (!Number.isFinite(installationId)) {
          // First step: the founder installs the App on GitHub (a consent only they can give). GitHub then sends them
          // to the App's setup URL with installation_id and this state; Settings › Integrations finishes the connect.
          if (!secrets.githubAppSlug) throw new ConfigError(GITHUB_KEY, "GITHUB_APP_SLUG", "set the GitHub App's URL name so Connect can open its installation page");
          const createdAt = now().toISOString();
          const installUrl = `https://github.com/apps/${encodeURIComponent(secrets.githubAppSlug)}/installations/new?state=${encodeURIComponent(businessId)}`;
          return { id: uuid(), businessId, connectorKey: GITHUB_KEY, status: "disconnected", scopes: [], accountLabel: null, externalAccountId: null, config: { consentUrl: installUrl }, credentialRef: null, expiresAt: null, lastHealthAt: null, createdAt };
        }
        const res = await (app().octokit as unknown as RestOctokit).rest.apps.getInstallation({ installation_id: installationId });
        const account = res.data.account as { login?: string; slug?: string; id?: number } | null;
        const label = account?.login ?? account?.slug ?? `installation ${installationId}`;
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: GITHUB_KEY, status: "connected", scopes: Object.entries(res.data.permissions ?? {}).map(([k, v]) => `${k}:${v}`), accountLabel: label, externalAccountId: String(installationId), config: { installationId, account: label, repositorySelection: res.data.repository_selection }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
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

export { githubMock, createGithubMock, signedDeliveryRequest, mergedPullRequestPayload } from "./mock";
export { githubTools, GITHUB_KEY } from "./tools";
export { createGithubWebhook, githubSignature, normaliseGithubEvent } from "./webhooks";
