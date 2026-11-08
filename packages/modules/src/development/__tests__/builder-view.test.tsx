/**
 * Builder view off (docs/DESIGN.md "Builder view"): the Development screens keep their content and drop the technical
 * columns and details (PR number, branch, lines, commit, provider; the Technical disclosure and the technical subtitle;
 * tokens and the ETA on a tile). The fake source renders Builder view on by default; these render it off.
 */
import "./setup";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EnvironmentsScreen } from "../EnvironmentsScreen";
import { PlanScreen } from "../PlanScreen";
import { PullRequestsScreen } from "../PullRequestsScreen";
import { TrainingGroundScreen } from "../TrainingGroundScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { TASK_DONE, TASK_INDEX, TASK_PLAYWRIGHT, agentsResponse, prsResponse, tasks, tasksResponse, trainingGroundResponses } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const off = { builder: false };
const heads = (grid: HTMLElement) => within(grid).getAllByRole("columnheader").map((h) => h.textContent?.replace(/Resize.*$/, "").trim());

describe("Development with Builder view off", () => {
  it("Pull requests: no branch, PR number, lines or commit; the titles, agents and previews stay", async () => {
    renderScreen(createFakeSource({ responses: { "dev.prs.list": prsResponse, "team.agents.list": agentsResponse } }), <PullRequestsScreen {...props} />, {}, off);
    const open = await screen.findByRole("grid", { name: "Open pull requests" });
    expect(heads(open)).not.toContain("Branch");
    expect(within(open).queryByText(`agent/${TASK_INDEX}`)).toBeNull();
    expect(within(open).getByText("Usage index for the Ledgerly dashboard")).toBeTruthy();
    const merged = screen.getByRole("grid", { name: "Merged pull requests" });
    for (const h of ["PR", "Branch", "Added", "Removed", "Commit"]) expect(heads(merged)).not.toContain(h);
    expect(within(merged).queryByRole("link", { name: "#41" })).toBeNull();
    expect(within(merged).queryByText("+120")).toBeNull();
    expect(within(merged).queryByText("a1b2c3d")).toBeNull();
  });

  it("Environments: no branch, provider or commit; the task and its state stay", async () => {
    const codeTasks = { ...tasksResponse, items: tasks.filter((t) => t.kind === "code") };
    renderScreen(createFakeSource({ responses: { "dev.tasks.list": codeTasks, "dev.prs.list": prsResponse, "team.agents.list": agentsResponse } }), <EnvironmentsScreen {...props} />, {}, off);
    const table = await screen.findByRole("grid", { name: "Environments" });
    for (const h of ["Branch", "Provider", "Commit"]) expect(heads(table)).not.toContain(h);
    expect(within(table).queryByText("sitemap-canonical-fixes")).toBeNull();
    expect(document.querySelector(`[data-branch="agent/${TASK_DONE}"]`)).toBeNull();
    expect(within(table).getByText("Merged")).toBeTruthy();
  });

  it("Plan: no Technical disclosure and no technical subtitle under a founder title", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: { "dev.tasks.list": tasksResponse, "team.agents.list": agentsResponse }, onMutate: () => ({ session: { id: "s" }, workflow: { queued: true } }) });
    renderScreen(fake, <PlanScreen {...props} />, {}, off);
    const table = await screen.findByRole("grid", { name: "Tasks" });
    await user.click(within(table).getByText("Playwright coverage for checkout"));
    await screen.findByRole("application", { name: /Dependencies of Playwright coverage/ });
    expect(screen.queryByTestId("task-technical")).toBeNull();
    expect(screen.queryByText(`agent/${TASK_PLAYWRIGHT}`)).toBeNull();
    expect(document.querySelector("[data-technical-title]")).toBeNull();
  });

  it("Live sessions: a tile keeps its progress and phase, without tokens or the ETA", async () => {
    renderScreen(createFakeSource({ responses: trainingGroundResponses() }), <TrainingGroundScreen {...props} />, {}, off);
    const grid = await screen.findByRole("region", { name: "Agent tiles" });
    const tile = within(grid).getByRole("article", { name: /Juno: Add a bundle picker/ });
    await waitFor(() => expect(within(tile).getByLabelText(/Progress \d+%/)).toBeTruthy());
    const footer = within(tile).getByTestId("tile-footer");
    expect(footer.textContent).not.toMatch(/ETA|tokens/);
    expect(footer.textContent).toContain("Estimate");
  });
});
