import { describe, expect, it } from "vitest";
import { DeployError } from "../contract";
import { RailwayDeployProvider, mapRailwayStatus } from "../railway";

const TOKEN = "rw-secret-token-123";
const SHA = "a".repeat(40);
const config = {
  token: TOKEN,
  projectId: "proj",
  environmentId: "env",
  serviceIds: { api: "svc-api", gateway: "svc-gw" },
};

function provider(handler: (query: string, vars: Record<string, unknown>, headers: Record<string, string>) => unknown) {
  const calls: string[] = [];
  const p = new RailwayDeployProvider({
    config,
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      calls.push(query);
      return { ok: true, status: 200, json: async () => handler(query, variables, init.headers) };
    },
  });
  return { p, calls };
}

const deployment = (over: Record<string, unknown> = {}) => ({
  data: {
    deployment: {
      id: "d1",
      status: "BUILDING",
      serviceId: "svc-api",
      environmentId: "env",
      projectId: "proj",
      createdAt: "2026-10-30T10:00:00.000Z",
      updatedAt: "2026-10-30T10:01:00.000Z",
      meta: { commitHash: SHA },
      ...over,
    },
  },
});

describe("railway provider", () => {
  it("maps Railway states onto contract states", () => {
    expect(mapRailwayStatus("SUCCESS")).toBe("succeeded");
    expect(mapRailwayStatus("CRASHED")).toBe("failed");
    expect(mapRailwayStatus("REMOVED")).toBe("canceled");
    expect(mapRailwayStatus("DEPLOYING")).toBe("deploying");
    expect(() => mapRailwayStatus("WHAT")).toThrow(DeployError);
  });

  it("deploys the configured service and environment at the given sha", async () => {
    let vars: Record<string, unknown> = {};
    let auth = "";
    const { p } = provider((q, v, h) => {
      if (q.includes("mutation")) {
        vars = v;
        auth = h.authorization ?? "";
        return { data: { serviceInstanceDeployV2: "d1" } };
      }
      return deployment();
    });
    const out = await p.deployService({ service: "api", commit_sha: SHA });
    expect(vars).toEqual({ serviceId: "svc-api", environmentId: "env", commitSha: SHA });
    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(out).toMatchObject({ deploy_id: "d1", service: "api", commit_sha: SHA, state: "building" });
  });

  it("refuses non-allowlisted services without calling Railway", async () => {
    const { p, calls } = provider(() => ({}));
    await expect(p.deployService({ service: "temporal", commit_sha: SHA })).rejects.toMatchObject({
      code: "service_not_allowlisted",
    });
    expect(calls).toHaveLength(0);
  });

  it("hides deployments outside the configured scope", async () => {
    const { p } = provider(() => deployment({ serviceId: "other" }));
    await expect(p.getDeployStatus({ deploy_id: "d1" })).rejects.toMatchObject({ code: "deploy_not_found" });
  });

  it("never leaks the token in errors, JSON or inspection", async () => {
    const p = new RailwayDeployProvider({
      config,
      fetch: async () => {
        throw new Error(`boom ${TOKEN}`);
      },
    });
    const err = await p.getDeployStatus({ deploy_id: "d1" }).catch((e) => e as DeployError);
    expect(err).toBeInstanceOf(DeployError);
    expect(JSON.stringify({ m: err.message, d: err.details, p })).not.toContain(TOKEN);
  });
});
