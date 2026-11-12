import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { VC_DEPLOYMENTS } from "./fixtures/deployments";
import { mapCreated, mapDeployment, mapDeploymentDetail, VERCEL_KEY, VERCEL_RATE_LIMITS, vercelTools, type VcDeployment } from "./tools";

export const MOCK_NOTICE = "Simulated: these are fixture deployments, not your Vercel account. Nothing was read from or deployed to Vercel.";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

const createdMs = (d: VcDeployment): number => (typeof d.createdAt === "number" ? d.createdAt : 0);

/**
 * One world of deployments per business (the fixtures are copied for each): a redeploy one business's agents ask for
 * adds a QUEUED deployment to that business's list only. The new id is derived from (source, target), so asking twice
 * for the same redeploy is idempotent.
 */
export function createVercelMock() {
  const world = perBusiness(() => new Map<string, VcDeployment>(VC_DEPLOYMENTS.map((d) => [String(d.uid), structuredClone(d)])));
  const find = (deployments: Map<string, VcDeployment>, idOrUrl: string): VcDeployment => {
    const wanted = idOrUrl.toLowerCase();
    const d = [...deployments.values()].find((x) => String(x.uid).toLowerCase() === wanted || String(x.url).toLowerCase() === wanted);
    if (!d) throw notFound(`deployment ${idOrUrl}`);
    return d;
  };

  const connector = buildMockConnector({
    key: VERCEL_KEY,
    displayName: "Vercel",
    phase: 2,
    auth: { kind: "api_key" },
    tools: vercelTools,
    rateLimits: VERCEL_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      list_deployments: async ({ projectId, target, state, limit }, ctx) => {
        const items = [...world(ctx.businessId).values()]
          .filter((d) => (!projectId || d.name === projectId) && (!state || d.readyState === state) && (!target || (target === "production") === (d.target === "production")))
          .sort((a, b) => createdMs(b) - createdMs(a))
          .slice(0, limit)
          .map(mapDeployment);
        return { items, simulated: true as const, notice: MOCK_NOTICE };
      },
      get_deployment: async ({ idOrUrl }, ctx) => ({ ...mapDeploymentDetail(find(world(ctx.businessId), idOrUrl)), simulated: true as const, notice: MOCK_NOTICE }),
      create_deployment: async ({ deploymentId, target }, ctx) => {
        const deployments = world(ctx.businessId);
        const source = find(deployments, deploymentId);
        const hash = stableHash([ctx.businessId, deploymentId, target], 22);
        const id = `dpl_${hash}`;
        const name = String(source.name);
        const created: VcDeployment = {
          uid: id,
          name,
          url: `${name}-${hash.slice(0, 9)}.vercel.app`,
          state: "QUEUED",
          readyState: "QUEUED",
          target: target === "production" ? "production" : null,
          created: MOCK_NOW.getTime(),
          createdAt: MOCK_NOW.getTime(),
          inspectorUrl: `https://vercel.com/mock/${name}/${hash}`,
          alias: [],
          meta: source.meta ?? null,
        };
        deployments.set(id, created);
        return { ...mapCreated(created), simulated: true as const, notice: `${MOCK_NOTICE} No build was started.` };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(VERCEL_KEY, businessId, { accountLabel: "Vercel (mock)" }),
    healthcheck: async () => mockHealth(VERCEL_KEY),
  });
  /** Forget every business's deployments (tests start again from the fixtures). */
  return Object.assign(connector, { reset: () => world.clear() });
}

export const vercelMock = createVercelMock();
