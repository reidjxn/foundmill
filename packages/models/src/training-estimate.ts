/**
 * What a training run costs (WP-09 T9), at list prices: each test is one candidate call on the agent's model and one
 * grading pass on whatever model `skillGrader` resolves to, so moving the grader moves the Estimate with it. `batch`
 * prices both at the Batches API's half price. Before any markup: the api adds it for a project on credits.
 */
import { meter } from "./pricing";
import { MODELS, resolveModel, type ModelKey } from "./routing";

/** Per test: about 4k input and 1.2k output tokens for the candidate (Estimate; calibrate from the cost report). */
export const REFERENCE_TEST_USAGE = { inputTokens: 4_000, outputTokens: 1_200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
/** Per test: the grader's pass over the candidate's answer (Estimate). */
export const REFERENCE_GRADE_USAGE = { inputTokens: 2_500, outputTokens: 400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export function trainingEstimate(input: { tests: number; agentModel: ModelKey; batch: boolean }): { costMinor: number; currency: "USD"; label: "Estimate" } {
  const opts = { batch: input.batch };
  const perTest = meter(REFERENCE_TEST_USAGE, MODELS[input.agentModel], opts).costMicroMinor + meter(REFERENCE_GRADE_USAGE, resolveModel("skillGrader").modelId, opts).costMicroMinor;
  // Rounded up: an Estimate that the run then exceeds would let a run start that the credits cannot finish.
  return { costMinor: Math.ceil((perTest * input.tests) / 1_000_000), currency: "USD", label: "Estimate" };
}
