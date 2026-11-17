// @vitest-environment happy-dom
/**
 * Settings › What the team can do (founder, 2026-11-07): the answers in plain words, what always comes to the founder
 * said once, the spend line's three answers (an amount, always ask, each agent's own limit named with its default), who
 * answers publishing and messaging (written to every department), the statements for releases and hiring, and agents
 * with their own setting. The page never says "hard gate", "policy" or "cap".
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const CHIEF = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

let business = { businessMode: "assisted", spendCapMinor: null as number | null, gameMode: "personal" };
let matrix = [
  { decisionType: "publish_content", handler: { kind: "founder", id: null }, uniform: true },
  { decisionType: "message_customers", handler: { kind: "founder", id: null }, uniform: false },
];
let chiefOfStaffId: string | null = CHIEF;
let autopilot = { enabled: false, settings: { maxIdleCycles: 3 } };
let agents = [
  { id: CHIEF, name: "Juno", archivedAt: null, autonomy: { mode: "inherit", approvalThresholdMinor: 25_000 } },
  { id: OTHER, name: "Pike", archivedAt: null, autonomy: { mode: "higher", approvalThresholdMinor: 25_000 } },
];

const setBusinessMode = vi.fn(async (v: Record<string, unknown>) => ({ ...business, businessMode: v.businessMode }));
const setSpendCap = vi.fn(async (v: { spendCapMinor: number | null }) => ({ ...business, spendCapMinor: v.spendCapMinor }));
const setResponsibility = vi.fn(async () => ({ updated: 2 }));
const saved = vi.fn();
const failed = vi.fn();

const mutation = (key: string, fn: (v: never) => Promise<unknown>) => ({ mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [[key]], mutationFn: (v: never) => fn(v), ...opts }) });
const noop = async () => ({ workflow: { queued: true } });

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    business: {
      setBusinessMode: mutation("setBusinessMode", setBusinessMode as never),
      setSpendCap: mutation("setSpendCap", setSpendCap as never),
      startHoliday: mutation("startHoliday", noop as never),
      endHoliday: mutation("endHoliday", noop as never),
      setPaymentPowers: mutation("setPaymentPowers", noop as never),
      // When the team stops reads Autopilot's settings (the same query AutopilotSection reads).
      autopilot: { get: { queryOptions: () => ({ queryKey: [["business", "autopilot", "get"]], queryFn: async () => autopilot }) } },
    },
    team: {
      responsibilities: {
        get: { queryOptions: () => ({ queryKey: [["team", "responsibilities", "get"]], queryFn: async () => ({ matrix, chiefOfStaffId, decisionTypes: [] }) }) },
        set: mutation("responsibilities.set", setResponsibility as never),
      },
      agents: { list: { queryOptions: () => ({ queryKey: [["team", "agents", "list"]], queryFn: async () => ({ agents, templates: [] }) }) } },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({ businessId: BUSINESS, isAdmin: true, data: { role: "owner", business, holiday: null, liveOpen: false }, departments: [{ id: "d1", slug: "team", moduleKeys: ["team"] }] }),
  useBusinessCurrency: () => "GBP",
}));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved, failed, info: vi.fn() }) }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => vi.fn(async () => undefined) }));
vi.mock("../AutopilotSection", () => ({ AutopilotSection: () => <section data-testid="autopilot-section" /> }));

import { TeamCanDoTab } from "../TeamCanDoTab";

const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <TooltipProvider>
        <TeamCanDoTab />
      </TooltipProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  business = { businessMode: "assisted", spendCapMinor: null, gameMode: "personal" };
  matrix = [
    { decisionType: "publish_content", handler: { kind: "founder", id: null }, uniform: true },
    { decisionType: "message_customers", handler: { kind: "founder", id: null }, uniform: false },
  ];
  chiefOfStaffId = CHIEF;
  autopilot = { enabled: false, settings: { maxIdleCycles: 3 } };
  agents = [
    { id: CHIEF, name: "Juno", archivedAt: null, autonomy: { mode: "inherit", approvalThresholdMinor: 25_000 } },
    { id: OTHER, name: "Pike", archivedAt: null, autonomy: { mode: "higher", approvalThresholdMinor: 25_000 } },
  ];
  for (const f of [setBusinessMode, setSpendCap, setResponsibility, saved, failed]) f.mockClear();
});

describe("What the team can do", () => {
  it("says once what always comes to the founder, offers three plain answers and never says hard gate, policy or cap", async () => {
    renderTab();
    await screen.findByTestId("answer-publish_content");
    expect(screen.getAllByText(/always come to you\. Nothing on this page changes that\./)).toHaveLength(1);
    const group = screen.getByRole("radiogroup", { name: "How much should the team do before checking with you?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /^Routine work alone; ask before big or permanent steps · Recommended$/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /^Work and decide on its own; the Chief of Staff answers routine questions for you/ })).toBeTruthy();
    // The Assisted words no longer promise anything about new people (nothing checks it).
    expect(document.body.textContent).not.toMatch(/new people/);
    expect(document.body.textContent).not.toMatch(/\b(hard gates?|policy|policies|caps?)\b/i);
    expect(document.body.textContent).not.toMatch(/Empty means no cap|no limit/i);
  });

  it("changes the answer with business.setBusinessMode", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("radio", { name: /^Work and decide on its own/ }));
    await waitFor(() => expect(setBusinessMode).toHaveBeenCalledWith({ businessId: BUSINESS, businessMode: "automated", reason: "settings" }));
  });

  it("names the null spend answer with the real default, and saves an amount, always ask, or each agent's own limit", async () => {
    renderTab();
    const own = await screen.findByRole("radio", { name: /^Each agent's own limit \(£250 unless you set one\)/ });
    expect(own.getAttribute("aria-checked")).toBe("true");
    const form = screen.getByTestId("spend-cap-form");
    const save = within(form).getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    const field = within(form).getByLabelText("Amount per purchase") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "lots" } });
    expect(within(form).getByText("Use a number, like 250.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "50" } });
    expect(screen.getByRole("radio", { name: "An amount" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(save);
    await waitFor(() => expect(setSpendCap).toHaveBeenCalledWith({ businessId: BUSINESS, spendCapMinor: 5_000 }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("Amount saved"));
    fireEvent.click(screen.getByRole("radio", { name: /^Always ask/ }));
    fireEvent.click(save);
    await waitFor(() => expect(setSpendCap).toHaveBeenLastCalledWith({ businessId: BUSINESS, spendCapMinor: 0 }));
  });

  it("says an agent asks sooner when the amount is above its own default limit", async () => {
    business = { ...business, spendCapMinor: 100_000, businessMode: "automated" };
    renderTab();
    expect(await screen.findByText("An agent still asks above its own limit when that is lower: £250 unless you set one on its Autonomy tab.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Work and decide on its own/ }).textContent).toContain("It still asks you before spending over £1,000");
  });

  it("hands publishing to the Chief of Staff in every department, and sends a department split to Team › Responsibilities", async () => {
    renderTab();
    const publish = await screen.findByTestId("answer-publish_content");
    fireEvent.click(within(publish).getByRole("radio", { name: "The Chief of Staff approves" }));
    await waitFor(() => expect(setResponsibility).toHaveBeenCalledWith({ businessId: BUSINESS, decisionType: "publish_content", handler: { kind: "agent", id: CHIEF } }));
    const message = screen.getByTestId("answer-message_customers");
    expect(within(message).queryByRole("radio")).toBeNull();
    expect(message.textContent).toContain("Differs by department");
    expect(within(message).getByRole("link", { name: "Team › Responsibilities" }).getAttribute("href")).toBe(`/b/${BUSINESS}/d/team/responsibilities`);
  });

  it("states releases and hiring as they are today, and lists agents with their own setting", async () => {
    renderTab();
    const release = await screen.findByTestId("answer-merge_to_main");
    expect(release.textContent).toContain("Always asks you.");
    expect(within(release).getByRole("link", { name: "Let a staff member decide" })).toBeTruthy();
    expect(screen.getByTestId("answer-agents").textContent).toContain("The team suggests it in the Inbox and you decide.");
    const own = await screen.findByTestId("agents-own-setting");
    expect(own.textContent).toContain("1 agent has its own setting for how much it does before asking.");
    expect(within(own).getByRole("link", { name: "Pike" }).getAttribute("href")).toBe(`/b/${BUSINESS}/agents/${OTHER}/autonomy`);
  });

  it("lists, read-only, when the team stops for the answer in force, with Autopilot's own pause only while it is on", async () => {
    const view = renderTab();
    const stops = await screen.findByTestId("team-can-do-stops");
    // The second answer: a permanent step and a contract ask; outside contact alone does not.
    expect(within(stops).getByTestId("stop-permanent")).toBeTruthy();
    expect(within(stops).getByTestId("stop-contract")).toBeTruthy();
    expect(within(stops).queryByTestId("stop-outside")).toBeNull();
    expect(within(stops).getByTestId("stop-spend").textContent).toContain("A purchase over the agent's own limit (£250 unless you set one)");
    expect(within(stops).getByTestId("stop-unsubscribed").textContent).toContain("The project never emails them again.");
    expect(within(stops).queryByTestId("stop-autopilot_idle")).toBeNull();
    expect(within(stops).queryAllByRole("radio")).toHaveLength(0);
    expect(within(stops).queryAllByRole("button")).toHaveLength(0);
    view.unmount();
    autopilot = { enabled: true, settings: { maxIdleCycles: 3 } };
    renderTab();
    expect((await screen.findByTestId("stop-autopilot_idle")).textContent).toContain("3 cycles in a row fail or get nothing done");
  });

  it("offers the Chief of Staff only once there is one", async () => {
    chiefOfStaffId = null;
    renderTab();
    const publish = await screen.findByTestId("answer-publish_content");
    expect((within(publish).getByRole("radio", { name: "The Chief of Staff approves" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
