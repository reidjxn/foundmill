import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LIVE_SESSIONS_LEDE, TrainingGroundScreen } from "../TrainingGroundScreen";
import { shoutInput, toGraphNodes } from "../TrainingGroundScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { openExplainer } from "../../explainer.testing";
import { AGENT_JUNO, SESSION_BUNDLE, SESSION_INDEX, SESSION_SOURCING, TASK_BUNDLE, TASK_PLAYWRIGHT, bundleEvents, edges, emptyTasksResponse, rawFrame, tasks, trainingGroundResponses } from "./fixtures";
import type { TasksListResponse } from "../types";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };

describe("TrainingGroundScreen", () => {
  it("renders one tile per live task, subscribes to each session and shows the concurrency hint", async () => {
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />, {}, { guidance: "on" });
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tiles = within(grid).getAllByRole("article");
    expect(tiles).toHaveLength(3);
    expect(within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ })).toBeTruthy();
    expect(within(grid).getByRole("article", { name: /Pike: Usage index/ })).toBeTruthy();
    expect(within(grid).getByRole("article", { name: /Wren: Supplier brief/ })).toBeTruthy();
    // The specialist task renders the specialist views, not a terminal.
    expect(within(grid).getByRole("tab", { name: "RFQ funnel" })).toBeTruthy();
    expect(fake.subscriberCount(`as:${SESSION_BUNDLE}`)).toBe(1);
    expect(fake.subscriberCount(`as:${SESSION_INDEX}`)).toBe(1);
    expect(fake.subscriberCount(`as:${SESSION_SOURCING}`)).toBe(1);
    expect(screen.getByTestId("ground-counts").textContent).toBe("3 live · 2 running");
    // The fixture's project is on Founder, which runs as many agents at once as Try (WP-14 T14).
    expect(screen.getByText(/your plan runs 4 agents at once/)).toBeTruthy();
    expect(fake.queried.get("dev.tasks.list")).toMatchObject({ status: ["running", "paused", "blocked", "review", "merging"] });
    // Guidance on: the department's intro says what a tile is (UX plan §7.10, §7.12), inside the panel's body.
    const explainer = openExplainer("development/live-sessions");
    expect(within(explainer).getByText(LIVE_SESSIONS_LEDE)).toBeTruthy();
    expect(within(explainer).getByText("The team building it. Watch work live, see the plan, review finished code.")).toBeTruthy();
    // Every tile carries the visible "…" beside its hover toolbar.
    expect(within(grid).getAllByRole("button", { name: /^More actions for/ })).toHaveLength(3);
  });

  it("guidance off: no intro and no '…' on the tiles; the hover toolbar and the shortcuts stay", () => {
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = screen.getByRole("region", { name: "Agent tiles" });
    expect(within(grid).getAllByRole("article")).toHaveLength(3);
    expect(document.querySelector("[data-explainer]")).toBeNull();
    expect(within(grid).queryAllByRole("button", { name: /^More actions for/ })).toHaveLength(0);
    expect(within(grid).getAllByRole("toolbar", { name: /^Controls for/ })).toHaveLength(3);
  });

  it("nobody at work: the intro sits above the empty state in the panel's body, never in place of it", () => {
    const fake = createFakeSource({ responses: { ...trainingGroundResponses(), "dev.tasks.list": emptyTasksResponse } });
    renderScreen(fake, <TrainingGroundScreen {...props} />, {}, { guidance: "on" });
    expect(screen.getByText("No agents are working right now")).toBeTruthy();
    expect(document.querySelector("[data-explainer='development/live-sessions']")).toBeTruthy();
  });

  it("gives every waiting tile its own words: a terminal shows its task's goal, a specialist with nothing yet its state and brief", async () => {
    const responses = trainingGroundResponses();
    const withGoals = (r: TasksListResponse): TasksListResponse => ({ ...r, items: r.items.map((t) => ({ ...t, goalMd: `## Goal\n\nShip ${t.title.toLowerCase()} behind a flag.` })) });
    const fake = createFakeSource({ responses: { ...responses, "dev.tasks.list": (input: Record<string, unknown> | undefined) => withGoals(responses["dev.tasks.list"](input)) } });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const juno = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    expect(within(juno).getByText(/Ship add a bundle picker to the product page behind a flag\./)).toBeTruthy();
    const wren = within(grid).getByRole("article", { name: /Wren: Supplier brief/ });
    expect(within(wren).getByText("No supplier records yet")).toBeTruthy();
    expect(within(wren).getByText("Ship supplier brief for the serum pump behind a flag.")).toBeTruthy();
    expect(within(grid).queryByText(/funnel fills as RFQs go out/)).toBeNull();
  });

  it("applies stream events to the tile (stored state first, stream on top) and throttles unfocused tiles", async () => {
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = () => within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    expect(within(tile()).getByLabelText("Progress 35%")).toBeTruthy();
    const events = bundleEvents();
    act(() => {
      fake.emit(rawFrame(events[0]!), `as:${SESSION_BUNDLE}`);
      fake.emit({ ch: `as:${SESSION_BUNDLE}`, e: rawFrame(events[2]!) }, `as:${SESSION_BUNDLE}`);
    });
    // Unfocused: nothing until the flush window (10 ms in tests) passes; then the formula value (0.2·4/6 + 0.5·2/2 = 63 %).
    expect(within(tile()).getByLabelText("Progress 35%")).toBeTruthy();
    await waitFor(() => expect(within(tile()).getByLabelText("Progress 63%")).toBeTruthy());
    expect(within(tile()).getByText("Implementing")).toBeTruthy();
    expect(within(tile()).getByText(/ETA/)).toBeTruthy();
    // A frame on another session's channel does not touch this tile.
    act(() => fake.emit(rawFrame(events[3]!), `as:${SESSION_INDEX}`));
    await waitFor(() => expect(within(within(grid).getByRole("article", { name: /Pike: Usage index/ })).getByText(/Nudge: Focus on tests/)).toBeTruthy());
    expect(within(tile()).queryByText(/Nudge: Focus on tests/)).toBeNull();
  });

  it("drives the controls through the dev.tasks procedures", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: trainingGroundResponses(), onMutate: () => ({ task: tasks[0], workflow: { queued: true } }) });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await user.click(within(tile).getByRole("button", { name: "Pause" }));
    expect(fake.mutations).toContainEqual({ path: "dev.tasks.pause", input: { taskId: TASK_BUNDLE } });
    await user.click(within(tile).getByRole("button", { name: "Use the strongest model" }));
    expect(fake.mutations).toContainEqual({ path: "dev.tasks.upgradeModel", input: { taskId: TASK_BUNDLE } });
    // Stop asks for confirmation inside the page (no browser confirm).
    await user.click(within(tile).getByRole("button", { name: "Stop and discard" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop and discard" });
    await user.click(within(dialog).getByRole("button", { name: "Stop and discard" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.stop", input: { taskId: TASK_BUNDLE } }));
    // A preset shout to one agent carries the API's preset label.
    await user.click(within(tile).getByRole("button", { name: "Nudge Juno" }));
    await user.click(await screen.findByRole("menuitem", { name: /Focus on tests/ }));
    expect(fake.mutations).toContainEqual({ path: "dev.tasks.shout", input: { taskId: TASK_BUNDLE, preset: "Focus on tests" } });
  });

  it("nudges to every agent from the header and reassigns through a dialog", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: trainingGroundResponses(), onMutate: () => ({ ok: true }) });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    await screen.findByRole("region", { name: "Agent tiles" });
    await user.click(screen.getByRole("button", { name: "Nudge" }));
    await user.click(await screen.findByRole("menuitem", { name: /Hurry up/ }));
    expect(fake.mutations).toContainEqual({ path: "dev.tasks.shout", input: { preset: "Hurry up" } });

    const grid = screen.getByRole("region", { name: "Agent tiles" });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await user.click(within(tile).getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog", { name: "Reassign task" });
    expect(within(dialog).getByRole("button", { name: "Reassign" })).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("combobox", { name: "New agent" }));
    await user.click(await screen.findByRole("option", { name: /Pike/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(fake.mutations.find((m) => m.path === "dev.tasks.reassign")?.input).toMatchObject({ taskId: TASK_BUNDLE }));
    expect(fake.mutations.find((m) => m.path === "dev.tasks.reassign")?.input.agentId).not.toBe(AGENT_JUNO);
  });

  it("opens the Claude Code export with the branch and checkout command", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await user.click(within(tile).getByRole("button", { name: "Open in Claude Code" }));
    const dialog = await screen.findByRole("dialog", { name: "Open in Claude Code" });
    expect(fake.queried.get("dev.tasks.openInClaudeCode")).toEqual({ taskId: TASK_BUNDLE });
    expect(within(dialog).getByText(`agent/${TASK_BUNDLE}`)).toBeTruthy();
    expect((within(dialog).getByLabelText("Checkout") as HTMLTextAreaElement).value).toContain(`git checkout agent/${TASK_BUNDLE}`);
  });

  it("loads every tile's replay on mount, so a tile that is not focused shows what its session already did (TPD-35)", async () => {
    const responses = trainingGroundResponses();
    const asked: string[] = [];
    const replay = (input: Record<string, unknown> | undefined) => {
      const sessionId = String(input?.sessionId);
      asked.push(sessionId);
      const base = responses["dev.sessions.replay"](input);
      if (sessionId !== SESSION_INDEX) return base;
      return {
        ...base,
        source: "stream",
        events: [
          { kind: "stdout", at: "2026-10-07T09:11:00Z", channel: "stdout", text: "PASS src/reports/usage.test.ts" },
          { kind: "tool_call", at: "2026-10-07T09:12:00Z", callId: "c1", tool: "run_migration", status: "awaiting_approval", approvalId: "a1" },
        ],
      };
    };
    const fake = createFakeSource({ responses: { ...responses, "dev.sessions.replay": replay } });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    expect(new Set(asked)).toEqual(new Set([SESSION_BUNDLE, SESSION_INDEX, SESSION_SOURCING]));
    const pike = within(grid).getByRole("article", { name: /Pike: Usage index/ });
    await waitFor(() => expect(within(pike).getByText(/PASS src\/reports\/usage\.test\.ts/)).toBeTruthy());
    expect(within(pike).queryByText(/has not written anything yet|first output/)).toBeNull();
    // The approval the session is waiting on shows, not the stored phase.
    expect(within(pike).getAllByText("Waiting").length).toBeGreaterThan(0);
    // The same event arriving live as well is applied once.
    act(() => fake.emit({ kind: "stdout", at: "2026-10-07T09:11:00Z", channel: "stdout", text: "PASS src/reports/usage.test.ts" }, `as:${SESSION_INDEX}`));
    await new Promise((r) => setTimeout(r, 30));
    expect(within(pike).getAllByText(/PASS src\/reports\/usage\.test\.ts/)).toHaveLength(1);
  });

  it("a started session whose stream is still empty reads Queued with no clock until its first event (SOAK-08)", async () => {
    const responses = trainingGroundResponses();
    const replay = (input: Record<string, unknown> | undefined) => ({ ...responses["dev.sessions.replay"](input), ...(input?.sessionId === SESSION_BUNDLE ? { source: "stream", events: [] } : {}) });
    const fake = createFakeSource({ responses: { ...responses, "dev.sessions.replay": replay } });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const juno = () => within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await waitFor(() => expect(within(juno()).getByText("Queued, waiting for a worker")).toBeTruthy());
    expect(within(juno()).queryByText(/session attached · streaming/)).toBeNull();
    expect(within(within(juno()).getByTestId("tile-footer")).getByText("Queued")).toBeTruthy();
    expect(screen.getByTestId("ground-counts").textContent).toBe("3 live · 1 running · 1 queued");
    // The first event means a worker has it.
    act(() => fake.emit(rawFrame(bundleEvents()[0]!), `as:${SESSION_BUNDLE}`));
    await waitFor(() => expect(within(juno()).queryByText("Queued, waiting for a worker")).toBeNull());
    expect(screen.getByTestId("ground-counts").textContent).toBe("3 live · 2 running");
  });

  it("tells the stream which tile is watched: only the focused tile's channel is focused (RES-12)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    expect([SESSION_BUNDLE, SESSION_INDEX, SESSION_SOURCING].map((id) => fake.focusOf(`as:${id}`))).toEqual([false, false, false]);
    await user.click(within(within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ })).getByTestId("tile-footer"));
    await waitFor(() => expect(fake.focusOf(`as:${SESSION_BUNDLE}`)).toBe(true));
    expect(fake.focusOf(`as:${SESSION_INDEX}`)).toBe(false);
  });

  it("ticks the elapsed clock every second while a session is live (VSOAK2-X1)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: new Date("2026-10-07T10:00:00Z") });
    try {
      const fake = createFakeSource({ responses: trainingGroundResponses() });
      renderScreen(fake, <TrainingGroundScreen {...props} />, { now: undefined });
      const juno = within(screen.getByRole("region", { name: "Agent tiles" })).getByRole("article", { name: /Juno: Add a bundle picker/ });
      const elapsed = () => within(juno).getByTitle("Elapsed").textContent;
      const before = elapsed();
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(elapsed()).not.toBe(before);
      expect(elapsed()).toMatch(/20m 5s|20m 05s/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("focuses a tile on click, shows the scrubber and replays the stream at a position", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const events = bundleEvents();
    act(() => {
      for (const e of events) fake.emit(rawFrame(e), `as:${SESSION_BUNDLE}`);
    });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await user.click(within(tile).getByTestId("tile-footer"));
    const scrubber = await screen.findByRole("group", { name: "Replay of Juno" });
    // Phase change + shout are marks; stdout and progress ticks are too frequent to mark.
    await waitFor(() => expect(within(scrubber).getByText("2 marks")).toBeTruthy());
    const focused = () => screen.getByRole("article", { name: /Juno: Add a bundle picker/ });
    // Live: every event applied (the focused tile is never throttled).
    await waitFor(() => expect(within(focused()).getByLabelText("Progress 63%")).toBeTruthy());
    // Step back twice (shout mark, then the phase mark): before the progress tick the tile shows the stored 35 %.
    await user.click(within(scrubber).getByRole("button", { name: "Previous event" }));
    expect(screen.getByRole("button", { name: "Back to live" })).toBeTruthy();
    await user.click(within(scrubber).getByRole("button", { name: "Previous event" }));
    await waitFor(() => expect(within(focused()).getByLabelText("Progress 35%")).toBeTruthy());
    expect(within(focused()).queryByText(/Nudge: Focus on tests/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to live" }));
    expect(screen.getByRole("button", { name: "Live" })).toHaveProperty("disabled", true);
    await waitFor(() => expect(within(focused()).getByLabelText("Progress 63%")).toBeTruthy());
    expect(within(focused()).getByText(/Nudge: Focus on tests/)).toBeTruthy();
  });

  it("after a nudge the tile shows the agent's one-bubble answer in its own voice; the focused strip offers its own presets", async () => {
    const user = userEvent.setup();
    const persona = {
      id: AGENT_JUNO,
      name: "Juno",
      avatarSeed: "juno",
      colourToken: "dept-2",
      voice: { greeting: "Here.", thinking: [], ack: ["Understood. Changing course in this step."] },
      nudges: [
        { key: "focus_on_tests", label: "Focus on tests", text: "Focus on tests", hint: "Make the acceptance tests pass first.", apiPreset: "Focus on tests" },
        { key: "check_sources", label: "Check your sources", text: "Check your sources: quote the record behind every figure.", hint: "Quote the record behind every figure.", apiPreset: null },
      ],
    };
    const fake = createFakeSource({ responses: { ...trainingGroundResponses(), "agent.conversation.get": (input?: Record<string, unknown>) => ({ persona, input }) }, onMutate: () => ({ message: "ok", results: [{ queued: true, workflowId: "session:s1" }] }) });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = () => within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await user.click(within(tile()).getByRole("button", { name: "Nudge Juno" }));
    await user.click(await screen.findByRole("menuitem", { name: /Simplify/ }));
    const ack = await screen.findByTestId("nudge-ack");
    // The first sentence of the voice's acknowledgement only; nothing was asked of a model.
    expect(ack.textContent).toContain("Understood.");
    expect(ack.textContent).not.toContain("Changing course");
    expect(ack.textContent).toContain("Nudge: Simplify.");
    expect(fake.queried.get("agent.conversation.get")).toEqual({ subject: { kind: "agent", id: AGENT_JUNO } });

    // Focus the tile: its strip offers the presets that fit Juno; a non-engineering preset goes as text.
    await user.click(within(tile()).getByTestId("tile-footer"));
    await user.click(await screen.findByTestId("nudge-menu"));
    expect(await screen.findByRole("menuitem", { name: /Check your sources/ })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: /Check your sources/ }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "dev.tasks.shout", input: { taskId: TASK_BUNDLE, text: "Check your sources: quote the record behind every figure." } }));
  });

  it("never says a nudge reached the agent when the orchestrator did not take it (audit #79)", async () => {
    const user = userEvent.setup();
    const persona = { key: "juno", name: "Juno", voice: { greeting: "Here.", thinking: [], ack: ["Understood. Changing course in this step."] }, nudges: [] };
    const fake = createFakeSource({
      responses: { ...trainingGroundResponses(), "agent.conversation.get": () => ({ persona }) },
      onMutate: () => ({ message: "ok", results: [{ queued: false, workflowId: "session:s1", reason: "Temporal is not reachable" }] }),
    });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await user.click(within(tile).getByRole("button", { name: "Nudge Juno" }));
    await user.click(await screen.findByRole("menuitem", { name: /Simplify/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Not delivered/));
    expect(screen.queryByTestId("nudge-ack")).toBeNull();
  });

  it("switches to the Task graph view and draws the whole task graph", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    await screen.findByRole("region", { name: "Agent tiles" });
    await user.click(screen.getByRole("radio", { name: "Task graph" }));
    const graph = await screen.findByRole("application", { name: /Task graph by status/ });
    expect(fake.queried.get("dev.tasks.list")).toEqual({ limit: 500 });
    expect(within(graph).getByRole("button", { name: /Playwright coverage for checkout, Ready/ })).toBeTruthy();
    expect(within(graph).getByRole("button", { name: /Add a bundle picker to the product page, Running, Juno/ })).toBeTruthy();
    // Selecting a task without a tile navigates to the Plan tab.
    await user.click(within(graph).getByRole("button", { name: /Playwright coverage for checkout/ }));
    expect(fake.navigations[0]).toBe(`/b/${BUSINESS_ID}/d/development/plan?task=${TASK_PLAYWRIGHT}`);
  });

  it("opens in the Task graph sub-view", async () => {
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} subView="formation" />);
    expect(await screen.findByRole("application", { name: /Task graph by status/ })).toBeTruthy();
  });

  it("shows the empty, loading and error states", async () => {
    const empty = createFakeSource({ responses: { ...trainingGroundResponses(), "dev.tasks.list": emptyTasksResponse } });
    const r = renderScreen(empty, <TrainingGroundScreen {...props} />);
    expect(await screen.findByText("No agents are working right now")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Plan" }));
    expect(empty.navigations[0]).toBe(`/b/${BUSINESS_ID}/d/development/plan`);
    r.unmount();

    const loading = createFakeSource({ responses: { "team.agents.list": trainingGroundResponses()["team.agents.list"] } });
    const l = renderScreen(loading, <TrainingGroundScreen {...props} />);
    expect(l.container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Agent tiles" })).toBeNull();
    l.unmount();

    const failing = createFakeSource({ responses: { ...trainingGroundResponses(), "dev.tasks.list": new Error("tasks unavailable") } });
    renderScreen(failing, <TrainingGroundScreen {...props} />);
    expect(await screen.findByText("tasks unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failing.refetches["dev.tasks.list"]).toBe(1);
  });

  it("refetches when task events arrive on the business channel", async () => {
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
    await screen.findByRole("region", { name: "Agent tiles" });
    act(() => fake.emit({ type: "task.completed", payload: { taskId: TASK_BUNDLE } }));
    expect(fake.refetches["dev.tasks.list"]).toBe(1);
    expect(fake.refetches["dev.sessions.list"]).toBe(1);
  });
});

describe("helpers", () => {
  it("shoutInput maps presets to the API labels and custom text to text", () => {
    expect(shoutInput({ preset: "ask_before_schema_changes", text: "Ask before schema changes" }, "t1")).toEqual({ taskId: "t1", preset: "Ask before schema changes" });
    expect(shoutInput({ preset: null, text: "Use the date helper" })).toEqual({ text: "Use the date helper" });
  });
  it("toGraphNodes turns edges into deps and ignores edges to unknown tasks", () => {
    const nodes = toGraphNodes(tasks, [...edges, { fromTask: "ghost", toTask: TASK_PLAYWRIGHT }], () => null);
    expect(nodes.find((n) => n.id === TASK_PLAYWRIGHT)?.deps).toEqual([TASK_BUNDLE]);
    expect(nodes.find((n) => n.id === TASK_BUNDLE)?.deps).toEqual([]);
  });
});
