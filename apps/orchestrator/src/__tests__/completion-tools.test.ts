/**
 * Every task kind an agent can be given comes with the tools its completion rule requires (WP-05 T23; the test round of
 * Nov 24, 2026: a revision session held read_product, get_task, block_task and complete_task, and no save_report). A
 * task that is not code is done on `complete_task` with a report saved by `save_report` (T2, T3); a code task is done on
 * the files it changed, so it needs the SDK's file tools. Checked for every template and every kind, the way a session
 * resolves its grants, and again after the second read's narrowing.
 */
import { describe, expect, it } from "vitest";
import { ALL_TEMPLATES, narrowToRevision } from "@foundmill/agents";
import { resolveGrants } from "@foundmill/connectors";
import { isBackgroundHelper, TASK_KINDS } from "@foundmill/shared";
import { sdkToolPolicyFor } from "../activities/sdk-isolation";

const NON_CODE_COMPLETION = ["platform:complete_task", "platform:save_report"];

/** Background helpers (entity linker, classifier and the like) take no tasks (`plannerWorkerTypes`, dispatch). */
const TASK_TAKERS = ALL_TEMPLATES.filter((t) => !isBackgroundHelper(t));

describe("every template × task kind holds the tools its completion rule needs", () => {
  it("covers every template that takes tasks", () => {
    expect(TASK_TAKERS.length).toBe(ALL_TEMPLATES.length - 5);
  });

  it.each(TASK_TAKERS.map((t) => [t.key, t] as const))("%s", (_key, template) => {
    const grants = resolveGrants(template.tools);
    for (const kind of TASK_KINDS) {
      const policy = sdkToolPolicyFor(kind, grants.mcpTools);
      if (kind === "code") {
        expect(policy.fileTools, `${template.key} on a code task has no file tools`).toBe(true);
        continue;
      }
      for (const ref of NON_CODE_COMPLETION) expect(grants.toolRefs, `${template.key} on a ${kind} task lacks ${ref}`).toContain(ref);
      for (const ref of NON_CODE_COMPLETION) expect(policy.allowedTools, `${template.key} on a ${kind} task: ${ref} is not offered to the SDK`).toContain(`mcp__${ref.replace(":", "__")}`);
    }
    // A second read's revision (a task that is not code) keeps them too.
    const revision = narrowToRevision(grants);
    for (const ref of NON_CODE_COMPLETION) expect(revision.toolRefs, `${template.key}'s revision lacks ${ref}`).toContain(ref);
  });
});
