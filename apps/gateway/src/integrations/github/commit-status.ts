/**
 * What the deploy guards (connectors/deploy/guards.ts) ask GitHub: the current head of the deploy branch, and the CI
 * verdict for one exact commit. Both are read afresh on every call (no cache): a deploy decision made on a five-minute-old
 * answer could ship a commit that is no longer main's head.
 *
 * The client is the narrow slice of Octokit's REST API these reads use (`rest.git.getRef`,
 * `rest.actions.listWorkflowRuns`, `rest.checks.listForRef`), so the GitHub connector's installation client can be passed
 * as is, and tests pass a fake.
 */
import { CI_WORKFLOW, checksState } from "@foundmill/connectors/connectors/github/tools";

/** The slice of Octokit's REST client the guards read through. */
export interface GitHubCommitClient {
  rest: {
    git: {
      getRef(params: { owner: string; repo: string; ref: string }): Promise<{ data: { object: { sha: string } } }>;
    };
    actions: {
      listWorkflowRuns(params: { owner: string; repo: string; workflow_id: string; head_sha: string; per_page: number }): Promise<{
        data: { workflow_runs: Array<{ head_sha?: string | null; status?: string | null; conclusion?: string | null }> };
      }>;
    };
    checks: {
      listForRef(params: { owner: string; repo: string; ref: string; per_page: number; page: number }): Promise<{
        data: { total_count: number; check_runs: Array<{ status: string; conclusion?: string | null }> };
      }>;
    };
  };
}

/** Where the guards look. Server configuration only: never built from a tool's arguments. */
export interface DeployTarget {
  owner: string;
  repo: string;
  /** The only branch a deploy may come from (`main`). */
  branch: string;
  /** The CI workflow file whose run decides (`ci.yml`). */
  workflow?: string;
}

/**
 * The CI verdict for one commit. `missing`: no run of the CI workflow for that SHA; `pending`: a run, or one of the
 * commit's check runs, has not completed (or the list was cut short); `failed`: completed with any conclusion other than
 * success (timed out, action required, skipped and neutral included: a CI run that did not run is not a pass), or a check
 * run failed; `canceled`: the CI run was canceled; `succeeded`: the run and every check run passed.
 */
export type CommitCiState = "missing" | "pending" | "failed" | "canceled" | "succeeded";

const CHECKS_PER_PAGE = 100;
const MAX_CHECK_PAGES = 5;
const FULL_SHA = /^[0-9a-f]{40}$/;

/** The deploy branch's head commit, as GitHub reports it now. Throws when GitHub cannot be asked or answers no full SHA. */
export async function readBranchHead(client: GitHubCommitClient, target: DeployTarget): Promise<string> {
  const res = await client.rest.git.getRef({ owner: target.owner, repo: target.repo, ref: `heads/${target.branch}` });
  const sha = res.data.object.sha.toLowerCase();
  if (!FULL_SHA.test(sha)) throw new Error(`GitHub answered no full commit SHA for ${target.branch}`);
  return sha;
}

/**
 * The CI verdict for exactly `sha` (module comment). The CI workflow's newest run for that SHA decides first, because
 * check runs from other apps can be green before CI ran; a successful run then defers to every check run on the commit.
 * A run GitHub lists under another SHA is ignored (read as missing).
 */
export async function readCommitCi(client: GitHubCommitClient, target: DeployTarget, sha: string): Promise<CommitCiState> {
  const { owner, repo } = target;
  const runs = (await client.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: target.workflow ?? CI_WORKFLOW, head_sha: sha, per_page: 1 })).data.workflow_runs;
  const run = runs[0];
  if (!run || (run.head_sha ?? "").toLowerCase() !== sha) return "missing";
  if (run.status !== "completed") return "pending";
  if (run.conclusion === "cancelled" || run.conclusion === "canceled") return "canceled";
  if (run.conclusion !== "success") return "failed";

  const checks: Array<{ status: string; conclusion: string | null }> = [];
  let total = 0;
  for (let page = 1; page <= MAX_CHECK_PAGES; page++) {
    const res = await client.rest.checks.listForRef({ owner, repo, ref: sha, per_page: CHECKS_PER_PAGE, page });
    total = res.data.total_count;
    checks.push(...res.data.check_runs.map((c) => ({ status: c.status, conclusion: c.conclusion ?? null })));
    if (res.data.check_runs.length < CHECKS_PER_PAGE || checks.length >= total) break;
  }
  const verdict = checksState(checks, checks.length >= total);
  return verdict === "success" ? "succeeded" : verdict === "failure" ? "failed" : "pending";
}
