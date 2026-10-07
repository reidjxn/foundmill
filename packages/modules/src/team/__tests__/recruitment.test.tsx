import "./setup";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CATALOGUE_VIEWS, MOVES_VIEWS, RecruitmentScreen, toCatalogueRows } from "../RecruitmentScreen";
import { suggestTemplates, tokenize } from "../shared";
import { AGENT_COS, AGENT_JUNO, BID, DEPT_DEV, DEPT_DIST, DEPT_TEAM, agents, catalogue, dataResponses, emptyResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("recruitment data", () => {
  it("orders the catalogue by family and counts agents hired from each template", () => {
    const rows = toCatalogueRows(catalogue, agents);
    expect(rows.map((r) => [r.key, r.familyLabel, r.hired])).toEqual([
      ["chief_of_staff", "Assistant manager", 1],
      ["engineering_lead", "Lead", 1],
      ["frontend_engineer", "Worker", 1],
      ["newsletter_writer", "Worker", 0],
      ["channel_email", "Channel engine", 1],
      ["sourcing_specialist", "Specialist", 0],
      ["entity_linker", "Utility", 1],
    ]);
    expect(CATALOGUE_VIEWS.map((v) => v.name)).toEqual(["All templates", "Leads", "Workers", "Channel engines", "Specialists", "Utilities"]);
    expect(MOVES_VIEWS.map((v) => v.id)).toEqual(["all", "idle"]);
  });

  it("suggests the closest templates for a sentence, stemming loosely and ignoring stop words", () => {
    expect(tokenize("An agent who writes our weekly customer newsletter and asks before sending")).toEqual(["writes", "weekly", "customer", "newsletter", "asks", "before", "sending"]);
    const best = suggestTemplates("An agent who writes our weekly customer newsletter and asks before sending", catalogue);
    expect(best[0]!.template.key).toBe("newsletter_writer");
    expect(best[0]!.score).toBeGreaterThan(0.5);
    expect(best[0]!.matched).toContain("newsletter");
    expect(best.length).toBeLessThanOrEqual(3);
    expect(suggestTemplates("find suppliers and request quotes", catalogue)[0]!.template.key).toBe("sourcing_specialist");
    expect(suggestTemplates("", catalogue)).toEqual([]);
    expect(suggestTemplates("zzzz qqqq", catalogue)).toEqual([]);
  });
});

describe("RecruitmentScreen", () => {
  it("renders the catalogue with model chips, wage caps labelled Estimate and the squad moves table", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Catalogue" });
    expect(within(table).getAllByRole("row")).toHaveLength(catalogue.length + 1);
    expect(within(table).getAllByText("Estimate").length).toBe(catalogue.length);
    expect(within(table).getByText("Newsletter writer")).toBeTruthy();
    expect(screen.getByTestId("catalogue-summary").textContent).toBe("7 templates · 5 in the squad");
    const moves = screen.getByRole("grid", { name: "Squad moves" });
    expect(within(moves).getAllByRole("row")).toHaveLength(agents.length + 1);
    expect(within(moves).getByRole("link", { name: "Juno" })).toBeTruthy();
    expect(within(moves).getByText("Down")).toBeTruthy();
    expect(fake.queried.get("team.agents.catalogue")).toEqual({});
  });

  it("hires a template into the open department through the dialog and refetches the squad", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (_p, input) => ({ id: "new-agent", name: input.name ?? "Newsletter writer", status: "idle", modelKey: "sonnet" }) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Catalogue" });
    fireEvent.contextMenu(within(table).getByText("Newsletter writer"));
    await user.click(await screen.findByRole("menuitem", { name: "Hire…" }));
    const dialog = await screen.findByTestId("hire-dialog");
    expect(within(dialog).getByText("Hire Newsletter writer")).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Department" }).textContent).toBe("Team");
    await user.click(within(dialog).getByRole("combobox", { name: "Department" }));
    await user.click(await screen.findByRole("option", { name: "Distribution" }));
    await user.type(within(dialog).getByLabelText("Name", { exact: false }), "Nell");
    await user.click(within(dialog).getByTestId("hire-confirm"));
    await waitFor(() => expect(fake.mutations).toEqual([{ path: "team.agents.hire", input: { templateKey: "newsletter_writer", departmentId: DEPT_DIST, name: "Nell" } }]));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Nell hired. First training run queued."));
    expect(fake.refetches["team.agents.list"]).toBe(1);
  });

  it("suggests templates from a sentence and hires from the suggestion", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ id: "new-agent", name: "Newsletter writer" }) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    await screen.findByRole("grid", { name: "Catalogue" });
    await user.type(screen.getByRole("textbox", { name: "Describe the agent" }), "writes our weekly customer newsletter");
    const list = await screen.findByRole("list", { name: "Suggested templates" });
    const first = within(list).getAllByRole("listitem")[0]!;
    expect(first.getAttribute("data-suggestion")).toBe("newsletter_writer");
    expect(within(first).getByText(/% match/)).toBeTruthy();
    await user.click(within(first).getByRole("button", { name: "Hire from this template" }));
    const dialog = await screen.findByTestId("hire-dialog");
    await user.click(within(dialog).getByTestId("hire-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.hire", input: { templateKey: "newsletter_writer", departmentId: DEPT_TEAM } }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Describe the agent" }) as HTMLTextAreaElement).value).toBe(""));
    await user.type(screen.getByRole("textbox", { name: "Describe the agent" }), "zzzz");
    expect(await screen.findByText(/No template matches those words yet/)).toBeTruthy();
  });

  it("clones, loans and releases from the squad moves table; the Chief of Staff cannot be released", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (path) => (path === "team.agents.clone" ? { id: "clone", name: "Juno II" } : {}) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    await screen.findByRole("grid", { name: "Catalogue" });
    const moves = screen.getByRole("grid", { name: "Squad moves" });
    fireEvent.contextMenu(within(moves).getByText("Chief of Staff"));
    const cosMenu = await screen.findByRole("menu");
    expect(within(cosMenu).getByRole("menuitem", { name: "Release" }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    fireEvent.contextMenu(within(moves).getByText("Frontend engineer"));
    await user.click(await screen.findByRole("menuitem", { name: "Clone…" }));
    const clone = await screen.findByTestId("clone-dialog");
    await user.click(within(clone).getByTestId("clone-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.clone", input: { agentId: AGENT_JUNO, name: "Juno II", departmentIds: [DEPT_DEV] } }));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Juno II joined the squad."));

    fireEvent.contextMenu(within(moves).getByText("Engineering lead"));
    await user.click(await screen.findByRole("menuitem", { name: "Loan to department…" }));
    const loan = await screen.findByTestId("loan-dialog");
    await user.click(within(loan).getByRole("combobox", { name: "To department" }));
    await user.click(await screen.findByRole("option", { name: "Team" }));
    await user.click(within(loan).getByTestId("loan-confirm"));
    await waitFor(() => expect(fake.mutations[1]).toEqual({ path: "team.agents.loan", input: { agentId: expect.any(String), departmentId: DEPT_TEAM, move: false } }));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Pike on loan to Team."));

    fireEvent.contextMenu(within(moves).getByText("Entity linker"));
    await user.click(await screen.findByRole("menuitem", { name: "Release" }));
    await user.click(within(await screen.findByTestId("release-dialog")).getByTestId("release-confirm"));
    await waitFor(() => expect(fake.mutations[2]!.path).toBe("team.agents.release"));
    expect(fake.mutations.some((m) => m.input.agentId === AGENT_COS)).toBe(false);
  });

  it("shows empty states, loading and an error with retry", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <RecruitmentScreen {...props} />);
    expect(await screen.findByText(/The catalogue lists every agent template/)).toBeTruthy();
    expect(screen.getByText(/Hired agents appear here/)).toBeTruthy();
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: { "department.list": [] } });
    const r2 = renderScreen(loading, <RecruitmentScreen {...props} />);
    expect(screen.queryByRole("grid", { name: "Catalogue" })).toBeNull();
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.agents.catalogue": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <RecruitmentScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.agents.catalogue"]).toBe(1);
  });
});
