import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskStatus } from "@foundmill/shared";
import { TaskRunState, canStartTask, taskRunInfo } from "./TaskRunState";

describe("taskRunInfo", () => {
  it("names each state", () => {
    expect(taskRunInfo("running")).toMatchObject({ kind: "running", label: "Running now" });
    expect(taskRunInfo("paused")).toMatchObject({ kind: "paused", label: "Resume" });
    expect(taskRunInfo("review")).toMatchObject({ kind: "review", label: "In review" });
    expect(taskRunInfo("merging")).toMatchObject({ kind: "merging", label: "Merging" });
    expect(taskRunInfo("done")).toMatchObject({ kind: "done", label: "Done" });
  });

  it("starts planned, ready, stopped, failed and free blocked tasks", () => {
    for (const s of ["planned", "ready", "stopped", "failed", "blocked"] as TaskStatus[]) {
      expect(taskRunInfo(s, [])).toMatchObject({ kind: "startable", label: "Run now" });
      expect(canStartTask(s)).toBe(true);
    }
  });

  it("waits on open dependencies: the first by name, then a count", () => {
    expect(taskRunInfo("planned", ["Pause and skip"])).toEqual({ kind: "waiting", label: "Runs after Pause and skip", sentence: "Runs after Pause and skip finishes" });
    expect(taskRunInfo("blocked", ["A", "B", "C"])).toEqual({ kind: "waiting", label: "Runs after A and 2 more", sentence: "Runs after A and 2 more finish" });
    for (const s of ["planned", "ready", "blocked"] as TaskStatus[]) expect(canStartTask(s, ["A"])).toBe(false);
  });

  it("never lets a task that is already underway or finished be started", () => {
    for (const s of ["running", "paused", "review", "merging", "done"] as TaskStatus[]) expect(canStartTask(s, [])).toBe(false);
    // A dependency does not change a state that is already live.
    expect(taskRunInfo("running", ["A"]).kind).toBe("running");
    expect(taskRunInfo("paused", ["A"]).kind).toBe("paused");
  });
});

describe("TaskRunState", () => {
  it("runs a startable task from its button", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<TaskRunState status="ready" onRun={onRun} />);
    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("is reachable and pressable from the keyboard", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(<TaskRunState status="paused" onResume={onResume} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Resume" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it("does not bubble a press to the row", async () => {
    const user = userEvent.setup();
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <TaskRunState status="failed" onRun={() => {}} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(onRow).not.toHaveBeenCalled();
  });

  it("shows no button when the caller gives no handler, and none while a press is in flight", () => {
    const onRun = vi.fn();
    const { rerender } = render(<TaskRunState status="ready" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<TaskRunState status="ready" onRun={onRun} pending />);
    const busy = screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("says a running task is running, with an icon and words", () => {
    render(<TaskRunState status="running" />);
    expect(screen.getByRole("img", { name: "Running now" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says what a waiting task runs after, and is not a button", () => {
    render(<TaskRunState status="planned" waitingOn={["Subscription pause and skip"]} onRun={() => {}} />);
    expect(screen.getByRole("img", { name: "Runs after Subscription pause and skip finishes" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["review", "In review"],
    ["merging", "Merging"],
    ["done", "Done"],
  ] as const)("shows %s as a read-only state", (status, name) => {
    render(<TaskRunState status={status} onRun={() => {}} onResume={() => {}} />);
    expect(screen.getByRole("img", { name })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the text variant shows the label as words with the button beside it", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const { rerender } = render(<TaskRunState status="ready" variant="text" onRun={onRun} />);
    expect(screen.getByText("Run now")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(onRun).toHaveBeenCalled();
    rerender(<TaskRunState status="planned" variant="text" waitingOn={["A", "B"]} />);
    expect(screen.getByText("Runs after A and 1 more")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<TaskRunState status="running" variant="text" />);
    expect(screen.getByText("Running now")).toBeTruthy();
  });
});
