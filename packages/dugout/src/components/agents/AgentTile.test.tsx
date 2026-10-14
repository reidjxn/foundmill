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
import { SpecialistTile, defaultSpecialistView, specialistEmptyCopy } from "./SpecialistTile";
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
    await user.click(within(toolbar).getByRole("button", { name: /Nudge Juno/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Focus on tests/ }));
    expect(controls.onShout).toHaveBeenCalledWith("session-1", { preset: "focus_on_tests", text: "Focus on tests" });
  });

  it("sends a custom nudge from the dialog", async () => {
    const user = userEvent.setup();
    const onShout = vi.fn();
    render(<AgentTile session={session} now={NOW} terminalRenderer="plain" controls={{ onShout }} />);
    await user.click(screen.getByRole("button", { name: /Nudge Juno/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Custom message/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Message"), "Use the existing date helper.");
    await user.click(within(dialog).getByRole("button", { name: "Send nudge" }));
    expect(onShout).toHaveBeenCalledWith("session-1", { preset: null, text: "Use the existing date helper." });
  });

  it("shows Resume instead of Pause when paused and hides Upgrade for Opus agents", () => {
    const paused = { ...session, status: "paused" as const, agent: { ...session.agent, model: "opus" as const } };
    render(<AgentTile session={paused} now={NOW} terminalRenderer="plain" controls={{ onPause: vi.fn(), onResume: vi.fn(), onUpgradeModel: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upgrade to Opus" })).toBeNull();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("never clips its header: who and what on a row of their own, phase, progress and views on the next", () => {
    const long = { ...session, agent: { ...session.agent, name: "Sourcing and Manufacturing Specialist" }, task: { ...session.task, title: "Second batch purchase order pack for the refill range" } };
    const { container } = render(<AgentTile session={long} now={NOW} terminalRenderer="plain" />);
    const header = container.querySelector("[data-tile-header]")!;
    const identity = header.querySelector("[data-tile-identity]")!;
    const status = header.querySelector("[data-tile-status]")!;
    // Narrow tiles wrap the status row under the identity (the identity takes the full row); wide ones keep one row.
    expect(identity.className).toContain("basis-full");
    expect(identity.className).toContain("@min-[600px]:flex-1");
    expect(header.className).toContain("flex-wrap");
    // The full name and title are in the DOM (FitText steps them down), with the tooltip text for the last resort.
    const name = identity.querySelector("[data-tile-name]")!;
    const task = identity.querySelector("[data-tile-task]")!;
    expect(name.querySelector("[data-fit-box]")?.textContent).toBe("Sourcing and Manufacturing Specialist");
    expect(name.getAttribute("title")).toBe("Sourcing and Manufacturing Specialist");
    expect(task.querySelector("[data-fit-box]")?.textContent).toBe(long.task.title);
    expect(task.getAttribute("title")).toBe(long.task.title);
    expect(within(status as HTMLElement).getByRole("progressbar")).toBeTruthy();
    expect(within(status as HTMLElement).getByText(`${Math.round(session.progress * 100)}%`)).toBeTruthy();
    expect(within(status as HTMLElement).getByRole("tablist", { name: "Tile view" })).toBeTruthy();
    // The hover controls sit in the body, not over the header's second row.
    expect(screen.getByRole("toolbar").parentElement?.querySelector("[role=tabpanel]")).toBeTruthy();
  });

  it("an empty terminal shows the task's goal, so no two waiting tiles read alike; a small tile keeps only its prompt", () => {
    const waiting = { ...session, stdout: [], notes: [], lastNote: null, toolCalls: [], files: [], awaitingApprovalId: null, task: { ...session.task, goal: "Add pause and skip to the refill subscription." } };
    const { unmount } = render(<AgentTile session={waiting} now={NOW} terminalRenderer="plain" />);
    expect(screen.getByText(/Add pause and skip to the refill subscription\./)).toBeTruthy();
    expect(screen.queryByText("Lines stream in here as the session runs.")).toBeNull();
    unmount();
    const { container } = render(<AgentTile session={waiting} now={NOW} compact terminalRenderer="plain" />);
    expect(screen.queryByText(/Add pause and skip/)).toBeNull();
    expect(screen.getByText(/waiting for .*'s first output/)).toBeTruthy();
    // One clipped line in a small tile: the prompt never grows over the header (SOAK-07).
    expect(container.querySelector("[data-terminal-prompt]")?.className).toMatch(/truncate/);
    expect(container.querySelector("[data-terminal-empty]")?.className).toMatch(/overflow-hidden/);
    expect(container.querySelector("[role=tabpanel]")?.className).toMatch(/overflow-hidden/);
  });

  it("an empty terminal says what the session did instead of claiming it wrote nothing (TPD-35)", () => {
    const quiet = { ...session, stdout: [], status: "blocked" as const };
    const approval = { ...quiet, toolCalls: [...quiet.toolCalls, { callId: "c9", tool: "run_migration", connectorKey: null, status: "awaiting_approval" as const, argsSummary: "", at: START, approvalId: "a1" }] };
    const { unmount } = render(<AgentTile session={approval} now={NOW} terminalRenderer="plain" />);
    expect(screen.getByText("Waiting for your approval: run_migration")).toBeTruthy();
    expect(screen.queryByText(/has not written anything yet/)).toBeNull();
    unmount();
    const noted = { ...quiet, toolCalls: [], awaitingApprovalId: null, notes: [{ at: START, level: "info" as const, source: "agent" as const, text: "Reading the usage table schema." }, { at: START, level: "info" as const, source: "shout" as const, text: "Focus on tests" }] };
    render(<AgentTile session={noted} now={NOW} terminalRenderer="plain" />);
    expect(screen.getByText("Reading the usage table schema.")).toBeTruthy();
  });

  it("a session no worker has picked up reads Queued, with no clock and no streaming prompt (SOAK-08)", () => {
    const queued = { ...session, status: "running" as const, phase: "implementing" as const, queued: true, stdout: [], notes: [], lastNote: null, toolCalls: [], files: [] };
    const { container } = render(<AgentTile session={queued} now={NOW} terminalRenderer="plain" />);
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
    expect(screen.getByText("Queued, waiting for a worker")).toBeTruthy();
    expect(screen.queryByText(/session attached · streaming/)).toBeNull();
    expect(container.querySelector("[data-terminal-empty]")?.getAttribute("data-terminal-empty")).toBe("queued");
    expect(within(screen.getByTestId("tile-footer")).queryByTitle("Elapsed")).toBeNull();
    expect(within(screen.getByTestId("tile-footer")).getByText("Queued")).toBeTruthy();
    expect(sessionPill(queued)).toMatchObject({ word: "Queued", tone: "neutral" });
    // A blocked session is not queued, whatever the flag says.
    expect(sessionPill({ ...queued, status: "blocked" }).word).toBe("Waiting");
  });

  it("keeps the Estimate label on the cost at every width (SOAK-07)", () => {
    render(<AgentTile session={session} now={NOW} compact terminalRenderer="plain" />);
    const footer = screen.getByTestId("tile-footer");
    // The chip for roomy footers and the plain word for the smallest: one of the two is always shown by the container query.
    expect(footer.querySelectorAll("[data-provenance=estimate]")).toHaveLength(2);
    expect([...footer.querySelectorAll("[data-provenance=estimate]")].map((e) => e.className).join(" ")).toMatch(/@xs\/foot:hidden/);
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

describe("SpecialistTile empty views", () => {
  const empty = { rfq: [], quotes: [], samples: [], shipments: [] };
  it("say what each tile is missing in its own state, over its own brief", () => {
    expect(specialistEmptyCopy("funnel", { ...session, status: "running" })).toEqual({ title: "No RFQs sent yet", body: `${session.agent.name} on ${session.task.title}.` });
    expect(specialistEmptyCopy("quotes", { ...session, status: "paused", task: { ...session.task, goal: "Carton proof round 2." } })).toEqual({ title: "Paused · no quotes in", body: "Carton proof round 2." });
    expect(specialistEmptyCopy("samples", { ...session, status: "review", phase: "review" }).title).toBe("In review · no samples requested");
    expect(specialistEmptyCopy("shipments", { ...session, status: "blocked" }).title).toBe("Waiting · no freight booked");
  });
  it("renders the tile's own empty line, never the generic one, and switches with the view", async () => {
    const user = userEvent.setup();
    const sp = { ...session, status: "paused" as const, task: { ...session.task, kind: "specialist" as const, goal: "Review the second carton proof against the labelling checklist." } };
    render(<SpecialistTile session={sp} data={empty} now={NOW} />);
    // Nothing in any view: the line names no view (a carton proof never sends an RFQ, TPD-23).
    expect(screen.getByText("Paused · no supplier records yet")).toBeTruthy();
    expect(screen.queryByText(/no RFQs sent/)).toBeNull();
    expect(screen.getByText("Review the second carton proof against the labelling checklist.")).toBeTruthy();
    expect(screen.queryByText(/funnel fills as RFQs go out/)).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Samples" }));
    expect(screen.getByText("Paused · no samples requested")).toBeTruthy();
  });
});

describe("SpecialistTile opening view (TPD-23)", () => {
  const sp = { ...session, status: "review" as const, phase: "review" as const, task: { ...session.task, kind: "specialist" as const, goal: "Stability data for the serum reformulation." } };
  it("opens on the first view with records: a chemist's samples, not an empty RFQ funnel", () => {
    const sample = { id: "s1", supplier: "Lab A", stage: "testing" as const };
    expect(defaultSpecialistView({ rfq: [], quotes: [], samples: [sample], shipments: [] })).toBe("samples");
    expect(defaultSpecialistView({ rfq: [], quotes: [], samples: [], shipments: [] })).toBe("funnel");
    expect(specialistEmptyCopy("funnel", sp, { allEmpty: true }).title).toBe("In review · no supplier records yet");
    expect(specialistEmptyCopy("funnel", { ...sp, status: "running" }, { allEmpty: true }).title).toBe("No supplier records yet");
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
