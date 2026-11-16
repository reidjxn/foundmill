/**
 * `read_skill` (WP-06 T4, founder D6 of Nov 16): an agent loads one of its own skills' full text on demand; the prompt
 * carries only their index. It is a platform tool like the others, served at `/mcp/platform` through the same pipeline
 * (session scope, rate limit, state re-check, Cedar, the `tool.call` audit row), and read-only: no policy hint, so it
 * runs in every mode. The SDK's own Skill tool stays off (SEC-3).
 *
 * Only a skill the calling agent carries is returned (packages/db `readAgentSkill`: its role's, or one added to it in
 * its own business), never another agent's or another business's upload. A library skill reads as the catalog has it;
 * the text is screened again as it is read, and one that no longer passes is refused with the reason. It comes inside
 * its `<skill>` block, with a notice that it grants nothing: a skill never changes tools, autonomy, spend caps or
 * approvals. An uploaded skill (`source: "upload"`) came from outside the platform, so the tool returns it in the
 * untrusted envelope (`skill:<key>`): the quarantined reader and the untrusted-recipient register apply to it as to a
 * repository document. Library and role skills come back raw. Each read writes `agent.skills.read`.
 */
import { readAgentSkill, repos, type Db } from "@foundmill/db";
import { PlatformToolError, READ_SKILL_NOTICE, type PlatformHost } from "@foundmill/connectors";
import { AppError } from "@foundmill/shared";
import { safeError, type GatewayLogger } from "./pipeline";

/** The audit action `read_skill` writes: which of its own skills an agent read, and in which session. */
export const AUDIT_ACTION_SKILL_READ = "agent.skills.read";

export function createSkillReader({ db, log }: { db: Db; log: GatewayLogger }): NonNullable<PlatformHost["readSkill"]> {
  return async (caller, { skillKey }) => {
    try {
      const read = await readAgentSkill(db, caller.businessId, caller.agentId, skillKey);
      if (!read.ok) throw new PlatformToolError(read.code === "not_found" ? "not_found" : "invalid_state", read.message);
      await repos.audit.append(db, caller.businessId, { actorKind: "agent", actorId: caller.agentId, action: AUDIT_ACTION_SKILL_READ, target: { kind: "agent", id: caller.agentId }, details: { skillKey: read.skillKey, sessionId: caller.sessionId } });
      return { skillKey: read.skillKey, name: read.name, source: read.source, text: read.text, notice: READ_SKILL_NOTICE };
    } catch (e) {
      // As every platform tool: an error the agent can act on passes through; a database fault is logged without arguments.
      if (e instanceof AppError) throw e;
      log.error({ err: safeError(e), method: "readSkill" }, "platform tool failed");
      throw new AppError("platform_unavailable", "The platform could not answer this call; try again shortly", 503);
    }
  };
}
