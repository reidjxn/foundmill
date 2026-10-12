/**
 * journeyBuild (BUILD §9.4, §11.4): refine one conversion's journey record (team, data-driven attribution and xC,
 * commentary). Started by ingest as `journey:{conversionId}` after the delivery commits; when ingest could not narrate
 * the win, the `customer.converted` is narrated here (retried with backoff, then left to Refresh).
 */
import { proxyActivities } from "@temporalio/workflow";
import type { Activities, JourneyBuildInput, JourneyBuildResult } from "../activities";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 5, initialInterval: "2 seconds", backoffCoefficient: 2 } });
const narration = proxyActivities<Activities>({ startToCloseTimeout: "1 minute", retry: { maximumAttempts: 6, initialInterval: "5 seconds", backoffCoefficient: 2 } });

export async function journeyBuild(input: JourneyBuildInput): Promise<JourneyBuildResult> {
  const result = await acts.buildJourneyRecord(input);
  if (input.narrate && input.convertedEventId && result.fullMatchDay) {
    try {
      await narration.narrateConversion({ businessId: input.businessId, eventId: input.convertedEventId });
    } catch {
      // The event stays un-narrated; the Inbox's Refresh narrates it.
    }
  }
  return result;
}
