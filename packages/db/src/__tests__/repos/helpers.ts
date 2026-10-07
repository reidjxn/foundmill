/**
 * Shared setup for the repository suites: one PGlite, two businesses (A and B) built by the RLS fixture, and
 * `svc` / `asOwner` helpers that run a repo call under the service role or as business A's owner through withRls.
 */
import type { Db, DbTx } from "../../client";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

export interface RepoHarness {
  h: TestHarness;
  /** Superuser connection typed as the repos expect. */
  db: Db;
  A: BusinessFixture;
  B: BusinessFixture;
  /** Runs fn under service_role (bypasses RLS; what orchestrator/composer/ingest use). */
  svc<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  /** Runs fn as a user through withRls (what apps/api does). */
  as<T>(userId: string, fn: (tx: DbTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function setupRepoHarness(prefix: string): Promise<RepoHarness> {
  const h = await createTestDb();
  const A = await createBusinessFixture(h, `${prefix}-a`);
  const B = await createBusinessFixture(h, `${prefix}-b`);
  return {
    h,
    db: h.db as unknown as Db,
    A,
    B,
    svc: (fn) => h.service().run(fn),
    as: (userId, fn) => h.asUser(userId).run(fn),
    close: () => h.close(),
  };
}

export const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
export const NIL = "00000000-0000-0000-0000-000000000000";
