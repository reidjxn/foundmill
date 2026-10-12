import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SQUAD_VIEWS } from "@foundmill/dugout";
import { SquadScreen, TEAM_SQUAD_VIEWS, squadSummary } from "../SquadScreen";
import { toModelOptions, describeModelSet } from "../ModelChangeDialog";
import { toSquadRow, toolKeys, skillRating } from "../shared";
import { BID, AGENT_JUNO, AGENT_MARA, DEPT_TEAM, agents, compareJuno, dataResponses, emptyResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("team rows", () => {
  it("maps an API agent row onto Dugout's SquadRow (tools from keys or grants, rating from skills, wage estimate)", () => {
    const juno = agents.find((a) => a.id === AGENT_JUNO)!;
    const row = toSquadRow(juno, "EUR");
    expect(row).toMatchObject({ id: AGENT_JUNO, name: "Juno", dept: "dept-2", role: "Frontend engineer", departments: ["Development"], status: "healthy", currentTask: { id: expect.any(String), title: "Add a bundle picker to the product page" }, rating: 6.5, tools: ["github", "e2b"], model: "sonnet", wage: { amountMinor: 18_000, currency: "EUR" } });
    expect(row.latestUpdate).toEqual({ at: "2026-10-07T11:50:00.000Z", text: "Picker renders; writing the Playwright test" });
    expect(toolKeys({ tools: ["github", { connectorKey: "github" }, { connectorKey: "stripe" }] })).toEqual(["github", "stripe"]);
    expect(skillRating({ rating: null, skills: [{ skillKey: "a", group: "craft", displayed: 10 }, { skillKey: "b", group: "craft", displayed: 20 }] })).toBe(7.5);
    const mara = toSquadRow(agents.find((a) => a.id === AGENT_MARA)!);
    expect(mara.expectedReturnAt).toBe("2026-10-07T14:00:00.000Z");
  });

  it("uses the five BUILD §11.9 saved views and summarises statuses in the product vocabulary", () => {
    expect(TEAM_SQUAD_VIEWS.map((v) => v.name)).toEqual(SQUAD_VIEWS.map((v) => v.name));
    expect(TEAM_SQUAD_VIEWS.map((v) => v.name)).toEqual(["General", "Health", "Tools", "Cost", "Performance"]);
    // General carries Wage (DESIGN §9 Team); the latest update lives in the Health and Performance views.
    expect(TEAM_SQUAD_VIEWS[0]!.columns).toEqual(["name", "role", "departments", "status", "currentTask", "form", "rating", "model", "wage"]);
    expect(TEAM_SQUAD_VIEWS.slice(1)).toEqual(SQUAD_VIEWS.slice(1));
    expect(squadSummary(agents)).toBe("5 agents · 2 healthy · 1 degraded · 1 down · 1 idle");
  });

  it("builds model options relative to the current model and describes a set result", () => {
    const options = toModelOptions(compareJuno, "EUR");
    expect(options.map((o) => [o.key, o.wageDelta.amountMinor, o.lockedReason ?? null, o.warning ?? null])).toEqual([
      ["opus", 72_000, null, null],
      ["sonnet", 0, null, null],
      ["haiku", -14_000, null, "Workers on Haiku fail hard tasks more often"],
    ]);
    expect(toModelOptions({ ...compareJuno, options: compareJuno.options.map((o) => (o.modelKey === "haiku" ? { ...o, allowed: false, warning: "Locked to Sonnet" } : o)) }, "EUR")[2]!.lockedReason).toBe("Locked to Sonnet");
    expect(describeModelSet({ updated: ["a", "b"], skipped: [{ agentId: "c", reason: "locked route" }], warnings: [], retests: [{ runId: "r1" }] }, "opus")).toBe("Model set to Opus for 2 agents · 1 skipped (locked route) · 1 retest queued");
    expect(describeModelSet({ updated: ["a"], skipped: [], warnings: [], retests: [], superseded: ["r1", "r2"] }, "sonnet")).toBe("Model set to Sonnet for 1 agent · 2 earlier retests canceled");
  });
});

describe("SquadScreen", () => {
  it("renders the team table with the exact columns, Down with expected return, and the saved views", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Agents" });
    expect(within(table).getAllByRole("row")).toHaveLength(agents.length + 1);
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent?.replace(/Resize.*$/, "").trim());
    // The General view hides Tools and the latest update (reachable from the column chooser and the other views).
    expect(headers).toEqual(["Agent", "Role", "Departments", "Status", "Current task", "Form", "Rating", "Model", "Wage"]);
    expect(within(table).getByRole("link", { name: "Juno" })).toBeTruthy();
    expect(within(table).getByText("Down")).toBeTruthy();
    expect(within(table).getByText(/expected back in 2 hr/)).toBeTruthy();
    expect(within(table).queryByText("Injured")).toBeNull();
    expect(within(table).getByRole("link", { name: "Add a bundle picker to the product page" })).toBeTruthy();
    expect(screen.getByTestId("squad-summary").textContent).toBe("5 agents · 2 healthy · 1 degraded · 1 down · 1 idle");
    expect(screen.getByText("General")).toBeTruthy();
    expect(fake.queried.get("team.agents.list")).toEqual({ includeArchived: false });
    fireEvent.click(within(table).getByRole("link", { name: "Juno" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/agents/${AGENT_JUNO}/overview`);
  });

  it("flips a row's status the moment agent.health_changed arrives and refetches once (AC-11.9.1)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Agents" });
    expect(within(table).getAllByText("Healthy")).toHaveLength(2);
    const before = Date.now();
    act(() => {
      fake.emit({ id: "ev-1", type: "agent.health_changed", occurredAt: "2026-10-07T12:00:01Z", businessId: BID, payload: { agentId: AGENT_JUNO, from: "healthy", to: "failing", reason: "Loop detected" } });
    });
    expect(within(table).getAllByText("Healthy")).toHaveLength(1);
    expect(within(table).getByText("Failing")).toBeTruthy();
    expect(Date.now() - before).toBeLessThan(2000);
    expect(screen.getByTestId("squad-summary").textContent).toContain("1 failing");
    await waitFor(() => expect(fake.refetches["team.agents.list"]).toBe(1));
    // The override is dropped once the server copy agrees.
    act(() => {
      fake.setResponse("team.agents.list", { agents: agents.map((a) => (a.id === AGENT_JUNO ? { ...a, status: "failing" } : a)), templates: [] });
    });
    expect(within(table).getByText("Failing")).toBeTruthy();
    expect(screen.queryByTestId("live-note")).toBeNull();
  });

  it("changes the model through the picker and ApplyScopeDialog, then calls agent.model.set with the scope", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (path) => (path === "agent.model.set" ? { updated: [AGENT_JUNO, "x"], skipped: [], warnings: [], retests: [{ runId: "r1" }, { runId: "r2" }] } : {}) });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Agents" });
    const junoRow = within(table).getByRole("link", { name: "Juno" }).closest("[role='row']") as HTMLElement;
    await user.click(within(junoRow).getByRole("button", { name: "Sonnet" }));
    const dialog = await screen.findByTestId("model-dialog");
    expect(within(dialog).getByText("Model for Juno")).toBeTruthy();
    expect(fake.queried.get("agent.model.compare")).toEqual({ agentId: AGENT_JUNO });
    await user.click(within(dialog).getByRole("radio", { name: /Opus/ }));
    const scope = await screen.findByTestId("apply-scope-dialog");
    expect(within(scope).getByText("Model: Opus")).toBeTruthy();
    await user.click(within(scope).getByRole("radio", { name: /Apply to all frontend engineer agents/ }));
    await user.click(within(scope).getByTestId("apply-scope-confirm"));
    await waitFor(() => expect(fake.mutations).toEqual([{ path: "agent.model.set", input: { agentId: AGENT_JUNO, modelKey: "opus", applyScope: "type" } }]));
    await waitFor(() => expect(screen.getByTestId("model-notice").textContent).toBe("Model set to Opus for 2 agents · 2 retests queued"));
    expect(fake.refetches["team.agents.list"]).toBe(1);
  });

  it("offers right-click verbs: open profile, change model, clone, loan, release (not for the Chief of Staff)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ id: "new", name: "Juno II" }) });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Agents" });
    fireEvent.contextMenu(within(table).getByText("Chief of Staff"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open profile", "Change model (Opus)", "Clone…", "Loan to department…", "Release"]);
    expect(within(menu).getByRole("menuitem", { name: "Release" }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    fireEvent.contextMenu(within(table).getByText("Frontend engineer"));
    await user.click(await screen.findByRole("menuitem", { name: "Clone…" }));
    const clone = await screen.findByTestId("clone-dialog");
    expect((within(clone).getByLabelText("Name", { exact: false }) as HTMLInputElement).value).toBe("Juno II");
    await user.click(within(clone).getByRole("checkbox", { name: "Distribution" }));
    await user.click(within(clone).getByTestId("clone-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.clone", input: { agentId: AGENT_JUNO, name: "Juno II", departmentIds: [expect.any(String), expect.any(String)] } }));
    await waitFor(() => expect(screen.getByTestId("model-notice").textContent).toBe("Juno II joined the team."));
  });

  it("loans and releases from the context menu, keeping the dialog open on an API error", async () => {
    const user = userEvent.setup();
    let fail = true;
    const fake = createFakeSource({
      businessId: BID,
      responses: dataResponses,
      onMutate: (path) => {
        if (path === "team.agents.release" && fail) throw new Error("Running task must be stopped first");
        return {};
      },
    });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Agents" });
    fireEvent.contextMenu(within(table).getByText("Email engine"));
    await user.click(await screen.findByRole("menuitem", { name: "Loan to department…" }));
    const loan = await screen.findByTestId("loan-dialog");
    await user.click(within(loan).getByRole("combobox", { name: "To department" }));
    await user.click(await screen.findByRole("option", { name: "Development" }));
    await user.click(within(loan).getByRole("checkbox", { name: /Move instead of loan/ }));
    await user.click(within(loan).getByTestId("loan-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.loan", input: { agentId: AGENT_MARA, departmentId: expect.any(String), move: true } }));
    await waitFor(() => expect(screen.getByTestId("model-notice").textContent).toBe("Mara moved to Development."));

    fireEvent.contextMenu(within(table).getByText("Frontend engineer"));
    await user.click(await screen.findByRole("menuitem", { name: "Release" }));
    const release = await screen.findByTestId("release-dialog");
    expect(within(release).getByText(/Currently working on/)).toBeTruthy();
    await user.click(within(release).getByTestId("release-confirm"));
    expect(await within(release).findByRole("alert")).toBeTruthy();
    expect(within(release).getByRole("alert").textContent).toBe("Running task must be stopped first");
    fail = false;
    await user.click(within(release).getByTestId("release-confirm"));
    await waitFor(() => expect(screen.queryByTestId("release-dialog")).toBeNull());
    expect(fake.mutations.filter((m) => m.path === "team.agents.release")).toHaveLength(2);
  });

  it("shows an empty state that leads to Recruitment, a loading skeleton and an error with retry", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <SquadScreen {...props} />);
    expect(screen.getByText("No agents yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Recruitment" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/d/team/recruitment`);
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: { "department.list": [] } });
    const r2 = renderScreen(loading, <SquadScreen {...props} />);
    expect(document.querySelector("[data-module-screen='team/squad'] [aria-busy='true'], [data-module-screen='team/squad'] .animate-shimmer, [data-module-screen='team/squad'] [data-skeleton]")).toBeTruthy();
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.agents.list": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <SquadScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.agents.list"]).toBe(1);
  });
});
