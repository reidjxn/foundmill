import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TrainingGroundScreen } from "../TrainingGroundScreen";
import { shoutInput, toGraphNodes } from "../TrainingGroundScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { AGENT_JUNO, SESSION_BUNDLE, SESSION_INDEX, SESSION_SOURCING, TASK_BUNDLE, TASK_PLAYWRIGHT, bundleEvents, edges, emptyTasksResponse, rawFrame, tasks, trainingGroundResponses } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };

describe("TrainingGroundScreen", () => {
  it("renders one tile per live task, subscribes to each session and shows the concurrency hint", async () => {
    const fake = createFakeSource({ responses: trainingGroundResponses() });
    renderScreen(fake, <TrainingGroundScreen {...props} />);
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
    expect(screen.getByText(/16 is the largest team your key supports/)).toBeTruthy();
    expect(fake.queried.get("dev.tasks.list")).toMatchObject({ status: ["running", "paused", "blocked", "review", "merging"] });
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
    await user.click(within(tile).getByRole("button", { name: "Upgrade to Opus" }));
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
    expect(fake.queried.get("dev.sessions.replay")).toEqual({ sessionId: SESSION_BUNDLE });
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
    const fake = createFakeSource({ responses: { ...trainingGroundResponses(), "agent.conversation.get": (input?: Record<string, unknown>) => ({ persona, input }) }, onMutate: () => ({ message: "ok", results: [] }) });
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
