/**
 * Default skills per role (WP-06 T6), live. Runs only with MODEL_MODE=live and a key (`pnpm evals`); skipped otherwise.
 * Gate: an agent hired for a role, given a task one of its role's skills covers, first calls read_skill with that
 * skill's key, 5 of 6. The skills are those the hire gave it, read back from the database (PGlite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hireFromTemplate, repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { createEvalClient, isLiveEvalEnabled, runAll } from "../harness";
import { DEFAULT_SKILL_CASES, runDefaultSkillsCase, type StoredDefault } from "./default-skills";

const live = isLiveEvalEnabled();

describe.skipIf(!live)("default skills are read when a task calls for one (live)", () => {
  const client = live ? createEvalClient() : null;
  let h: TestHarness;
  const stored = new Map<string, StoredDefault[]>();

  beforeAll(async () => {
    h = await createTestDb();
    const db = h.db as unknown as Db;
    const business = await repos.businesses.create(db, { name: "Northwind Skincare" });
    for (const c of DEFAULT_SKILL_CASES) {
      const hired = await hireFromTemplate(db, business.id, c.templateKey);
      stored.set(c.id, await repos.skills.listAddedForAgent(db, business.id, hired.agent.id, hired.agent.agentType));
    }
  }, 120_000);
  afterAll(() => h?.close());

  it(
    "reads the role's skill the task needs first, with its key, 5 of 6",
    async () => {
      const results = await runAll(DEFAULT_SKILL_CASES, 3, (c) => runDefaultSkillsCase(client!, c, stored.get(c.id)!));
      for (const r of results) if (!r.passed) console.warn(`[eval] default skill ${r.caseId}: ${r.problems.join(", ")}`);
      console.warn(`[eval] default skills: ${results.filter((r) => r.passed).length}/${results.length} passed, cost ${results.reduce((s, r) => s + r.costMinor, 0)} minor (Estimate)`);
      expect(results.filter((r) => r.passed).length).toBeGreaterThanOrEqual(5);
    },
    5 * 60 * 1000,
  );
});
