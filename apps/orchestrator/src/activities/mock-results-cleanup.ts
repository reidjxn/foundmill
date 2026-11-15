/**
 * Removes the generated results left on people's projects before the guards (WP-02 T4; audit a5 GTM-02, GTM-10,
 * GTM-16). Nightly, in the mode `MOCK_RESULTS_CLEANUP` names: "report" counts and logs `{ platformReport:
 * "mock_results", …counts }` and writes nothing; "apply" removes them, per business that is not a sample one (the
 * house project included), in one transaction each (`repos.mockResults`), then records each expired launch approval
 * (T1's `recordExpiredApprovals`), one audit row with the counts (no names, no addresses) and one note from the Chief of
 * Staff. A second run finds nothing and writes nothing. "off" does nothing, and so do development and test, where any
 * project may hold simulated results.
 */
import { repos, type Executor } from "@foundmill/db";
import { recordExpiredApprovals } from "@foundmill/events";
import { mockResultsAllowed } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent } from "../events";
import { requestJourneyDailyRefresh } from "../journey-refresh";

export interface MockResultsCounts {
  businesses: number;
  leads: number;
  metricRows: number;
  mockIntegrations: number;
  liveCampaigns: number;
  openLaunchApprovals: number;
}

export const MOCK_RESULTS_AUDIT_ACTION = "data_fix.mock_results_removed";
export const MOCK_RESULTS_NOTE_SUBJECT = "We removed sample figures from your project";

export function mockResultsNoteBody(leads: number, metricRows: number): string {
  return `Before Nov 11, 2026 your Customers and Channels screens could show leads and channel numbers that were generated, not real. We removed ${leads} generated contact${leads === 1 ? "" : "s"} and ${metricRows} day${metricRows === 1 ? "" : "s"} of generated channel numbers. Nothing real was removed. From now on a number here means something happened.`;
}

export function createMockResultsCleanupActivities(deps: OrchestratorDeps) {
  return {
    async cleanMockResults(input: { mode?: "report" | "apply" } = {}): Promise<MockResultsCounts> {
      const configured = deps.env.MOCK_RESULTS_CLEANUP;
      const mode = input.mode ?? (configured === "off" ? null : configured);
      const totals: MockResultsCounts = { businesses: 0, leads: 0, metricRows: 0, mockIntegrations: 0, liveCampaigns: 0, openLaunchApprovals: 0 };
      // Development and test may hold simulated results on any project: only staging and production are cleaned.
      if (!mode || mockResultsAllowed(deps.env.APP_ENV, false)) return totals;
      for (const businessId of await repos.businesses.listForSchedules(deps.db)) {
        const business = await repos.businesses.get(deps.db, businessId);
        if (business.isDemo) continue;
        const counts = await deps.db.transaction(async (tx: Executor) => {
          const found = await repos.mockResults.find(tx, businessId);
          const n = { leads: found.leadEntityIds.length, metricRows: found.metricRows, mockIntegrations: found.mockIntegrationIds.length, liveCampaigns: found.liveCampaignIds.length, openLaunchApprovals: found.openLaunchApprovalIds.length };
          const any = Object.values(n).some((v) => v > 0);
          if (mode === "apply" && any) {
            const now = deps.clock.now();
            const { expiredApprovals } = await repos.mockResults.remove(tx, businessId, found, now);
            await recordExpiredApprovals(tx, businessId, expiredApprovals, now);
            await repos.audit.append(tx, businessId, { actorKind: "system", action: MOCK_RESULTS_AUDIT_ACTION, target: { kind: "business", id: businessId }, details: { ...n, job: "mockResultsCleanup" } });
            const chief = await repos.agents.chiefOfStaff(tx, businessId);
            if (chief) {
              const item = await repos.inbox.createItem(tx, businessId, { type: "update", from_agent_id: chief.id, subject: MOCK_RESULTS_NOTE_SUBJECT, body_md: mockResultsNoteBody(n.leads, n.metricRows), status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
              await emitEvent(tx, { businessId, type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
            }
          }
          return any ? n : null;
        });
        if (!counts) continue;
        totals.businesses += 1;
        totals.leads += counts.leads;
        totals.metricRows += counts.metricRows;
        totals.mockIntegrations += counts.mockIntegrations;
        totals.liveCampaigns += counts.liveCampaigns;
        totals.openLaunchApprovals += counts.openLaunchApprovals;
      }
      if (mode === "apply" && totals.metricRows > 0) requestJourneyDailyRefresh(deps);
      deps.log.info({ platformReport: "mock_results", mode, ...totals }, mode === "apply" ? "generated results removed from real projects" : "generated results on real projects (report only)");
      return totals;
    },
  };
}
