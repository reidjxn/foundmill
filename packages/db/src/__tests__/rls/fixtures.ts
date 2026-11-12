/**
 * Fixtures for the RLS suites. Everything is created through the superuser connection (bypasses RLS)
 * so the tests only exercise the app roles. One fixture = one business with an owner, a member, a
 * viewer and one row in every parent table that business-scoped samples need to reference.
 */
import { eq } from "drizzle-orm";
import * as s from "../../schema";
import type { TestHarness } from "../../testing/pglite";

export interface BusinessFixture {
  slug: string;
  businessId: string;
  ownerId: string;
  adminId: string;
  memberId: string;
  viewerId: string;
  agentId: string;
  agent2Id: string;
  agentVersionId: string;
  departmentId: string;
  roadmapItemId: string;
  roadmapItem2Id: string;
  /** Extra roadmap items / tasks so edge samples (unique pairs) never collide. */
  roadmapItemIds: string[];
  taskIds: string[];
  specBlockId: string;
  proposalId: string;
  taskId: string;
  task2Id: string;
  inboxItemId: string;
  planId: string;
  planActionId: string;
  playbookId: string;
  channelId: string;
  campaignId: string;
  entityId: string;
  entity2Id: string;
  visitorId: string;
  /** Six conversions; journeys need one each (conversion_id is unique). */
  conversionIds: string[];
  /** Six events; outbox rows need one each (event_id is unique). */
  eventIds: string[];
  integrationId: string;
  credentialId: string;
  accountId: string;
  securityId: string;
  legalEntityId: string;
  skillDefinitionId: string;
  sessionId: string;
  /** 0020: the Chief of Staff's conversation about the fixture's inbox item. */
  agentThreadId: string;
  /** 0082: a live team call with both agents, started by the owner. */
  teamCallId: string;
}

const first = <T>(rows: T[], what: string): T => {
  const row = rows[0];
  if (!row) throw new Error(`fixture: ${what} returned no row`);
  return row;
};

export async function createBusinessFixture(h: TestHarness, slug: string): Promise<BusinessFixture> {
  const db = h.db;
  const [ownerId, adminId, memberId, viewerId] = await Promise.all([
    h.createUser(`${slug}-owner@test.local`),
    h.createUser(`${slug}-admin@test.local`),
    h.createUser(`${slug}-member@test.local`),
    h.createUser(`${slug}-viewer@test.local`),
  ]);

  // An established business (channels running, campaigns live): its founder started distribution (0062). A test about the
  // first days commits a fresh business instead, which starts with distribution not started.
  const business = first(
    await db.insert(s.businesses).values({ name: slug.toUpperCase(), slug, createdBy: ownerId, archetype: "b2b_saas", distributionStartedAt: new Date("2026-01-01T00:00:00Z") }).returning({ id: s.businesses.id }),
    "businesses",
  );
  const businessId = business.id;

  await db.insert(s.memberships).values([
    { businessId, userId: ownerId, role: "owner" },
    { businessId, userId: adminId, role: "admin" },
    { businessId, userId: memberId, role: "member" },
    { businessId, userId: viewerId, role: "viewer" },
  ]);

  const [agent, agent2] = await db
    .insert(s.agents)
    .values([
      { businessId, name: `${slug} Chief of Staff`, agentType: "chief_of_staff", layer: "assistant", status: "healthy" },
      { businessId, name: `${slug} Engineer`, agentType: "engineer", layer: "worker" },
    ])
    .returning({ id: s.agents.id });
  if (!agent || !agent2) throw new Error("fixture: agents");

  const agentVersion = first(
    await db.insert(s.agentVersions).values({ businessId, agentId: agent.id, version: 1, state: "live" }).returning({ id: s.agentVersions.id }),
    "agent_versions",
  );
  await db.update(s.agents).set({ currentVersionId: agentVersion.id }).where(eq(s.agents.id, agent.id));

  const department = first(
    await db
      .insert(s.departments)
      .values({ businessId, name: "Product", slug: "product", moduleKeys: ["product"], leadAgentId: agent.id })
      .returning({ id: s.departments.id }),
    "departments",
  );

  const roadmapRows = await db
    .insert(s.roadmapItems)
    .values([
      { businessId, title: "Ship onboarding", horizon: "now" },
      { businessId, title: "Billing", horizon: "next" },
      ...Array.from({ length: 8 }, (_, i) => ({ businessId, title: `Later item ${i}`, horizon: "later" as const })),
    ])
    .returning({ id: s.roadmapItems.id });
  const [roadmapItem, roadmapItem2] = roadmapRows;
  if (!roadmapItem || !roadmapItem2) throw new Error("fixture: roadmap_items");

  const specBlock = first(await db.insert(s.specBlocks).values({ businessId, section: "vision", position: 0 }).returning({ id: s.specBlocks.id }), "spec_blocks");

  const inboxItem = first(
    await db
      .insert(s.inboxItems)
      .values({ businessId, type: "decision", subject: "Pick a channel", fromAgentId: agent.id, bodyMd: "Two options." })
      .returning({ id: s.inboxItems.id }),
    "inbox_items",
  );

  const proposal = first(
    await db
      .insert(s.changeProposals)
      .values({ businessId, title: "Tighten scope", proposedByAgentId: agent.id, inboxItemId: inboxItem.id })
      .returning({ id: s.changeProposals.id }),
    "change_proposals",
  );

  const plan = first(await db.insert(s.plans).values({ businessId, origin: "option", inboxItemId: inboxItem.id }).returning({ id: s.plans.id }), "plans");
  const planAction = first(
    await db.insert(s.planActions).values({ businessId, planId: plan.id, type: "create_task", agentId: agent.id }).returning({ id: s.planActions.id }),
    "plan_actions",
  );

  const taskRows = await db
    .insert(s.tasks)
    .values([
      { businessId, kind: "code", title: "Build onboarding", roadmapItemId: roadmapItem.id, departmentId: department.id, assigneeAgentId: agent2.id, planActionId: planAction.id },
      { businessId, kind: "research", title: "Competitor scan", departmentId: department.id },
      ...Array.from({ length: 8 }, (_, i) => ({ businessId, kind: "ops" as const, title: `Ops task ${i}`, departmentId: department.id })),
    ])
    .returning({ id: s.tasks.id });
  const [task, task2] = taskRows;
  if (!task || !task2) throw new Error("fixture: tasks");

  const playbook = first(
    await db.insert(s.playbooks).values({ businessId, departmentId: department.id, name: "Weekly digest", sourceText: "Every Friday summarise." }).returning({ id: s.playbooks.id }),
    "playbooks",
  );

  const channel = first(
    await db.insert(s.channels).values({ businessId, channelKey: "events", line: "wings", enabled: true, ownerAgentId: agent.id }).returning({ id: s.channels.id }),
    "channels",
  );
  const campaign = first(
    await db.insert(s.campaigns).values({ businessId, channelId: channel.id, name: "Launch", status: "live" }).returning({ id: s.campaigns.id }),
    "campaigns",
  );

  const [entity, entity2] = await db
    .insert(s.entities)
    .values([
      { businessId, kind: "person", displayName: `${slug} Ada Lovelace`, aliases: ["Ada"], identifiers: { email: `ada@${slug}.test` } },
      { businessId, kind: "organisation", displayName: `${slug} Analytical Engines Ltd`, identifiers: { domain: `${slug}.test` } },
    ])
    .returning({ id: s.entities.id });
  if (!entity || !entity2) throw new Error("fixture: entities");

  const visitor = first(
    await db.insert(s.visitors).values({ businessId, anonId: `anon-${slug}`, entityId: entity.id }).returning({ id: s.visitors.id }),
    "visitors",
  );

  const events = await db
    .insert(s.events)
    .values(Array.from({ length: 6 }, (_, i) => ({ businessId, type: "signup.created", payload: { i }, entityIds: [entity.id] })))
    .returning({ id: s.events.id });

  const conversions = await db
    .insert(s.conversions)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        businessId,
        entityId: entity.id,
        kind: (["signup", "activation", "payment"] as const)[i % 3]!,
        amountMinor: i % 3 === 2 ? 4900 : 0,
        sourceEventId: events[i]?.id,
      })),
    )
    .returning({ id: s.conversions.id });

  const integration = first(
    await db.insert(s.integrations).values({ businessId, connectorKey: "stripe", status: "mock", authKind: "api_key" }).returning({ id: s.integrations.id }),
    "integrations",
  );
  const credential = first(
    await db
      .insert(s.credentials)
      .values({
        businessId,
        integrationId: integration.id,
        ciphertext: new Uint8Array([1, 2, 3]),
        dataKeyCiphertext: new Uint8Array([4, 5, 6]),
        kmsKeyId: "dev-master-key",
      })
      .returning({ id: s.credentials.id }),
    "credentials",
  );

  const account = first(
    await db.insert(s.accounts).values({ businessId, provider: "mock_bank", externalId: `acct-${slug}`, name: "Main", integrationId: integration.id }).returning({ id: s.accounts.id }),
    "accounts",
  );
  const security = first(await db.insert(s.securities).values({ businessId, class: "Ordinary", kind: "common" }).returning({ id: s.securities.id }), "securities");
  const legalEntity = first(
    await db.insert(s.legalEntities).values({ businessId, jurisdiction: "GB", entityType: "ltd", legalName: `${slug} Ltd` }).returning({ id: s.legalEntities.id }),
    "legal_entities",
  );
  const skillDefinition = first(
    await db
      .insert(s.skillDefinitions)
      .values({ businessId, agentType: "engineer", skillKey: `custom_${slug}`, name: "Custom skill", group: "craft", custom: true })
      .returning({ id: s.skillDefinitions.id }),
    "skill_definitions",
  );
  const session = first(
    await db
      .insert(s.agentSessions)
      .values({ businessId, agentId: agent2.id, versionId: agentVersion.id, taskId: task.id, tokensIn: 1000, tokensOut: 200, costMinor: 12 })
      .returning({ id: s.agentSessions.id }),
    "agent_sessions",
  );
  const agentThread = first(
    await db.insert(s.agentThreads).values({ businessId, agentId: agent.id, subjectKind: "inbox_item", subjectId: inboxItem.id }).returning({ id: s.agentThreads.id }),
    "agent_threads",
  );

  const teamCall = first(
    await db.insert(s.teamCalls).values({ businessId, kind: "team", agentIds: [agent.id, agent2.id], startedBy: ownerId }).returning({ id: s.teamCalls.id }),
    "team_calls",
  );

  return {
    slug,
    businessId,
    ownerId,
    adminId,
    memberId,
    viewerId,
    agentId: agent.id,
    agent2Id: agent2.id,
    agentVersionId: agentVersion.id,
    departmentId: department.id,
    roadmapItemId: roadmapItem.id,
    roadmapItem2Id: roadmapItem2.id,
    roadmapItemIds: roadmapRows.slice(2).map((r) => r.id),
    taskIds: taskRows.slice(2).map((r) => r.id),
    specBlockId: specBlock.id,
    proposalId: proposal.id,
    taskId: task.id,
    task2Id: task2.id,
    inboxItemId: inboxItem.id,
    planId: plan.id,
    planActionId: planAction.id,
    playbookId: playbook.id,
    channelId: channel.id,
    campaignId: campaign.id,
    entityId: entity.id,
    entity2Id: entity2.id,
    visitorId: visitor.id,
    conversionIds: conversions.map((c) => c.id),
    eventIds: events.map((e) => e.id),
    integrationId: integration.id,
    credentialId: credential.id,
    accountId: account.id,
    securityId: security.id,
    legalEntityId: legalEntity.id,
    skillDefinitionId: skillDefinition.id,
    sessionId: session.id,
    agentThreadId: agentThread.id,
    teamCallId: teamCall.id,
  };
}

/** Matches the two ways Postgres refuses a write under RLS: no policy passed, or no table privilege at all. */
export const RLS_DENIED = /row-level security|permission denied/i;
