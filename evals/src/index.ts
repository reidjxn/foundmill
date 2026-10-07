/**
 * @founder-manager/evals — golden tasks per agent template, the prompt-injection suite and the harness that runs them
 * against live models (BUILD §17.1, §9.8 item 5). `pnpm --filter @founder-manager/evals evals` runs everything with
 * MODEL_MODE=live; the Vitest suites skip themselves when no key is present, so `pnpm test` stays offline.
 */
export * from "./types";
export * from "./harness";
export { GOLDEN_TASKS, goldenTasksFor, GOLDEN_FIXTURE_IDS } from "./golden/tasks";
export { INJECTION_CASES, injectionCasesOfKind } from "./injection/suite";
