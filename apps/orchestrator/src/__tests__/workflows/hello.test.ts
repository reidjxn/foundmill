/** Gate 0: the hello workflow runs an activity round-trip through the task queue (BUILD §16.1 task 6). */
import { APP_NAME } from "@foundmill/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hello } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

describe("hello workflow", () => {
  it("greets through the activity", async () => {
    const greet = async ({ name }: { name: string }) => `Hello from ${APP_NAME}, ${name}`;
    const result = await rig.run({ greet }, (client, taskQueue) => client.workflow.execute(hello, { workflowId: wfId("hello"), taskQueue, args: ["Reid"] }));
    expect(result).toBe(`Hello from ${APP_NAME}, Reid`);
  });
});
