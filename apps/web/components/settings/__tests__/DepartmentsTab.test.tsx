// @vitest-environment happy-dom
/**
 * Settings › Departments (audits MLSL-08, WEB-19, AC-06): archiving asks first and names the tabs that leave, the toast
 * undoes it, an Archived list restores, "Add department" creates, and a department's settings can give it a lead,
 * a budget and a look. The API is canned; every call is recorded.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeApi } from "../../live/__tests__/fake-trpc";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
const invalidate = vi.hoisted(() => vi.fn(async () => undefined));
const departments = vi.hoisted(() => [
  { id: "d-team", name: "Team", slug: "team", icon: "users", colourToken: "dept-5", position: 0, hidden: false, moduleKeys: ["team"], leadAgentId: null, budgetMinor: null, archivedAt: null, tabs: [{ id: "t1", slug: "squad", title: "Agents", position: 0 }, { id: "t2", slug: "recruitment", title: "Recruitment", position: 1 }], squad: [{ id: "a1", name: "Mara", role: "Recruiter", status: "idle", modelKey: "balanced", avatarSeed: "s" }] },
  { id: "d-fin", name: "Finance", slug: "finance", icon: "landmark", colourToken: "dept-4", position: 1, hidden: false, moduleKeys: ["finance"], leadAgentId: null, budgetMinor: null, archivedAt: null, tabs: [], squad: [] },
]);
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("../../live/__tests__/fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({ businessId: "b1", isAdmin: true, data: { role: "owner", business: { name: "Northwind", archetype: "b2b_saas" } }, departments }),
  useBusinessCurrency: () => "USD",
}));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => invalidate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DepartmentsTab } from "../DepartmentsTab";
import { departmentPatch } from "../DepartmentSettingsDialog";
import { callsTo, renderWithProviders } from "../../live/__tests__/fake-trpc";

const ARCHIVED = { ...departments[1]!, id: "d-old", name: "Legal Desk", slug: "legal", archivedAt: new Date(), hidden: true, moduleKeys: ["legal"] };

beforeEach(() => {
  api.calls = [];
  invalidate.mockClear();
  api.handlers = {
    "department.list": () => [...departments, ARCHIVED],
    "department.archive": (v) => ({ ...departments.find((d) => d.id === (v as { departmentId: string }).departmentId)!, archivedAt: new Date() }),
    "department.restore": (v) => ({ id: (v as { departmentId: string }).departmentId }),
    "department.create": (v) => ({ id: "d-new", ...(v as object) }),
    "department.update": (v) => ({ id: (v as { departmentId: string }).departmentId }),
    "department.templates": () => [],
    "team.agents.list": () => ({ agents: [{ id: "a1", name: "Mara", role: "Recruiter", agentType: "recruiter", departments: [{ name: "Team" }] }] }),
    "team.responsibilities.get": () => ({ perDepartment: [] }),
  };
});
afterEach(cleanup);

describe("Settings › Departments", () => {
  it("archives only after a confirmation that names the tabs, and the toast's Undo restores it", async () => {
    renderWithProviders(<DepartmentsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Archive Team" }));
    const dialog = await screen.findByTestId("archive-department");
    expect(dialog.textContent).toContain("Archive Team?");
    expect(dialog.textContent).toContain("Agents, Recruitment");
    expect(callsTo(api, "department.archive")).toHaveLength(0);

    // Cancel changes nothing.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("archive-department")).toBeNull());
    expect(callsTo(api, "department.archive")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Archive Team" }));
    fireEvent.click(within(await screen.findByTestId("archive-department")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(callsTo(api, "department.archive")).toEqual([{ businessId: "b1", departmentId: "d-team" }]));
    // The toast offers Undo, which restores the same department.
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(callsTo(api, "department.restore")).toEqual([{ businessId: "b1", departmentId: "d-team" }]));
  });

  it("lists archived departments and restores one by name", async () => {
    renderWithProviders(<DepartmentsTab />);
    const archived = await screen.findByTestId("archived-departments");
    expect(archived.textContent).toContain("Legal Desk");
    fireEvent.click(within(archived).getByRole("button", { name: "Restore Legal Desk" }));
    await waitFor(() => expect(callsTo(api, "department.restore")).toEqual([{ businessId: "b1", departmentId: "d-old" }]));
  });

  it("Add department (blank) needs a name and a module, then creates it", async () => {
    renderWithProviders(<DepartmentsTab />);
    fireEvent.click(await screen.findByTestId("add-department-open"));
    const dialog = await screen.findByTestId("add-department");
    const submit = within(dialog).getByTestId("add-department-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "Support desk" } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Product/i }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(callsTo(api, "department.create")).toEqual([{ businessId: "b1", name: "Support desk", icon: "folder", colourToken: "dept-7", moduleKeys: ["product"] }]));
  });

  it("From a sentence drafts an editable department before anything is created", async () => {
    renderWithProviders(<DepartmentsTab />);
    fireEvent.click(await screen.findByTestId("add-department-open"));
    const dialog = await screen.findByTestId("add-department");
    fireEvent.click(within(dialog).getByRole("button", { name: "From a sentence" }));
    fireEvent.change(within(dialog).getByLabelText("Describe the department"), { target: { value: "A customer support desk that handles refunds and the privacy policy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Draft it" }));
    const draft = await within(dialog).findByTestId("department-draft");
    expect((within(draft).getByLabelText(/Name/) as HTMLInputElement).value).toBe("Customer Support");
    expect(callsTo(api, "department.create")).toHaveLength(0);
    fireEvent.click(within(dialog).getByTestId("add-department-submit"));
    await waitFor(() => expect(callsTo(api, "department.create")).toEqual([{ businessId: "b1", name: "Customer Support", icon: "scale", colourToken: "dept-6", moduleKeys: ["legal"] }]));
  });

  it("a department's settings send only what changed: a lead, a budget in the business currency, a new color", async () => {
    renderWithProviders(<DepartmentsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings of Team" }));
    const dialog = await screen.findByTestId("department-settings");
    expect(dialog.textContent).toContain("Shortcut");
    // Make Mara the lead from the member list, and set the budget.
    fireEvent.click(await within(dialog).findByRole("button", { name: "Make lead" }));
    fireEvent.change(within(dialog).getByLabelText("Monthly budget"), { target: { value: "450" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo(api, "department.update")).toEqual([{ businessId: "b1", departmentId: "d-team", patch: { leadAgentId: "a1", budgetMinor: 45_000, currency: "USD" } }]));
  });
});

describe("departmentPatch", () => {
  const d = departments[0]! as never;
  const draft = { name: "Team", icon: "users", colourToken: "dept-5" as const, leadAgentId: "none", budget: "" };

  it("is empty for an untouched form and names only the changed fields otherwise", () => {
    expect(departmentPatch(d, draft, "USD")).toEqual({ patch: {}, error: null });
    expect(departmentPatch(d, { ...draft, name: " People ", icon: "heart-handshake", colourToken: "dept-2", leadAgentId: "a1", budget: "1,200.50" }, "GBP")).toEqual({
      patch: { name: "People", icon: "heart-handshake", colourToken: "dept-2", leadAgentId: "a1", budgetMinor: 120_050, currency: "GBP" },
      error: null,
    });
  });

  it("refuses an empty name and an amount that is not a number or is negative", () => {
    expect(departmentPatch(d, { ...draft, name: "  " }, "USD").error).toMatch(/name/);
    expect(departmentPatch(d, { ...draft, budget: "lots" }, "USD").error).toMatch(/budget/);
    expect(departmentPatch(d, { ...draft, budget: "-5" }, "USD").error).toMatch(/budget/);
  });

  it("clearing the budget sends null, and removing the lead sends null", () => {
    const funded = { ...(d as object), budgetMinor: 45_000, leadAgentId: "a1" } as never;
    expect(departmentPatch(funded, { ...draft, leadAgentId: "none", budget: "" }, "USD").patch).toEqual({ leadAgentId: null, budgetMinor: null, currency: "USD" });
  });
});
