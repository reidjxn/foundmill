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
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
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

  it("while the team is stopped the trigger is Resume agents: an owner confirms and onResume runs", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onResume = vi.fn(() => Promise.resolve());
    render(<StopAllAgents onConfirm={onConfirm} stopped={{ since: "2026-10-12T15:45:00Z", reason: "Stop all agents", onResume, canResume: true, hint: "Storing a new key resumes the team by itself." }} />);
    expect(screen.queryByTestId("stop-all-trigger")).toBeNull();
    await user.click(screen.getByTestId("resume-agents-trigger"));
    const dialog = screen.getByRole("dialog", { name: "Resume agents?" });
    expect(dialog.textContent).toContain("because Stop all agents");
    expect(dialog.textContent).toContain("Oct 12");
    expect(dialog.textContent).toContain("Storing a new key resumes the team by itself.");
    await user.click(screen.getByRole("button", { name: "Resume agents" }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("someone who cannot resume sees why the team is stopped and no Resume button", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(<StopAllAgents onConfirm={vi.fn()} stopped={{ reason: "the credits ran out", onResume, canResume: false }} />);
    await user.click(screen.getByTestId("resume-agents-trigger"));
    expect(screen.getByRole("dialog", { name: "Agents are stopped" }).textContent).toContain("An owner or admin resumes the agents.");
    expect(screen.queryByRole("button", { name: "Resume agents" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onResume).not.toHaveBeenCalled();
  });

  it("a failed resume keeps the dialog open with the error", async () => {
    const user = userEvent.setup();
    render(<StopAllAgents onConfirm={vi.fn()} stopped={{ reason: "the Anthropic key was revoked", onResume: () => Promise.reject(new Error("Store a key in Settings › Keys first.")), canResume: true }} />);
    await user.click(screen.getByTestId("resume-agents-trigger"));
    await user.click(screen.getByRole("button", { name: "Resume agents" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Store a key"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens with focus on Cancel, so Enter straight away stops nothing, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StopAllAgents onConfirm={onConfirm} variant="button" />);
    const trigger = screen.getByTestId("stop-all-trigger");
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Stop all agents?" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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
