// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { OnboardingForm } from "../OnboardingScreen";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function renderForm(onSubmit = vi.fn()) {
  render(
    <TooltipProvider>
      <OnboardingForm profile={null} email="reid.jackson@example.com" onSubmit={onSubmit} />
    </TooltipProvider>,
  );
  return onSubmit;
}

describe("OnboardingForm (BUILD §11.1 founder profile)", () => {
  it("renders every section with the five skill sliders at 10 and the name from the email", () => {
    renderForm();
    for (const id of ["identity", "skills", "time", "place", "constraints"]) expect(document.querySelector(`[data-section="${id}"]`)).toBeTruthy();
    expect(document.querySelectorAll("[data-skill]")).toHaveLength(5);
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    expect((screen.getByLabelText(/What the squad calls you/) as HTMLInputElement).value).toBe("Reid Jackson");
    expect(document.querySelector('[data-skill-value="engineering"]')?.textContent).toBe("10");
  });

  it("refuses to submit until the required sections are complete and says how many are missing", () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByTestId("profile-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((a) => /3 fields to complete/.test(a.textContent ?? ""))).toBe(true);
    expect(document.querySelector('[data-section-link="identity"]')?.getAttribute("data-done")).toBeNull();
  });

  it("submits the founder.profile.update patch once experience, time and a market are chosen", async () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByLabelText(/^First-time founder/));
    fireEvent.click(screen.getByLabelText(/^Full time/));
    fireEvent.change(screen.getByLabelText(/Budget you can commit/), { target: { value: "25k" } });
    const markets = screen.getByPlaceholderText("Add a market and press Enter");
    fireEvent.change(markets, { target: { value: "Nordics" } });
    fireEvent.keyDown(markets, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /^EU$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remote only" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const patch = onSubmit.mock.calls[0]![0];
    expect(patch).toMatchObject({ displayName: "Reid Jackson", experience: "first_time", timeCommitment: "full_time", budgetMinor: 2_500_000, currency: "EUR", targetMarkets: ["Nordics", "EU"], constraints: ["Remote only"], riskAppetite: "medium" });
    expect(patch.skills).toEqual({ engineering: 10, sales: 10, design: 10, finance: 10, domain: 10 });
    expect(screen.getByTestId("profile-summary").textContent).toMatch(/First-time founder · full time · EUR 25,000 · Nordics, EU/);
  });

  it("pre-fills an existing profile and offers Save", () => {
    render(
      <TooltipProvider>
        <OnboardingForm profile={{ displayName: "Sara", experience: "exited", skills: { engineering: 18 }, timeCommitment: "part_time", budgetMinor: 1_000_000, currency: "SEK", citizenship: "Sweden", residence: "Sweden", targetMarkets: ["Nordics"], constraints: ["B2B only"], riskAppetite: "high" }} email="sara@example.com" onSubmit={vi.fn()} />
      </TooltipProvider>,
    );
    expect((screen.getByLabelText(/What the squad calls you/) as HTMLInputElement).value).toBe("Sara");
    expect(document.querySelector('[data-skill-value="engineering"]')?.textContent).toBe("18");
    expect(screen.getByTestId("profile-submit").textContent).toMatch(/Save and continue/);
    expect(screen.getByText("B2B only")).toBeTruthy();
  });
});
