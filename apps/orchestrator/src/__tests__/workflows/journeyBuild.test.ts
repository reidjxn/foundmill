/** journeyBuild: refines the record, and narrates the win only when ingest asked it to (its own narration failed). */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, JourneyBuildInput } from "../../activities";
import { journeyBuild } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function mockActivities(options: { narrateFails?: number; fullMatchDay?: boolean } = {}) {
  const built: JourneyBuildInput[] = [];
  const narrated: string[] = [];
  let failures = options.narrateFails ?? 0;
  const acts: Partial<Activities> = {
    async buildJourneyRecord(input) {
      built.push(input);
      return { journeyId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", matchdayLevel: "cup", fullMatchDay: options.fullMatchDay ?? true, eventId: null };
    },
    async narrateConversion(input) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("composer unavailable");
      }
      narrated.push(input.eventId);
      return { narrated: true, inboxItemId: null };
    },
  };
  return { acts, built, narrated };
}

const run = (m: ReturnType<typeof mockActivities>, input: JourneyBuildInput) =>
  rig.run(m.acts, (client, taskQueue) => client.workflow.execute(journeyBuild, { workflowId: wfId("journey"), taskQueue, args: [input] }));

describe("journeyBuild workflow", () => {
  it("refines the record and leaves narration to ingest when it succeeded", async () => {
    const m = mockActivities();
    const result = await run(m, { businessId: BUSINESS, conversionId: CONVERSION, convertedEventId: EVENT, narrate: false });
    expect(result.journeyId).toBeTruthy();
    expect(m.built).toHaveLength(1);
    expect(m.narrated).toEqual([]);
  });

  it("narrates the customer.converted when ingest could not, retrying a composer outage", async () => {
    const m = mockActivities({ narrateFails: 2 });
    await run(m, { businessId: BUSINESS, conversionId: CONVERSION, convertedEventId: EVENT, narrate: true });
    expect(m.narrated).toEqual([EVENT]);
  });

  it("tries a refused narration once and still completes (the event is left to Refresh)", async () => {
    const m = mockActivities();
    let attempts = 0;
    m.acts.narrateConversion = async () => {
      attempts += 1;
      throw ApplicationFailure.create({ message: "Composer /v1/narrate returned 422", type: "composer_refused", nonRetryable: true });
    };
    const result = await run(m, { businessId: BUSINESS, conversionId: CONVERSION, convertedEventId: EVENT, narrate: true });
    expect(result.journeyId).toBeTruthy();
    expect(attempts).toBe(1);
  });

  it("does not narrate a conversion that rolls into the daily round-up", async () => {
    const m = mockActivities({ fullMatchDay: false });
    await run(m, { businessId: BUSINESS, conversionId: CONVERSION, convertedEventId: EVENT, narrate: true });
    expect(m.narrated).toEqual([]);
  });
});
