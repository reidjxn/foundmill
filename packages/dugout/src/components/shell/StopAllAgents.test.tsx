import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StopAllAgents } from "./StopAllAgents";

describe("StopAllAgents", () => {
  it("confirms before calling onConfirm and closes when it resolves", async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<StopAllAgents onConfirm={onConfirm} runningCount={7} />);
    await user.click(screen.getByTestId("stop-all-trigger"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Stop all agents?" })).toBeTruthy();
    expect(screen.getByText(/7 running sessions stop now/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Stop all agents" });
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open and shows the error when the stop fails", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => Promise.reject(new Error("Temporal unreachable")));
    render(<StopAllAgents onConfirm={onConfirm} />);
    await user.click(screen.getByTestId("stop-all-trigger"));
    await user.click(screen.getByRole("button", { name: "Stop all agents" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Temporal unreachable"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("cancel closes without calling onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StopAllAgents onConfirm={onConfirm} variant="button" />);
    await user.click(screen.getByTestId("stop-all-trigger"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
