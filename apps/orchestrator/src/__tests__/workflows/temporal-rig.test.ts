/**
 * The shared Temporal rig starts the test server binary `TEMPORAL_TEST_SERVER` names when the environment sets it
 * (the acceptance sandbox, whose network is closed by the time the tests run), else the SDK's cached download.
 */
import { describe, expect, it } from "vitest";
import { testServerOptions } from "./temporal";

describe("testServerOptions", () => {
  it("uses the SDK's cached download unless TEMPORAL_TEST_SERVER names a binary", () => {
    expect(testServerOptions({})).toBeUndefined();
    expect(testServerOptions({ TEMPORAL_TEST_SERVER: "" })).toBeUndefined();
    expect(testServerOptions({ TEMPORAL_TEST_SERVER: "   " })).toBeUndefined();
    expect(testServerOptions({ TEMPORAL_TEST_SERVER: "/tmp/temporal-test-server-sdk-typescript-1.24.0" })).toEqual({ server: { executable: { type: "existing-path", path: "/tmp/temporal-test-server-sdk-typescript-1.24.0" } } });
  });
});
