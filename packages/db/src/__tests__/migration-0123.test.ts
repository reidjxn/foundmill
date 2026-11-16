/**
 * 0123 (WP-13): agents, agent versions, agent sessions and the usage ledger accept the GLM model key and still refuse
 * a key that does not exist. The migration's number may change when branches merge: `TAG` names it once.
 */
import { MODEL_KEYS } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0123_glm_model_key";
const CHECKS = ["agents_model_key_check", "agent_versions_model_key_check", "agent_sessions_model_key_check", "usage_ledger_model_key_check"];

let h: TestHarness;

beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h?.close();
});

describe(`${TAG}: the GLM model key`, () => {
  it("names every model key in each check, and only those", async () => {
    const result = (await h.db.execute(sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname in (${sql.join(CHECKS.map((c) => sql`${c}`), sql`, `)})`)) as unknown as { rows: { conname: string; def: string }[] };
    expect(result.rows.map((r) => r.conname).sort()).toEqual([...CHECKS].sort());
    for (const { def } of result.rows) {
      for (const key of MODEL_KEYS) expect(def).toContain(`'${key}'`);
      expect(def).not.toContain("'gpt");
    }
  });
});
