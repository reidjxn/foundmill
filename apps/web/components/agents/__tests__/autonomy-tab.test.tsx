// @vitest-environment happy-dom
/**
 * Agent › Autonomy money fields (audit WEB-03): the field keeps exactly what the founder types, keystroke by keystroke
 * ("25" stays 25, "150.50" stays 150.50; the old field re-rendered every keystroke from minor units, so "2" became
 * "2.00" and "25" saved 2.01), and Save sends those amounts in minor units.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

const setAutonomy = vi.fn();
const setNegotiation = vi.fn();
const viewer = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    agent: {
      autonomy: { set: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["agent", "autonomy", "set"]], mutationFn: (vars: unknown) => setAutonomy(vars), ...opts }) } },
      negotiation: { set: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["agent", "negotiation", "set"]], mutationFn: (vars: unknown) => setNegotiation(vars), ...opts }) } },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: "b1", isAdmin: viewer.isAdmin, data: { business: { gameMode: "sandbox", businessMode: "assisted" } }, departments: [] }) }));

import { AutonomyTab } from "../AutonomyTab";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
const AGENT = "4c76f0d6-2afd-4bdd-adbf-2a82479eadf3";

function renderTab(autonomy: Record<string, unknown> = { mode: "inherit", spendCapMinor: 0, approvalThresholdMinor: 0 }, negotiation: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const profile = { agent: { id: AGENT, name: "Researcher", agentType: "researcher", role: "Researcher", layer: "worker", autonomy, negotiation } } as never;
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider renderViewport={false}>
          <AutonomyTab businessId={BUSINESS} profile={profile} currency="USD" onChangeModel={() => {}} refetch={() => {}} />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Types like a keyboard: focus, clear, then one change event per character appended to what the field shows. */
function type(el: HTMLInputElement, text: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: "" } });
  for (const ch of text) fireEvent.change(el, { target: { value: el.value + ch } });
}

describe("AutonomyTab money fields", () => {
  beforeEach(() => {
    viewer.isAdmin = true;
    setAutonomy.mockReset().mockResolvedValue({ updated: [AGENT] });
    setNegotiation.mockReset().mockResolvedValue({ updated: [AGENT] });
  });

  it("a member sees autonomy, caps and negotiation as an owner's or admin's to change (audit SECX-10)", () => {
    viewer.isAdmin = false;
    renderTab();
    expect((screen.getByTestId("save-autonomy") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("save-negotiation") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("autonomy-footer").textContent).toContain("Only an owner or admin changes autonomy and spend caps");
  });

  it("keeps what is typed in every money field and saves it in minor units", async () => {
    renderTab();
    const cap = screen.getByRole("textbox", { name: "Spend cap per action" }) as HTMLInputElement;
    const ask = screen.getByRole("textbox", { name: "Ask above" }) as HTMLInputElement;
    type(cap, "25");
    expect(cap.value).toBe("25");
    type(cap, "150.50");
    expect(cap.value).toBe("150.50");
    type(ask, "99.99");
    expect(ask.value).toBe("99.99");
    fireEvent.blur(ask);
    expect(screen.queryByTestId("autonomy-error")).toBeNull();

    fireEvent.click(screen.getByTestId("save-autonomy"));
    await act(async () => {
      fireEvent.click(await screen.findByTestId("apply-scope-confirm"));
    });
    expect(setAutonomy).toHaveBeenCalledTimes(1);
    expect(setAutonomy.mock.calls[0]![0]).toEqual({ businessId: BUSINESS, agentId: AGENT, autonomy: { mode: "inherit", spendCapMinor: 15_050, approvalThresholdMinor: 9_999 }, applyScope: "agent" });
  });

  it("shows stored amounts as typed amounts, groups them at rest, and names text that is not an amount", () => {
    renderTab({ mode: "higher", spendCapMinor: 125_000, approvalThresholdMinor: 1250 }, { enabled: false, priceMinMinor: 10_000, walkAwayMinor: 8_050 });
    const cap = screen.getByRole("textbox", { name: "Spend cap per action" }) as HTMLInputElement;
    expect(cap.value).toBe("1,250");
    fireEvent.focus(cap);
    expect(cap.value).toBe("1250");
    expect((screen.getByRole("textbox", { name: "Ask above" }) as HTMLInputElement).value).toBe("12.50");
    expect((screen.getByRole("textbox", { name: "Walk away at" }) as HTMLInputElement).value).toBe("80.50");
    type(cap, "lots");
    expect(cap.value).toBe("lots");
    expect(screen.getByTestId("autonomy-error").textContent).toMatch(/Enter the spend cap as an amount/);
    expect((screen.getByTestId("save-autonomy") as HTMLButtonElement).disabled).toBe(true);
  });

  it("negotiation limits keep what is typed too, and the max concession takes a decimal", async () => {
    renderTab(undefined, { enabled: true, priceMinMinor: 10_000, walkAwayMinor: 8_000, topics: ["price"] });
    const floor = screen.getByRole("textbox", { name: "Price floor" }) as HTMLInputElement;
    const ceiling = screen.getByRole("textbox", { name: "Price ceiling" }) as HTMLInputElement;
    const walk = screen.getByRole("textbox", { name: "Walk away at" }) as HTMLInputElement;
    const concession = screen.getByRole("textbox", { name: "Max concession" }) as HTMLInputElement;
    type(floor, "120");
    type(ceiling, "1,500.25");
    type(walk, "95.5");
    type(concession, "12.5");
    expect([floor.value, ceiling.value, walk.value, concession.value]).toEqual(["120", "1,500.25", "95.5", "12.5"]);
    expect(screen.queryByTestId("negotiation-error")).toBeNull();

    fireEvent.click(screen.getByTestId("save-negotiation"));
    await act(async () => {
      fireEvent.click(await screen.findByTestId("apply-scope-confirm"));
    });
    expect(setNegotiation.mock.calls[0]![0]).toMatchObject({ negotiation: { enabled: true, priceMinMinor: 12_000, priceMaxMinor: 150_025, walkAwayMinor: 9_550, maxConcessionPct: 12.5, topics: ["price"] } });
  });
});
