import "./setup";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { STAFF_VIEWS, StaffScreen, toStaffRows } from "../StaffScreen";
import { permissionSummary, readMe } from "../shared";
import { BID, DEPT_TEAM, ME, USER_ADA, USER_BEN, dataResponses, emptyResponses, humans, me, responsibilities } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };

describe("staff rows", () => {
  it("names members, summarises permissions and lists the decision types they approve", () => {
    const rows = toStaffRows(humans, responsibilities, readMe(me, BID));
    expect(rows.map((r) => [r.name, r.roleLabel, r.isMe])).toEqual([
      ["Reid", "Owner", true],
      ["ada@northwind.example", "Admin", false],
      ["Ben Okafor", "Advisor", false],
    ]);
    expect(rows[1]!.writes).toEqual(["Finance"]);
    expect(rows[1]!.reads).toEqual(["Legal"]);
    expect(rows[1]!.approves).toEqual(["Publish content"]);
    expect(permissionSummary({ product: "write", inbox: "none" })).toEqual({ write: ["Product"], read: [], none: ["Inbox"] });
    expect(STAFF_VIEWS.map((v) => v.id)).toEqual(["all", "admins", "approvers"]);
  });
});

describe("StaffScreen", () => {
  it("lists the humans with roles, section permissions and approvals, linking CRM entities", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <StaffScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Staff" });
    expect(within(table).getAllByRole("row")).toHaveLength(humans.length + 1);
    expect(within(table).getByText("You")).toBeTruthy();
    expect(within(table).getByText("Owner")).toBeTruthy();
    expect(within(table).getByText("Finance · write")).toBeTruthy();
    expect(within(table).getByText("Legal · read")).toBeTruthy();
    expect(within(table).getByText("Publish content")).toBeTruthy();
    expect(screen.getByTestId("staff-summary").textContent).toBe("3 people · 1 approving");
    fireEvent.click(within(table).getByRole("link", { name: "ada@northwind.example" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/crm/e0000000-0000-4000-8000-000000000002/overview`);
    expect(screen.getByText("All staff")).toBeTruthy();
  });

  it("invites a member by user id with a role and per-section permissions", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (_p, input) => ({ id: "m-4", userId: input.userId, role: input.role, sectionPermissions: input.sectionPermissions, email: input.email }) });
    renderScreen(fake, <StaffScreen {...props} />);
    await screen.findByRole("grid", { name: "Staff" });
    await user.click(screen.getByRole("button", { name: "Invite" }));
    const dialog = await screen.findByTestId("invite-dialog");
    const confirm = within(dialog).getByTestId("invite-confirm");
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await user.type(within(dialog).getByLabelText(/Account id/), "not-a-uuid");
    expect(within(dialog).getByText("That is not an account id; it has 36 letters, digits and dashes.")).toBeTruthy();
    await user.clear(within(dialog).getByLabelText(/Account id/));
    await user.type(within(dialog).getByLabelText(/Account id/), "90000000-0000-4000-8000-000000000009");
    await user.type(within(dialog).getByLabelText(/E-mail/), "cal@northwind.example");
    await user.click(within(dialog).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Viewer" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Finance permission" }));
    await user.click(await screen.findByRole("option", { name: "Write" }));
    await user.click(confirm);
    await waitFor(() => expect(fake.mutations).toEqual([{ path: "team.humans.invite", input: { userId: "90000000-0000-4000-8000-000000000009", role: "viewer", sectionPermissions: { finance: "write" }, email: "cal@northwind.example" } }]));
    await waitFor(() => expect(screen.getByTestId("staff-notice").textContent).toBe("cal@northwind.example invited as Viewer."));
    expect(fake.refetches["team.humans.list"]).toBe(1);
  });

  it("changes a role and permissions from the row menu, blocks removing the owner or yourself, removes an advisor", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (path, input) => (path === "team.humans.role" ? { ...humans.find((h) => h.userId === input.userId)!, role: input.role ?? "advisor", sectionPermissions: input.sectionPermissions } : { removed: true }) });
    renderScreen(fake, <StaffScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Staff" });
    fireEvent.contextMenu(within(table).getByText("Owner"));
    const ownerMenu = await screen.findByRole("menu");
    expect(within(ownerMenu).getByRole("menuitem", { name: "Remove" }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    fireEvent.contextMenu(within(table).getByText("Advisor"));
    await user.click(await screen.findByRole("menuitem", { name: "Role and permissions…" }));
    const role = await screen.findByTestId("role-dialog");
    expect(within(role).getByText("Role and permissions for Ben Okafor")).toBeTruthy();
    await user.click(within(role).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Member" }));
    await user.click(within(role).getByRole("combobox", { name: "Product permission" }));
    await user.click(await screen.findByRole("option", { name: "Write" }));
    await user.click(within(role).getByTestId("role-confirm"));
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "team.humans.role", input: { userId: USER_BEN, sectionPermissions: { product: "write" }, role: "member" } }));
    await waitFor(() => expect(screen.getByTestId("staff-notice").textContent).toBe("Ben Okafor is now Member."));

    fireEvent.contextMenu(within(table).getByText("Advisor"));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const remove = await screen.findByTestId("remove-dialog");
    await user.click(within(remove).getByTestId("remove-confirm"));
    await waitFor(() => expect(fake.mutations[1]).toEqual({ path: "team.humans.remove", input: { userId: USER_BEN } }));
    await waitFor(() => expect(screen.getByTestId("staff-notice").textContent).toBe("Ben Okafor removed."));
    expect(fake.mutations.every((m) => m.input.userId !== ME && m.input.userId !== USER_ADA)).toBe(true);
  });

  it("shows the empty state, loading and an error with retry", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <StaffScreen {...props} />);
    expect(await screen.findByText("Only you so far")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Invite staff" }));
    expect(await screen.findByTestId("invite-dialog")).toBeTruthy();
    unmount();

    const loading = createFakeSource({ businessId: BID, responses: { "founder.profile.get": me } });
    const r2 = renderScreen(loading, <StaffScreen {...props} />);
    expect(screen.queryByRole("grid")).toBeNull();
    r2.unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.humans.list": new Error("tRPC: FORBIDDEN") } });
    renderScreen(failing, <StaffScreen {...props} />);
    expect(screen.getAllByText("tRPC: FORBIDDEN").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["team.humans.list"]).toBe(1);
  });
});
