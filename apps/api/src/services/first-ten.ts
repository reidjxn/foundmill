/**
 * The first ten conversations (WP-08 T5; packages/shared `first-ten.ts`): people the founder knows, kept as CRM records
 * (source `first_ten`, role `lead`) and moved by hand. Over the existing repos; no table, no model call, no send, and no
 * event: a founder's own note is never an outcome. Every read and write runs in the member's RLS.
 */
import { repos } from "@foundmill/db";
import { FIRST_TEN_BASIS, FIRST_TEN_SAID, FIRST_TEN_SOURCE, FIRST_TEN_STAGES, NotFoundError, ValidationError, stageAfterHeard, type FirstTenStage } from "@foundmill/shared";
import { audit, type BusinessContext } from "../trpc";

/** More than this is not a first conversation any more: the board holds this many people at most. */
const FIRST_TEN_MAX_PEOPLE = 50;

type Tx = Parameters<Parameters<BusinessContext["rls"]>[0]>[0];

/** The person's lead role if they are one of this business's first-ten people; else not found (the same for a foreign id). */
async function firstTenRole(tx: Tx, ctx: BusinessContext, entityId: string) {
  const entity = await repos.entities.get(tx, ctx.businessId, entityId);
  const role = (await repos.entities.activeRoles(tx, ctx.businessId, [entityId])).get(entityId)?.find((r) => r.role === "lead");
  if (entity.source !== FIRST_TEN_SOURCE || !role) throw new NotFoundError("That person");
  return role;
}

export async function listFirstTen(ctx: BusinessContext) {
  return ctx.rls(async (tx) => {
    const page = await repos.entities.listByRole(tx, ctx.businessId, "lead", { limit: FIRST_TEN_MAX_PEOPLE });
    const people = await Promise.all(
      page.items
        .filter((e) => e.source === FIRST_TEN_SOURCE)
        .map(async (e) => {
          const notes = await repos.entities.listInteractions(tx, ctx.businessId, { entityId: e.id, kind: "note", limit: 20 });
          const said = notes.items.find((n) => n.summary.startsWith(FIRST_TEN_SAID));
          return { entityId: e.id, name: e.displayName, stage: (e.role.stage ?? "to_ask") as string, words: said ? said.summary.slice(FIRST_TEN_SAID.length) : null, updatedAt: (said?.occurredAt ?? e.role.startedAt).toISOString() };
        }),
    );
    const counts = Object.fromEntries(FIRST_TEN_STAGES.map((s) => [s, people.filter((p) => p.stage === s).length])) as Record<FirstTenStage, number>;
    return { people, counts };
  });
}

export async function addFirstTen(ctx: BusinessContext, input: { name: string }) {
  return ctx.rls(async (tx) => {
    const have = (await repos.entities.listByRole(tx, ctx.businessId, "lead", { limit: FIRST_TEN_MAX_PEOPLE })).items.filter((e) => e.source === FIRST_TEN_SOURCE).length;
    if (have >= FIRST_TEN_MAX_PEOPLE) throw new ValidationError("That is plenty to start with. Talk to the people already here first.");
    const entity = await repos.entities.create(tx, ctx.businessId, { kind: "person", displayName: input.name, source: FIRST_TEN_SOURCE, lawfulBasis: FIRST_TEN_BASIS });
    await repos.entities.addRole(tx, ctx.businessId, entity.id, { role: "lead", stage: "to_ask" });
    await audit(tx, ctx, { action: "crm.first_ten.add", target: { kind: "entity", id: entity.id }, details: {} });
    return { entityId: entity.id };
  });
}

export async function moveFirstTen(ctx: BusinessContext, input: { entityId: string; stage: FirstTenStage }) {
  return ctx.rls(async (tx) => {
    const role = await firstTenRole(tx, ctx, input.entityId);
    await repos.entities.updateRole(tx, ctx.businessId, role.id, { stage: input.stage });
    await audit(tx, ctx, { action: "crm.first_ten.move", target: { kind: "entity", id: input.entityId }, details: { stage: input.stage } });
    return { ok: true as const };
  });
}

/** What the person said, as a note prefixed "Said: "; a person still to ask or asked becomes "talked". */
export async function heardFirstTen(ctx: BusinessContext, input: { entityId: string; words: string }) {
  return ctx.rls(async (tx) => {
    const role = await firstTenRole(tx, ctx, input.entityId);
    await repos.entities.addNote(tx, ctx.businessId, input.entityId, `${FIRST_TEN_SAID}${input.words.trim()}`);
    const next = stageAfterHeard(role.stage);
    if (next !== role.stage) await repos.entities.updateRole(tx, ctx.businessId, role.id, { stage: next });
    await audit(tx, ctx, { action: "crm.first_ten.heard", target: { kind: "entity", id: input.entityId }, details: {} });
    return { ok: true as const };
  });
}
