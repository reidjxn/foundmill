import "./setup";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GuidanceProvider, SQUAD_VIEWS } from "@foundmill/dugout";
import { termsWithGlossary } from "@foundmill/shared/terms";
import { SIMPLE_VIEW_ID, SquadScreen, TEAM_SQUAD_VIEWS, specialistsLabel, squadSummary, squadTreeRows } from "../SquadScreen";
import { toModelOptions, describeModelSet } from "../ModelChangeDialog";
import { toSquadRow, toolKeys, skillRating } from "../shared";
import { teamTree } from "@foundmill/shared/team-tiers";
import { BID, AGENT_COS, AGENT_JUNO, AGENT_LINK, AGENT_MARA, AGENT_PIKE, DEPT_TEAM, agents, compareJuno, dataResponses, departments, emptyResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";
import { openExplainer } from "../../explainer.testing";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("team rows", () => {
  it("maps an API agent row onto Dugout's SquadRow (tools from keys or grants, the 1–20 mean from skills, wage estimate)", () => {
    const juno = agents.find((a) => a.id === AGENT_JUNO)!;
    const row = toSquadRow(juno, "EUR");
    // One scale everywhere (founder, Oct 20, 2026): the 1–20 mean of the skills, as the profile header shows it.
    expect(row).toMatchObject({ id: AGENT_JUNO, name: "Juno", dept: "dept-2", role: "Frontend engineer", departments: ["Development"], status: "healthy", currentTask: { id: expect.any(String), title: "Add a bundle picker to the product page" }, rating: 13, tools: ["github", "e2b"], model: "sonnet", wage: { amountMinor: 18_000, currency: "EUR" } });
    expect(row.latestUpdate).toEqual({ at: "2026-10-07T11:50:00.000Z", text: "Picker renders; writing the Playwright test" });
    expect(toolKeys({ tools: ["github", { connectorKey: "github" }, { connectorKey: "stripe" }] })).toEqual(["github", "stripe"]);
    expect(skillRating({ rating: null, skills: [{ skillKey: "a", group: "craft", displayed: 10 }, { skillKey: "b", group: "craft", displayed: 20 }] })).toBe(15);
    expect(skillRating({ rating: null, skills: [{ skillKey: "a", group: "craft", displayed: 14 }, { skillKey: "b", group: "craft", displayed: 17 }, { skillKey: "c", group: "craft", displayed: 12 }] })).toBe(14.3);
    // The api's `rating20` wins when it is there; the deprecated 1–10 figure is doubled only when the row carries no
    // skills; nothing at all reads 0 (the cell shows "—").
    expect(skillRating({ rating20: 15.5, rating: 7.8, skills: [{ skillKey: "a", group: "craft", displayed: 10 }] })).toBe(15.5);
    expect(skillRating({ rating20: null, rating: 6.5, skills: [] })).toBe(13);
    expect(skillRating({ rating: 6.5, skills: [] })).toBe(13);
    expect(skillRating({ rating: null, skills: [] })).toBe(0);
    const mara = toSquadRow(agents.find((a) => a.id === AGENT_MARA)!, "EUR");
    expect(mara.expectedReturnAt).toBe("2026-10-07T14:00:00.000Z");
  });

  it("uses Simple plus the five BUILD §11.9 saved views and summarises statuses in the product vocabulary", () => {
    expect(TEAM_SQUAD_VIEWS.map((v) => v.name)).toEqual(["Simple", ...SQUAD_VIEWS.map((v) => v.name)]);
    expect(TEAM_SQUAD_VIEWS.map((v) => v.name)).toEqual(["Simple", "General", "Health", "Tools", "Cost", "Performance"]);
    // Simple (UX plan §7.10): Agent, Status, Current task, Rating, built in so it cannot be deleted.
    expect(TEAM_SQUAD_VIEWS[0]).toMatchObject({ id: SIMPLE_VIEW_ID, builtIn: true, columns: ["name", "status", "currentTask", "rating"] });
    // General carries Wage (DESIGN §9 Team); the latest update lives in the Health and Performance views.
    expect(TEAM_SQUAD_VIEWS[1]!.columns).toEqual(["name", "role", "departments", "status", "currentTask", "form", "rating", "model", "wage"]);
    expect(TEAM_SQUAD_VIEWS.slice(2)).toEqual(SQUAD_VIEWS.slice(1));
    // Leads first: the Chief of Staff named, leads and specialists counted, the background helper left out.
    expect(squadSummary(agents, departments)).toBe("Chief of Staff · 1 lead · 2 specialists · 2 need you");
  });

  it("nests each specialist under its lead, the Chief of Staff first, and says who each reports to (Leads first)", () => {
    const tree = teamTree(agents, departments);
    const rows = squadTreeRows(tree, "EUR", (a) => a.name);
    expect(rows.map((r) => [r.id, r.tier, r.reportsTo, (r.reports ?? []).map((c) => [c.id, c.tier, c.reportsTo])])).toEqual([
      [AGENT_COS, "chief", "You", [[AGENT_MARA, "specialist", "Orla"]]],
      [AGENT_PIKE, "lead", "Orla", [[AGENT_JUNO, "specialist", "Pike"]]],
    ]);
    expect(tree.background.map((a) => a.id)).toEqual([AGENT_LINK]);
    expect(specialistsLabel(1)).toBe("+1 specialist");
    expect(specialistsLabel(3)).toBe("+3 specialists");
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

/** The data column heads of the grid (the table adds its own "…" actions column after them). */
const headersOf = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((h) => h.textContent?.replace(/Resize.*$/, "").trim()).filter((h) => h !== "Actions");

/** The grid row that holds an agent's name link. */
const rowOf = (table: HTMLElement, name: string) => within(table).getByRole("link", { name }).closest("[role='row']") as HTMLElement;

/** Opens every lead's specialists (they start collapsed). */
const openAll = (table: HTMLElement) => {
  for (const b of within(table).queryAllByRole("button", { name: /^Show \d+ specialists? under / })) fireEvent.click(b);
};

/** The definitions map the app hands the provider (the dotted words need an entry to render as Terms). */
const TERMS = termsWithGlossary(null);

/** The screen as an operator sees it: guidance off, so the General view opens with every column the tests reach for. */
const operator = (el: ReturnType<typeof SquadScreen>) => <GuidanceProvider value={{ guidance: "off" }}>{el}</GuidanceProvider>;

describe("SquadScreen", () => {
  it("renders the team table with the exact General columns, Down with expected return, and the saved views", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    // Guidance off: the operator's General view opens, with no explainer and no defined words under the table.
    renderScreen(fake, operator(<SquadScreen {...props} />));
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    // Leads first: the Chief of Staff and the lead, collapsed; their specialists open under them; never the helper.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("button", { name: "Show 1 specialist under Pike" }).textContent).toBe("+1 specialist");
    openAll(table);
    expect(within(table).getAllByRole("row")).toHaveLength(agents.length);
    expect(within(table).queryByRole("link", { name: "Linker" })).toBeNull();
    // The General view hides Tools and the latest update (reachable from the column chooser and the other views).
    expect(headersOf(table)).toEqual(["Agent", "Role", "Departments", "Status", "Current task", "Form", "Rating /20", "Model", "AI cost (USD)"]);
    // The rating is the 1–20 mean with its band word (a compact ScaleLabel); an agent with no skills yet is not rated.
    expect(within(table).getByLabelText("Rating 13.0 of 20, Good")).toBeTruthy();
    expect(within(table).getByLabelText("Rating 13.0 of 20, Good").querySelector("[data-scale-label]")?.textContent).toBe("Good");
    expect(within(table).getAllByLabelText("Rating 17.0 of 20, Excellent")).toHaveLength(2);
    expect(screen.queryByTestId("form-caption")).toBeNull();
    expect(screen.queryByTestId("column-terms")).toBeNull();
    expect(document.querySelector("[data-explainer='team-agents']")).toBeNull();
    expect(within(table).getByRole("link", { name: "Juno" })).toBeTruthy();
    expect(within(table).getByText("Down")).toBeTruthy();
    expect(within(table).getByText(/expected back in 2 hr/)).toBeTruthy();
    expect(within(table).queryByText("Injured")).toBeNull();
    expect(within(table).getByRole("link", { name: "Add a bundle picker to the product page" })).toBeTruthy();
    expect(screen.getByTestId("squad-summary").textContent).toBe("Chief of Staff · 1 lead · 2 specialists · 2 need you");
    // The helper is reachable through one honest line and its read-only list.
    expect(screen.getByTestId("background-helpers-line").textContent).toContain("1 background helper also runs, linking names, sorting what comes in and checking drafts. They never take tasks or write to you.");
    fireEvent.click(screen.getByTestId("background-helpers-show"));
    const helpers = await screen.findByTestId("background-helpers-dialog");
    const item = helpers.querySelector(`[data-agent-id="${AGENT_LINK}"]`) as HTMLElement;
    expect(item.textContent).toContain("Linker");
    expect(within(item).getByText("Idle")).toBeTruthy();
    fireEvent.click(within(helpers).getByRole("button", { name: "Open Linker's profile" }));
    expect(fake.navigations.at(-1)).toBe(`/b/${BID}/agents/${AGENT_LINK}/overview`);
    fake.navigations.length = 0;
    expect(screen.getByText("General")).toBeTruthy();
    expect(fake.queried.get("team.agents.list")).toEqual({ includeArchived: false });
    fireEvent.click(within(table).getByRole("link", { name: "Juno" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/agents/${AGENT_JUNO}/overview`);
  });

  it("opens on the Simple view with the explainer and the defined column words while guidance is on (UX plan §7.10)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    // Guidance is on by default; the provider carries the definitions the app hands it.
    renderScreen(
      fake,
      <GuidanceProvider value={{ terms: TERMS }}>
        <SquadScreen {...props} />
      </GuidanceProvider>,
    );
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    expect(headersOf(table)).toEqual(["Agent", "Status", "Current task", "Rating /20"]);
    expect(screen.getByRole("button", { name: "View: Simple" })).toBeTruthy();
    // The intro sits inside the panel body, above the table, and names what the tab is for.
    const explainer = openExplainer("team-agents");
    expect(explainer.textContent).toContain("Everyone who works here. Agents have skills 1–20");
    expect(explainer.querySelector("[data-term='rating']")).not.toBeNull();
    expect(explainer.querySelector("[data-term='training']")).not.toBeNull();
    // The Form key and the other column heads defined once, under the table (the heads sit in the sort buttons).
    expect(screen.getByTestId("form-caption").textContent).toBe("Form: the last five tasks.");
    expect(screen.getByTestId("form-caption").querySelector("[data-term='form']")).not.toBeNull();
    expect(screen.getByTestId("column-terms").querySelector("[data-term='rating']")).not.toBeNull();
    expect(screen.getByTestId("column-terms").querySelector("[data-term='model']")).not.toBeNull();
    expect(document.querySelector("[data-term='wage']")).not.toBeNull();
    // Rows, cells and the live status work the same in both states.
    openAll(table);
    expect(within(table).getAllByRole("row")).toHaveLength(agents.length);
    expect(within(table).getByLabelText("Rating 13.0 of 20, Good")).toBeTruthy();
  });

  it("flips a row's status the moment agent.health_changed arrives and refetches once (AC-11.9.1)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    openAll(table);
    expect(within(table).getAllByText("Healthy")).toHaveLength(2);
    const before = Date.now();
    act(() => {
      fake.emit({ id: "ev-1", type: "agent.health_changed", occurredAt: "2026-10-07T12:00:01Z", businessId: BID, payload: { agentId: AGENT_JUNO, from: "healthy", to: "failing", reason: "Loop detected" } });
    });
    expect(within(table).getAllByText("Healthy")).toHaveLength(1);
    expect(within(table).getByText("Failing")).toBeTruthy();
    expect(Date.now() - before).toBeLessThan(2000);
    expect(screen.getByTestId("squad-summary").textContent).toContain("3 need you");
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
    // The Model column is in the General view (Simple keeps four columns), so the operator's state.
    renderScreen(fake, operator(<SquadScreen {...props} />));
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    openAll(table);
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

  it("shows predicted wage deltas in US dollars, the metered model cost's currency, on a business that keeps its books in pounds", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, currency: "GBP", responses: { ...dataResponses, "agent.model.compare": { ...compareJuno, currency: "USD" } } });
    renderScreen(fake, operator(<SquadScreen {...props} />));
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    openAll(table);
    const junoRow = within(table).getByRole("link", { name: "Juno" }).closest("[role='row']") as HTMLElement;
    await user.click(within(junoRow).getByRole("button", { name: "Sonnet" }));
    const dialog = await screen.findByTestId("model-dialog");
    await waitFor(() => expect(dialog.textContent).toContain("+$720.00/mo"));
    expect(dialog.textContent).not.toContain("£");
    // An older answer without a currency still never borrows the business's.
    expect(toModelOptions({ ...compareJuno, currency: undefined })[0]!.wageDelta).toEqual({ amountMinor: 72_000, currency: "USD" });
  });

  it("offers right-click verbs: open profile, change model, duplicate, lend, let go (not for the Chief of Staff)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ id: "new", name: "Juno II" }) });
    renderScreen(fake, <SquadScreen {...props} />);
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    openAll(table);
    // The Simple view (guidance on) keeps the Agent column, so rows are found by name; the row itself is right-clicked
    // (the name link has the entity's own menu).
    fireEvent.contextMenu(rowOf(table, "Orla"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open profile", "Change model (Opus)", "Duplicate…", "Lend to another department…", "Let go"]);
    expect(within(menu).getByRole("menuitem", { name: "Let go" }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    fireEvent.contextMenu(rowOf(table, "Juno"));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate…" }));
    const clone = await screen.findByTestId("clone-dialog");
    expect((within(clone).getByLabelText("Name", { exact: false }) as HTMLInputElement).value).toBe("Juno II");
    await user.click(within(clone).getByRole("checkbox", { name: "Distribution" }));
    await user.click(within(clone).getByTestId("clone-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.clone", input: { agentId: AGENT_JUNO, name: "Juno II", departmentIds: [expect.any(String), expect.any(String)] } }));
    await waitFor(() => expect(screen.getByTestId("model-notice").textContent).toBe("Juno II joined the team."));
  });

  it("lends and lets go from the context menu, keeping the dialog open on an API error", async () => {
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
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    openAll(table);
    fireEvent.contextMenu(rowOf(table, "Mara"));
    await user.click(await screen.findByRole("menuitem", { name: "Lend to another department…" }));
    const loan = await screen.findByTestId("loan-dialog");
    expect(within(loan).getByRole("button", { name: "Lend" })).toBeTruthy();
    // The consequence follows the choice: lending keeps everything; moving changes the line manager. Both reversible.
    expect(within(loan).getByTestId("loan-consequence").textContent).toBe("It joins the other department from the next cycle and keeps its tasks, skills, tools and model.·Reversible");
    await user.click(within(loan).getByRole("combobox", { name: "To department" }));
    await user.click(await screen.findByRole("option", { name: "Development" }));
    await user.click(within(loan).getByRole("checkbox", { name: /Move instead of lending/ }));
    expect(within(loan).getByTestId("loan-consequence").textContent).toContain("the new department's lead becomes its line manager");
    await user.click(within(loan).getByTestId("loan-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.loan", input: { agentId: AGENT_MARA, departmentId: expect.any(String), move: true } }));
    await waitFor(() => expect(screen.getByTestId("model-notice").textContent).toBe("Mara moved to Development."));

    fireEvent.contextMenu(rowOf(table, "Juno"));
    await user.click(await screen.findByRole("menuitem", { name: "Let go" }));
    const release = await screen.findByTestId("release-dialog");
    expect(within(release).getByText("Let Juno go")).toBeTruthy();
    expect(within(release).getByText(/Currently working on/)).toBeTruthy();
    // What letting go does, and that there is no way back, under the action (UX plan §6.2 ConsequenceLine).
    const consequence = within(release).getByTestId("release-consequence");
    expect(consequence.textContent).toContain("Running tasks stop; history and logs stay on the profile. Nothing is deleted.");
    expect(consequence.textContent).toContain("Not reversible");
    // Focus opens on Keep, the safe choice, not on a defined word whose card would open with the dialog.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Keep"));
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

describe("SquadScreen in the first week (WP-04 T4: everyone is hired, the starting team is shown)", () => {
  it("shows the starting agents and anyone with a current task, says so, and opens everyone on Show all", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "today.get": { firstWeek: { days: [] } } } });
    renderScreen(fake, operator(<SquadScreen {...props} />));
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    await waitFor(() => expect(screen.getByTestId("squad-first-week")).toBeTruthy());
    expect(screen.getByTestId("squad-first-week").textContent).toContain("Showing who is working this week");
    openAll(table);
    // Orla is the Chief of Staff (a starter); Juno has a task; Pike and Mara wait; the helper is never a row.
    expect(within(table).getAllByRole("row").slice(1).map((r) => within(r).queryAllByRole("link")[0]?.textContent)).toEqual(["Orla", "Juno"]);
    fireEvent.click(screen.getByRole("button", { name: "Show all 4" }));
    openAll(table);
    // The header row and the four agents.
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByTestId("squad-first-week")).toBeNull();
  });

  it("shows everyone once the first week is over", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "today.get": { firstWeek: null } } });
    renderScreen(fake, operator(<SquadScreen {...props} />));
    const table = await screen.findByRole("treegrid", { name: "Agents" });
    openAll(table);
    // The header row and the four agents.
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByTestId("squad-first-week")).toBeNull();
  });
});
