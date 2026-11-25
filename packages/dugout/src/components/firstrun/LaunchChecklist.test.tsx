import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { launchChecklist } from "@foundmill/shared/launch-checklist";
import { LaunchChecklist } from "./LaunchChecklist";

const content = { pitch: "Fresh bread on your street", about: "Short.", forWhom: "", stage: "idea", showFounders: false, followForm: false } as const;

describe("LaunchChecklist", () => {
  it("shows each item as Ready or Not yet with its sentence, and says publishing works either way", () => {
    render(<LaunchChecklist items={launchChecklist({ name: "Maple Bakes", content })} />);
    const list = screen.getByRole("region", { name: "Before it goes live" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getAllByRole("img", { name: "Not yet" })).toHaveLength(2);
    expect(within(list).getByText(/You can publish now either way/)).toBeTruthy();
    // No action without a handler.
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("runs a Not yet item's one action", async () => {
    const onAction = vi.fn();
    render(<LaunchChecklist items={launchChecklist({ name: "Maple Bakes", content })} onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn on the Follow form" }));
    expect(onAction).toHaveBeenCalledWith("turn_on_follow");
  });
});
