/**
 * Real deploy provider: Railway GraphQL API. Runs only inside the gateway; RAILWAY_TOKEN arrives through
 * `RailwayConfig` and is used solely as the Authorization header. It is never returned, logged, or put in an
 * error message or error detail. Main-head and CI guards live in guards.ts; this provider enforces the
 * allowlist and only ever targets the configured production project/environment.
 */
import type { RailwayConfig } from "../../config";
import {
  DeployError,
  assertServiceAllowlisted,
  deployRefusals,
  deployServiceInputSchema,
  deployStatusSchema,
  getDeployStatusInputSchema,
  type DeployConnector,
  type DeployServiceInput,
  type DeployServiceOutput,
  type DeployState,
  type DeployStatus,
  type GetDeployStatusInput,
} from "./contract";

export const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

/** Railway deployment statuses mapped onto the contract states. Unknown statuses are a provider error. */
const STATE_MAP: Readonly<Record<string, DeployState>> = {
  INITIALIZING: "queued",
  QUEUED: "queued",
  WAITING: "queued",
  NEEDS_APPROVAL: "queued",
  BUILDING: "building",
  DEPLOYING: "deploying",
  SUCCESS: "succeeded",
  FAILED: "failed",
  CRASHED: "failed",
  SKIPPED: "canceled",
  REMOVING: "canceled",
  REMOVED: "canceled",
};

export function mapRailwayStatus(status: string): DeployState {
  const state = STATE_MAP[status];
  if (!state) throw new DeployError("provider_error", "Railway returned an unrecognized deployment status", { status });
  return state;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface RailwayProviderOptions {
  config: RailwayConfig;
  /** Allowlist override for tests; defaults to the configured production allowlist. */
  allowlist?: readonly string[];
  fetch?: FetchLike;
  now?: () => Date;
}

const DEPLOY_MUTATION = `mutation Deploy($serviceId: String!, $environmentId: String!, $commitSha: String) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
}`;

const STATUS_QUERY = `query Status($id: String!) {
  deployment(id: $id) { id status serviceId environmentId projectId createdAt updatedAt meta }
}`;

interface GraphqlBody {
  data?: Record<string, unknown> | null;
  errors?: unknown[];
}

export class RailwayDeployProvider implements DeployConnector {
  private readonly cfg: RailwayConfig;
  private readonly allowlist: readonly string[] | undefined;
  private readonly doFetch: FetchLike;
  private readonly now: () => Date;

  constructor(opts: RailwayProviderOptions) {
    this.cfg = opts.config;
    this.allowlist = opts.allowlist;
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => new Date());
  }

  /** Never serialize the token: JSON.stringify(provider) and util.inspect show nothing sensitive. */
  toJSON(): Record<string, never> {
    return {};
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "RailwayDeployProvider";
  }

  async deployService(rawInput: DeployServiceInput): Promise<DeployServiceOutput> {
    const parsedInput = deployServiceInputSchema.safeParse(rawInput);
    if (!parsedInput.success) throw new DeployError("invalid_input", "invalid deploy_service input");
    const input = parsedInput.data;
    assertServiceAllowlisted(input.service, this.allowlist);
    const serviceId = this.cfg.serviceIds[input.service];
    if (!serviceId) throw deployRefusals.serviceNotAllowlisted(input.service);

    const data = await this.request(DEPLOY_MUTATION, {
      serviceId,
      environmentId: this.cfg.environmentId,
      commitSha: input.commit_sha,
    });
    const deployId = data.serviceInstanceDeployV2;
    if (typeof deployId !== "string" || !deployId) {
      throw new DeployError("provider_error", "Railway did not return a deployment id");
    }
    // The deployment is created from the GitHub commit; read it back so the state is Railway's, not assumed.
    try {
      return await this.getDeployStatus({ deploy_id: deployId });
    } catch (err) {
      if (err instanceof DeployError && err.code === "deploy_not_found") {
        const ts = this.now().toISOString();
        return { deploy_id: deployId, service: input.service, commit_sha: input.commit_sha, state: "queued", created_at: ts, updated_at: ts };
      }
      throw err;
    }
  }

  async getDeployStatus(rawInput: GetDeployStatusInput): Promise<DeployStatus> {
    const parsedInput = getDeployStatusInputSchema.safeParse(rawInput);
    if (!parsedInput.success) throw new DeployError("invalid_input", "invalid get_deploy_status input");
    const { deploy_id } = parsedInput.data;
    let data: Record<string, unknown>;
    try {
      data = await this.request(STATUS_QUERY, { id: deploy_id });
    } catch (err) {
      if (err instanceof DeployError && err.code === "provider_error" && err.details.not_found === "true") {
        throw new DeployError("deploy_not_found", "Deploy not found", { deploy_id });
      }
      throw err;
    }
    const d = data.deployment as Record<string, unknown> | null | undefined;
    if (!d || typeof d !== "object") throw new DeployError("deploy_not_found", "Deploy not found", { deploy_id });

    // Only deployments of the configured production project, environment and allowlisted services are visible.
    const service = Object.entries(this.cfg.serviceIds).find(([, id]) => id === d.serviceId)?.[0];
    const inScope =
      service !== undefined &&
      (this.allowlist === undefined || this.allowlist.includes(service)) &&
      (d.projectId === undefined || d.projectId === this.cfg.projectId) &&
      (d.environmentId === undefined || d.environmentId === this.cfg.environmentId);
    if (!inScope) throw new DeployError("deploy_not_found", "Deploy not found", { deploy_id });

    const meta = (d.meta && typeof d.meta === "object" ? d.meta : {}) as Record<string, unknown>;
    const parsed = deployStatusSchema.safeParse({
      deploy_id: String(d.id ?? deploy_id),
      service,
      commit_sha: meta.commitHash,
      state: mapRailwayStatus(String(d.status)),
      created_at: toIso(d.createdAt),
      updated_at: toIso(d.updatedAt ?? d.createdAt),
    });
    if (!parsed.success) throw new DeployError("provider_error", "Railway returned a deployment that does not match the contract");
    return parsed.data;
  }

  private async request(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.doFetch(RAILWAY_GRAPHQL_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.token}` },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      // The underlying error is dropped on purpose: it could echo request headers.
      throw new DeployError("provider_error", "Railway request failed");
    }
    let body: GraphqlBody | undefined;
    try {
      body = (await res.json()) as GraphqlBody;
    } catch {
      body = undefined;
    }
    if (body?.errors?.length) {
      const text = JSON.stringify(body.errors).toLowerCase();
      const notFound = text.includes("not found");
      throw new DeployError("provider_error", "Railway rejected the request", notFound ? { not_found: "true" } : {});
    }
    if (!res.ok || !body?.data) {
      throw new DeployError("provider_error", "Railway request failed", { http_status: String(res.status) });
    }
    return body.data;
  }
}

function toIso(value: unknown): string {
  const d = typeof value === "string" || typeof value === "number" ? new Date(value) : new Date(NaN);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
