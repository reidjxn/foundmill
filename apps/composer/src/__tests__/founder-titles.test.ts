/**
 * Founder titles (founder, 2026-11-01; `POST /v1/founder-titles`): open tasks without a title in the founder's words get
 * one from the `founderTitle` route (the mock route here: the deterministic rewrite), every answer is checked against the
 * title rules before it is stored, a task the rules cannot be met for keeps its technical title, and the business
 * boundary holds.
 */
import { repos } from "@foundmill/db";
import { isFounderTitle } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOUNDER_TITLES_BATCH, bannedWordsLine, titleFallback, vocabularyLines } from "../founder-titles";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("founder-titles");
}, 120_000);
afterAll(() => hz?.close());

const task = (businessId: string, title: string, goalMd = "", status: "ready" | "done" = "ready") => repos.tasks.create(hz.db, businessId, { kind: "code", title, goalMd, status });

describe("POST /v1/founder-titles", () => {
  it("titles the open tasks without one, checks every answer against the rules and leaves the technical title in place", async () => {
    const service = hz.service();
    const display = await task(hz.A.businessId, "Fix hydration mismatch in /dashboard", "The dashboard shows a hydration warning.");
    const plain = await task(hz.A.businessId, "Reconcile September invoices");
    // Eleven words after the rewrite and nothing the goal's first sentence can give either: no title, on purpose.
    const stubborn = await task(hz.A.businessId, "Rebase agent/a5444581-1234-4abc-8def-123456789abc onto main and resolve merge conflicts", "Rebase the branch onto main and fix the merge conflicts in the deploy contract.");
    const ended = await task(hz.A.businessId, "Merge the old sitemap PR", "", "done");

    const r = await service.founderTitles(hz.A.businessId);
    const written = new Map(r.written.map((w) => [w.taskId, w]));
    expect(written.get(display.id)).toMatchObject({ title: "Fix a display bug in the dashboard page" });
    expect(written.get(plain.id)).toMatchObject({ title: "Reconcile September invoices" });
    expect(written.has(stubborn.id)).toBe(false);
    expect(r.skipped.map((s) => s.taskId)).toContain(stubborn.id);
    // Ended tasks are not asked about.
    expect(written.has(ended.id)).toBe(false);
    for (const w of r.written) expect(isFounderTitle(w.title), w.title).toBe(true);

    const stored = await repos.tasks.get(hz.db, hz.A.businessId, display.id);
    expect(stored.founderTitle).toBe("Fix a display bug in the dashboard page");
    expect(stored.title).toBe("Fix hydration mismatch in /dashboard");
    expect((await repos.tasks.get(hz.db, hz.A.businessId, stubborn.id)).founderTitle).toBeNull();

    // A second call finds nothing new to write for these tasks.
    const again = await service.founderTitles(hz.A.businessId);
    expect(again.written.map((w) => w.taskId)).not.toContain(display.id);
    expect(again.written.map((w) => w.taskId)).not.toContain(plain.id);
  });

  it("titles exactly the tasks named, whatever their state, and never another business's", async () => {
    const service = hz.service();
    const done = await task(hz.A.businessId, "Open a PR for the usage export", "", "done");
    const other = await task(hz.B.businessId, "Open a PR for the usage export");
    const r = await service.founderTitles(hz.A.businessId, [done.id, other.id]);
    expect(r.written.map((w) => w.taskId)).toEqual([done.id]);
    expect((await repos.tasks.get(hz.db, hz.A.businessId, done.id)).founderTitle).toBe("Open a finished change for the usage export");
    expect((await repos.tasks.get(hz.db, hz.B.businessId, other.id)).founderTitle).toBeNull();
  });

  it("the prompt's vocabulary and banned words come from the shared map, and the fallback reads the goal when the title cannot be rewritten", () => {
    expect(vocabularyLines()).toContain('"merge" → "put live"');
    expect(bannedWordsLine()).toContain("Pull request");
    expect(bannedWordsLine()).toContain("webhook");
    expect(FOUNDER_TITLES_BATCH).toBeGreaterThan(0);
    expect(titleFallback({ title: "Investigate flaky e2e in apps/web", goalMd: "The inbox page sometimes fails to load. Find out why." })).toEqual({ title: "Investigate unreliable the automatic tests", source: "fallback" });
    expect(titleFallback({ title: "Make CI green on the sitemap branch", goalMd: "Two tests fail on the sitemap page. Fix them." })).toEqual({ title: "Two tests fail on the sitemap page", source: "fallback" });
    expect(titleFallback({ title: "Rebase agent/x onto main and resolve merge conflicts in CI", goalMd: "Rebase onto main and fix merge conflicts." })).toBeNull();
  });
});
