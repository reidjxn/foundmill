import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MODULE_KEYS, MODULE_TABS } from "@foundmill/shared";
import { isModulePackLoaded, loadModulePack, loadModulePacks, useModulePacks } from "./lazy";
import { getModuleScreen } from "./registry";

function Probe({ keys }: { keys: readonly (typeof MODULE_KEYS)[number][] }) {
  const { ready, error } = useModulePacks(keys);
  return <p data-testid="probe">{error ? "error" : ready ? "ready" : "loading"}</p>;
}

describe("module packs on demand", () => {
  afterEach(cleanup);

  it("registers nothing until a pack is asked for, then only that pack", async () => {
    // This file imports the loader and the registry only, never the barrel.
    expect(isModulePackLoaded("legal")).toBe(false);
    await loadModulePack("legal");
    expect(isModulePackLoaded("legal")).toBe(true);
    expect(getModuleScreen("legal", MODULE_TABS.legal[0]!.slug)?.moduleKey).toBe("legal");
    expect(isModulePackLoaded("team")).toBe(false);
  });

  it("shares one load between callers", async () => {
    const a = loadModulePack("team");
    const b = loadModulePack("team");
    expect(a).toBe(b);
    await a;
    expect(isModulePackLoaded("team")).toBe(true);
    // Once loaded, the answer is immediate.
    await expect(loadModulePack("team")).resolves.toBeUndefined();
  });

  it("re-renders a component when its packs have registered", async () => {
    expect(isModulePackLoaded("finance")).toBe(false);
    render(<Probe keys={["finance"]} />);
    expect(screen.getByTestId("probe").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("ready"), { timeout: 15_000 });
    expect(getModuleScreen("finance", "overview")?.tabSlug).toBe("overview");
  });

  it("is ready at once for no packs and for packs already loaded", async () => {
    await loadModulePacks(["finance"]);
    const { unmount } = render(<Probe keys={[]} />);
    expect(screen.getByTestId("probe").textContent).toBe("ready");
    unmount();
    render(<Probe keys={["finance"]} />);
    expect(screen.getByTestId("probe").textContent).toBe("ready");
  });

  it("loads every pack the barrel would", async () => {
    await act(() => loadModulePacks(MODULE_KEYS));
    for (const key of MODULE_KEYS) {
      for (const tab of MODULE_TABS[key]) expect(getModuleScreen(key, tab.slug)?.moduleKey).toBe(key);
    }
  });
});
