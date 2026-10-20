// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";
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
    expect((screen.getByLabelText(/What the team calls you/) as HTMLInputElement).value).toBe("Reid Jackson");
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
    // No residence typed: the currency follows the browser's language (en-US in this test runner).
    expect(patch).toMatchObject({ displayName: "Reid Jackson", experience: "first_time", timeCommitment: "full_time", budgetMinor: 2_500_000, currency: "USD", targetMarkets: ["Nordics", "EU"], constraints: ["Remote only"], riskAppetite: "medium" });
    expect(patch.skills).toEqual({ engineering: 10, sales: 10, design: 10, finance: 10, domain: 10 });
    expect(screen.getByTestId("profile-summary").textContent).toMatch(/First-time founder · full time · USD 25,000 · Nordics, EU/);
  });

  it("derives the currency from where the founder lives until they pick one themselves (A11)", async () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByLabelText(/^First-time founder/));
    fireEvent.click(screen.getByLabelText(/^Full time/));
    const markets = screen.getByPlaceholderText("Add a market and press Enter");
    fireEvent.change(markets, { target: { value: "UK" } });
    fireEvent.keyDown(markets, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Residence"), { target: { value: "United Kingdom" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ currency: "GBP", residence: "United Kingdom" });
    fireEvent.change(screen.getByLabelText("Residence"), { target: { value: "Germany" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ currency: "EUR" });
  });

  it("'I have no budget yet' is a choice beside the amount: it clears and disables the budget, and typing an amount unpicks it (A11)", async () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByLabelText(/^First-time founder/));
    fireEvent.click(screen.getByLabelText(/^Full time/));
    const markets = screen.getByPlaceholderText("Add a market and press Enter");
    fireEvent.change(markets, { target: { value: "EU" } });
    fireEvent.keyDown(markets, { key: "Enter" });
    const budget = screen.getByLabelText(/Budget you can commit/) as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "25k" } });
    expect(document.querySelector('[data-section="time"]')?.textContent).toContain("2 of 2 answered");
    fireEvent.click(screen.getByLabelText("I have no budget yet"));
    expect(budget.value).toBe("");
    expect(budget.disabled).toBe(true);
    expect(document.querySelector('[data-option="none"]')?.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-section="time"]')?.textContent).toContain("2 of 2 answered");
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ budgetMinor: null });
    // Picking the budget back: the amount field is the answer again.
    fireEvent.change(budget, { target: { value: "10k" } });
    expect(document.querySelector('[data-option="none"]')?.getAttribute("data-selected")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ budgetMinor: 1_000_000 });
  });

  it("keeps the account ID behind a disclosure for a co-founder, with benefit hints (A10, A17)", () => {
    render(
      <ToastProvider>
        <TooltipProvider>
          <OnboardingForm profile={null} email="reid.jackson@example.com" accountId="11111111-1111-4111-8111-111111111111" onSubmit={vi.fn()} />
        </TooltipProvider>
      </ToastProvider>,
    );
    const disclosure = screen.getByTestId("profile-account-id");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(disclosure.querySelector("summary")?.textContent).toContain("For a co-founder joining you");
    expect(disclosure.hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("account-id").textContent).toContain("11111111-1111-4111-8111-111111111111");
    const place = document.querySelector('[data-section="place"]')!;
    expect(place.textContent).toContain("Where you live decides which countries we suggest for registering the business.");
    expect(place.textContent).not.toMatch(/jurisdiction recommender/);
    expect(document.querySelector('[data-section="constraints"]')?.textContent).toContain("Rules the ideas must respect, like 'no stock to buy' or 'keep my day job'.");
  });

  it("pre-fills an existing profile and offers Save", () => {
    render(
      <TooltipProvider>
        <OnboardingForm profile={{ displayName: "Sara", experience: "exited", skills: { engineering: 18 }, timeCommitment: "part_time", budgetMinor: 1_000_000, currency: "SEK", citizenship: "Sweden", residence: "Sweden", targetMarkets: ["Nordics"], constraints: ["B2B only"], riskAppetite: "high" }} email="sara@example.com" onSubmit={vi.fn()} />
      </TooltipProvider>,
    );
    expect((screen.getByLabelText(/What the team calls you/) as HTMLInputElement).value).toBe("Sara");
    expect(document.querySelector('[data-skill-value="engineering"]')?.textContent).toBe("18");
    expect(screen.getByTestId("profile-submit").textContent).toMatch(/Save and continue/);
    expect(screen.getByText("B2B only")).toBeTruthy();
  });
});
