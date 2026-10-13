/**
 * Custom skills (BUILD §11.10 "Custom skills: founder adds name + description + optional examples; Opus drafts a test
 * set; founder reviews before it counts"). The shapes shared by apps/api (drafting and review: agent.skills.*) and the
 * orchestrator (training: a custom skill is scored only on the tests the founder reviewed).
 */
import { z } from "zod";
import { DeterministicCheck, SkillTest } from "./types";

/** How many tests Opus drafts for a custom skill (the prompt asks for half held out). */
export const CUSTOM_SKILL_TEST_COUNT = 12;

/** What the `custom_skill_tests` prompt returns (route `coach`, Opus). */
export const CustomSkillTestsOutput = z.object({
  tests: z
    .array(
      z.object({
        title: z.string().min(8).max(200),
        prompt: z.string().min(40).max(4000),
        rubric: z.array(z.string().min(8).max(300)).min(2).max(5),
        checks: z.array(DeterministicCheck).max(5).default([]),
        mockTools: z.array(z.string().min(1).max(80)).max(10).default([]),
        heldOut: z.boolean(),
      }),
    )
    .min(4)
    .max(30),
});
export type CustomSkillTestsOutput = z.infer<typeof CustomSkillTestsOutput>;
export type CustomSkillTestDraft = CustomSkillTestsOutput["tests"][number];

/** A custom skill's key: `custom_` and its name in snake case ("Grant writing" → `custom_grant_writing`). */
export function customSkillKey(name: string): string {
  const snake = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `custom_${snake || "skill"}`;
}

export function isCustomSkillKey(key: string): boolean {
  return key.startsWith("custom_");
}

/** A drafted test as `skill_tests` stores it: the task (with its checks and mock tools) and the rubric. */
export function storedCustomTest(draft: CustomSkillTestDraft): { task: Record<string, unknown>; rubric: Record<string, unknown>; heldOut: boolean } {
  return {
    task: { title: draft.title, prompt: draft.prompt, fixtures: {}, mockTools: draft.mockTools, checks: draft.checks },
    rubric: { lines: draft.rubric.map((criterion) => ({ criterion, weight: 1 })), passThreshold: 0.6 },
    heldOut: draft.heldOut,
  };
}

/** A stored custom test as the training runner scores it, or null when the row does not hold a valid test. */
export function skillTestFromStored(row: { id: string; task: unknown; rubric: unknown; heldOut: boolean }, skillKey: string): SkillTest | null {
  const task = (row.task ?? {}) as { checks?: unknown };
  const parsed = SkillTest.safeParse({ id: row.id, skillKey, task: row.task, rubric: row.rubric, checks: task.checks ?? [], heldOut: row.heldOut, scenarioKey: skillKey });
  return parsed.success ? parsed.data : null;
}
