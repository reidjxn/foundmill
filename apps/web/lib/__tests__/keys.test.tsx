import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createKeyboardRegistry, KeyboardRegistryProvider, usePageShortcuts, useRegisteredShortcuts } from "../keys";

describe("keyboard registry", () => {
  it("merges registrations, later wins per key, unregister restores", () => {
    const reg = createKeyboardRegistry();
    const a = vi.fn();
    const b = vi.fn();
    const offA = reg.register({ onEditLayout: a, onRefreshInbox: a });
    const offB = reg.register({ onEditLayout: b });
    expect(reg.current().onEditLayout).toBe(b);
    expect(reg.current().onRefreshInbox).toBe(a);
    offB();
    expect(reg.current().onEditLayout).toBe(a);
    offA();
    expect(reg.current()).toEqual({});
  });

  it("usePageShortcuts registers for the component lifetime and sees the latest closure", () => {
    const reg = createKeyboardRegistry();
    let seen = "";
    function Page({ label }: { label: string }) {
      usePageShortcuts({ onEditLayout: () => (seen = label) });
      return null;
    }
    function Shell() {
      const s = useRegisteredShortcuts();
      return <button data-testid="e" onClick={() => s.onEditLayout?.()} />;
    }
    const ui = (label: string) => (
      <KeyboardRegistryProvider value={reg}>
        <Shell />
        <Page label={label} />
      </KeyboardRegistryProvider>
    );
    const r = render(ui("one"));
    act(() => r.getByTestId("e").click());
    expect(seen).toBe("one");
    r.rerender(ui("two"));
    act(() => r.getByTestId("e").click());
    expect(seen).toBe("two");
    r.unmount();
    expect(reg.current().onEditLayout).toBeUndefined();
  });
});
