import type { z } from "zod";
import { isAllowlistedService } from "./deploy-services";
import {
  DEPLOY_REFUSAL_CODES,
  deployServiceInputSchema,
  deployServiceOutputSchema,
  getDeployStatusInputSchema,
  deployStatusSchema,
  type DeployErrorCode,
  type DeployRefusalCode,
  type DeployServiceInput,
  type DeployServiceOutput,
  type DeployStatus,
  type GetDeployStatusInput,
} from "./types";

export * from "./types";

/** Typed error thrown by every deploy provider implementation (real and mock). */
export class DeployError extends Error {
  readonly code: DeployErrorCode;
  readonly details: Readonly<Record<string, string>>;
  constructor(code: DeployErrorCode, message: string, details: Record<string, string> = {}) {
    super(message);
    this.name = "DeployError";
    this.code = code;
    this.details = details;
  }
  /** True when the deploy was refused by policy and nothing was started. */
  get isRefusal(): boolean {
    return (DEPLOY_REFUSAL_CODES as readonly string[]).includes(this.code);
  }
}

export const deployRefusals = {
  serviceNotAllowlisted: (service: string) =>
    new DeployError(
      "service_not_allowlisted",
      `Service "${service}" is not on the production deploy allowlist`,
      { service },
    ),
  commitNotMainHead: (commitSha: string, mainHeadSha: string) =>
    new DeployError("commit_not_main_head", "commit_sha is not the current head of main", {
      commit_sha: commitSha,
      main_head_sha: mainHeadSha,
    }),
  ciNotSucceeded: (commitSha: string, ciState: string) =>
    new DeployError("ci_not_succeeded", "CI has not succeeded for this commit", {
      commit_sha: commitSha,
      ci_state: ciState,
    }),
};

export function isDeployRefusal(err: unknown): err is DeployError & { code: DeployRefusalCode } {
  return err instanceof DeployError && err.isRefusal;
}

/** Contract implemented by the real (Railway) and mock providers. */
export interface DeployConnector {
  deployService(input: DeployServiceInput): Promise<DeployServiceOutput>;
  getDeployStatus(input: GetDeployStatusInput): Promise<DeployStatus>;
}

export const DEPLOY_TOOLS = {
  deploy_service: {
    name: "deploy_service",
    description:
      "Deploy a commit of an allowlisted production service. Refused unless the commit is " +
      "the head of main and CI succeeded on it.",
    input: deployServiceInputSchema,
    output: deployServiceOutputSchema,
  },
  get_deploy_status: {
    name: "get_deploy_status",
    description: "Read the status of a deploy by id.",
    input: getDeployStatusInputSchema,
    output: deployStatusSchema,
  },
} as const;

export type DeployToolName = keyof typeof DEPLOY_TOOLS;
export type DeployToolInput<N extends DeployToolName> = z.infer<(typeof DEPLOY_TOOLS)[N]["input"]>;

/** Validates raw agent input; throws DeployError("invalid_input") on failure. */
export function parseDeployInput<N extends DeployToolName>(
  tool: N,
  raw: unknown,
): DeployToolInput<N> {
  // Widen to one schema type so safeParse is not called on a union of schema types.
  const schema = DEPLOY_TOOLS[tool].input as z.ZodType;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
      .join("; ");
    throw new DeployError("invalid_input", message);
  }
  return parsed.data as DeployToolInput<N>;
}

/** Allowlist check shared by providers; the list comes from configuration, never from input. */
export function assertServiceAllowlisted(service: string, allowlist?: readonly string[]): void {
  if (!isAllowlistedService(service, allowlist)) throw deployRefusals.serviceNotAllowlisted(service);
}
