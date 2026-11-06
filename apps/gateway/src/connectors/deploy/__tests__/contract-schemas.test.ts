import { describe, expect, it } from "vitest";
import {
  DEPLOY_TOOLS,
  DeployError,
  assertServiceAllowlisted,
  deployErrorCodeSchema,
  deployRefusals,
  deployStatusSchema,
  isDeployRefusal,
  parseDeployInput,
} from "../contract";
import { DEPLOY_SERVICE_ALLOWLIST } from "../deploy-services";

const sha = "a".repeat(40);

describe("AC-1 deploy tool schemas are defined and validated", () => {
  it("accepts valid deploy_service input", () => {
    expect(parseDeployInput("deploy_service", { service: "api", commit_sha: sha })).toEqual({
      service: "api",
      commit_sha: sha,
    });
  });

  it("rejects bad sha, bad service, missing and extra keys", () => {
    for (const bad of [
      { service: "api", commit_sha: "abc" },
      { service: "api", commit_sha: "A".repeat(40) },
      { service: "API!", commit_sha: sha },
      { service: "api", commit_sha: sha, allowlist: ["x"] },
      { service: "api" },
      null,
      "api",
    ]) {
      expect(() => parseDeployInput("deploy_service", bad)).toThrowError(DeployError);
    }
  });

  it("reports invalid input with the invalid_input code and the failing field", () => {
    try {
      parseDeployInput("deploy_service", { service: "api", commit_sha: "abc" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DeployError);
      expect((err as DeployError).code).toBe("invalid_input");
      expect((err as DeployError).message).toMatch(/commit_sha/);
      expect(isDeployRefusal(err)).toBe(false);
    }
  });

  it("validates get_deploy_status", () => {
    expect(parseDeployInput("get_deploy_status", { deploy_id: "d-1" })).toEqual({
      deploy_id: "d-1",
    });
    expect(() => parseDeployInput("get_deploy_status", {})).toThrowError(/deploy_id/);
    expect(() => parseDeployInput("get_deploy_status", { deploy_id: "" })).toThrowError(
      DeployError,
    );
  });

  it("declares both tools with matching names", () => {
    expect(Object.keys(DEPLOY_TOOLS).sort()).toEqual(["deploy_service", "get_deploy_status"]);
    for (const [key, tool] of Object.entries(DEPLOY_TOOLS)) expect(tool.name).toBe(key);
  });

  it("validates the status output shape", () => {
    const status = {
      deploy_id: "d-1",
      service: "api",
      commit_sha: sha,
      state: "succeeded",
      created_at: "2026-10-30T14:00:00Z",
      updated_at: "2026-10-30T14:05:00Z",
    };
    expect(deployStatusSchema.parse(status)).toEqual(status);
    expect(deployStatusSchema.safeParse({ ...status, state: "done" }).success).toBe(false);
  });
});

describe("AC-2 allowlist is configuration, not agent input", () => {
  it("is frozen and not part of the input schema", () => {
    expect(Object.isFrozen(DEPLOY_SERVICE_ALLOWLIST)).toBe(true);
    expect(Object.keys(DEPLOY_TOOLS.deploy_service.input.shape).sort()).toEqual([
      "commit_sha",
      "service",
    ]);
  });

  it("lists the Railway app services only", () => {
    expect([...DEPLOY_SERVICE_ALLOWLIST].sort()).toEqual([
      "api",
      "composer",
      "gateway",
      "ingest",
      "orchestrator",
      "stream",
    ]);
  });

  it("refuses non-allowlisted services", () => {
    for (const service of ["postgres", "redis", "temporal", "web"]) {
      expect(() => assertServiceAllowlisted(service)).toThrowError(/allowlist/);
    }
    expect(() => assertServiceAllowlisted("api")).not.toThrow();
  });
});

describe("AC-3 typed refusals (allowlist, main head, CI)", () => {
  it("carry distinct codes and are refusals", () => {
    const errs = [
      deployRefusals.serviceNotAllowlisted("x"),
      deployRefusals.commitNotMainHead(sha, "b".repeat(40)),
      deployRefusals.ciNotSucceeded(sha, "failure"),
    ];
    expect(errs.map((e) => e.code)).toEqual([
      "service_not_allowlisted",
      "commit_not_main_head",
      "ci_not_succeeded",
    ]);
    expect(errs.every((e) => isDeployRefusal(e))).toBe(true);
    expect(isDeployRefusal(new DeployError("provider_error", "x"))).toBe(false);
    expect(isDeployRefusal(new Error("x"))).toBe(false);
  });

  it("carry the facts the guard decided on", () => {
    expect(deployRefusals.commitNotMainHead(sha, "b".repeat(40)).details).toEqual({
      commit_sha: sha,
      main_head_sha: "b".repeat(40),
    });
    expect(deployRefusals.ciNotSucceeded(sha, "pending").details).toEqual({
      commit_sha: sha,
      ci_state: "pending",
    });
  });

  it("every code is in the shared error code enum", () => {
    for (const code of deployErrorCodeSchema.options) {
      expect(new DeployError(code, "x").code).toBe(code);
    }
  });
});
