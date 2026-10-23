/**
 * The business's own repository (DECISIONS "Coding agents can read and change the repository (2026-10-23)"): which
 * GitHub reads are the founder's own code, delivered raw instead of as the quarantined reader's digest.
 *
 * A read is first-party only when all of these hold (security review B1):
 *  - it names the Code-tab repository (owner and name, any case);
 *  - GitHub says that repository is private and its numeric id is the one pinned for the Code tab. The api pins the id
 *    when the founder chooses the repository (after checking, through `POST /v1/github/repository` here, that the
 *    installation reaches it and that it is private); a repository chosen before pinning existed is pinned here on its
 *    first read after the same check, never on the name alone. A renamed or replaced repository under the same name has
 *    another id and is third-party;
 *  - the ref is HEAD or a branch name: never `refs/pull/…` or `pull/…` (a pull request's head can be a fork's code), a
 *    bare commit sha (GitHub serves a fork's commits through the parent repository), `refs/` outside `refs/heads/`, or a
 *    revision expression (`main~1`, `main^`, `main@{1}`).
 * GitHub's answer about a repository is kept for five minutes per business (`RepoMetadataCache`), so a read costs no
 * extra request most of the time.
 */
import { z } from "zod";
import { repos, type Integration } from "@foundmill/db";
import { isUntrusted, readForQuarantine, type Connector, type ToolContext } from "@foundmill/connectors";
import { GET_REPOSITORY_TOOL } from "@foundmill/connectors/connectors/github/tools";
import { toIntegrationRecord } from "./credentials";
import { appInstallationVerified, GatewayError, modeFor, type GatewayDeps, type GatewayLogger } from "./pipeline";

/** How long GitHub's answer about one repository is reused. */
export const REPO_METADATA_TTL_MS = 5 * 60_000;
/** Repositories remembered at once (all businesses); the oldest go first. */
export const REPO_METADATA_MAX_ENTRIES = 2_000;

/** What the gateway needs to know about a repository (from `github:get_repository`). */
export interface RepoMetadata {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

const RepoMetadataShape = z.object({ id: z.number().int().positive(), fullName: z.string().min(3), private: z.boolean(), defaultBranch: z.string().min(1) });

/** A small TTL cache of repository metadata, keyed per business, connector mode and repository. */
export class RepoMetadataCache {
  private readonly entries = new Map<string, { meta: RepoMetadata; expiresAt: number }>();
  constructor(
    private readonly ttlMs = REPO_METADATA_TTL_MS,
    private readonly maxEntries = REPO_METADATA_MAX_ENTRIES,
  ) {}

  get(key: string, now: number): RepoMetadata | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return hit.meta;
  }

  set(key: string, meta: RepoMetadata, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { meta, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  get size(): number {
    return this.entries.size;
  }
}

const defaultCaches = new WeakMap<GatewayDeps, RepoMetadataCache>();
export function repoCacheFor(deps: GatewayDeps): RepoMetadataCache {
  if (deps.repoCache) return deps.repoCache;
  let cache = defaultCaches.get(deps);
  if (!cache) {
    cache = new RepoMetadataCache();
    defaultCaches.set(deps, cache);
  }
  return cache;
}

/**
 * GitHub's answer about `owner/repo` as this business's installation sees it, or null when the installation cannot reach
 * it (or GitHub could not be asked: whoever relies on the answer fails closed). Cached for REPO_METADATA_TTL_MS unless
 * `fresh`, which asks GitHub again (and refreshes the cache).
 */
export async function repositoryMetadata(deps: GatewayDeps, connector: Connector, ctx: ToolContext, target: { owner: string; repo: string }, options: { fresh?: boolean } = {}): Promise<RepoMetadata | null> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const cache = repoCacheFor(deps);
  const key = `${ctx.businessId}:${connector.key}:${ctx.mode}:${target.owner}/${target.repo}`.toLowerCase();
  if (!options.fresh) {
    const hit = cache.get(key, now);
    if (hit) return hit;
  }
  let result;
  try {
    result = await connector.callTool(GET_REPOSITORY_TOOL, { owner: target.owner, repo: target.repo }, ctx);
  } catch {
    return null;
  }
  if (!result.ok) return null;
  // Only the typed identity fields are read from GitHub's answer; its description and the like are never looked at.
  const parsed = RepoMetadataShape.safeParse(isUntrusted(result.data) ? readForQuarantine(result.data).content : result.data);
  if (!parsed.success) return null;
  const meta: RepoMetadata = { id: parsed.data.id, fullName: parsed.data.fullName, private: parsed.data.private, defaultBranch: parsed.data.defaultBranch };
  cache.set(key, meta, now);
  return meta;
}

/** A full or abbreviated commit sha (7 to 64 hex characters). */
const BARE_SHA = /^[0-9a-f]{7,64}$/i;
/** Namespaces a short name can resolve into that are not this repository's own branches (`pull/1/head` is `refs/pull/1/head`). */
const FOREIGN_NAMESPACE = /^(?:refs|pull|remotes|tags)\//i;
/** A git branch name (`git check-ref-format --branch`), without revision syntax. */
const BRANCH_NAME = /^(?![-/.])(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\/\.)[^\s~^:?*[\\]+(?<![/.])(?<!\.lock)$/;
/** Control characters (U+0000 to U+001F and DEL) never appear in a branch name. */
const hasControl = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * Whether a read at `ref` can be first-party: HEAD (the default branch) or a branch of the repository itself. A pull
 * request ref, a bare sha, another `refs/` namespace and a revision expression never are.
 */
export function isFirstPartyRef(ref: unknown): boolean {
  if (ref === undefined || ref === "HEAD") return true;
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 250) return false;
  const name = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  if (name.length === 0 || hasControl(name) || BARE_SHA.test(name) || FOREIGN_NAMESPACE.test(name)) return false;
  return BRANCH_NAME.test(name);
}

/** GitHub reads whose result can be the business's own code. */
export const FIRST_PARTY_REPO_TOOLS: ReadonlySet<string> = new Set(["list_repos", "read_tree", "read_file", "download_archive"]);

export type FirstPartyVerdict =
  /** First-party; `pin` is the id to pin for a Code-tab repository chosen before pinning existed (null when already pinned). */
  | { firstParty: true; pin: number | null }
  | { firstParty: false; reason: string };

export interface FirstPartyInput {
  connector: string;
  tool: string;
  args: unknown;
  /** The Code-tab repository (`repos.integrations.codeRepository`). */
  codeRepository: { fullName: string; repoId: number | null } | null;
  /** GitHub's answer about the repository the call names (`repositoryMetadata`), or null when there is none. */
  repository: RepoMetadata | null;
  /** The business has a GitHub installation the gateway may use (`list_repos` lists what it granted). */
  installed: boolean;
}

const argsOf = (args: unknown): Record<string, unknown> => (args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {});

/** The repository a call names, when it names one in the two string arguments GitHub tools take. */
export function namedRepository(args: unknown): { owner: string; repo: string } | null {
  const a = argsOf(args);
  if (typeof a.owner !== "string" || typeof a.repo !== "string" || a.owner.length === 0 || a.repo.length === 0) return null;
  return { owner: a.owner, repo: a.repo };
}

/**
 * Whether a call needs GitHub's answer about its repository to be decided: it names the Code-tab repository at a
 * first-party ref. Anything else is third-party without asking.
 */
export function firstPartyCandidate(input: Omit<FirstPartyInput, "repository" | "installed">): { owner: string; repo: string } | null {
  if (input.connector !== "github" || !FIRST_PARTY_REPO_TOOLS.has(input.tool) || input.tool === "list_repos" || !input.codeRepository) return null;
  const named = namedRepository(input.args);
  if (!named || `${named.owner}/${named.repo}`.toLowerCase() !== input.codeRepository.fullName.toLowerCase()) return null;
  return isFirstPartyRef(argsOf(input.args).ref) ? named : null;
}

/**
 * The first-party rule (module comment). `list_repos` lists what the founder's own installation granted, so it counts
 * whenever the business has one; every other repository read counts only for the Code-tab repository, private, with the
 * pinned id (or, unpinned, the id to pin), at HEAD or a branch.
 */
export function firstPartyVerdict(input: FirstPartyInput): FirstPartyVerdict {
  if (input.connector !== "github" || !FIRST_PARTY_REPO_TOOLS.has(input.tool)) return { firstParty: false, reason: "not a repository read" };
  if (input.tool === "list_repos") return input.installed ? { firstParty: true, pin: null } : { firstParty: false, reason: "no GitHub installation" };
  if (!input.codeRepository) return { firstParty: false, reason: "no Code-tab repository" };
  if (!firstPartyCandidate(input)) return { firstParty: false, reason: namedRepository(input.args) ? "another repository, or a ref that is not HEAD or a branch" : "no repository named" };
  const meta = input.repository;
  if (!meta) return { firstParty: false, reason: "GitHub did not confirm the repository" };
  if (meta.fullName.toLowerCase() !== input.codeRepository.fullName.toLowerCase()) return { firstParty: false, reason: "GitHub knows the repository under another name" };
  if (!meta.private) return { firstParty: false, reason: "the repository is public" };
  if (input.codeRepository.repoId === null) return { firstParty: true, pin: meta.id };
  return meta.id === input.codeRepository.repoId ? { firstParty: true, pin: null } : { firstParty: false, reason: "the repository's id is not the one pinned for the Code tab" };
}

export function isFirstPartyRepoRead(input: FirstPartyInput): boolean {
  return firstPartyVerdict(input).firstParty;
}

/**
 * Decides the first-party rule for one allowed GitHub read (pipeline `allow`), asking GitHub about the repository only
 * when the call names the Code-tab repository at a first-party ref, and pinning an unpinned Code-tab repository's id
 * (audited) when GitHub confirmed it.
 */
export async function decideFirstParty(deps: GatewayDeps, input: { connector: Connector; tool: string; args: unknown; ctx: ToolContext; installed: boolean; log: GatewayLogger }): Promise<boolean> {
  const { connector, tool, args, ctx, installed, log } = input;
  if (tool === "list_repos") return firstPartyVerdict({ connector: connector.key, tool, args, codeRepository: null, repository: null, installed }).firstParty;
  const codeRepository = await repos.integrations.codeRepository(deps.db, ctx.businessId);
  const candidate = firstPartyCandidate({ connector: connector.key, tool, args, codeRepository });
  const repository = candidate ? await repositoryMetadata(deps, connector, ctx, candidate) : null;
  const verdict = firstPartyVerdict({ connector: connector.key, tool, args, codeRepository, repository, installed });
  if (!verdict.firstParty) {
    if (candidate) log.info({ reason: verdict.reason }, "read of the Code-tab repository's name is not first-party");
    return false;
  }
  if (verdict.pin !== null && codeRepository) {
    const pinned = await repos.integrations.pinCodeRepositoryId(deps.db, ctx.businessId, { fullName: codeRepository.fullName, repoId: verdict.pin });
    if (pinned) {
      await repos.audit.append(deps.db, ctx.businessId, {
        actorKind: "system",
        action: "gateway.code_repository.pinned",
        target: { connector: "github", repository: codeRepository.fullName },
        details: { repoId: verdict.pin, private: true, sessionId: ctx.sessionId, tool },
      });
      log.info({ repoId: verdict.pin }, "Code-tab repository pinned on its first read");
    } else {
      // Someone chose or pinned the repository meanwhile: decide again against what is stored now.
      const now = await repos.integrations.codeRepository(deps.db, ctx.businessId);
      return firstPartyVerdict({ connector: connector.key, tool, args, codeRepository: now, repository, installed }).firstParty && now?.repoId === verdict.pin;
    }
  }
  return true;
}

export const REPOSITORY_CHECK_ROUTE = "/v1/github/repository";

/** The api's question before the founder chooses a repository on Development › Code. */
export const RepositoryCheckRequest = z
  .object({
    businessId: z.guid(),
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
  })
  .strict();

/** What `POST /v1/github/repository` answers: GitHub's identity of the repository, as the business's installation sees it. */
export interface RepositoryCheckResponse {
  mode: "mock" | "live";
  repository: RepoMetadata;
}

function connectedRow(row: Integration | null): row is Integration {
  return row !== null && row.archivedAt === null && row.status !== "disconnected";
}

/**
 * `POST /v1/github/repository` (service JWT, the api only): whether the business's GitHub installation reaches
 * `owner/repo`, and its id, visibility and default branch, always asked of GitHub afresh. 409 when GitHub is not connected
 * through a verified installation, 404 when the installation cannot reach the repository. The api refuses a public one.
 */
export async function checkRepository(deps: GatewayDeps, input: z.output<typeof RepositoryCheckRequest>): Promise<RepositoryCheckResponse> {
  const mode = modeFor(deps, "github");
  const connector = deps.registry.get("github", mode);
  const row = await repos.integrations.getByKey(deps.db, input.businessId, "github");
  if (!connectedRow(row)) throw new GatewayError("integration_not_connected", "GitHub is not connected for this business", 409, { connector: "github" });
  if (mode === "live" && !appInstallationVerified(row, await repos.integrations.verifiedInstallation(deps.db, input.businessId, "github"))) {
    throw new GatewayError("integration_not_connected", "GitHub is not connected through a verified installation; connect it again from Settings › Integrations", 409, { connector: "github" });
  }
  const ctx: ToolContext = { businessId: input.businessId, agentId: "gateway", sessionId: null, integration: toIntegrationRecord(row, null), log: deps.log, mode };
  const repository = await repositoryMetadata(deps, connector, ctx, { owner: input.owner, repo: input.repo }, { fresh: true });
  if (!repository) throw new GatewayError("repository_not_accessible", `The GitHub installation cannot access ${input.owner}/${input.repo}`, 404, { repository: `${input.owner}/${input.repo}` });
  return { mode, repository };
}
