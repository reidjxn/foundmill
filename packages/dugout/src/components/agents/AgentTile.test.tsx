import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const term = { open: vi.fn(), write: vi.fn(), reset: vi.fn(), dispose: vi.fn(), loadAddon: vi.fn(), scrollToBottom: vi.fn() };
const fit = { fit: vi.fn(), dispose: vi.fn() };
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor() {
      return term;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    constructor() {
      return fit;
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { AgentTile } from "./AgentTile";
import { generateMockSessionEvents, mockSessionSeed } from "./mock";
import { reduceSessionEvents } from "./progress";
import { TerminalView, needsReplay } from "./TerminalView";
import { isInteractiveTarget, sessionPill } from "./TileFrame";
import type { StdoutChunk } from "./types";

const START = "2026-10-07T09:00:00Z";
const NOW = new Date("2026-10-07T09:12:00Z");
const session = reduceSessionEvents(mockSessionSeed(0, START), generateMockSessionEvents(0, START, { outcome: "running", shout: true }));

describe("sessionPill", () => {
  it("status wins over phase and every state has a word", () => {
    expect(sessionPill({ status: "blocked", phase: "testing" }).word).toBe("Waiting");
    expect(sessionPill({ status: "running", phase: "testing" }).word).toBe("Testing");
    expect(sessionPill({ status: "done", phase: "done" }).tone).toBe("good");
    expect(sessionPill({ status: "failed", phase: "implementing" }).tone).toBe("bad");
  });

  it("isInteractiveTarget detects buttons and links", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div><button><span id="s"></span></button><p id="p"></p></div>';
    expect(isInteractiveTarget(root.querySelector("#s"), root)).toBe(true);
    expect(isInteractiveTarget(root.querySelector("#p"), root)).toBe(false);
  });
});

describe("AgentTile", () => {
  beforeEach(() => {
    term.write.mockClear();
    term.reset.mockClear();
    fit.fit.mockClear();
  });

  it("renders header, phase pill, progress ring and footer facts", () => {
    render(<AgentTile session={session} now={NOW} terminalRenderer="plain" />);
    expect(screen.getByRole("article", { name: /Juno: Add a bundle picker/ })).toBeTruthy();
    expect(screen.getByText("Testing")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: /Progress/ }).getAttribute("aria-valuenow")).toBe(String(Math.round(session.progress * 100)));
    const footer = screen.getByTestId("tile-footer");
    expect(footer.textContent).toContain("12m 00s");
    expect(footer.textContent).toContain("tokens");
    expect(footer.textContent).toContain("Estimate");
    expect(footer.textContent).toContain("Playwright failed on price formatting");
    expect(session.notes.some((n) => n.source === "shout")).toBe(true);
  });

  it("switches views with tabs and arrow keys", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<AgentTile session={session} now={NOW} terminalRenderer="plain" diffEngine="local" onViewChange={onViewChange} />);
    expect(screen.getByRole("log", { name: /Terminal output for Juno/ }).textContent).toContain("pnpm install");
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(onViewChange).toHaveBeenCalledWith("plan");
    expect(screen.getByText("Write Playwright tests")).toBeTruthy();
    expect(screen.getByText(/Acceptance tests: 3 of 3 passing/)).toBeTruthy();
    const planTab = screen.getByRole("tab", { name: "Plan" });
    planTab.focus();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onViewChange).toHaveBeenLastCalledWith("preview");
    expect(screen.getByText(/A preview appears after the first successful build/)).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Diff" }));
    const files = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(files).getAllByRole("button").some((b) => b.textContent?.includes("bundle-picker.tsx"))).toBe(true);
    expect(screen.getByText("+18")).toBeTruthy();
    expect(screen.getByText("src/styles/product.css")).toBeTruthy();
  });

  it("exposes the hover controls and routes them to handlers", async () => {
    const user = userEvent.setup();
    const controls = { onPause: vi.fn(), onResume: vi.fn(), onShout: vi.fn(), onReassign: vi.fn(), onUpgradeModel: vi.fn(), onStop: vi.fn() };
    render(<AgentTile session={session} now={NOW} terminalRenderer="plain" controls={controls} />);
    const toolbar = screen.getByRole("toolbar", { name: /Controls for Juno/ });
    await user.click(within(toolbar).getByRole("button", { name: "Pause" }));
    expect(controls.onPause).toHaveBeenCalledWith("session-1");
    await user.click(within(toolbar).getByRole("button", { name: "Upgrade to Opus" }));
    expect(controls.onUpgradeModel).toHaveBeenCalledWith("session-1");
    await user.click(within(toolbar).getByRole("button", { name: "Stop and discard" }));
    expect(controls.onStop).toHaveBeenCalledWith("session-1");
    await user.click(within(toolbar).getByRole("button", { name: /Shout to Juno/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Focus on tests/ }));
    expect(controls.onShout).toHaveBeenCalledWith("session-1", { preset: "focus_on_tests", text: "Focus on tests" });
  });

  it("sends a custom shout from the dialog", async () => {
    const user = userEvent.setup();
    const onShout = vi.fn();
    render(<AgentTile session={session} now={NOW} terminalRenderer="plain" controls={{ onShout }} />);
    await user.click(screen.getByRole("button", { name: /Shout to Juno/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Custom message/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Message"), "Use the existing date helper.");
    await user.click(within(dialog).getByRole("button", { name: "Send shout" }));
    expect(onShout).toHaveBeenCalledWith("session-1", { preset: null, text: "Use the existing date helper." });
  });

  it("shows Resume instead of Pause when paused and hides Upgrade for Opus agents", () => {
    const paused = { ...session, status: "paused" as const, agent: { ...session.agent, model: "opus" as const } };
    render(<AgentTile session={paused} now={NOW} terminalRenderer="plain" controls={{ onPause: vi.fn(), onResume: vi.fn(), onUpgradeModel: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upgrade to Opus" })).toBeNull();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("focus click ignores controls and calls onFocus from the body", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<AgentTile session={session} now={NOW} terminalRenderer="plain" onFocus={onFocus} controls={{ onPause: vi.fn() }} />);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onFocus).not.toHaveBeenCalled();
    await user.click(screen.getByRole("log"));
    expect(onFocus).toHaveBeenCalledWith("session-1");
  });
});

describe("TerminalView with xterm", () => {
  const chunk = (i: number): StdoutChunk => ({ at: new Date(Date.parse(START) + i * 1000).toISOString(), channel: "stdout", text: `line ${i}\n` });

  it("needsReplay detects rewinds", () => {
    const a = [chunk(0), chunk(1)];
    expect(needsReplay(a, [...a, chunk(2)])).toBe(false);
    expect(needsReplay(a, [chunk(0)])).toBe(true);
    expect(needsReplay(a, [chunk(5), chunk(6)])).toBe(true);
    expect(needsReplay([], a)).toBe(false);
  });

  it("writes streamed stdout incrementally, fits, and replays from the top on rewind", async () => {
    const { rerender } = render(<TerminalView chunks={[chunk(0), chunk(1)]} label="Terminal" renderer="xterm" />);
    await waitFor(() => expect(term.open).toHaveBeenCalled());
    await waitFor(() => expect(term.write).toHaveBeenCalledTimes(2));
    expect(fit.fit).toHaveBeenCalled();
    expect(term.write.mock.calls[0]?.[0]).toBe("line 0\r\n");
    await act(async () => {
      rerender(<TerminalView chunks={[chunk(0), chunk(1), chunk(2)]} label="Terminal" renderer="xterm" />);
    });
    expect(term.write).toHaveBeenCalledTimes(3);
    expect(term.write.mock.calls[2]?.[0]).toBe("line 2\r\n");
    expect(term.reset).not.toHaveBeenCalled();
    await act(async () => {
      rerender(<TerminalView chunks={[chunk(0)]} label="Terminal" renderer="xterm" />);
    });
    expect(term.reset).toHaveBeenCalledTimes(1);
    expect(term.write).toHaveBeenCalledTimes(4);
    expect(term.scrollToBottom).toHaveBeenCalled();
  });

  it("colours stderr red in the ANSI stream", async () => {
    term.write.mockClear();
    render(<TerminalView chunks={[{ at: START, channel: "stderr", text: "boom\n" }]} label="Terminal" renderer="xterm" />);
    await waitFor(() => expect(term.write).toHaveBeenCalled());
    expect(term.write.mock.calls[0]?.[0]).toBe("\u001b[31mboom\r\n\u001b[0m");
  });
});
