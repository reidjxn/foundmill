/** Gate 0 hello workflow (BUILD §16.1 task 6): one activity round-trip through the task queue. */
import { proxyActivities } from "@temporalio/workflow";
import type { Activities } from "../activities";

const { greet } = proxyActivities<Activities>({ startToCloseTimeout: "1 minute", retry: { maximumAttempts: 3 } });

export async function hello(name = "founder"): Promise<string> {
  return greet({ name });
}
