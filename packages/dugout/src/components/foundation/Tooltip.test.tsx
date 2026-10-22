/**
 * Tooltip: one Radix provider for the whole app (perf audit item 7). Below a `TooltipProvider` a Tooltip mounts no
 * provider of its own; outside one (a story, a test) it still mounts its own so it works anywhere.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RadixTooltip from "@radix-ui/react-tooltip";

const providers = vi.hoisted(() => ({ count: 0 }));

vi.mock("@radix-ui/react-tooltip", async (importOriginal) => {
  const actual = await importOriginal<typeof RadixTooltip>();
  function CountingProvider(props: ComponentProps<typeof actual.Provider>) {
    providers.count += 1;
    return <actual.Provider {...props} />;
  }
  return { ...actual, Provider: CountingProvider, TooltipProvider: CountingProvider };
});

import { Tooltip, TooltipProvider } from "./Tooltip";

beforeEach(() => {
  providers.count = 0;
});

describe("Tooltip", () => {
  it("uses the provider above it: many tooltips, one provider", () => {
    render(
      <TooltipProvider delayDuration={400}>
        {["a", "b", "c"].map((id) => (
          <Tooltip key={id} content={`Tip ${id}`}>
            <button type="button">{id}</button>
          </Tooltip>
        ))}
      </TooltipProvider>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(providers.count).toBe(1);
  });

  it("mounts its own provider outside one, and still opens on focus", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Standalone tip" delayDuration={0}>
        <button type="button">alone</button>
      </Tooltip>,
    );
    expect(providers.count).toBe(1);
    await user.tab();
    expect((await screen.findByRole("tooltip")).textContent).toContain("Standalone tip");
  });

  it("opens below the shared provider too", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Shared tip">
          <button type="button">shared</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect((await screen.findByRole("tooltip")).textContent).toContain("Shared tip");
  });

  it("renders the child alone when there is nothing to say", () => {
    render(
      <TooltipProvider>
        <Tooltip content="">
          <button type="button">bare</button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "bare" })).toBeTruthy();
    expect(providers.count).toBe(1);
  });
});
