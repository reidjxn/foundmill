// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GuidanceProvider,
  SKILL_SCALE_LEGEND,
  ToastProvider,
  TooltipProvider,
} from "@foundmill/dugout";
import {
  GUIDANCE_OFF_TOAST,
  OnboardingForm,
  PROFILE_REASSURANCE,
  SKILLS_HINT,
} from "../OnboardingScreen";
import { detailStorageKey } from "../profile-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

function renderForm(
  onSubmit = vi.fn(),
  extra: Partial<React.ComponentProps<typeof OnboardingForm>> = {},
) {
  render(
    <ToastProvider>
      <TooltipProvider>
        <OnboardingForm
          profile={null}
          email="reid.jackson@example.com"
          onSubmit={onSubmit}
          {...extra}
        />
      </TooltipProvider>
    </ToastProvider>,
  );
  return onSubmit;
}

/** The four first-pass answers (the name is prefilled). */
function answerFirstPass() {
  fireEvent.click(screen.getByLabelText(/^First-time founder/));
  fireEvent.click(screen.getByLabelText(/^Full time/));
  fireEvent.change(screen.getByLabelText("Residence"), { target: { value: "United Kingdom" } });
}

const openDetail = () => fireEvent.click(screen.getByTestId("profile-detail-toggle"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("OnboardingForm (BUILD §11.1 founder profile; UX plan §7.3 two passes)", () => {
  it("asks four things first, the name prefilled, and keeps the rest behind 'Add detail' with the rail counting 5", () => {
    renderForm();
    for (const id of ["name", "experience", "time", "place", "detail"])
      expect(document.querySelector(`[data-section="${id}"]`)).toBeTruthy();
    expect(document.querySelectorAll("[data-section-link]")).toHaveLength(5);
    expect(screen.getByText("1 of 5 done")).toBeTruthy();
    expect((screen.getByLabelText(/What the team calls you/) as HTMLInputElement).value).toBe(
      "Reid Jackson",
    );
    // The optional section is closed for a first-timer: no sliders, no budget, no markets on the first screen.
    const detail = document.querySelector('[data-section="detail"]') as HTMLElement;
    expect(detail.textContent).toContain("Add detail (optional, improves the ideas)");
    expect(detail.hasAttribute("data-open")).toBe(false);
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(screen.queryByLabelText(/Budget you can commit/)).toBeNull();
    expect(screen.getByTestId("profile-detail-closed").textContent).toContain(
      "Skills, budget, target markets, constraints and risk appetite.",
    );
    // Continue is there from the start, and nothing in the optional section is asked for.
    expect(screen.getByTestId("profile-submit").hasAttribute("disabled")).toBe(false);
  });

  it("refuses to submit until name, experience and time are answered, and says how many are missing", () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByTestId("profile-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getAllByRole("alert").some((a) => /2 fields to complete/.test(a.textContent ?? "")),
    ).toBe(true);
    expect(
      document.querySelector('[data-section-link="experience"]')?.getAttribute("data-done"),
    ).toBeNull();
    expect(document.querySelector('[data-section-link="name"]')?.getAttribute("data-done")).toBe(
      "true",
    );
  });

  it("saves the first pass alone: four answers, the market and the currency derived from where the founder lives", async () => {
    const onSubmit = renderForm();
    answerFirstPass();
    expect(screen.getByText("4 of 5 done")).toBeTruthy();
    expect(screen.getByTestId("profile-place-derived").textContent).toBe(
      "Ideas will aim at UK first and count money in British Pound. Change either under Add detail.",
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const patch = onSubmit.mock.calls[0]![0];
    expect(patch).toMatchObject({
      displayName: "Reid Jackson",
      experience: "first_time",
      timeCommitment: "full_time",
      residence: "United Kingdom",
      currency: "GBP",
      targetMarkets: ["UK"],
      budgetMinor: null,
      constraints: [],
      riskAppetite: "medium",
    });
    expect(patch.skills).toEqual({
      engineering: 10,
      sales: 10,
      design: 10,
      finance: 10,
      domain: 10,
    });
    expect(screen.getByTestId("profile-summary").textContent).toMatch(
      /First-time founder · full time · UK/,
    );
  });

  it("submits the whole founder.profile.update patch once the detail is filled in too", async () => {
    const onSubmit = renderForm();
    answerFirstPass();
    openDetail();
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(screen.getByLabelText(/Budget you can commit/), { target: { value: "25k" } });
    const markets = screen.getByPlaceholderText("Add a market and press Enter");
    fireEvent.change(markets, { target: { value: "Nordics" } });
    fireEvent.keyDown(markets, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /^EU$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remote only" }));
    expect(screen.getByText("5 of 5 done")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const patch = onSubmit.mock.calls[0]![0];
    // The founder's own markets win over the one derived from the residence.
    expect(patch).toMatchObject({
      budgetMinor: 2_500_000,
      currency: "GBP",
      targetMarkets: ["Nordics", "EU"],
      constraints: ["Remote only"],
      riskAppetite: "medium",
    });
    expect(screen.getByTestId("profile-summary").textContent).toMatch(
      /First-time founder · full time · GBP 25,000 · Nordics, EU/,
    );
  });

  it("derives the currency from where the founder lives until they pick one themselves (A11)", async () => {
    const onSubmit = renderForm();
    fireEvent.click(screen.getByLabelText(/^First-time founder/));
    fireEvent.click(screen.getByLabelText(/^Full time/));
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    // No residence typed: the currency follows the browser's language (en-US in this test runner), and no market is invented.
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      currency: "USD",
      residence: null,
      targetMarkets: [],
    });
    fireEvent.change(screen.getByLabelText("Residence"), { target: { value: "Germany" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({
      currency: "EUR",
      residence: "Germany",
      targetMarkets: ["DACH"],
    });
  });

  it("the skills carry a legend once, the honest hint, and a four-word picker per skill that sets the slider (A2)", async () => {
    const onSubmit = renderForm();
    answerFirstPass();
    openDetail();
    expect(screen.getByTestId("skill-legend").textContent).toBe(SKILL_SCALE_LEGEND);
    expect(screen.getAllByText(SKILL_SCALE_LEGEND)).toHaveLength(1);
    expect(screen.getByTestId("profile-skills").textContent).toContain(SKILLS_HINT);
    expect(document.querySelectorAll("[data-skill]")).toHaveLength(5);
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    expect(document.querySelectorAll("[data-skill-anchors]")).toHaveLength(5);
    expect(document.querySelector('[data-skill-value="engineering"]')?.textContent).toBe("10");
    const sales = screen.getByRole("group", { name: "Sales: level" });
    fireEvent.click(sales.querySelector('[data-value="expert"]')!);
    expect(document.querySelector('[data-skill-value="sales"]')?.textContent).toBe("18");
    expect(screen.getByRole("slider", { name: "Sales rating" }).getAttribute("aria-valuenow")).toBe(
      "18",
    );
    // The band word beside the figure follows (one /20 scale with its word, decision 3).
    expect(document.querySelector('[data-skill="sales"] [data-scale-label]')?.textContent).toBe(
      "Excellent",
    );
    expect(
      document.querySelector('[data-skill="engineering"] [data-scale-label]')?.textContent,
    ).toBe("Average");
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[0]![0].skills).toEqual({
      engineering: 10,
      sales: 18,
      design: 10,
      finance: 10,
      domain: 10,
    });
  });

  it("'I have no budget yet' is a choice beside the amount: it clears and disables the budget, and typing an amount unpicks it (A11)", async () => {
    const onSubmit = renderForm();
    answerFirstPass();
    openDetail();
    const budget = screen.getByLabelText(/Budget you can commit/) as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "25k" } });
    expect(screen.getByText("5 of 5 done")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("I have no budget yet"));
    expect(budget.value).toBe("");
    expect(budget.disabled).toBe(true);
    expect(document.querySelector('[data-option="none"]')?.getAttribute("data-selected")).toBe(
      "true",
    );
    expect(screen.getByText("5 of 5 done")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ budgetMinor: null });
    // Picking the budget back: the amount field is the answer again.
    fireEvent.change(budget, { target: { value: "10k" } });
    expect(
      document.querySelector('[data-option="none"]')?.getAttribute("data-selected"),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    expect(onSubmit.mock.calls[1]![0]).toMatchObject({ budgetMinor: 1_000_000 });
  });

  it("opens Add detail by itself for an Exited founder or an Operator, and remembers the account's own choice", () => {
    renderForm(vi.fn(), { accountId: ACCOUNT });
    const toggle = () => screen.getByTestId("profile-detail-toggle");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByLabelText(/^Exited founder/));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    fireEvent.click(screen.getByLabelText(/^First-time founder/));
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByLabelText(/^Operator/));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    // The founder closes it: that choice holds whatever the experience, and is kept for this account.
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("Add detail");
    expect(window.localStorage.getItem(detailStorageKey(ACCOUNT))).toBe("0");
    fireEvent.click(screen.getByLabelText(/^Exited founder/));
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    cleanup();
    // Next visit, same account: still closed, even for an Exited founder.
    renderForm(vi.fn(), { accountId: ACCOUNT });
    fireEvent.click(screen.getByLabelText(/^Exited founder/));
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("false");
    cleanup();
    // Another account starts from the experience again.
    renderForm(vi.fn(), { accountId: "22222222-2222-4222-8222-222222222222" });
    fireEvent.click(screen.getByLabelText(/^Exited founder/));
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("profile-detail-toggle").textContent).toContain("Hide detail");
  });

  it("opens Add detail to show a refused answer inside it, and the rail's optional link opens it too", () => {
    const onSubmit = renderForm();
    answerFirstPass();
    openDetail();
    fireEvent.change(screen.getByLabelText(/Budget you can commit/), { target: { value: "abc" } });
    openDetail();
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByTestId("profile-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getAllByRole("alert")
        .some((a) => /Use a number, like 25000 or 25k/.test(a.textContent ?? "")),
    ).toBe(true);
    openDetail();
    fireEvent.click(document.querySelector('[data-section-link="detail"]')!);
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("reassures under Continue while guidance is on, and says nothing when it is off (§5.7, §5.9)", () => {
    renderForm();
    expect(screen.getByTestId("profile-reassurance").textContent).toBe(PROFILE_REASSURANCE);
    expect(screen.getByTestId("profile-reassurance").getAttribute("data-reassurance")).toBe(
      "settings",
    );
    cleanup();
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <TooltipProvider>
          <OnboardingForm profile={null} email="reid.jackson@example.com" onSubmit={vi.fn()} />
        </TooltipProvider>
      </GuidanceProvider>,
    );
    expect(screen.queryByTestId("profile-reassurance")).toBeNull();
    // Information stays: the legend and the band words are not tutoring.
    openDetail();
    expect(screen.getByTestId("skill-legend")).toBeTruthy();
    expect(document.querySelectorAll("[data-scale-label]")).toHaveLength(5);
  });

  it("keeps the account ID behind a disclosure for a co-founder, with benefit hints (A10, A17)", () => {
    render(
      <ToastProvider>
        <TooltipProvider>
          <OnboardingForm
            profile={null}
            email="reid.jackson@example.com"
            accountId={ACCOUNT}
            onSubmit={vi.fn()}
          />
        </TooltipProvider>
      </ToastProvider>,
    );
    const disclosure = screen.getByTestId("profile-account-id");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(disclosure.querySelector("summary")?.textContent).toContain(
      "For a co-founder joining you",
    );
    expect(disclosure.hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("account-id").textContent).toContain(ACCOUNT);
    const place = document.querySelector('[data-section="place"]')!;
    expect(place.textContent).toContain(
      "Where you live decides which countries we suggest for registering the business",
    );
    expect(place.textContent).not.toMatch(/jurisdiction recommender/);
    openDetail();
    expect(document.querySelector('[data-section="detail"]')?.textContent).toContain(
      "Rules the ideas must respect, like 'no stock to buy' or 'keep my day job'.",
    );
  });

  it("pre-fills an existing profile with Add detail open and offers Save", () => {
    render(
      <TooltipProvider>
        <OnboardingForm
          profile={{
            displayName: "Sara",
            experience: "domain_expert",
            skills: { engineering: 18 },
            timeCommitment: "part_time",
            budgetMinor: 1_000_000,
            currency: "SEK",
            citizenship: "Sweden",
            residence: "Sweden",
            targetMarkets: ["Nordics"],
            constraints: ["B2B only"],
            riskAppetite: "high",
          }}
          email="sara@example.com"
          onSubmit={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect((screen.getByLabelText(/What the team calls you/) as HTMLInputElement).value).toBe(
      "Sara",
    );
    expect(screen.getByTestId("profile-detail-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-skill-value="engineering"]')?.textContent).toBe("18");
    expect(screen.getByTestId("profile-submit").textContent).toMatch(/Save and continue/);
    expect(screen.getByText("B2B only")).toBeTruthy();
    expect(screen.getByText("5 of 5 done")).toBeTruthy();
  });

  it("names the guidance toast for experienced founders (UX plan §6.3, decided Oct 20, 2026)", () => {
    expect(GUIDANCE_OFF_TOAST).toEqual({
      title: "Guidance is off for experienced founders",
      description: "Turn it on any time in Settings › Preferences.",
    });
  });
});
