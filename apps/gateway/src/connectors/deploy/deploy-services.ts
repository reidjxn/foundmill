/**
 * Production service allowlist. Configuration, not agent input: changing it is a code change
 * that goes through review. Agents only pass a service name, which is checked against this list.
 *
 * These are the six Railway app services built from this repository (docs/DEPLOY.md §3).
 * The web app deploys on Vercel and the infrastructure services (temporal, temporal-ui, Redis,
 * Postgres) are not built from this repo, so none of them is deployable through this connector.
 */
export const DEPLOY_SERVICE_ALLOWLIST: readonly string[] = Object.freeze([
  "api",
  "composer",
  "gateway",
  "ingest",
  "orchestrator",
  "stream",
]);

export function isAllowlistedService(
  service: string,
  allowlist: readonly string[] = DEPLOY_SERVICE_ALLOWLIST,
): boolean {
  return allowlist.includes(service);
}
