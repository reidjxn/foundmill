/**
 * Choosing the repository on Development › Code (security review B1): before it is stored, the business's GitHub
 * installation must reach it and it must be private, and GitHub's numeric id of it is pinned with the choice
 * (`settings.repoId`). The gateway treats a read as the founder's own code only for that id, so a repository renamed or
 * replaced under the same name later is third-party content again.
 *
 * Live GitHub is asked through the gateway (`POST /v1/github/repository`, where the App's keys are); a business on the
 * simulated GitHub asks the connector's mock here, which knows every repository a business names (private, a stable id).
 */
import { isUntrusted, mockIntegrationRecord, readForQuarantine, type ConnectorRegistry } from "@foundmill/connectors";
import { GET_REPOSITORY_TOOL } from "@foundmill/connectors/connectors/github/tools";
import type { Integration } from "@foundmill/db";
import { AppError, connectorMode, ValidationError } from "@foundmill/shared";
import type { Env } from "@foundmill/shared";
import type { ApiGatewayClient, GatewayRepository } from "./gateway";

export interface VerifyRepositoryDeps {
  env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">;
  connectors: ConnectorRegistry;
  gateway: ApiGatewayClient;
}

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

export const notAccessibleMessage = (fullName: string) => `The GitHub installation cannot access ${fullName}: add it to the installation on GitHub, or choose another repository`;
export const publicRepositoryMessage = (fullName: string) => `${fullName} is public: agents work only on private repositories. Make it private on GitHub, or choose another repository`;

/** GitHub's identity of the repository as this business's installation sees it; refuses one it cannot reach or a public one. */
export async function verifyCodeRepository(deps: VerifyRepositoryDeps, businessId: string, integration: Pick<Integration, "status">, fullName: string): Promise<GatewayRepository> {
  const [owner, repo] = fullName.split("/") as [string, string];
  const simulated = integration.status === "mock" || connectorMode(deps.env, "github") !== "live";
  let repository: GatewayRepository;
  if (simulated) {
    const mock = deps.connectors.get("github", "mock");
    const result = await mock.callTool(GET_REPOSITORY_TOOL, { owner, repo }, { businessId, agentId: "api", sessionId: null, integration: mockIntegrationRecord("github", businessId), log: SILENT, mode: "mock" });
    if (!result.ok) throw new ValidationError(notAccessibleMessage(fullName));
    const content = (isUntrusted(result.data) ? readForQuarantine(result.data).content : result.data) as GatewayRepository;
    repository = { id: content.id, fullName: content.fullName, private: content.private, defaultBranch: content.defaultBranch };
  } else {
    try {
      repository = (await deps.gateway.repository(businessId, owner, repo)).repository;
    } catch (e) {
      if (e instanceof AppError && e.status === 404) throw new ValidationError(notAccessibleMessage(fullName));
      throw e;
    }
  }
  if (!Number.isSafeInteger(repository.id) || repository.id <= 0) throw new AppError("gateway_error", "GitHub sent no repository id", 502);
  if (!repository.private) throw new ValidationError(publicRepositoryMessage(repository.fullName || fullName));
  return repository;
}
