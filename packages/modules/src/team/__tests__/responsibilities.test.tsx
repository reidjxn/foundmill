import "./setup";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GuidanceProvider } from "@foundmill/dugout";
import { RESPONSIBILITY_VIEWS, ResponsibilitiesScreen, handlerName, toResponsibilityRows } from "../ResponsibilitiesScreen";
import { DECISION_DESCRIPTIONS, readMe } from "../shared";
import { AGENT_MARA, AGENT_PIKE, BID, DEPT_DIST, DEPT_TEAM, USER_ADA, agents, dataResponses, departments, emptyResponses, humans, me, responsibilities } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };
const ctx = () => ({ agents: new Map(agents.map((a) => [a.id, a])), humans: new Map(humans.map((h) => [h.userId, h])), me: readMe(me, BID) });

describe("responsibility rows", () => {
  it("builds one row per decision type with the handler's name, the hard gate and per-department detail", () => {
    const rows = toResponsibilityRows(responsibilities, departments, ctx());
    expect(rows.map((r) => [r.label, r.handlerName, r.uniform, r.gated])).toEqual([
      ["Spend above threshold", "You (founder)", true, false],
      ["Publish content", "ada@northwind.example", true, false],
      ["Merge to main", "Pike", true, false],
      ["Sign contracts", "You (founder)", true, true],
      ["Message customers", "You (founder)", false, false],
      ["Hire agents", "You (founder)", true, false],
      ["Change models", "You (founder)", true, false],
    ]);
    const msg = rows.find((r) => r.decisionType === "message_customers")!;
    expect(msg.departments.map((d) => [d.departmentName, d.handlerName])).toEqual([
      ["Team", "You (founder)"],
      ["Development", "You (founder)"],
      ["Distribution", "Mara"],
    ]);
    expect(handlerName({ kind: "agent", id: "ffffffff-0000-4000-8000-000000000000" }, ctx())).toBe("Agent ffffffff");
    expect(toResponsibilityRows(undefined, undefined, ctx())).toHaveLength(7);
    expect(RESPONSIBILITY_VIEWS.map((v) => v.id)).toEqual(["simple", "all", "delegated", "mine"]);
    expect(RESPONSIBILITY_VIEWS[0]).toMatchObject({ name: "Simple", builtIn: true, columns: ["label", "handler", "scope", "actions"] });
  });
});

describe("ResponsibilitiesScreen", () => {
  it("renders the matrix with entity links for handlers, the hard-gate chip and the department detail", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ResponsibilitiesScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Responsibilities" });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByRole("link", { name: "Pike" })).toBeTruthy();
    expect(within(table).getByRole("link", { name: "ada@northwind.example" })).toBeTruthy();
    expect(within(table).getAllByText("You (founder)")).toHaveLength(5);
    expect(within(table).getByText("Hard gate")).toBeTruthy();
    expect(within(table).getByText("Differs by department")).toBeTruthy();
    expect(screen.getByTestId("responsibilities-summary").textContent).toBe("7 decision types · 2 delegated · 1 differs by department");
    // The everyday answers live on one Settings page; this table hands one decision to one person or department.
    expect(screen.getByTestId("responsibilities-pointer").textContent).toBe("Everyday choices live in Settings › What the team can do. Use this table to hand a decision to one person or department.");
    expect(within(screen.getByTestId("responsibilities-pointer")).getByRole("link", { name: "Settings › What the team can do" }).getAttribute("href")).toBe(`/b/${BID}/settings/mode`);
    fireEvent.click(within(table).getByText("Message customers"));
    const detail = await screen.findByRole("table", { name: "Message customers by department" });
    expect(within(detail).getByRole("link", { name: "Mara" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Take back Message customers in Distribution" })).toBeTruthy();
  });

  it("makes room for the department detail: Covers steps aside, actions become named icon buttons, the detail says what the decision covers", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <GuidanceProvider value={{ guidance: "off" }}><ResponsibilitiesScreen {...props} /></GuidanceProvider>);
    let table = await screen.findByRole("grid", { name: "Responsibilities" });
    const headers = () => within(screen.getByRole("grid", { name: "Responsibilities" })).getAllByRole("columnheader").map((h) => h.textContent?.replace(/Resize.*$/, "").trim());
    expect(headers()).toContain("Covers");
    fireEvent.click(within(table).getByText("Message customers"));
    const detail = await screen.findByRole("table", { name: "Message customers by department" });
    expect(screen.getByText(DECISION_DESCRIPTIONS.message_customers, { selector: "p" })).toBeTruthy();
    expect(detail).toBeTruthy();
    table = screen.getByRole("grid", { name: "Responsibilities" });
    expect(headers()).not.toContain("Covers");
    const delegate = within(table).getByRole("button", { name: "Delegate Hire agents" });
    expect(delegate.textContent).toBe("");
    await user.click(delegate);
    expect(await screen.findByTestId("delegate-dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(headers()).toContain("Covers"));
  });

  it("takes a decision back with one click, business-wide or in one department (AC-11.9.2 routing)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ updated: 3 }) });
    renderScreen(fake, <ResponsibilitiesScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Responsibilities" });
    await user.click(within(table).getByRole("button", { name: "Take back Merge to main" }));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.responsibilities.set", input: { decisionType: "merge_to_main", handler: { kind: "founder", id: null } } }));
    await waitFor(() => expect(screen.getByTestId("responsibilities-notice").textContent).toBe("Merge to main is yours again."));
    expect(fake.refetches["team.responsibilities.get"]).toBe(1);

    fireEvent.click(within(table).getByText("Message customers"));
    const detail = await screen.findByRole("table", { name: "Message customers by department" });
    await user.click(within(detail).getByRole("button", { name: "Take back Message customers in Distribution" }));
    await waitFor(() => expect(fake.mutations[1]).toEqual({ path: "team.responsibilities.set", input: { decisionType: "message_customers", handler: { kind: "founder", id: null }, departmentId: DEPT_DIST } }));
    expect(within(table).queryByRole("button", { name: "Take back Spend above threshold" })).toBeNull();
  });

  it("offers signing only to staff: no delegate action on the hard gate until someone else is on the staff", async () => {
    const user = userEvent.setup();
    const alone = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.humans.list": humans.filter((h) => h.role === "owner") } });
    const r = renderScreen(alone, <ResponsibilitiesScreen {...props} />);
    let table = await screen.findByRole("grid", { name: "Responsibilities" });
    expect(within(table).queryByRole("button", { name: "Delegate Sign contracts" })).toBeNull();
    expect(within(table).getByText("Founder or staff only")).toBeTruthy();
    fireEvent.contextMenu(within(table).getByText("Sign contracts"));
    expect((await screen.findByRole("menuitem", { name: "Delegate to staff…" })).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    // Delegating anything else starts on "An agent"; choosing a staff member says there is no one yet and offers the invite.
    await user.click(within(table).getByRole("button", { name: "Delegate Hire agents" }));
    const dialog = await screen.findByTestId("delegate-dialog");
    expect(within(dialog).getByRole("radio", { name: /An agent/, checked: true })).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: /A staff member/ }));
    expect(within(dialog).getByTestId("delegate-no-staff").textContent).toContain("No one else is on the staff yet.");
    await user.click(within(dialog).getByRole("button", { name: "Invite staff" }));
    expect(alone.navigations.at(-1)).toBe(`/b/${BID}/d/team/staff`);
    r.unmount();

    const withStaff = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(withStaff, <ResponsibilitiesScreen {...props} />);
    table = await screen.findByRole("grid", { name: "Responsibilities" });
    expect(within(table).getByRole("button", { name: "Delegate Sign contracts" }).textContent).toBe("Delegate to staff…");
    expect(within(table).getByRole("button", { name: "Delegate Hire agents" }).textContent).toBe("Delegate…");
  });

  it("delegates to a staff member or an agent, never an agent for signing, optionally in one department", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ updated: 1 }) });
    renderScreen(fake, <ResponsibilitiesScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Responsibilities" });
    await user.click(within(table).getByRole("button", { name: "Delegate Sign contracts" }));
    const gated = await screen.findByTestId("delegate-dialog");
    expect(within(gated).getByRole("radio", { name: /An agent/ }).hasAttribute("disabled")).toBe(true);
    expect(within(gated).getByText(/A hard gate: an agent can never sign/)).toBeTruthy();
    await user.click(within(gated).getByRole("combobox", { name: "Staff member" }));
    await user.click(await screen.findByRole("option", { name: "ada@northwind.example" }));
    await user.click(within(gated).getByTestId("delegate-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.responsibilities.set", input: { decisionType: "sign_contracts", handler: { kind: "user", id: USER_ADA } } }));
    await waitFor(() => expect(screen.getByTestId("responsibilities-notice").textContent).toBe("Sign contracts delegated to ada@northwind.example."));

    fireEvent.contextMenu(within(table).getByText("Hire agents"));
    await user.click(await screen.findByRole("menuitem", { name: "Delegate…" }));
    const dialog = await screen.findByTestId("delegate-dialog");
    await user.click(within(dialog).getByRole("radio", { name: /An agent/ }));
    await user.click(within(dialog).getByRole("combobox", { name: "Agent" }));
    // Background helpers are never offered (Leads first).
    expect(screen.queryByRole("option", { name: /Linker/ })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "Pike · Engineering lead" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Where" }));
    await user.click(await screen.findByRole("option", { name: "Only Distribution" }));
    await user.click(within(dialog).getByTestId("delegate-confirm"));
    await waitFor(() => expect(fake.mutations[1]).toEqual({ path: "team.responsibilities.set", input: { decisionType: "hire_agents", handler: { kind: "agent", id: AGENT_PIKE }, departmentId: DEPT_DIST } }));
    await waitFor(() => expect(screen.getByTestId("responsibilities-notice").textContent).toBe("Hire agents delegated to Pike in Distribution."));
    expect(fake.mutations.some((m) => (m.input.handler as { id: string }).id === AGENT_MARA)).toBe(false);
  });

  it("keeps the dialog open with the API's message when the server rejects a delegation", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({
      businessId: BID,
      responses: dataResponses,
      onMutate: () => {
        throw new Error("Handler is not a member");
      },
    });
    renderScreen(fake, <ResponsibilitiesScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Responsibilities" });
    await user.click(within(table).getByRole("button", { name: "Delegate Change models" }));
    const dialog = await screen.findByTestId("delegate-dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Staff member" }));
    await user.click(await screen.findByRole("option", { name: "Ben Okafor" }));
    await user.click(within(dialog).getByTestId("delegate-confirm"));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toBe("Handler is not a member");
    expect(screen.getByTestId("delegate-dialog")).toBeTruthy();
  });

  it("renders every decision type as yours when nothing is stored, plus loading and error states", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <ResponsibilitiesScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Responsibilities" });
    expect(within(table).getAllByText("You (founder)")).toHaveLength(7);
    expect(screen.getByTestId("responsibilities-summary").textContent).toBe("7 decision types · 0 delegated");
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: {} });
    const r2 = renderScreen(loading, <ResponsibilitiesScreen {...props} />);
    expect(screen.queryByRole("grid")).toBeNull();
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.responsibilities.get": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <ResponsibilitiesScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.responsibilities.get"]).toBe(1);
  });
});
