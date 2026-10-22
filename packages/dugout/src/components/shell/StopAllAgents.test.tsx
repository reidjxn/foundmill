import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { STOP_ALL_CONSEQUENCE, STOP_ALL_TOOLTIP, StopAllAgents, stopAllDescription } from "./StopAllAgents";

describe("StopAllAgents", () => {
  it("confirms before calling onConfirm and closes when it resolves", async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<StopAllAgents onConfirm={onConfirm} runningCount={7} />);
    // The trigger says what it does and that nothing is lost (B6); the dialog opens with the reassurance.
    expect(STOP_ALL_TOOLTIP).toBe("Stop all agents (pauses everything, nothing is lost)");
    expect(stopAllDescription(0, true)).toMatch(/^Nothing is deleted\. Every running session stops now\./);
    expect(stopAllDescription(1, true)).toContain("1 running session stops now.");
    await user.hover(screen.getByTestId("stop-all-trigger"));
    expect((await screen.findAllByText(STOP_ALL_TOOLTIP)).length).toBeGreaterThan(0);
    await user.click(screen.getByTestId("stop-all-trigger"));
    expect(onConfirm).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Stop all agents?" });
    expect(dialog.textContent).toContain("Nothing is deleted. 7 running sessions stop now.");
    expect(screen.getByText(/7 running sessions stop now/)).toBeTruthy();
    // Under the confirm: what the stop does, that it costs nothing and can be undone (a ConsequenceLine).
    const consequence = screen.getByTestId("stop-all-consequence");
    expect(consequence.hasAttribute("data-consequence")).toBe(true);
    expect(consequence.textContent).toContain(STOP_ALL_CONSEQUENCE);
    expect(consequence.textContent).toContain("No cost");
    expect(consequence.querySelector("[data-consequence-reversible='true']")?.textContent).toBe("Reversible");
    expect(STOP_ALL_CONSEQUENCE).toBe("Running sessions stop now; tasks keep their state. Nothing is deleted.");
    const confirm = screen.getByRole("button", { name: "Stop all agents" });
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a stop that never answers stops holding the dialog after the escape time (audit RES-13)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    render(<StopAllAgents onConfirm={onConfirm} pendingEscapeMs={40} />);
    await user.click(screen.getByTestId("stop-all-trigger"));
    await user.click(screen.getByRole("button", { name: "Stop all agents" }));
    // Pending: Esc and Cancel are held while the server has its budget.
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Past it: the founder may close the dialog; the request keeps going.
    await waitFor(() => expect(screen.getByTestId("stop-all-slow")).toBeTruthy());
    // The dialog's own close mark and the footer button are both back.
    const closers = screen.getAllByRole("button", { name: "Close" });
    expect(closers.length).toBeGreaterThanOrEqual(2);
    await user.click(closers[closers.length - 1]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("tells a member, viewer or advisor who can stop the agents instead of offering a stop the API refuses (audit RUI-05)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<StopAllAgents onConfirm={onConfirm} canStop={false} />);
    await user.click(screen.getByTestId("stop-all-trigger"));
    const dialog = screen.getByRole("dialog", { name: "Stop all agents" });
    expect(dialog.textContent).toContain("Only an owner or admin");
    expect(screen.queryByRole("button", { name: "Stop all agents" })).toBeNull();
    // No confirm, so no line under it.
    expect(screen.queryByTestId("stop-all-consequence")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
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
