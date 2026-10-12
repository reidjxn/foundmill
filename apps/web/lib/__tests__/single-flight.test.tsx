import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSingleFlight } from "../single-flight";

function deferred() {
  let resolve: () => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSingleFlight (Take charge: audit FR-02, a double click built two businesses)", () => {
  it("runs the first of two calls made in the same tick and ignores the second", async () => {
    const d = deferred();
    const run = vi.fn((_label: string) => d.promise);
    const { result } = renderHook(() => useSingleFlight(run));
    act(() => {
      result.current("a");
      result.current("b");
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a");
    await act(async () => {
      d.resolve();
      await d.promise;
    });
    result.current("c");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("opens again after a failure, so the founder can try again", async () => {
    const first = deferred();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSingleFlight(run, { closeOnSuccess: true }));
    result.current();
    result.current();
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.reject(new Error("Not committed"));
      await first.promise.catch(() => undefined);
    });
    result.current();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stays closed after a success when the screen is moving on", async () => {
    const run = vi.fn().mockResolvedValue({ business: { id: "b1" } });
    const { result, rerender } = renderHook(() => useSingleFlight(run, { closeOnSuccess: true }));
    await act(async () => {
      result.current();
      await Promise.resolve();
    });
    rerender();
    result.current();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
