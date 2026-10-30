/**
 * Deploy guards: the gateway refuses a deploy before any provider (Railway or mock) is called unless
 *  1. the input passes the strict `deploy_service` schema (unknown keys are rejected, so no argument can switch a guard
 *     off or name another repository, branch or allowlist);
 *  2. the service is on the production allowlist (configuration);
 *  3. `commit_sha` is the deploy branch's head, read from GitHub at request time;
 *  4. the CI workflow's run for that exact SHA completed with success, and every check run on the commit passed;
 *  5. the branch's head is still that commit once CI has been read (main can move while the checks are read).
 * Where to look (owner, repo, branch, workflow) and the allowlist come from `DeployGuardDeps`, which the gateway builds
 * from its own configuration; a tool call only ever supplies `service` and `commit_sha`.
 *
 * Refusals are the typed errors of contract.ts (`commit_not_main_head`, `ci_not_succeeded`, `service_not_allowlisted`).
 * When GitHub cannot be asked, the deploy fails closed with `provider_error`: nothing is deployed on an unknown answer.
 */
import {
  assertServiceAllowlisted,
  DeployError,
  deployRefusals,
  parseDeployInput,
  type DeployConnector,
  type DeployServiceInput,
} from "./contract";
import { readBranchHead, readCommitCi, type DeployTarget, type GitHubCommitClient } from "../../integrations/github/commit-status";

export interface DeployGuardDeps {
  /** The business's GitHub installation client (server-side; never an agent's token). */
  github: GitHubCommitClient;
  /** The repository and branch deploys come from: gateway configuration. */
  target: DeployTarget;
  /** Overrides the configured allowlist (tests); defaults to `DEPLOY_SERVICE_ALLOWLIST`. */
  allowlist?: readonly string[];
}

async function askGitHub<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof DeployError) throw err;
    throw new DeployError("provider_error", `Could not read ${what} from GitHub; the deploy was not started`, { check: what });
  }
}

/**
 * Runs every guard on raw tool input and returns the validated input, or throws a `DeployError`. Order: schema,
 * allowlist, main head, CI, main head again. The cheap local checks go first so a bad call costs no GitHub request.
 */
export async function assertDeployAllowed(raw: unknown, deps: DeployGuardDeps): Promise<DeployServiceInput> {
  const input = parseDeployInput("deploy_service", raw);
  assertServiceAllowlisted(input.service, deps.allowlist);

  const head = await askGitHub("main_head", () => readBranchHead(deps.github, deps.target));
  if (input.commit_sha !== head) throw deployRefusals.commitNotMainHead(input.commit_sha, head);

  const ci = await askGitHub("ci_status", () => readCommitCi(deps.github, deps.target, input.commit_sha));
  if (ci !== "succeeded") throw deployRefusals.ciNotSucceeded(input.commit_sha, ci);

  const headAfter = await askGitHub("main_head", () => readBranchHead(deps.github, deps.target));
  if (headAfter !== input.commit_sha) throw deployRefusals.commitNotMainHead(input.commit_sha, headAfter);

  return input;
}

/**
 * The only way the gateway exposes a provider: `deployService` runs the guards and passes the provider the validated
 * input (never the raw arguments), so a refused deploy never reaches it.
 */
export function withDeployGuards(provider: DeployConnector, deps: DeployGuardDeps): DeployConnector {
  return {
    async deployService(raw) {
      const input = await assertDeployAllowed(raw, deps);
      return provider.deployService({ service: input.service, commit_sha: input.commit_sha });
    },
    async getDeployStatus(raw) {
      return provider.getDeployStatus(parseDeployInput("get_deploy_status", raw));
    },
  };
}
