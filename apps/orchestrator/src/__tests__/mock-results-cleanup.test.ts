/**
 * Removing generated results from real projects (WP-02 T4): "report" counts and writes nothing; "apply" leaves the
 * real project clean and the sample one untouched, with one audit row and one note; a second "apply" finds nothing and
 * writes nothing. The two generators refuse to run where simulated results are not allowed.
 */
import { repos } from "@foundmill/db";
import { CHANNEL_META } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordMockLeads } from "../activities/channel";
import { createMockResultsCleanupActivities, MOCK_RESULTS_AUDIT_ACTION, MOCK_RESULTS_NOTE_SUBJECT } from "../activities/mock-results-cleanup";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let sampleId: string;

/** One of each kind of generated row, on one business. */
async function plant(businessId: string, tag: string) {
  const channel = await repos.channels.upsert(t.db, businessId, { channelKey: "email_automation", line: CHANNEL_META.email_automation.line, enabled: true, kitMode: false, budgetMinor: 10_000, currency: "EUR" });
  await repos.entities.upsertLead(t.db, businessId, { kind: "person", displayName: `Generated ${tag}`, email: `gen.${tag}@acme.example`, source: "email_automation", lawfulBasis: "legitimate_interest" });
  await repos.entities.upsertLead(t.db, businessId, { kind: "person", displayName: `Real ${tag}`, email: `real.${tag}@acme.com`, source: "email_automation", lawfulBasis: "consent" });
  const campaign = await repos.campaigns.create(t.db, businessId, { channelId: channel.id, name: `Week ${tag}`, status: "live" });
  await repos.channels.upsertMetric(t.db, businessId, { channelId: channel.id, campaignId: campaign.id, day: "2026-11-01", spendMinor: 100, currency: "EUR", impressions: 500, leads: 1, signups: 1, activations: 0, customers: 0, source: "estimate" });
  await repos.integrations.upsert(t.db, businessId, { connectorKey: "sendgrid", status: "mock", authKind: "api_key", accountLabel: "mock" });
  await repos.approvals.create(t.db, businessId, { agentId: null, connectorKey: "platform", tool: "launch_campaign", args: { campaignId: campaign.id, channelKey: "email_automation" } });
  return { channel, campaign };
}

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "mockclean" });
  await repos.businesses.commit(t.db, t.businessId, { archetype: "b2b_saas" });
  await plant(t.businessId, "real");
  const sample = await repos.businesses.create(t.db, { name: "Sample Co", isDemo: true, createdBy: t.fixture.ownerId });
  await repos.businesses.commit(t.db, sample.id, { archetype: "b2b_saas" });
  sampleId = sample.id;
  await plant(sampleId, "sample");
});
afterAll(async () => {
  await t?.close();
});

const production = () => ({ ...t.deps, env: { ...t.deps.env, APP_ENV: "production" as const } });
const acts = () => createMockResultsCleanupActivities(production());
const auditRows = async (businessId: string) => (await repos.audit.list(t.db, businessId, { limit: 200 })).items.filter((a) => a.action === MOCK_RESULTS_AUDIT_ACTION);
const notes = async (businessId: string) => (await repos.inbox.list(t.db, businessId, { limit: 200 })).items.filter((i) => i.subject === MOCK_RESULTS_NOTE_SUBJECT);

describe("cleanMockResults", () => {
  it("report counts the real project's generated rows and writes nothing", async () => {
    const found = await repos.mockResults.find(t.db, t.businessId);
    // The fixture brings its own mock rows and live campaign besides the ones planted here.
    expect(found.mockIntegrationIds.length).toBeGreaterThanOrEqual(1);
    const counts = await acts().cleanMockResults({ mode: "report" });
    expect(counts).toEqual({ businesses: 1, leads: 1, metricRows: 1, mockIntegrations: found.mockIntegrationIds.length, liveCampaigns: found.liveCampaignIds.length, openLaunchApprovals: 1 });
    expect(await repos.mockResults.find(t.db, t.businessId)).toMatchObject({ metricRows: 1 });
    expect(await auditRows(t.businessId)).toHaveLength(0);
  });

  it("apply cleans the real project, leaves the sample one, and writes one audit row and one note; again, nothing", async () => {
    const counts = await acts().cleanMockResults({ mode: "apply" });
    expect(counts.businesses).toBe(1);
    expect(await repos.mockResults.find(t.db, t.businessId)).toEqual({ leadEntityIds: [], metricRows: 0, mockIntegrationIds: [], liveCampaignIds: [], openLaunchApprovalIds: [] });
    const sample = await repos.mockResults.find(t.db, sampleId);
    expect([sample.leadEntityIds.length, sample.metricRows, sample.mockIntegrationIds.length, sample.liveCampaignIds.length, sample.openLaunchApprovalIds.length]).toEqual([1, 1, 1, 1, 1]);
    // The real contact stays; the generated one is archived, not deleted.
    expect(await repos.entities.findByIdentifier(t.db, t.businessId, "email", "real.real@acme.com")).not.toBeNull();
    const audits = await auditRows(t.businessId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.details).toMatchObject({ leads: 1, metricRows: 1, openLaunchApprovals: 1 });
    expect(JSON.stringify(audits[0]!.details)).not.toMatch(/acme|Generated/);
    const written = await notes(t.businessId);
    expect(written).toHaveLength(1);
    expect(written[0]!.bodyMd).toContain("We removed 1 generated contact and 1 day of generated channel numbers. Nothing real was removed.");
    const expired = (await repos.events.list(t.db, t.businessId, { type: "approval.resolved", limit: 50 })).items;
    expect(expired.length).toBe(0); // the approval had no agent: no event, but it is resolved
    expect(await auditRows(sampleId)).toHaveLength(0);

    expect(await acts().cleanMockResults({ mode: "apply" })).toEqual({ businesses: 0, leads: 0, metricRows: 0, mockIntegrations: 0, liveCampaigns: 0, openLaunchApprovals: 0 });
    expect(await auditRows(t.businessId)).toHaveLength(1);
    expect(await notes(t.businessId)).toHaveLength(1);
  });

  it("off does nothing, and neither does a test stack", async () => {
    await plant(t.businessId, "again");
    const off = createMockResultsCleanupActivities({ ...production(), env: { ...production().env, MOCK_RESULTS_CLEANUP: "off" } });
    expect((await off.cleanMockResults()).businesses).toBe(0);
    expect((await createMockResultsCleanupActivities(t.deps).cleanMockResults({ mode: "apply" })).businesses).toBe(0);
    expect((await repos.mockResults.find(t.db, t.businessId)).leadEntityIds).toHaveLength(1);
  });
});

describe("the generators refuse a real project on production", () => {
  it("recordMockLeads throws mock_result_refused", async () => {
    await expect(recordMockLeads(production(), { id: t.businessId, isDemo: false }, "00000000-0000-4000-8000-000000000001", "email_automation", "00000000-0000-4000-8000-000000000002", null, 1, "consent", "s")).rejects.toMatchObject({ code: "mock_result_refused" });
  });
});
