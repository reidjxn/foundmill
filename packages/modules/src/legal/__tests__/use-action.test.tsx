import "./setup";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { WidgetDataProvider } from "@foundmill/widgets";
import { useAction as useFinanceAction } from "../../finance/shared";
import { useAction as useLegalAction } from "../shared";
import { createFakeSource } from "./fake-source";

/**
 * A host's change resolves once it is saved, and its `settled` once the reads it made stale have reloaded
 * (apps/web lib/widget-data.tsx). `fresh` waits for both, for a screen that drops what it showed meanwhile.
 */
function hostWithSettle() {
  const fake = createFakeSource();
  let settle: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  fake.source.mutate = (<T,>() => Object.assign(Promise.resolve({ saved: true } as T), { settled })) as typeof fake.source.mutate;
  const wrapper = ({ children }: { children: ReactNode }) => <WidgetDataProvider source={fake.source}>{children}</WidgetDataProvider>;
  return { wrapper, settle };
}

describe.each([
  ["legal", useLegalAction],
  ["finance", useFinanceAction],
])("useAction (%s)", (_name, useAction) => {
  it("settles as soon as the change is saved, the reloads behind it", async () => {
    const { wrapper } = hostWithSettle();
    const { result } = renderHook(() => useAction(), { wrapper });
    const then = vi.fn();
    let answer: unknown;
    await act(async () => {
      answer = await result.current.run("legal.regulatory.set", { sector: "food" }, { key: "k", then });
    });
    expect(answer).toEqual({ saved: true });
    expect(then).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
  });

  it("with `fresh`, stays pending until the reads the change made stale have reloaded", async () => {
    const { wrapper, settle } = hostWithSettle();
    const { result } = renderHook(() => useAction(), { wrapper });
    const then = vi.fn();
    let run: Promise<unknown> = Promise.resolve();
    await act(async () => {
      run = result.current.run("finance.forecast.update", {}, { key: "save", fresh: true, then });
      await Promise.resolve();
    });
    expect(then).not.toHaveBeenCalled();
    expect(result.current.pending).toBe("save");
    await act(async () => {
      settle();
      await run;
    });
    expect(then).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
  });
});
