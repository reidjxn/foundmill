import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { checklistMeta, DEFAULT_FIRST_WEEK_ITEMS, FirstWeekChecklist, type FirstWeekItem } from "./FirstWeekChecklist";

const items: FirstWeekItem[] = DEFAULT_FIRST_WEEK_ITEMS.map((i, n) => ({ ...i, href: `/go/${i.id}`, done: n < 2 }));

describe("FirstWeekChecklist", () => {
  it("lists the seven first-week items in order, the page first, and asks for no bank or Stripe", () => {
    expect(DEFAULT_FIRST_WEEK_ITEMS.map((i) => i.label)).toEqual([
      "Publish your page",
      "Sign off the specification",
      "Sign off the roadmap",
      "Run a cycle",
      "Read a note from an agent",
      "Talk to an agent",
      "Start distribution",
    ]);
    expect(DEFAULT_FIRST_WEEK_ITEMS[0].id).toBe("publish_page");
  });

  it("is a panel titled for the week with the count in its meta, a check or a circle per row and a Go on what is left", () => {
    render(<FirstWeekChecklist items={items} onDismiss={() => {}} />);
    const panel = screen.getByRole("region", { name: "Your first week" });
    expect(panel.getAttribute("data-span")).toBe("4");
    expect(within(panel).getByText("2 of 7 done")).toBeTruthy();
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(within(rows[0] as HTMLElement).getByRole("img", { name: "Done" })).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
    expect(within(rows[2] as HTMLElement).getByRole("img", { name: "Not done" })).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByRole("link", { name: "Go: Run a cycle" }).getAttribute("href")).toBe("/go/run_cycle");
  });

  it("an item with an action instead of a route gets a Go button that calls it; one with neither has no Go", async () => {
    const onGo = vi.fn();
    const mixed: FirstWeekItem[] = [
      { id: "run_cycle", label: "Run a cycle", onGo, done: false },
      { id: "wait", label: "Nothing to open", done: false },
    ];
    render(<FirstWeekChecklist items={mixed} onDismiss={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Go: Run a cycle" }));
    expect(onGo).toHaveBeenCalledTimes(1);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(rows[1] as HTMLElement).queryByRole("link")).toBeNull();
  });

  it("Hide in the header calls onDismiss", async () => {
    const onDismiss = vi.fn();
    render(<FirstWeekChecklist items={items} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says All done once every item is done, and tells the caller once", () => {
    const onComplete = vi.fn();
    const done = items.map((i) => ({ ...i, done: true }));
    const { rerender } = render(<FirstWeekChecklist items={done} onDismiss={() => {}} onComplete={onComplete} />);
    const panel = screen.getByRole("region", { name: "Your first week" });
    expect(panel.getAttribute("data-complete")).toBe("true");
    expect(within(panel).getByText("All done")).toBeTruthy();
    expect(within(panel).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(panel).getByText("7 of 7 done")).toBeTruthy();
    rerender(<FirstWeekChecklist items={done} onDismiss={() => {}} onComplete={onComplete} />);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when guidance is off", () => {
    const { container } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <FirstWeekChecklist items={items} onDismiss={() => {}} />
      </GuidanceProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers the panel menu (Pin to Home) when given one", async () => {
    const onPinToHome = vi.fn();
    render(<FirstWeekChecklist items={items} onDismiss={() => {}} menu={{ onPinToHome }} />);
    expect(screen.getByRole("button", { name: "Panel menu" })).toBeTruthy();
  });

  it("counts in words", () => {
    expect(checklistMeta([{ done: true }, { done: false }, { done: false }])).toBe("1 of 3 done");
  });
});
