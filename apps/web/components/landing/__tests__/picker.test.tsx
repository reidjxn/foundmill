// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExamplePicker } from "../ExamplePicker";
import { ExampleProvider, useExample, useExampleChoice } from "../examples/context";
import { peekExample, resetExampleCache } from "../examples";
import { NORTHWIND } from "../examples/northwind";

/** What the page shows: the business every section reads, and whether one is loading. */
function Shown() {
  const business = useExample();
  const { pending } = useExampleChoice();
  return (
    <span data-testid="shown" data-pending={pending ?? ""}>
      {business.identity.name}
    </span>
  );
}

function renderPicker(initial?: Parameters<typeof ExampleProvider>[0]["initial"]) {
  return render(
    <ExampleProvider initial={initial}>
      <ExamplePicker />
      <Shown />
    </ExampleProvider>,
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });
const shown = () => screen.getByTestId("shown").textContent;

beforeEach(() => {
  resetExampleCache();
  window.history.replaceState(null, "", "/");
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("the example picker", () => {
  it("is a radio group named Watch it run, one option per business, each named and described", () => {
    renderPicker();
    const group = screen.getByRole("radiogroup", { name: "Watch it run" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("data-example-option"))).toEqual(["tutorlane", "glitchwick", "northwind"]);
    expect(radio("Tutorlane").getAttribute("aria-checked")).toBe("true");
    expect(radio("Glitchwick").getAttribute("aria-checked")).toBe("false");
    // Each option is described by its vertical and its one line, for screen readers.
    const described = (radio("Glitchwick").getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described[0]).toBe("Developer tools");
    expect(described[1]).toMatch(/^AI playtesters that play every build/);
    // One tab stop: the chosen option.
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    // Nothing is announced until the visitor chooses.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows a business that is not loaded yet as pending, keeps the page on the current one, then swaps", async () => {
    renderPicker();
    fireEvent.click(radio("Glitchwick"));
    // Chosen at once (the radio is checked) while its content loads; the page still shows Tutorlane.
    expect(radio("Glitchwick").getAttribute("aria-checked")).toBe("true");
    expect(radio("Glitchwick").getAttribute("aria-busy")).toBe("true");
    expect(shown()).toBe("Tutorlane");
    expect(screen.getByTestId("shown").getAttribute("data-pending")).toBe("glitchwick");
    expect(screen.getByRole("status").textContent).toBe("Loading Glitchwick");
    await waitFor(() => expect(shown()).toBe("Glitchwick"));
    expect(radio("Glitchwick").hasAttribute("aria-busy")).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("Showing Glitchwick, Developer tools");
    expect(window.location.search).toBe("?example=glitchwick");
  });

  it("moves and chooses with the arrow keys, Home and End, wrapping at the ends, and keeps focus on the choice", async () => {
    renderPicker();
    radio("Tutorlane").focus();
    fireEvent.keyDown(radio("Tutorlane"), { key: "ArrowRight" });
    expect(radio("Glitchwick").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("Glitchwick"));
    fireEvent.keyDown(radio("Glitchwick"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(radio("Northwind Skincare"));
    fireEvent.keyDown(radio("Northwind Skincare"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(radio("Tutorlane"));
    expect(radio("Tutorlane").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Tutorlane"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radio("Northwind Skincare"));
    fireEvent.keyDown(radio("Northwind Skincare"), { key: "Home" });
    expect(document.activeElement).toBe(radio("Tutorlane"));
    fireEvent.keyDown(radio("Tutorlane"), { key: "End" });
    expect(document.activeElement).toBe(radio("Northwind Skincare"));
    // The tab stop follows the choice.
    expect(screen.getAllByRole("radio").map((o) => o.tabIndex)).toEqual([-1, -1, 0]);
    // Other keys are left alone.
    fireEvent.keyDown(radio("Northwind Skincare"), { key: "a" });
    expect(radio("Northwind Skincare").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(shown()).toBe("Northwind Skincare"));
  });

  it("follows only the latest choice when the visitor changes their mind while a business loads", async () => {
    renderPicker();
    fireEvent.click(radio("Glitchwick"));
    fireEvent.click(radio("Tutorlane"));
    expect(shown()).toBe("Tutorlane");
    expect(screen.getByTestId("shown").getAttribute("data-pending")).toBe("");
    await waitFor(() => expect(peekExample("glitchwick")).toBeTruthy());
    await act(async () => {});
    expect(shown()).toBe("Tutorlane");
    expect(window.location.search).toBe("");
  });

  it("writes the choice into the address without a navigation, keeping other parameters and the hash", async () => {
    window.history.replaceState(null, "", "/?utm_source=x#journey");
    const before = window.history.length;
    renderPicker();
    fireEvent.click(radio("Northwind Skincare"));
    expect(window.location.search).toBe("?utm_source=x&example=northwind");
    expect(window.location.hash).toBe("#journey");
    await waitFor(() => expect(shown()).toBe("Northwind Skincare"));
    fireEvent.click(radio("Tutorlane"));
    expect(window.location.search).toBe("?utm_source=x");
    expect(window.location.pathname).toBe("/");
    expect(window.history.length).toBe(before);
  });

  it("starts loading a business when the pointer is over its option or it has focus", async () => {
    renderPicker();
    expect(peekExample("northwind")).toBeUndefined();
    fireEvent.pointerEnter(radio("Northwind Skincare"));
    await waitFor(() => expect(peekExample("northwind")?.identity.name).toBe("Northwind Skincare"));
    expect(peekExample("glitchwick")).toBeUndefined();
    fireEvent.focus(radio("Glitchwick"));
    await waitFor(() => expect(peekExample("glitchwick")?.identity.name).toBe("Glitchwick"));
    // Choosing a loaded business swaps at once, with no pending state.
    fireEvent.click(radio("Northwind Skincare"));
    expect(shown()).toBe("Northwind Skincare");
    expect(radio("Northwind Skincare").hasAttribute("aria-busy")).toBe(false);
  });

  it("opens on a deep-linked business it was handed, which then needs no load", () => {
    window.history.replaceState(null, "", "/?example=northwind");
    renderPicker(NORTHWIND);
    expect(shown()).toBe("Northwind Skincare");
    expect(radio("Northwind Skincare").getAttribute("aria-checked")).toBe("true");
    expect(peekExample("northwind")).toBe(NORTHWIND);
    expect(window.location.search).toBe("?example=northwind");
  });

  it("drops a deep link it does not know from the address", () => {
    window.history.replaceState(null, "", "/?example=acme&utm_source=x");
    renderPicker();
    expect(shown()).toBe("Tutorlane");
    expect(window.location.search).toBe("?utm_source=x");
  });
});
