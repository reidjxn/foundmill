import "./setup";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GuidanceProvider } from "@foundmill/dugout";
import { termsWithGlossary } from "@foundmill/shared/terms";
import { CATALOGUE_VIEWS, MOVES_VIEWS, RecruitmentScreen, toCatalogueRows } from "../RecruitmentScreen";
import { suggestTemplates, tokenize } from "../shared";
import { AGENT_COS, AGENT_JUNO, BID, DEPT_DEV, DEPT_DIST, DEPT_TEAM, agents, catalogue, dataResponses, emptyResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";
import { openExplainer } from "../../explainer.testing";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("recruitment data", () => {
  it("orders the catalogue by family and counts agents hired from each template", () => {
    const rows = toCatalogueRows(catalogue, agents);
    expect(rows.map((r) => [r.key, r.familyLabel, r.hired])).toEqual([
      ["chief_of_staff", "Chief of Staff", 1],
      ["engineering_lead", "Lead", 1],
      ["frontend_engineer", "Worker", 1],
      ["newsletter_writer", "Worker", 0],
      ["channel_email", "Channel engine", 1],
      ["sourcing_specialist", "Specialist", 0],
    ]);
    // Leads first: the utility templates are background helpers every business already runs, never offered for hire.
    expect(rows.some((r) => r.family === "utility")).toBe(false);
    expect(CATALOGUE_VIEWS.map((v) => v.name)).toEqual(["Simple", "All templates", "Leads", "Workers", "Channel engines", "Specialists"]);
    expect(MOVES_VIEWS.map((v) => v.id)).toEqual(["simple", "all", "idle"]);
    // Simple (DESIGN §8 Guidance): four columns, built in, for both tables.
    for (const views of [CATALOGUE_VIEWS, MOVES_VIEWS]) expect(views[0]).toMatchObject({ id: "simple", builtIn: true, columns: expect.any(Array) });
    expect(CATALOGUE_VIEWS[0]!.columns).toHaveLength(4);
    expect(MOVES_VIEWS[0]!.columns).toHaveLength(4);
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
  it("renders the catalogue with model chips, wage caps labelled Estimate and the team moves table", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    // Guidance on, with the definitions map the app hands the provider, so the dotted words render as Terms.
    renderScreen(
      fake,
      <GuidanceProvider value={{ terms: termsWithGlossary(null) }}>
        <RecruitmentScreen {...props} />
      </GuidanceProvider>,
    );
    const table = await screen.findByRole("grid", { name: "Catalog" });
    // Every template but the utility one (a background helper).
    expect(within(table).getAllByRole("row")).toHaveLength(catalogue.length);
    expect(within(table).getAllByText("Estimate").length).toBe(catalogue.length - 1);
    expect(within(table).getByText("Newsletter writer")).toBeTruthy();
    // The template's kind reads "Kind" (never "Family"), and the cap says it is US dollars.
    expect(within(table).getByRole("columnheader", { name: /^Kind/ })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: /^Family/ })).toBeNull();
    expect(within(table).getByRole("columnheader", { name: /Wage cap \(USD\)/ })).toBeTruthy();
    expect(screen.getByTestId("catalogue-intro").textContent).toBe("Ready-made agents. Hire one into a department and it starts next round of work.");
    expect(screen.getByTestId("catalogue-summary").textContent).toBe("6 templates · 4 in the team");
    // Guidance is on outside a provider: the tab's intro sits in the builder panel, the wage cap is a defined word, and
    // the generate button shows no key cap (an operator's affordance).
    const explainer = openExplainer("team-recruitment");
    expect(explainer.textContent).toContain("Hire new agents");
    expect(explainer.querySelector("[data-term='wage_cap']")).not.toBeNull();
    expect(screen.getByTestId("draft-agent").querySelector("kbd")).toBeNull();
    const moves = screen.getByRole("grid", { name: "Team moves" });
    // The founder's team: the background helper is not moved, lent or let go from here.
    expect(within(moves).getAllByRole("row")).toHaveLength(agents.length);
    expect(within(moves).queryByText("Entity linker")).toBeNull();
    expect(within(moves).getByRole("link", { name: "Juno" })).toBeTruthy();
    expect(within(moves).getByText("Down")).toBeTruthy();
    expect(fake.queried.get("team.agents.catalogue")).toEqual({});
  });

  it("hires a template into the department over its module (changeable) through the dialog and refetches the team", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (_p, input) => ({ id: "new-agent", name: input.name ?? "Newsletter writer", status: "idle", modelKey: "sonnet" }) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Catalog" });
    fireEvent.contextMenu(within(table).getByText("Newsletter writer"));
    await user.click(await screen.findByRole("menuitem", { name: "Hire…" }));
    const dialog = await screen.findByTestId("hire-dialog");
    expect(within(dialog).getByText("Hire Newsletter writer")).toBeTruthy();
    expect(within(dialog).getByText("Kind")).toBeTruthy();
    expect(within(dialog).getByText("Wage cap (USD)")).toBeTruthy();
    // What hiring does and what it can cost, under the form (UX plan §6.2 ConsequenceLine), then the reassurance.
    const consequence = within(dialog).getByTestId("hire-consequence");
    expect(consequence.textContent).toContain("Starts next round of work with the template's instructions, tools and skills");
    expect(consequence.textContent).toContain("Up to $150.00/mo (Estimate)");
    expect(consequence.textContent).toContain("Reversible");
    expect(dialog.querySelector("[data-reassurance]")?.textContent).toContain("lend it or let it go later");
    // Focus opens on the department, the first thing to fill, never on a defined word or the Estimate chip.
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("combobox", { name: "Department" })));
    // A distribution template opened from Team › Recruitment starts in Distribution, not in the tab's own department.
    expect(within(dialog).getByRole("combobox", { name: "Department" }).textContent).toBe("Distribution");
    await user.click(within(dialog).getByRole("combobox", { name: "Department" }));
    await user.click(await screen.findByRole("option", { name: "Team" }));
    await user.type(within(dialog).getByLabelText("Name", { exact: false }), "Nell");
    await user.click(within(dialog).getByTestId("hire-confirm"));
    await waitFor(() => expect(fake.mutations).toEqual([{ path: "team.agents.hire", input: { templateKey: "newsletter_writer", departmentId: DEPT_TEAM, name: "Nell" } }]));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Nell hired. Train it from its profile to tune its skills."));
    expect(fake.refetches["team.agents.list"]).toBe(1);
  });

  it("suggests templates from a sentence and hires from the suggestion", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ id: "new-agent", name: "Newsletter writer" }) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    await screen.findByRole("grid", { name: "Catalog" });
    await user.type(screen.getByRole("textbox", { name: "Describe the agent" }), "writes our weekly customer newsletter");
    const list = await screen.findByRole("list", { name: "Suggested templates" });
    const first = within(list).getAllByRole("listitem")[0]!;
    expect(first.getAttribute("data-suggestion")).toBe("newsletter_writer");
    // en-US percent: "60% fit", never "60 % fit" (CLAUDE.md 2026-10-10).
    expect(within(first).getByText(/^\d{1,3}% fit$/)).toBeTruthy();
    expect(within(first).queryByText(/\d %/)).toBeNull();
    await user.click(within(first).getByRole("button", { name: "Hire from this template" }));
    const dialog = await screen.findByTestId("hire-dialog");
    await user.click(within(dialog).getByTestId("hire-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.hire", input: { templateKey: "newsletter_writer", departmentId: DEPT_DIST } }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Describe the agent" }) as HTMLTextAreaElement).value).toBe(""));
    await user.type(screen.getByRole("textbox", { name: "Describe the agent" }), "zzzz");
    expect(await screen.findByText(/No template matches those words yet/)).toBeTruthy();
  });

  it("drafts an agent from a sentence with the generate action, starting from the closest template", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ id: "new-agent", name: "Newsletter writer" }) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    await screen.findByRole("grid", { name: "Catalog" });
    const draft = screen.getByTestId("draft-agent");
    expect(draft.textContent).toContain("Find the closest role");
    expect(draft.textContent).not.toMatch(/draft/i);
    expect(draft.hasAttribute("disabled")).toBe(true);
    const box = screen.getByRole("textbox", { name: "Describe the agent" });
    await user.type(box, "writes our weekly customer newsletter");
    expect(draft.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/the closest of/).textContent).toContain("Newsletter writer");
    await user.click(draft);
    const dialog = await screen.findByTestId("hire-dialog");
    expect(within(dialog).getByText("Hire Newsletter writer")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("hire-dialog")).toBeNull());
    // ⌘/Ctrl+Enter in the sentence box does the same.
    box.focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByTestId("hire-dialog")).toBeTruthy();
  });

  it("with guidance off the key cap shows on the generate button and the intro is gone; the catalog line stays", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(
      fake,
      <GuidanceProvider value={{ guidance: "off" }}>
        <RecruitmentScreen {...props} />
      </GuidanceProvider>,
    );
    await screen.findByRole("grid", { name: "Catalog" });
    expect(screen.getByTestId("draft-agent").querySelector("kbd")?.textContent).toBe("⌘↵");
    expect(document.querySelector("[data-explainer='team-recruitment']")).toBeNull();
    expect(screen.getByTestId("catalogue-intro").textContent).toBe("Ready-made agents. Hire one into a department and it starts next round of work.");
  });

  it("keeps a long template description to three lines in the hire dialog, the rest on request", async () => {
    const user = userEvent.setup();
    const long = "Runs the e-mail channel end to end. ".repeat(12).trim();
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.agents.catalogue": catalogue.map((t) => (t.key === "channel_email" ? { ...t, description: long } : t)) } });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Catalog" });
    fireEvent.contextMenu(within(table).getByText("Email engine"));
    await user.click(await screen.findByRole("menuitem", { name: "Hire…" }));
    const dialog = await screen.findByTestId("hire-dialog");
    const description = within(dialog).getByText(long);
    expect(description.className).toContain("line-clamp-3");
    await user.click(within(dialog).getByRole("button", { name: "Read the full description" }));
    expect(description.className).not.toContain("line-clamp-3");
    expect(within(dialog).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("opens both tables on the Simple view while guidance is on (DESIGN §8 Guidance)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    await screen.findByRole("grid", { name: "Catalog" });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^View: Simple/ }).length).toBe(2));
    // The empty-state and explainer lines point at the "…" button, never right-click alone (§7.10, D6).
    expect(document.body.textContent).not.toMatch(/right-click/i);
  });

  it("shows skills and departments in words, never keys or module slugs", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <GuidanceProvider value={{ guidance: "off" }}><RecruitmentScreen {...props} /></GuidanceProvider>);
    const table = await screen.findByRole("grid", { name: "Catalog" });
    expect(within(table).queryByText(/_/)).toBeNull();
    expect(within(table).getByText("Planning, Prioritization")).toBeTruthy();
    expect(within(table).getAllByText("Development").length).toBe(3);
    expect(within(table).queryByText("development")).toBeNull();
  });

  it("duplicates, lends and lets go from the team moves table; the Chief of Staff cannot be let go", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (path) => (path === "team.agents.clone" ? { id: "clone", name: "Juno II" } : {}) });
    renderScreen(fake, <RecruitmentScreen {...props} />);
    await screen.findByRole("grid", { name: "Catalog" });
    const moves = screen.getByRole("grid", { name: "Team moves" });
    fireEvent.contextMenu(within(moves).getByText("Chief of Staff"));
    const cosMenu = await screen.findByRole("menu");
    // The founder's words: duplicate, lend, let go (the API keeps clone / loan / release).
    expect(within(cosMenu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open profile", "Duplicate…", "Lend to another department…", "Let go"]);
    expect(within(cosMenu).getByRole("menuitem", { name: "Let go" }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    fireEvent.contextMenu(within(moves).getByText("Frontend engineer"));
    await user.click(await screen.findByRole("menuitem", { name: "Duplicate…" }));
    const clone = await screen.findByTestId("clone-dialog");
    expect(within(clone).getByText("Duplicate Juno")).toBeTruthy();
    await user.click(within(clone).getByTestId("clone-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.agents.clone", input: { agentId: AGENT_JUNO, name: "Juno II", departmentIds: [DEPT_DEV] } }));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Juno II joined the team."));

    fireEvent.contextMenu(within(moves).getByText("Engineering lead"));
    await user.click(await screen.findByRole("menuitem", { name: "Lend to another department…" }));
    const loan = await screen.findByTestId("loan-dialog");
    await user.click(within(loan).getByRole("combobox", { name: "To department" }));
    await user.click(await screen.findByRole("option", { name: "Team" }));
    await user.click(within(loan).getByTestId("loan-confirm"));
    await waitFor(() => expect(fake.mutations[1]).toEqual({ path: "team.agents.loan", input: { agentId: expect.any(String), departmentId: DEPT_TEAM, move: false } }));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Pike lent to Team."));

    fireEvent.contextMenu(within(moves).getByText("Email engine"));
    await user.click(await screen.findByRole("menuitem", { name: "Let go" }));
    await user.click(within(await screen.findByTestId("release-dialog")).getByTestId("release-confirm"));
    await waitFor(() => expect(fake.mutations[2]!.path).toBe("team.agents.release"));
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Mara has left the team."));
    expect(fake.mutations.some((m) => m.input.agentId === AGENT_COS)).toBe(false);
  });

  it("shows empty states, loading and an error with retry", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <RecruitmentScreen {...props} />);
    expect(await screen.findByText(/The catalog lists every agent template/)).toBeTruthy();
    expect(screen.getByText(/Nothing hired yet/)).toBeTruthy();
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: { "department.list": [] } });
    const r2 = renderScreen(loading, <RecruitmentScreen {...props} />);
    expect(screen.queryByRole("grid", { name: "Catalog" })).toBeNull();
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.agents.catalogue": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <RecruitmentScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.agents.catalogue"]).toBe(1);
  });
});
