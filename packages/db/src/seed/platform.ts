/**
 * Platform-wide rows the demo businesses rely on: the skill catalogue (`skill_definitions` with business_id null,
 * BUILD §11.10) so agent_skills rows point at real definitions. Idempotent: only missing keys are inserted.
 */
import { SKILL_DEFINITIONS } from "@foundmill/agents";
import { isNull } from "drizzle-orm";
import type { Db } from "../client";
import { skillDefinitions, type NewSkillDefinition } from "../schema";
import { bulkInsert } from "./context";

export async function ensurePlatformSkillDefinitions(db: Db): Promise<number> {
  const existing = await db.select({ agentType: skillDefinitions.agentType, skillKey: skillDefinitions.skillKey }).from(skillDefinitions).where(isNull(skillDefinitions.businessId));
  const have = new Set(existing.map((r) => `${r.agentType}:${r.skillKey}`));
  const rows: NewSkillDefinition[] = [];
  for (const def of SKILL_DEFINITIONS) {
    for (const agentType of def.agentTypes) {
      const key = `${agentType}:${def.key}`;
      if (have.has(key)) continue;
      have.add(key);
      rows.push({ businessId: null, agentType, skillKey: def.key, name: def.name, description: def.description, group: def.group, custom: false });
    }
  }
  return bulkInsert(db, skillDefinitions, rows);
}
