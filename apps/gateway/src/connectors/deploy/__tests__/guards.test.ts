/**
 * Deploy guards (task bebc845b): a deploy is refused, before the provider is called, when commit_sha is not main's head
 * at request time or when the CI run for that exact SHA is missing, pending, failed or canceled; the guards cannot be
 * switched off by tool arguments, and refusals are the typed errors of contract.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { DeployError, type DeployConnector, type DeployStatus } from "../contract";
import { assertDeployAllowed, withDeployGuards, type DeployGuardDeps } from "../guards";
import type { GitHubCommitClient } from "../../../integrations/github/commit-status";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const TARGET = { owner: "reidjxn", repo: "foundmill", branch: "main" } as const;

interface FakeRun { head_sha?: string; status: string; conclusion: string | null }
interface FakeState {
  /** Heads answered in order (the last repeats): lets a test move main between the two reads. */
  heads: string[];
  runs: Record<string, FakeRun | undefined>;
  checks: Record<string, Array<{ status: string; conclusion: string | null }>>;
  failHead?: boolean;
  failRuns?: boolean;
}

function fakeGitHub(state: FakeState) {
  const log: string[] = [];
  let headReads = 0;
  const client: GitHubCommitClient = {
    rest: {
      git: {
        getRef: async ({ owner, repo, ref }) => {
          log.push(`getRef ${owner}/${repo} ${ref}`);
          if (state.failHead) throw Object.assign(new Error("boom"), { status: 502 });
          const sha = state.heads[Math.min(headReads++, state.heads.length - 1)]!;
          return { data: { object: { sha } } };
        },
      },
      actions: {
        listWorkflowRuns: async ({ owner, repo, workflow_id, head_sha }) => {
          log.push(`runs ${owner}/${repo} ${workflow_id} ${head_sha}`);
          if (state.failRuns) throw Object.assign(new Error("boom"), { status: 500 });
          const run = state.runs[head_sha];
          return { data: { workflow_runs: run ? [{ head_sha, ...run }] : [] } };
        },
      },
      checks: {
        listForRef: async ({ ref, per_page, page }) => {
          log.push(`checks ${ref} ${page}`);
          const all = state.checks[ref] ?? [];
          return { data: { total_count: all.length, check_runs: all.slice((page - 1) * per_page, page * per_page) } };
        },
      },
    },
  };
  return { client, log };
}

const green = (sha: string): Pick<FakeState, "runs" | "checks"> => ({
  runs: { [sha]: { status: "completed", conclusion: "success" } },
  checks: { [sha]: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }] },
});

function setup(state: Partial<FakeState> = {}) {
  const gh = fakeGitHub({ heads: [HEAD], ...green(HEAD), ...state });
  const status: DeployStatus = { deploy_id: "d1", service: "api", commit_sha: HEAD, state: "queued", created_at: "2026-10-30T18:00:00.000Z", updated_at: "2026-10-30T18:00:00.000Z" };
  const provider: DeployConnector = { deployService: vi.fn(async () => status), getDeployStatus: vi.fn(async () => status) };
  const deps: DeployGuardDeps = { github: gh.client, target: TARGET };
  return { ...gh, provider, deps, guarded: withDeployGuards(provider, deps) };
}

async function refusal(p: Promise<unknown>): Promise<DeployError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DeployError);
  return err as DeployError;
}

describe("deploy guards: main head", () => {
  it("deploys the head of main when CI succeeded, passing the provider only the validated input", async () => {
    const t = setup();
    await expect(t.guarded.deployService({ service: "api", commit_sha: HEAD })).resolves.toMatchObject({ deploy_id: "d1" });
    expect(t.provider.deployService).toHaveBeenCalledWith({ service: "api", commit_sha: HEAD });
    expect(t.log[0]).toBe("getRef reidjxn/foundmill heads/main");
    expect(t.log).toContain(`runs reidjxn/foundmill ci.yml ${HEAD}`);
  });

  it("refuses a commit that is not main's head with commit_not_main_head, before CI is read or the provider called", async () => {
    const t = setup({ ...green(OLD) });
    const err = await refusal(t.guarded.deployService({ service: "api", commit_sha: OLD }));
    expect(err.code).toBe("commit_not_main_head");
    expect(err.isRefusal).toBe(true);
    expect(err.details).toEqual({ commit_sha: OLD, main_head_sha: HEAD });
    expect(t.log.some((l) => l.startsWith("runs"))).toBe(false);
    expect(t.provider.deployService).not.toHaveBeenCalled();
  });

  it("refuses when main moves while CI is read", async () => {
    const t = setup({ heads: [HEAD, OLD] });
    const err = await refusal(t.guarded.deployService({ service: "api", commit_sha: HEAD }));
    expect(err.code).toBe("commit_not_main_head");
    expect(err.details.main_head_sha).toBe(OLD);
    expect(t.provider.deployService).not.toHaveBeenCalled();
  });

  it("reads main afresh on every request (no cached head)", async () => {
    const t = setup();
    await t.guarded.deployService({ service: "api", commit_sha: HEAD });
    await t.guarded.deployService({ service: "api", commit_sha: HEAD });
    expect(t.log.filter((l) => l.startsWith("getRef"))).toHaveLength(4);
  });
});

describe("deploy guards: CI for the exact SHA", () => {
  const cases: Array<[string, Partial<FakeState>, string]> = [
    ["missing", { runs: {} }, "missing"],
    ["a run listed under another SHA", { runs: { [HEAD]: { head_sha: OLD, status: "completed", conclusion: "success" } } }, "missing"],
    ["queued", { runs: { [HEAD]: { status: "queued", conclusion: null } } }, "pending"],
    ["in progress", { runs: { [HEAD]: { status: "in_progress", conclusion: null } } }, "pending"],
    ["failed", { runs: { [HEAD]: { status: "completed", conclusion: "failure" } } }, "failed"],
    ["timed out", { runs: { [HEAD]: { status: "completed", conclusion: "timed_out" } } }, "failed"],
    ["skipped", { runs: { [HEAD]: { status: "completed", conclusion: "skipped" } } }, "failed"],
    ["canceled", { runs: { [HEAD]: { status: "completed", conclusion: "cancelled" } } }, "canceled"],
    ["a green run with a failed check", { checks: { [HEAD]: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }] } }, "failed"],
    ["a green run with a check still running", { checks: { [HEAD]: [{ status: "in_progress", conclusion: null }] } }, "pending"],
    ["a green run with no check runs", { checks: { [HEAD]: [] } }, "pending"],
  ];
  for (const [name, state, ciState] of cases) {
    it(`refuses with ci_not_succeeded (${ciState}) when the CI run is ${name}`, async () => {
      const t = setup(state);
      const err = await refusal(t.guarded.deployService({ service: "api", commit_sha: HEAD }));
      expect(err.code).toBe("ci_not_succeeded");
      expect(err.isRefusal).toBe(true);
      expect(err.details).toEqual({ commit_sha: HEAD, ci_state: ciState });
      expect(t.provider.deployService).not.toHaveBeenCalled();
    });
  }

  it("reads every page of check runs and never passes a list cut short", async () => {
    const many = Array.from({ length: 150 }, () => ({ status: "completed", conclusion: "success" as string | null }));
    const t = setup({ checks: { [HEAD]: [...many, { status: "completed", conclusion: "failure" }] } });
    expect((await refusal(t.guarded.deployService({ service: "api", commit_sha: HEAD }))).details.ci_state).toBe("failed");
    expect(t.log.filter((l) => l.startsWith("checks"))).toEqual([`checks ${HEAD} 1`, `checks ${HEAD} 2`]);
  });
});

describe("deploy guards: cannot be bypassed by tool arguments", () => {
  for (const extra of [{ skip_guards: true }, { branch: "agent/x" }, { allowlist: ["postgres"] }, { owner: "someone-else" }, { ci_state: "succeeded" }]) {
    it(`rejects unknown key ${Object.keys(extra)[0]} as invalid_input without asking GitHub`, async () => {
      const t = setup();
      const err = await refusal(t.guarded.deployService({ service: "api", commit_sha: HEAD, ...extra }));
      expect(err.code).toBe("invalid_input");
      expect(t.log).toEqual([]);
      expect(t.provider.deployService).not.toHaveBeenCalled();
    });
  }

  it("refuses a service off the allowlist before asking GitHub", async () => {
    const t = setup();
    const err = await refusal(t.guarded.deployService({ service: "postgres", commit_sha: HEAD }));
    expect(err.code).toBe("service_not_allowlisted");
    expect(t.log).toEqual([]);
  });

  it("rejects an abbreviated or uppercase SHA (the guard compares full lowercase SHAs only)", async () => {
    const t = setup();
    for (const commit_sha of [HEAD.slice(0, 7), HEAD.toUpperCase()]) expect((await refusal(t.guarded.deployService({ service: "api", commit_sha }))).code).toBe("invalid_input");
  });

  it("assertDeployAllowed returns only service and commit_sha", async () => {
    const t = setup();
    await expect(assertDeployAllowed({ service: "gateway", commit_sha: HEAD }, t.deps)).resolves.toEqual({ service: "gateway", commit_sha: HEAD });
  });
});

describe("deploy guards: fail closed when GitHub cannot be asked", () => {
  it("does not deploy when main's head cannot be read", async () => {
    const t = setup({ failHead: true });
    const err = await refusal(t.guarded.deployService({ service: "api", commit_sha: HEAD }));
    expect(err.code).toBe("provider_error");
    expect(err.details).toEqual({ check: "main_head" });
    expect(t.provider.deployService).not.toHaveBeenCalled();
  });

  it("does not deploy when the CI status cannot be read", async () => {
    const t = setup({ failRuns: true });
    const err = await refusal(t.guarded.deployService({ service: "api", commit_sha: HEAD }));
    expect(err.code).toBe("provider_error");
    expect(err.details).toEqual({ check: "ci_status" });
    expect(t.provider.deployService).not.toHaveBeenCalled();
  });
});

describe("deploy guards: get_deploy_status", () => {
  it("validates input and passes through", async () => {
    const t = setup();
    await expect(t.guarded.getDeployStatus({ deploy_id: "d1" })).resolves.toMatchObject({ deploy_id: "d1" });
    expect((await refusal(t.guarded.getDeployStatus({ deploy_id: "d1", extra: 1 } as never))).code).toBe("invalid_input");
  });
});
