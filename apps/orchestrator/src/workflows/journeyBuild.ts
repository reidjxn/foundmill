/** journeyBuild (BUILD §9.4, §11.4): build one conversion's journey record (attribution, xC, commentary, `customer.converted`). */
import { proxyActivities } from "@temporalio/workflow";
import type { Activities, JourneyBuildInput, JourneyBuildResult } from "../activities";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 5, initialInterval: "2 seconds", backoffCoefficient: 2 } });

export async function journeyBuild(input: JourneyBuildInput): Promise<JourneyBuildResult> {
  return acts.buildJourneyRecord(input);
}
