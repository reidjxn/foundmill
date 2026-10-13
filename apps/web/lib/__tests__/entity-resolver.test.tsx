import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEntityResolver } from "../entity-resolver";

const BID = "11111111-1111-4111-8111-111111111111";
const REC = "22222222-2222-4222-8222-222222222222";
// A plain function, not vi.fn(): a spy keeps the rejected promise it returned, and vitest reports that as unhandled.
let calls = 0;
let answer: () => Promise<unknown> = () => Promise.resolve([]);
const lookup = (input: unknown) => {
  calls += 1;
  void input;
  return answer();
};

// The lookup goes through the query client's `fetchQuery`; the test runs the query function directly.
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ fetchQuery: (options: { queryFn: () => Promise<unknown> }) => options.queryFn() }),
}));
vi.mock("../trpc-react", () => ({
  useTRPC: () => ({ crm: { entity: { lookup: { queryOptions: (input: unknown) => ({ queryKey: ["lookup", input], queryFn: () => lookup(input) }) } } } }),
}));

const render = () => renderHook(() => useEntityResolver({ businessId: BID, agents: [], canReadCrm: true, navigate: () => undefined }));
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe("useEntityResolver (audit GTM-26: a failed lookup must not unlink mentions for good)", () => {
  beforeEach(() => {
    calls = 0;
  });

  it("resolves a record after the batched lookup lands", async () => {
    answer = () => Promise.resolve([{ id: REC, kind: "organisation", displayName: "Pennine", agentId: null, roles: [{ role: "customer", stage: "won" }] }]);
    const { result } = render();
    expect(result.current.resolve?.(REC)).toBeUndefined();
    await waitFor(() => expect(result.current.resolve?.(REC)?.name).toBe("Pennine"));
    expect(calls).toBe(1);
  });

  it("an id the lookup does not return is known not to exist, so its mention is plain text", async () => {
    answer = () => Promise.resolve([]);
    const { result } = render();
    result.current.resolve?.(REC);
    await waitFor(() => expect(result.current.exists?.(REC)).toBe(false));
  });

  it("a lookup that fails on the network leaves the mention linked (unknown), and is not repeated in a loop", async () => {
    answer = () => Promise.reject(new Error("Failed to fetch"));
    const { result } = render();
    result.current.resolve?.(REC);
    await waitFor(() => expect(calls).toBe(1));
    await settle();
    expect(result.current.exists?.(REC)).toBeUndefined();
    result.current.resolve?.(REC);
    await settle();
    expect(calls).toBe(1);
  });
});
