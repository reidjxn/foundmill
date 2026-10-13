/**
 * The agent session behind a call the orchestrator makes through the gateway on an agent's behalf (a plan action, a
 * Door B import). The gateway books usage and queues approvals against `agent_sessions(id)`, so every token it mints
 * must name a real session: one row per call, opened before the token is minted and ended when the call returns
 * (audit VSEC-X1; a random session id made every allowed or approval-needing call a 500 after its side effect).
 */
import { repos, type Agent } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";

export const SYSTEM_SESSION_OUTCOME = "system_call";

export async function withSystemSession<T>(deps: Pick<OrchestratorDeps, "db">, businessId: string, agent: Pick<Agent, "id" | "modelKey">, fn: (sessionId: string) => Promise<T>): Promise<T> {
  const session = await repos.agents.createSession(deps.db, businessId, { agentId: agent.id, modelKey: agent.modelKey });
  try {
    return await fn(session.id);
  } finally {
    await repos.agents.endSession(deps.db, businessId, session.id, { outcome: SYSTEM_SESSION_OUTCOME }).catch(() => undefined);
  }
}
