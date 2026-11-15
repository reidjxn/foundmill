/**
 * 0110 `task_reports`: what only it has. The generated cross-tenant suite covers its tenancy (./tables.ts, write mode
 * `service`, and `COLLABORATOR_CLOSED_TABLES`: a collaborator reads none of its rows). This file covers the trigger
 * `fm_task_report_same_business`: no report of one business points at another business's task, whoever writes, the
 * service connection and the migration role included.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

/** Every message in a rejected promise's cause chain, joined ("" when it resolved). */
async function causes(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    const out: string[] = [];
    for (let c: unknown = err; c; c = (c as { cause?: unknown }).cause) out.push((c as Error).message);
    return out.join(" | ");
  }
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "reports-a");
  B = await createBusinessFixture(h, "reports-b");
}, 120_000);
afterAll(() => h?.close());

describe("fm_task_report_same_business", () => {
  const row = (businessId: string, taskId: string, agentId: string) => ({ businessId, taskId, agentId, title: "Findings", bodyMd: "Three suppliers compared." });

  it("refuses a service insert with business A and a task of business B", async () => {
    expect(await causes(h.service().run((tx) => tx.insert(s.taskReports).values(row(A.businessId, B.taskId, A.agentId))))).toMatch(/task_reports_same_business|own business/);
    // The migration role too (it bypasses row level security, not the trigger), and through the repo.
    expect(await causes(h.db.insert(s.taskReports).values(row(A.businessId, B.taskId, A.agentId)))).toMatch(/own business/);
    expect(await causes(h.service().run((tx) => repos.taskReports.save(tx, A.businessId, { taskId: B.taskId, agentId: A.agentId, title: "Findings", bodyMd: "Cross." })))).toMatch(/own business/);
  });

  it("refuses moving a report onto another business's task", async () => {
    const saved = await h.service().run((tx) => repos.taskReports.save(tx, A.businessId, { taskId: A.taskId, agentId: A.agentId, title: "Findings", bodyMd: "Own task." }));
    expect(saved.businessId).toBe(A.businessId);
    expect(await causes(h.service().run((tx) => tx.update(s.taskReports).set({ taskId: B.taskId }).where(eq(s.taskReports.id, saved.id))))).toMatch(/own business/);
  });

  it("refuses a source that is not an http or https address", async () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ftp://files.example/a"]) {
      expect(await causes(h.service().run((tx) => repos.taskReports.save(tx, A.businessId, { taskId: A.taskId, agentId: A.agentId, title: "Findings", bodyMd: "One source.", sources: [{ url, title: "A" }] }))), url).not.toBe("");
    }
    await expect(h.service().run((tx) => repos.taskReports.save(tx, A.businessId, { taskId: A.taskId, agentId: A.agentId, title: "Findings", bodyMd: "One source.", sources: [{ url: "https://supplier.example/prices", title: "A" }] }))).resolves.toBeDefined();
  });
});
