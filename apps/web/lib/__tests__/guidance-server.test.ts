// @vitest-environment node
/**
 * getServerGuidance (lib/guidance.server.ts): the signed-in layouts read the guidance preferences on the server and
 * hand them to GuidanceHost as `initial` (review F28, perf audit item 2). It never rejects: a failed read is handed over
 * as null (the host reads once in the browser), and nobody signed in reads nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const guidanceQuery = vi.fn();
let signedIn = true;
vi.mock("../trpc-server", () => ({
  serverApi: vi.fn(async () => (signedIn ? { auth: { userId: "u1" }, api: { founder: { preferences: { guidance: { query: guidanceQuery } } } } } : null)),
}));

import { getServerGuidance } from "../guidance.server";

const PREFS = { guidance: "off", textSize: "comfortable", explainersSeen: { home: true }, toursDone: { home: true }, checklistDismissedAt: null };

beforeEach(() => {
  signedIn = true;
  guidanceQuery.mockReset();
});

describe("getServerGuidance", () => {
  it("hands the account's answer over", async () => {
    guidanceQuery.mockResolvedValueOnce(PREFS);
    await expect(getServerGuidance()).resolves.toEqual({ signedIn: true, prefs: PREFS });
  });

  it("hands null over when the read fails, without rejecting", async () => {
    guidanceQuery.mockRejectedValueOnce(new Error("API unreachable"));
    await expect(getServerGuidance()).resolves.toEqual({ signedIn: true, prefs: null });
  });

  it("reads nothing when nobody is signed in", async () => {
    signedIn = false;
    await expect(getServerGuidance()).resolves.toEqual({ signedIn: false, prefs: null });
    expect(guidanceQuery).not.toHaveBeenCalled();
  });
});
