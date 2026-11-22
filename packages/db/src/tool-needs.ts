/**
 * The tool scout's stage triggers (founder, Nov 22, 2026): at a stage of the project (take charge, the page's first
 * draft, distribution starting, the first real payment) the kinds of tool its kind of business needs then are raised,
 * each once, as a `tool_need` task for the Chief of Staff. Timing matters more than completeness: nothing is raised
 * before its stage. `coveredBy` is `connectorKeysFor` from @foundmill/connectors (this package does not import it).
 */
import { toolNeedsAt } from "@foundmill/agents";
import type { RegulatedArea, ToolCategory, ToolNeedStage } from "@foundmill/shared";
import type { Executor } from "./repos/_shared";
import { businessesRepo } from "./repos/businesses";
import { toolNeedsRepo, type RaiseToolNeedResult } from "./repos/tool-needs";

export async function raiseStageToolNeeds(db: Executor, businessId: string, stage: ToolNeedStage, coveredBy: (category: ToolCategory) => string[], options: { regulated?: readonly RegulatedArea[]; now?: Date } = {}): Promise<RaiseToolNeedResult[]> {
  const business = await businessesRepo.get(db, businessId, { includeArchived: true });
  return toolNeedsRepo.raiseStage(db, businessId, stage, toolNeedsAt(business.archetype, stage, options.regulated ?? []), coveredBy, options.now);
}
