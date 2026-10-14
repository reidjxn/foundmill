/**
 * Ownership checks for reference fields (audit RA-07, ARB-08, ARB-23, ARB-24).
 *
 * The foreign keys on agents, departments, tasks and the like point at the parent row's id alone, and Postgres checks a
 * foreign key without asking row-level security, so a real id from another business is accepted by the database. A
 * repository that stores an id the caller sent must therefore ask first whether the row is this business's. Every
 * helper here reads in the business (`business_id = $1`) and throws a ValidationError naming the field when any id is
 * not found there, so the profile of an agent with a foreign line manager can never 404 and a department can never
 * lead by an agent it cannot see.
 */
import { ValidationError } from "@foundmill/shared";
import { and, eq, inArray } from "drizzle-orm";
import { agents, departments, entities, memberships, roadmapItems, specBlocks } from "../schema";
import type { Executor } from "./_shared";

type MaybeId = string | null | undefined;

function distinct(ids: readonly MaybeId[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
}

async function assertOwned(db: Executor, what: string, field: string, wanted: string[], found: Promise<{ id: string }[]>): Promise<void> {
  if (wanted.length === 0) return;
  const have = new Set((await found).map((r) => r.id));
  const missing = wanted.filter((id) => !have.has(id));
  if (missing.length) throw new ValidationError(`${field} must be ${what} of this business`, { [field]: missing });
}

/** Every id is an agent of the business (archived ones included: an archived line manager is still the manager). */
export async function assertAgentsOwned(db: Executor, businessId: string, ids: readonly MaybeId[], field = "agentId"): Promise<void> {
  const wanted = distinct(ids);
  await assertOwned(db, "an agent", field, wanted, wanted.length ? db.select({ id: agents.id }).from(agents).where(and(eq(agents.businessId, businessId), inArray(agents.id, wanted))) : Promise.resolve([]));
}

/** Every id is a department of the business. */
export async function assertDepartmentsOwned(db: Executor, businessId: string, ids: readonly MaybeId[], field = "departmentId"): Promise<void> {
  const wanted = distinct(ids);
  await assertOwned(db, "a department", field, wanted, wanted.length ? db.select({ id: departments.id }).from(departments).where(and(eq(departments.businessId, businessId), inArray(departments.id, wanted))) : Promise.resolve([]));
}

/** Every id is an entity of the business. */
export async function assertEntitiesOwned(db: Executor, businessId: string, ids: readonly MaybeId[], field = "entityId"): Promise<void> {
  const wanted = distinct(ids);
  await assertOwned(db, "an entity", field, wanted, wanted.length ? db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, wanted))) : Promise.resolve([]));
}

/** Every id is a spec block of the business. */
export async function assertSpecBlocksOwned(db: Executor, businessId: string, ids: readonly MaybeId[], field = "specBlockIds"): Promise<void> {
  const wanted = distinct(ids);
  await assertOwned(db, "a spec block", field, wanted, wanted.length ? db.select({ id: specBlocks.id }).from(specBlocks).where(and(eq(specBlocks.businessId, businessId), inArray(specBlocks.id, wanted))) : Promise.resolve([]));
}

/** Every id is a roadmap item of the business. */
export async function assertRoadmapItemsOwned(db: Executor, businessId: string, ids: readonly MaybeId[], field = "roadmapItemId"): Promise<void> {
  const wanted = distinct(ids);
  await assertOwned(db, "a roadmap item", field, wanted, wanted.length ? db.select({ id: roadmapItems.id }).from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), inArray(roadmapItems.id, wanted))) : Promise.resolve([]));
}

/** The owner of a CRM role: an agent or department of the business, or a member of it (`ownerRef` has no foreign key at all). */
export async function assertOwnerRef(db: Executor, businessId: string, ref: { kind: "agent" | "user" | "department"; id: string } | null | undefined): Promise<void> {
  if (!ref) return;
  if (ref.kind === "agent") return assertAgentsOwned(db, businessId, [ref.id], "ownerRef");
  if (ref.kind === "department") return assertDepartmentsOwned(db, businessId, [ref.id], "ownerRef");
  await assertOwned(
    db,
    "a member",
    "ownerRef",
    [ref.id],
    db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.businessId, businessId), eq(memberships.userId, ref.id))),
  );
}
