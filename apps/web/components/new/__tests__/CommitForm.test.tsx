// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuilderViewProvider, CONCEPT_ATTRIBUTE_KEYS, GuidanceProvider, TooltipProvider } from "@foundmill/dugout";
import { TRPCClientError } from "@trpc/client";
import { FIRST_DAY_PROMISE, domainCandidates } from "@foundmill/shared";
import { termsWithGlossary } from "@foundmill/shared/terms";
import { COMMIT_WORDS, CommitForm, HOW_IT_RUNS_REASSURANCE, WHAT_HAPPENS_NEXT, archetypeParam, commitSteps, departmentColour, importHref, includedCreditsLine, spendCapSummary, startingTeamLine, teamCountsLine, upgradeHrefOf, type CommitDomainApi, type CommitLogoApi } from "../commit/CommitScreen";
import type { DomainCheck } from "../commit/naming";
import { IMPORT_STEPS, STUDIO_STEPS } from "../StudioFrame";
import { META_KIND, type IdeaLike } from "../ideate/concepts";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const IDEA_ID = "11111111-1111-4111-8111-111111111111";

const idea: IdeaLike = {
  id: IDEA_ID,
  title: "Ledgerly",
  pitch: "Bookkeeping that closes itself for freelancers.",
  archetype: "b2b_saas",
  current: {
    id: "v1",
    version: 1,
    title: "Ledgerly",
    pitch: "Bookkeeping that closes itself for freelancers.",
    attributes: Object.fromEntries(CONCEPT_ATTRIBUTE_KEYS.map((k, i) => [k, { value: 8 + (i % 5), evidence: "e" }])),
    starsCurrent: "3",
    starsPotential: "4",
    research: { citations: [{ title: "a", url: "https://a" }, { title: "b", url: "https://b" }, { kind: META_KIND, crest_seed: "seed-1" }] },
    parentVersionId: null,
    action: "generated",
    createdAt: "2026-10-07T10:00:00Z",
  },
};

const mark = (fill: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><rect width="100" height="100" rx="22" fill="${fill}"/></svg>`)}`;
const OPTIONS = [
  { id: "a1", name: "Orbit", concept: "A ring with one point on it.", dataUrl: mark("#1f6f5f"), colours: ["#1f6f5f", "#e8c56b"] },
  { id: "a2", name: "Stack", concept: "Three bars.", dataUrl: mark("#2b6cb0"), colours: ["#2b6cb0", "#f5b841"] },
  { id: "a3", name: "Fold", concept: "Two panels.", dataUrl: mark("#7a3b8f"), colours: ["#7a3b8f", "#f29e4c"] },
  { id: "a4", name: "Arch", concept: "A doorway.", dataUrl: mark("#b23a2e"), colours: ["#b23a2e", "#f5b841"] },
];

function fakeLogoApi(over: Partial<CommitLogoApi> = {}): CommitLogoApi & { generate: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn> } {
  return {
    prepare: vi.fn(async (dataUrl: string) => ({ dataUrl, colours: ["#0f766e", "#fbbf24"] })),
    generate: vi.fn(async () => ({ options: OPTIONS, cost: { amountMinor: 7, currency: "USD", label: "Estimate" as const }, remaining: 9, mode: "mock" as const })),
    ...over,
  } as never;
}

const CHECKED_AT = "2026-10-13T15:45:00.000Z";
const answer = (domain: string, status: DomainCheck["status"] = "available", over: Partial<DomainCheck> = {}): DomainCheck => ({ domain, status, provenance: "Registry", estimate: false, checkedAt: CHECKED_AT, ...over });

/** `idea.domainCheck` answered from the registry: every candidate available unless `statuses` says otherwise. */
function fakeDomainApi(statuses: Record<string, Partial<DomainCheck>> = {}, over: Partial<CommitDomainApi> = {}): CommitDomainApi & { check: ReturnType<typeof vi.fn> } {
  return {
    check: vi.fn(async (input: { name: string } | { domains: string[] }) => ("name" in input ? domainCandidates(input.name) : input.domains).map((d) => answer(d, "available", statuses[d]))),
    ...over,
  } as never;
}

/** The app's definitions map (GuidanceHost hands the same to the provider), so the Terms on the screen are real. */
const TERMS = termsWithGlossary(null);

/**
 * Renders the form with guidance on and the definitions, and opens "More options" (WP-04 T2: the name checks, the logo,
 * How it runs and the team start behind it, for everyone); `collapsed: true` leaves it closed.
 */
function renderForm(onCommit = vi.fn(), extra: Partial<React.ComponentProps<typeof CommitForm>> = {}, { collapsed = false, guidance = "on" as "on" | "off", builder = false } = {}) {
  render(
    <GuidanceProvider value={{ guidance, terms: TERMS }}>
      <BuilderViewProvider on={builder}>
        <TooltipProvider>
          <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={onCommit} logoApi={fakeLogoApi()} domainApi={fakeDomainApi()} {...extra} />
        </TooltipProvider>
      </BuilderViewProvider>
    </GuidanceProvider>,
  );
  if (!collapsed) openMore();
  return onCommit;
}

function openMore() {
  const more = screen.getByTestId("commit-more");
  if (more.getAttribute("aria-expanded") !== "true") fireEvent.click(more);
}

/** The panels that wait behind "More options". */
const MORE_PANELS = ["name-checks-panel", "logo-panel", "how-it-runs", "how-it-runs-controls", "squad-preview", "commit-words-note"] as const;

describe("CommitForm: name and go (WP-04 T2)", () => {
  for (const guidance of ["on", "off"] as const) {
    it(`with guidance ${guidance}, shows the name, what happens next, the credits line and one button; the rest waits behind More options`, () => {
      const domainApi = fakeDomainApi();
      renderForm(vi.fn(), { domainApi }, { collapsed: true, guidance });
      const form = screen.getByTestId("commit-form");
      // One field: the name, prefilled from the card.
      const inputs = [...form.querySelectorAll("input, textarea, select")].filter((n) => (n as HTMLInputElement).type !== "hidden");
      expect(inputs).toHaveLength(1);
      expect((screen.getByLabelText(/Business name/) as HTMLInputElement).value).toBe("Ledgerly");
      // What happens next, each line, and the included credits.
      const next = screen.getByTestId("what-happens-next");
      expect(next.querySelectorAll("li")).toHaveLength(WHAT_HAPPENS_NEXT.length);
      for (const step of WHAT_HAPPENS_NEXT) expect(next.textContent).toContain(step);
      expect(screen.getByTestId("commit-credits-line").textContent).toBe(includedCreditsLine());
      // One button that starts it: "Start my project".
      const starts = [...form.querySelectorAll("button")].filter((b) => /Start my project/.test(b.textContent ?? ""));
      expect(starts).toHaveLength(1);
      expect(starts[0]!.getAttribute("data-testid")).toBe("take-charge");
      expect(screen.queryByTestId("take-charge-bottom")).toBeNull();
      // Closed for everyone, guidance on or off.
      const more = screen.getByTestId("commit-more");
      expect(more.textContent).toContain("More options");
      expect(more.getAttribute("aria-expanded")).toBe("false");
      for (const id of MORE_PANELS) expect(screen.queryByTestId(id)).toBeNull();
      // Nothing on the default view names a domain, a trademark, a spend line, a mode or a wage.
      expect(form.textContent).not.toMatch(/domain|trademark|spend cap|Assisted|Automated|Augmented|wage/i);
      // The domain checker is not asked until the founder opens More options.
      expect(domainApi.check).not.toHaveBeenCalled();
      fireEvent.click(more);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      for (const id of MORE_PANELS) expect(screen.getByTestId(id)).toBeTruthy();
      expect(screen.getByTestId("take-charge-bottom").textContent).toContain("Start my project");
      fireEvent.click(more);
      expect(screen.queryByTestId("logo-panel")).toBeNull();
    });
  }

  it("asks the domain checker only once More options is open", async () => {
    vi.useFakeTimers();
    try {
      const domainApi = fakeDomainApi();
      renderForm(vi.fn(), { domainApi }, { collapsed: true });
      await settle();
      expect(domainApi.check).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("commit-more"));
      await settle();
      expect(domainApi.check).toHaveBeenCalledTimes(1);
      expect(domainApi.check.mock.calls[0]![0]).toEqual({ name: "Ledgerly" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens More options when an answer inside it is refused", async () => {
    const onCommit = vi.fn();
    renderForm(onCommit, { idea: { ...idea, archetype: null } }, { collapsed: true });
    expect(screen.queryByTestId("archetype-panel")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("commit-more").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("archetype-panel")).toBeTruthy();
  });

  it("asks for time and where you live when the profile lacks them, and Start waits for exactly those two (WP-14 T2)", async () => {
    const onCommit = renderForm(vi.fn(), { aboutMissing: ["timeCommitment", "residence"] }, { collapsed: true });
    const panel = screen.getByTestId("commit-about-you");
    expect(within(panel).getAllByRole("radio").length).toBe(4);
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("2 things to fix first")).toBeTruthy();
    expect(within(panel).getByText("Pick how much time you can give.")).toBeTruthy();
    expect(within(panel).getByText("Tell your team where you live.")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("radio", { name: /A few hours a week/ }));
    fireEvent.change(within(panel).getByLabelText(/Where do you live/), { target: { value: " Canada " } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ ideaId: IDEA_ID, name: "Ledgerly", timeCommitment: "few_hours", residence: "Canada" });
  });

  it("asks only for the one that is missing, and for nothing when the profile has both", async () => {
    renderForm(vi.fn(), { aboutMissing: ["residence"] }, { collapsed: true });
    expect(within(screen.getByTestId("commit-about-you")).queryAllByRole("radio").length).toBe(0);
    expect(screen.getByLabelText(/Where do you live/)).toBeTruthy();
    cleanup();
    const onCommit = renderForm(vi.fn(), {}, { collapsed: true });
    expect(screen.queryByTestId("commit-about-you")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[0]![0]).not.toHaveProperty("timeCommitment");
    expect(onCommit.mock.calls[0]![0]).not.toHaveProperty("residence");
  });

  it("starts with the defaults in one press when nothing is opened", async () => {
    const onCommit = renderForm(vi.fn(), {}, { collapsed: true });
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ ideaId: IDEA_ID, name: "Ledgerly", gameMode: "personal", businessMode: "assisted", archetype: "b2b_saas" });
  });

  it("says the words of the plan: the title, the lede, the reassurance and the button while it starts", () => {
    renderForm(vi.fn(), {}, { collapsed: true });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Start Ledgerly");
    expect(screen.getByText(COMMIT_WORDS.lede)).toBeTruthy();
    expect(COMMIT_WORDS.lede).toBe("Name your project. We've set everything else to the careful option, and you can change any of it later.");
    expect(screen.getByTestId("reassure-name").textContent).toBe("You can change the name, the logo and how your team works any time.");
    fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "" } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Start your project");
    cleanup();
    renderForm(vi.fn(), { committing: true }, { collapsed: true });
    expect(screen.getByTestId("take-charge").textContent).toMatch(/Starting…/);
  });

  it("shows the wage line inside More options only while Builder view is on", () => {
    const preview = {
      departments: [{ slug: "product", name: "Product", icon: "box", colourToken: "dept-1", moduleKeys: ["product"], budgetMinor: 0, budgetLabel: "Estimate" }],
      agents: [{ templateKey: "chief_of_staff", name: "Chief of Staff", role: "Chief of Staff", layer: "assistant", modelKey: "opus", wageCapMinor: 40_000, wageCurrency: "USD", wageLabel: "Estimate" }],
      defaultChannels: [],
      specOutline: [],
    } as unknown as React.ComponentProps<typeof CommitForm>["preview"];
    renderForm(vi.fn(), { preview });
    expect(screen.getByTestId("squad-preview")).toBeTruthy();
    expect(screen.queryByTestId("squad-preview-wages")).toBeNull();
    cleanup();
    renderForm(vi.fn(), { preview }, { builder: true });
    expect(screen.getByTestId("squad-preview-wages").textContent).toMatch(/^Up to \$400\.00 a month in wage caps/);
  });
});

/** A b2b-shaped preview: the three starters, four more agents and one background helper. */
const TEAM_PREVIEW = {
  departments: [{ slug: "product", name: "Product", icon: "box", colourToken: "dept-1", moduleKeys: ["product"], budgetMinor: 0, budgetLabel: "Estimate" }],
  agents: [
    { templateKey: "chief_of_staff", name: "Chief of Staff", role: "Chief of Staff", layer: "assistant", modelKey: "opus", wageCapMinor: 40_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "product_lead", name: "Product Lead", role: "Leads Product", layer: "lead", modelKey: "opus", wageCapMinor: 30_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "researcher", name: "Researcher", role: "Finds sources", layer: "worker", modelKey: "sonnet", wageCapMinor: 10_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "product_researcher", name: "Product researcher", role: "Studies users", layer: "worker", modelKey: "sonnet", wageCapMinor: 10_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "engineering_lead", name: "Engineering Lead", role: "Leads Development", layer: "lead", modelKey: "opus", wageCapMinor: 30_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "planner", name: "Planner", role: "Plans the build", layer: "worker", modelKey: "opus", wageCapMinor: 10_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "finance_lead", name: "Finance Lead", role: "Leads Finance", layer: "lead", modelKey: "sonnet", wageCapMinor: 10_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
    { templateKey: "entity_linker", name: "Entity linker", role: "Links mentions", layer: "utility", background: true, modelKey: "haiku", wageCapMinor: 2_000, wageCurrency: "USD", wageLabel: "Estimate", departmentSlug: "product" },
  ],
  defaultChannels: [],
  specOutline: [],
} as unknown as NonNullable<React.ComponentProps<typeof CommitForm>["preview"]>;

describe("CommitForm: the starting team, as shown (WP-04 T4)", () => {
  it("names the three starters and counts the rest, background helpers left out", () => {
    expect(startingTeamLine(TEAM_PREVIEW)).toBe("Your starting team: Chief of Staff, Product Lead and Researcher. 4 more join as the work needs them.");
    expect(startingTeamLine({ agents: TEAM_PREVIEW.agents.slice(0, 3) })).toBe("Your starting team: Chief of Staff, Product Lead and Researcher.");
  });

  it("says the starting team in one line on the default view, with no model or wage", () => {
    renderForm(vi.fn(), { preview: TEAM_PREVIEW }, { collapsed: true });
    expect(screen.getByTestId("starting-team-line").textContent).toBe(startingTeamLine(TEAM_PREVIEW));
    expect(screen.getByTestId("commit-form").textContent).not.toMatch(/Opus|Sonnet|Haiku|wage/i);
    expect(screen.queryByTestId("squad-preview")).toBeNull();
  });

  it("lists the three starters inside More options, everyone behind See everyone, model chips only in Builder view", () => {
    renderForm(vi.fn(), { preview: TEAM_PREVIEW });
    const list = () => within(screen.getByTestId("squad-preview")).getByRole("list", { name: "Team" });
    expect(within(list()).getAllByRole("listitem").map((li) => li.querySelector(".text-body-strong")?.textContent)).toEqual(["Chief of Staff", "Product Lead", "Researcher"]);
    expect(screen.getByTestId("squad-preview").textContent).not.toMatch(/Opus|Sonnet/);
    const all = screen.getByRole("button", { name: "See everyone" });
    expect(all.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(all);
    expect(within(list()).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByTestId("squad-preview").textContent).not.toMatch(/Entity linker/);
    cleanup();
    renderForm(vi.fn(), { preview: TEAM_PREVIEW }, { builder: true });
    expect(screen.getByTestId("squad-preview").textContent).toMatch(/Opus/);
  });
});

describe("CommitForm (BUILD §11.1 Commit screen; AC-11.1.6, AC-11.1.7)", () => {
  it("inside More options: Name checks, Logo, and How it runs summed up in labeled lines over its five controls (A3, §7.6)", () => {
    renderForm();
    expect(screen.getByTestId("name-panel")).toBeTruthy();
    expect(screen.getByTestId("logo-panel")).toBeTruthy();
    const summary = screen.getByTestId("how-it-runs-summary");
    const chips = () => Array.from(summary.querySelectorAll("[data-summary]")).map((c) => [c.getAttribute("data-summary"), c.textContent]);
    // Labeled lines since Nov 8, 2026 (first-time founder report): the spend cap sits with who decides.
    expect(chips()).toEqual([
      ["game-mode", "Personal"],
      ["business-mode", "Assisted"],
      ["spend-cap", "Asks you before any spend"],
      ["archetype", "B2B SaaS"],
      ["autopilot", "Autopilot off"],
    ]);
    for (const label of ["Where it runs", "Who decides", "Kind of business", "On a schedule"]) expect(summary.textContent).toContain(label);
    // The chips that have a definition are Terms: the dotted word opens its definition card.
    for (const [chip, term] of [
      ["archetype", "archetype"],
      ["business-mode", "business_mode"],
      ["autopilot", "autopilot"],
    ]) expect(summary.querySelector(`[data-summary="${chip}"] button[data-term="${term}"]`)?.className).toContain("term-link");
    expect(screen.getByTestId("reassure-how-it-runs").textContent).toBe(HOW_IT_RUNS_REASSURANCE);
    // The five controls are open under the summary once More options is.
    expect(screen.getByRole("radiogroup", { name: "Personal or live" })).toBeTruthy();
    expect(screen.getByTestId("archetype-panel")).toBeTruthy();
    expect(screen.getByTestId("business-mode-panel")).toBeTruthy();
    expect(screen.getByLabelText(/Spend cap per action/)).toBeTruthy();
    // Every control keeps its id, and the chips follow the controls.
    fireEvent.click(screen.getByRole("switch", { name: "Overnight shift" }));
    fireEvent.click(screen.getByLabelText(/Automated/));
    fireEvent.click(document.querySelector<HTMLElement>('[data-option="live"] button[role="radio"]')!);
    fireEvent.change(screen.getByLabelText(/Spend cap per action/), { target: { value: "" } });
    expect(chips()).toEqual([
      ["game-mode", "Live"],
      ["business-mode", "Automated"],
      ["spend-cap", "No spend cap"],
      ["archetype", "B2B SaaS"],
      ["autopilot", "Overnight shift on"],
    ]);
    // Closing More options keeps the choices.
    fireEvent.click(screen.getByTestId("commit-more"));
    expect(screen.queryByTestId("archetype-panel")).toBeNull();
    expect(screen.getByTestId("commit-form").dataset.businessMode).toBe("automated");
    expect(spendCapSummary(" 1,000 ", "USD")).toBe("Asks you above $1,000.00");
    expect(spendCapSummary("abc", "USD")).toBe("Spend cap to fix");
    expect(spendCapSummary("0", "USD")).toBe("Asks you before any spend");
  });

  it("asks for the archetype inside More options when the card has none", () => {
    renderForm(vi.fn(), { idea: { ...idea, archetype: null } }, { guidance: "off" });
    expect(screen.getByTestId("archetype-panel")).toBeTruthy();
    expect(screen.getByTestId("how-it-runs-summary").querySelector('[data-summary="archetype"]')?.textContent).toBe("Pick an archetype");
  });

  it("defaults to Assisted and Personal with the card's archetype and name", () => {
    renderForm();
    expect(screen.getByTestId("commit-form").dataset.businessMode).toBe("assisted");
    expect(document.querySelector('[data-option="assisted"]')?.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-option="personal"]')?.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-option="b2b_saas"]')?.getAttribute("data-selected")).toBe("true");
    expect((screen.getByLabelText(/Business name/) as HTMLInputElement).value).toBe("Ledgerly");
    // The careful defaults (WP-14 T11; founder, 2026-11-22): a cap of 0, so every spend asks, the overnight shift off, the initials mark.
    expect((screen.getByLabelText(/Spend cap per action/) as HTMLInputElement).value).toBe("0");
    expect(screen.getByRole("switch", { name: "Overnight shift" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("autopilot-choice").textContent).toContain("Off unless you turn it on.");
    expect(screen.getByTestId("trademark-caveat").textContent).toMatch(/Screen, not legal clearance/);
    expect(screen.getByTestId("kit-contrast").dataset.passes).toBe("true");
  });

  it("offers Live only where LIVE is open (audit VLS2-X1)", () => {
    renderForm();
    expect(document.querySelector('[data-option="live"]')).not.toBeNull();
    cleanup();
    renderForm(vi.fn(), { liveOpen: false });
    expect(document.querySelector('[data-option="live"]')).toBeNull();
    expect(document.querySelector('[data-option="personal"]')?.getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("live-closed-note").textContent).toContain("Live is not open yet");
  });

  it("screens the trademark after the name settles, as an Estimate and not a registry search", async () => {
    vi.useFakeTimers();
    try {
      renderForm();
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(document.querySelectorAll("[data-registry]")).toHaveLength(2);
      // One panel checks the name; each registry's acronym is expanded where it is read (A12).
      expect(screen.getByTestId("name-checks-panel").textContent).toMatch(/Check the name \(domains and trademarks\)/);
      expect(screen.getByTestId("trademark-screen").textContent).toMatch(/USPTO, the US trademark office/);
      expect(screen.getByTestId("trademark-screen").textContent).toMatch(/EUIPO, the EU trademark office/);
      expect(screen.getByTestId("trademark-provenance").textContent).toMatch(/Estimate/);
      // "Ledgerly" starts like the known mark "ledger": said about that list, with the mark named (nothing invented).
      expect(document.querySelector("[data-registry]")?.textContent).toMatch(/LEDGER.*Close to a known mark/);
      expect(screen.getByTestId("trademark-caveat").textContent).toMatch(/A quick check.*not a registry search/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what happens next in the real order, with the included credits line and no dollar figure (A4, A10; WP-14 T11)", () => {
    renderForm();
    const next = screen.getByTestId("what-happens-next");
    // The steps are the shared first-day promise itself, not a copy of it (WP-02 T6), and the welcome note repeats it (WP-04 T7).
    expect(WHAT_HAPPENS_NEXT).toBe(FIRST_DAY_PROMISE);
    expect(WHAT_HAPPENS_NEXT).toEqual(["Your page is drafted first, from your own words. About a minute.", "You check it and publish it. Then you have a link to send.", "Your plan arrives as one note to approve.", "Nothing costs money or goes out in your name unless you say so."]);
    expect(next.textContent).not.toMatch(/specification|roadmap|two notes|sign them off/i);
    for (const step of WHAT_HAPPENS_NEXT) expect(next.textContent).toContain(step);
    expect(next.textContent).not.toMatch(/Board|three decisions|first cycle/);
    // No dollar figure and no word about a card (WP-14 T11): true while the entry plan is free and after it is paid.
    expect(includedCreditsLine()).toBe("Your team starts with this month's included credits.");
    expect(includedCreditsLine()).not.toMatch(/[$€£]|\d|card|free/i);
    expect(screen.getByTestId("commit-credits-line").textContent).toBe("Your team starts with this month's included credits.");
    cleanup();
    // When this month's shared budget is already used, the resting notice speaks instead; the credits line never contradicts it.
    renderForm(vi.fn(), { creditsNotice: "This month's team budget ($5.00) is already used by your other projects." });
    expect(screen.queryByTestId("commit-credits-line")).toBeNull();
  });

  it("gives every business mode an example line and says 'your limits', never 'caps' (§7.6)", () => {
    renderForm();
    const examples = Array.from(document.querySelectorAll("[data-mode-example]")).map((n) => n.textContent);
    expect(examples).toHaveLength(3);
    expect(examples[1]).toBe("Example: drafts the pricing page and publishes it; asks before paying for a domain.");
    expect(screen.getByTestId("business-mode-panel").textContent).toMatch(/within your limits/);
    expect(screen.getByTestId("business-mode-panel").textContent).not.toMatch(/\bcaps\b/);
  });

  it("reassures under Name, Logo, How it runs, Archetype and Mode while guidance is on, and says nothing when it is off (§5.7, §5.9)", () => {
    renderForm();
    for (const id of ["reassure-name", "reassure-logo", "reassure-how-it-runs", "reassure-archetype", "reassure-mode"]) expect(screen.getByTestId(id).getAttribute("data-reassurance")).toBe("settings");
    expect(screen.getByTestId("reassure-name").textContent).toBe("You can change the name, the logo and how your team works any time.");
    expect(screen.getByTestId("reassure-logo").textContent).toBe("You can change this later in Settings › Business.");
    expect(screen.getByTestId("reassure-archetype").textContent).toBe("You can change this later in Settings › Business.");
    expect(screen.getByTestId("reassure-mode").textContent).toBe("You can change this later in Settings › What the team can do.");
    cleanup();
    render(
      <GuidanceProvider value={{ guidance: "off", terms: TERMS }}>
        <TooltipProvider>
          <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={vi.fn()} logoApi={fakeLogoApi()} domainApi={fakeDomainApi()} />
        </TooltipProvider>
      </GuidanceProvider>,
    );
    openMore();
    for (const id of ["reassure-name", "reassure-logo", "reassure-how-it-runs", "reassure-archetype", "reassure-mode"]) expect(screen.queryByTestId(id)).toBeNull();
    // Information stays: the credits line, the chips and the example lines are not tutoring.
    expect(screen.getByTestId("commit-credits-line")).toBeTruthy();
    expect(screen.getByTestId("how-it-runs-summary").textContent).toContain("Asks you before any spend");
    expect(document.querySelectorAll("[data-mode-example]")).toHaveLength(3);
    // Panel titles carry the defined words as plain text when guidance is off, never a broken underline.
    expect(screen.getByTestId("archetype-panel").querySelector('[data-term="archetype"]')?.getAttribute("data-guided")).toBe("off");
  });
  it("keeps the cap at 0 in every mode, and never overwrites what the founder typed", () => {
    renderForm();
    const cap = () => (screen.getByLabelText(/Spend cap per action/) as HTMLInputElement).value;
    fireEvent.click(screen.getByLabelText(/Automated/));
    expect(cap()).toBe("0");
    fireEvent.click(screen.getByLabelText(/Augmented/));
    expect(cap()).toBe("0");
    fireEvent.click(screen.getByLabelText(/Assisted/));
    expect(cap()).toBe("0");
    fireEvent.change(screen.getByLabelText(/Spend cap per action/), { target: { value: "75" } });
    fireEvent.click(screen.getByLabelText(/Augmented/));
    expect(cap()).toBe("75");
  });

  it("commits with the careful defaults in one press, and a founder who changes two of them gets what they chose (WP-14 T11)", async () => {
    const onCommit = renderForm();
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ businessMode: "assisted", gameMode: "personal", spendCapMinor: 0, currency: "EUR", autopilot: false, logo: null });
    expect(onCommit.mock.calls[0]![0]).not.toHaveProperty("overnight");
    // Change two: the cap and the overnight shift.
    fireEvent.change(screen.getByLabelText(/Spend cap per action/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("switch", { name: "Overnight shift" }));
    expect(screen.getByTestId("how-it-runs-summary").querySelector('[data-summary="spend-cap"]')?.textContent).toBe("Asks you above €40.00");
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[1]![0]).toMatchObject({ spendCapMinor: 4_000, autopilot: true, overnight: { timeZone: expect.any(String) } });
  });

  it("offers the overnight shift, off when the page opens (A4), and sends the choice with idea.commit", async () => {
    const onCommit = renderForm();
    const toggle = screen.getByRole("switch", { name: "Overnight shift" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ autopilot: false });
    expect(onCommit.mock.calls[0]![0]).not.toHaveProperty("overnight");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[1]![0]).toMatchObject({ autopilot: true, overnight: { timeZone: expect.any(String) } });
  });

  it("offers Give agents names and faces, starting from the account preference, sends the choice with idea.commit and keeps the five chips", async () => {
    const onCommit = renderForm();
    const toggle = screen.getByRole("switch", { name: "Give agents names and faces" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anthropomorphic-choice").textContent).toContain("still AI agents");
    // The summary line stays the five choices the step is laid out around.
    expect(screen.getByTestId("how-it-runs-summary").querySelectorAll("[data-summary]")).toHaveLength(5);
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ anthropomorphicAgents: false });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[1]![0]).toMatchObject({ anthropomorphicAgents: true });
  });

  it("offers the four styles only while the switch is on, starts at the account's style, and sends the choice with idea.commit", async () => {
    const onCommit = renderForm(vi.fn(), { anthropomorphicDefault: true, agentStyleDefault: "cartoon_2d" });
    expect(screen.getByRole("radiogroup", { name: "Style" })).toBeTruthy();
    expect(within(screen.getByRole("radiogroup", { name: "Style" })).getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "2D cartoon humans and animals" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ anthropomorphicAgents: true, agentStyle: "fantasy" });
    // Switching the faces off hides the choice.
    fireEvent.click(screen.getByRole("switch", { name: "Give agents names and faces" }));
    expect(screen.queryByRole("radiogroup", { name: "Style" })).toBeNull();
  });

  it("with the switch off there is no style to choose, and Humans is what is sent", async () => {
    const onCommit = renderForm();
    expect(screen.queryByRole("radiogroup", { name: "Style" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge"));
    });
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ anthropomorphicAgents: false, agentStyle: "humans" });
  });

  it("starts the Give agents names and faces switch on when the account preference is on, and follows it until the founder chooses", () => {
    const view = render(
      <GuidanceProvider value={{ guidance: "on", terms: TERMS }}>
        <TooltipProvider>
          <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={vi.fn()} logoApi={fakeLogoApi()} domainApi={fakeDomainApi()} anthropomorphicDefault />
        </TooltipProvider>
      </GuidanceProvider>,
    );
    openMore();
    const toggle = screen.getByRole("switch", { name: "Give agents names and faces" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    // The preference arrives late: the switch follows it while untouched ...
    view.rerender(
      <GuidanceProvider value={{ guidance: "on", terms: TERMS }}>
        <TooltipProvider>
          <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={vi.fn()} logoApi={fakeLogoApi()} domainApi={fakeDomainApi()} anthropomorphicDefault={false} />
        </TooltipProvider>
      </GuidanceProvider>,
    );
    expect(screen.getByRole("switch", { name: "Give agents names and faces" }).getAttribute("aria-checked")).toBe("false");
    // ... and stops following once the founder has chosen here.
    fireEvent.click(screen.getByRole("switch", { name: "Give agents names and faces" }));
    view.rerender(
      <GuidanceProvider value={{ guidance: "on", terms: TERMS }}>
        <TooltipProvider>
          <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={vi.fn()} logoApi={fakeLogoApi()} domainApi={fakeDomainApi()} anthropomorphicDefault />
        </TooltipProvider>
      </GuidanceProvider>,
    );
    expect(screen.getByRole("switch", { name: "Give agents names and faces" }).getAttribute("aria-checked")).toBe("true");
  });

  it("submits the idea.commit input and blocks an empty name", async () => {
    const onCommit = renderForm();
    fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("take-charge"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((a) => /Give the business a name/.test(a.textContent ?? ""))).toBe(true);
    const suggestion = document.querySelectorAll<HTMLElement>("[data-suggestion]")[1]!;
    const suggested = suggestion.dataset.suggestion!;
    // Name suggestions are local rules, not a model call: no sparkle (it is reserved for generation).
    expect(suggestion.querySelector("svg")).toBeNull();
    fireEvent.click(suggestion.querySelector("button")!);
    expect((screen.getByLabelText(/Business name/) as HTMLInputElement).value).toBe(suggested);
    fireEvent.click(document.querySelector<HTMLElement>('[data-option="live"] button[role="radio"]')!);
    fireEvent.change(screen.getByTestId("kit-primary-hex"), { target: { value: "#1b4fd8" } });
    // A LIVE start asks the founder to confirm that they are 18 or older (the network is for adults) before it goes.
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge-bottom"));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((a) => /18 or older/.test(a.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I am 18 or older/ }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge-bottom"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ ideaId: IDEA_ID, name: suggested, gameMode: "live", confirmAdult: true, archetype: "b2b_saas", businessMode: "assisted", currency: "EUR", spendCapMinor: 0, kit: { primary: "#1b4fd8" } });
  });

  it("does not ask again for a LIVE start once the founder's 18+ confirmation is on record, and never for Personal", async () => {
    const onCommit = renderForm(vi.fn(), { adultConfirmed: true });
    expect(screen.queryByTestId("commit-adult")).toBeNull();
    fireEvent.click(document.querySelector<HTMLElement>('[data-option="live"] button[role="radio"]')!);
    expect(screen.queryByTestId("commit-adult")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge-bottom"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ gameMode: "live" });
    expect(onCommit.mock.calls[0]![0]).not.toHaveProperty("confirmAdult");
  });

  it("starts with the initials mark (no shield), generates four marks, picks one, takes its colours and commits it", async () => {
    const logoApi = fakeLogoApi();
    const onCommit = renderForm(vi.fn(), { logoApi });
    const preview = screen.getByTestId("logo-preview");
    expect(preview.querySelector("[data-logo]")?.getAttribute("data-logo")).toBe("initials");
    expect(preview.querySelector("text")?.textContent).toBe("LE");
    expect(preview.querySelector("path")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-generate"));
    });
    // The set streams: the form hands the picker's progress callback and stop signal through.
    expect(logoApi.generate).toHaveBeenCalledWith({ name: "Ledgerly", colours: expect.objectContaining({ primary: expect.any(String) }), archetype: "b2b_saas", round: 0 }, expect.any(Function), expect.any(AbortSignal));
    const options = screen.getAllByTestId("logo-option");
    expect(options).toHaveLength(4);
    expect(options[0]!.querySelector("img")?.getAttribute("src")).toBe(OPTIONS[0]!.dataUrl);
    expect(screen.getByTestId("logo-cost").textContent).toMatch(/US\$0\.07/);
    expect(screen.getByTestId("logo-options").textContent).toMatch(/Estimate/);

    await act(async () => {
      fireEvent.click(options[0]!);
    });
    expect(options[0]!.getAttribute("aria-checked")).toBe("true");
    expect(preview.querySelector("img")?.getAttribute("src")).toBe(OPTIONS[0]!.dataUrl);
    // The concept card preview follows the chosen logo.
    expect(document.querySelector("article[data-concept] img")?.getAttribute("src")).toBe(OPTIONS[0]!.dataUrl);

    // Colours from the logo are suggested, applied on request, and still editable.
    await waitFor(() => expect(screen.getByTestId("logo-colour-suggestion")).toBeTruthy());
    fireEvent.click(screen.getByTestId("logo-use-colours"));
    expect((screen.getByTestId("kit-primary-hex") as HTMLInputElement).value).toBe("#1f6f5f");
    expect((screen.getByTestId("kit-secondary-hex") as HTMLInputElement).value).toBe("#e8c56b");
    expect(screen.queryByTestId("logo-colour-suggestion")).toBeNull();
    fireEvent.change(screen.getByTestId("kit-primary-hex"), { target: { value: "#14532d" } });

    // Generate again asks for the next set.
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-regenerate"));
    });
    expect(logoApi.generate).toHaveBeenLastCalledWith(expect.objectContaining({ round: 1, colours: expect.objectContaining({ primary: "#14532d" }) }), expect.any(Function), expect.any(AbortSignal));

    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge-bottom"));
    });
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ logo: { source: "generated", dataUrl: OPTIONS[0]!.dataUrl }, kit: { primary: "#14532d", secondary: "#e8c56b" } });
  });

  it("uploads an SVG through the server check, shows the cleaned result, and can go back to the initials mark", async () => {
    const cleaned = mark("#0f766e");
    const logoApi = fakeLogoApi({ prepare: vi.fn(async () => ({ dataUrl: cleaned, colours: ["#0f766e", "#fbbf24"] })) });
    const onCommit = renderForm(vi.fn(), { logoApi });
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10"/></svg>'], "logo.svg", { type: "image/svg+xml" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("logo-file"), { target: { files: [svg] } });
    });
    await waitFor(() => expect(logoApi.prepare).toHaveBeenCalledTimes(1));
    const sent = (logoApi.prepare as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sent.startsWith("data:image/svg+xml;base64,")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("logo-preview").querySelector("img")?.getAttribute("src")).toBe(cleaned));
    expect(screen.getByTestId("logo-picker").getAttribute("data-logo-source")).toBe("upload");

    fireEvent.click(screen.getByTestId("logo-clear"));
    await waitFor(() => expect(screen.getByTestId("logo-picker").getAttribute("data-logo-source")).toBe("initials"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge-bottom"));
    });
    expect(onCommit.mock.calls[0]![0].logo).toBeNull();
  });

  it("refuses an oversize or unsupported file before sending it, and shows the server's reason when the check fails", async () => {
    const logoApi = fakeLogoApi({ prepare: vi.fn(async () => Promise.reject(new Error("The file says image/png but its contents are image/jpeg."))) });
    renderForm(vi.fn(), { logoApi });
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "huge.svg", { type: "image/svg+xml" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("logo-file"), { target: { files: [big] } });
    });
    expect(screen.getByTestId("logo-error").textContent).toMatch(/larger than 2 MB/);
    const gif = new File(["GIF89a"], "x.gif", { type: "image/gif" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("logo-file"), { target: { files: [gif] } });
    });
    expect(screen.getByTestId("logo-error").textContent).toMatch(/PNG, JPEG, WebP or SVG/);
    expect(logoApi.prepare).not.toHaveBeenCalled();
    const svg = new File(["<svg/>"], "ok.svg", { type: "image/svg+xml" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("logo-file"), { target: { files: [svg] } });
    });
    await waitFor(() => expect(screen.getByTestId("logo-error").textContent).toMatch(/contents are image\/jpeg/));
    expect(screen.getByTestId("logo-picker").getAttribute("data-logo-source")).toBe("initials");
  });

  it("says what is happening while the business is set up", () => {
    renderForm(vi.fn(), { committing: true });
    expect(screen.getByTestId("committing-status").textContent).toBe("Setting up your business: departments, team and the first tasks. This takes a few seconds.");
    // The header says it too, beside the top button, which reads as the work in progress rather than the action.
    expect(screen.getAllByText(/^Setting up your business/)).toHaveLength(2);
    expect(screen.getByTestId("take-charge").textContent).toMatch(/Starting…/);
  });

  it("turns the plan's business limit into an upgrade prompt that opens Billing of the business whose plan sets it", () => {
    const refusal = new TRPCClientError("Try holds 1 project and you have 1. You keep it. Founder holds up to 5: change plan in Settings › Billing to take charge of another, or archive one.", { result: { error: { code: -32003, message: "x", data: { code: "FORBIDDEN", httpStatus: 403, appCode: "tier_limit", details: { limit: "businesses", tier: "free", allowed: 1, used: 1, planBusinessId: "b1" } } } } } as never);
    expect(upgradeHrefOf(refusal)).toBe("/b/b1/settings/billing");
    expect(upgradeHrefOf(new TRPCClientError("Seats", { result: { error: { code: -32003, message: "x", data: { appCode: "tier_limit", details: { limit: "seats", planBusinessId: "b1" } } } } } as never))).toBeNull();
    expect(upgradeHrefOf(new Error("network"))).toBeNull();
    renderForm(vi.fn(), { error: refusal.message, upgradeHref: upgradeHrefOf(refusal) });
    expect(screen.getByRole("alert").textContent).toMatch(/Try holds 1 project/);
    expect(screen.getByTestId("commit-upgrade").getAttribute("href")).toBe("/b/b1/settings/billing");
  });

  it("says before Take charge when the team would start resting (this month's shared budget is already used)", () => {
    renderForm(vi.fn());
    expect(screen.queryByTestId("commit-credits-notice")).toBeNull();
    cleanup();
    renderForm(vi.fn(), { creditsNotice: "This month's team budget ($5.00) is already used by your other projects, so this one starts resting." });
    const notice = screen.getByTestId("commit-credits-notice");
    expect(notice.textContent).toContain("Team starts resting");
    expect(notice.textContent).toContain("is already used by your other projects");
  });

  it("shows the team the archetype seeds", () => {
    renderForm(
      vi.fn(),
      {
      preview: {
        departments: [{ slug: "product", name: "Editorial", baseName: "Product", icon: "box", colourToken: "dept-1", moduleKeys: ["product"], budgetMinor: 0, budgetLabel: "Estimate" }],
        agents: [
          { templateKey: "chief_of_staff", name: "Chief of Staff", role: "Chief of Staff", layer: "assistant", modelKey: "opus", wageCapMinor: 40_000, wageCurrency: "USD", wageLabel: "Estimate" },
          { templateKey: "source_watcher", name: "Source watcher", role: "Watches the imported sources", layer: "utility", background: true, modelKey: "haiku", wageCapMinor: 5_000, wageCurrency: "USD", wageLabel: "Estimate" },
        ],
        defaultChannels: ["seo"],
        specOutline: [],
      } as unknown as React.ComponentProps<typeof CommitForm>["preview"],
      },
      // The wage line is Builder view's (WP-04 T2).
      { builder: true },
    );
    const squad = screen.getByTestId("squad-preview");
    expect(squad.textContent).toMatch(/Chief of Staff/);
    // A platform helper stays off the roster, as on the Team screen; the count says it is there (first-time founder report, Nov 8, 2026).
    expect(squad.textContent).not.toMatch(/Source watcher/);
    expect(screen.getByTestId("squad-preview-counts").textContent).toBe("1 agent · 1 department · 1 channel on · plus 1 background helper");
    // The wage caps add up, in the credits' currency, named when the business counts in another; the helper's cap is left out.
    expect(screen.getByTestId("squad-preview-wages").textContent).toMatch(/^Up to \$400\.00 a month in wage caps/);
    expect(screen.getByTestId("squad-preview-wages").textContent).toMatch(/Wages are counted in US dollars, not in your EUR\./);
    expect(screen.getByTestId("squad-preview-wages").querySelector("[data-provenance='estimate']")).toBeTruthy();
    // An archetype's own department name is said as such, never a silent rename.
    expect(screen.getByText(/· your Product department/)).toBeTruthy();
    expect(screen.getByTestId("department-rename-note").textContent).toBe("A B2B SaaS business calls its Product department Editorial; it does the same work.");
  });

  it("names no channels in the team's count when none can run for a new project yet (never '0 channels on')", () => {
    const agents = [{ templateKey: "chief_of_staff", layer: "assistant", wageCapMinor: 40_000 }];
    expect(teamCountsLine({ agents, departments: [{}, {}], defaultChannels: [] })).toBe("1 agent · 2 departments");
    expect(teamCountsLine({ agents, departments: [{}, {}], defaultChannels: ["seo", "geo"] })).toBe("1 agent · 2 departments · 2 channels on");
  });

  it("preselects the Import report's archetype over the card's and says where it came from (audit IAE-10)", () => {
    renderForm(vi.fn(), { suggestedArchetype: "services" });
    expect(document.querySelector('[data-option="services"]')?.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-option="b2b_saas"]')?.getAttribute("data-selected")).not.toBe("true");
    expect(screen.getByText("From the import report")).toBeTruthy();
    expect(screen.queryByText("From the card")).toBeNull();
  });

  it("draws Import's own trail when it came from Import (audit IAE-18)", () => {
    renderForm(vi.fn(), { steps: commitSteps(true, "job-1") });
    const ids = Array.from(document.querySelectorAll("[data-step-item]")).map((n) => n.getAttribute("data-step-item"));
    expect(ids).toEqual(IMPORT_STEPS.map((s) => s.id));
    expect(ids).not.toContain("ideate");
    expect(document.querySelector('[data-step-item="import"] a')?.getAttribute("href")).toBe("/new/import?job=job-1");
  });
});

/** Lets the debounce fire and the promises settle. */
async function settle(ms = 500) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

const domainsBox = () => screen.getByTestId("domain-checks");
const rowFor = (domain: string) => domainsBox().querySelector(`[data-domain="${domain}"]`) as HTMLElement;

describe("CommitForm domain checker (audit #458: a real lookup, never a guess)", () => {
  it("asks the registry once the name settles and draws Available, Taken and 'Couldn't check' with where each came from", async () => {
    vi.useFakeTimers();
    try {
      const domainApi = fakeDomainApi({ "ledgerly.com": { status: "taken", registrar: "MarkMonitor Inc.", expires: "2028-09-14" }, "ledgerly.io": { status: "unknown", reason: "The registry is busy. Try again in a minute." } });
      renderForm(vi.fn(), { domainApi });
      expect(domainsBox().textContent).toMatch(/Checking/);
      await settle();
      expect(domainApi.check).toHaveBeenCalledTimes(1);
      expect(domainApi.check.mock.calls[0]![0]).toEqual({ name: "Ledgerly" });
      expect(domainApi.check.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
      expect(domainsBox().querySelectorAll("[data-domain]")).toHaveLength(5);
      expect(rowFor("ledgerly.com").dataset.status).toBe("taken");
      expect(rowFor("ledgerly.com").textContent).toMatch(/Taken/);
      expect(rowFor("ledgerly.com").title).toBe("Registered with MarkMonitor Inc., expires 2028-09-14");
      expect(rowFor("ledgerly.co").textContent).toMatch(/Available/);
      expect(rowFor("ledgerly.io").dataset.status).toBe("unknown");
      expect(rowFor("ledgerly.io").textContent).toMatch(/Couldn't check/);
      expect(rowFor("ledgerly.io").textContent).toMatch(/The registry is busy/);
      expect(rowFor("ledgerly.io").querySelector('[data-testid="domain-retry"]')).toBeTruthy();
      expect(rowFor("ledgerly.com").querySelector('[data-testid="domain-retry"]')).toBeNull();
      // Registry answers: a "Domain registry" chip, no Estimate chip anywhere in the Domains column, and the time it was checked.
      expect([...domainsBox().querySelectorAll('[data-testid="domain-provenance"]')].map((c) => c.textContent)).toEqual(["Domain registry"]);
      expect(domainsBox().querySelector('[data-provenance="estimate"]')).toBeNull();
      expect(domainsBox().textContent).not.toMatch(/Estimate/);
      expect(screen.getByTestId("domain-checked").textContent).toMatch(/^Checked \d{1,2}:\d{2} (AM|PM)\.\s*$/);
      expect(screen.getByTestId("domain-note").textContent).toContain("Availability is a snapshot; registering the domain happens at a registrar. We never buy domains for you.");
      // Premium is not claimed anywhere: the registry cannot tell it.
      expect(domainsBox().textContent).not.toMatch(/Premium/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a DNS answer reads 'DNS lookup (Estimate)'; the mock reads 'Mock'", async () => {
    vi.useFakeTimers();
    try {
      const domainApi = fakeDomainApi({
        "ledgerly.io": { provenance: "DNS", estimate: true, reason: "It has no DNS records. This TLD has no public registry lookup, so this is an estimate." },
        "ledgerly.co": { provenance: "DNS", estimate: true, status: "taken" },
        "ledgerly.com": { provenance: "Mock" },
      });
      renderForm(vi.fn(), { domainApi });
      await settle();
      expect([...domainsBox().querySelectorAll('[data-testid="domain-provenance"]')].map((c) => c.textContent)).toEqual(["Domain registry", "DNS lookup (Estimate)", "Mock"]);
      expect(rowFor("ledgerly.io").dataset.provenance).toBe("DNS");
      expect(rowFor("ledgerly.io").textContent).toMatch(/this is an estimate/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounces: typing asks once, for the final name", async () => {
    vi.useFakeTimers();
    try {
      const domainApi = fakeDomainApi();
      renderForm(vi.fn(), { domainApi });
      const input = screen.getByLabelText(/Business name/);
      for (const value of ["N", "No", "Nor", "Nort", "Northwind HQ"]) {
        fireEvent.change(input, { target: { value } });
        await act(async () => {
          vi.advanceTimersByTime(100);
        });
      }
      expect(domainApi.check).not.toHaveBeenCalled();
      await settle();
      expect(domainApi.check).toHaveBeenCalledTimes(1);
      expect(domainApi.check.mock.calls[0]![0]).toEqual({ name: "Northwind HQ" });
      expect(rowFor("northwindhq.com")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slow answer for an old name never overwrites the newer list, and the old request is cancelled", async () => {
    vi.useFakeTimers();
    try {
      let releaseOld!: (rows: DomainCheck[]) => void;
      const signals: AbortSignal[] = [];
      const domainApi = fakeDomainApi(
        {},
        {
          check: vi.fn((input: { name: string } | { domains: string[] }, signal?: AbortSignal) => {
            signals.push(signal!);
            if ("name" in input && input.name === "Ledgerly") return new Promise<DomainCheck[]>((resolve) => (releaseOld = resolve));
            return Promise.resolve(("name" in input ? domainCandidates(input.name) : input.domains).map((d) => answer(d)));
          }),
        },
      );
      renderForm(vi.fn(), { domainApi });
      await settle(); // the first name is asked and is still waiting
      expect(domainApi.check).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "Northwind" } });
      // The old rows are not shown for the new name while it is checked.
      expect(domainsBox().querySelector("[data-domain]")).toBeNull();
      await settle();
      expect(signals[0]!.aborted).toBe(true);
      expect(rowFor("northwind.com")).toBeTruthy();
      // The old answer arrives late, as taken: it is dropped.
      await act(async () => {
        releaseOld(domainCandidates("Ledgerly").map((d) => answer(d, "taken")));
      });
      expect(rowFor("northwind.com").dataset.status).toBe("available");
      expect(domainsBox().querySelector('[data-domain="ledgerly.com"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("when the call itself fails every row says 'Couldn't check' with a Retry that asks for that domain only", async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const domainApi = fakeDomainApi(
        {},
        {
          check: vi.fn(async (input: { name: string } | { domains: string[] }) => {
            if (fail) throw new Error("gateway down");
            return ("name" in input ? domainCandidates(input.name) : input.domains).map((d) => answer(d));
          }),
        },
      );
      renderForm(vi.fn(), { domainApi });
      await settle();
      const rows = [...domainsBox().querySelectorAll("[data-domain]")] as HTMLElement[];
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.dataset.status).toBe("unknown");
        expect(row.textContent).toMatch(/Couldn't check/);
        expect(row.querySelector('[data-testid="domain-retry"]')).toBeTruthy();
      }
      // No invented status, no provenance chip, no time, no Estimate.
      expect(domainsBox().querySelector('[data-testid="domain-provenance"]')).toBeNull();
      expect(domainsBox().querySelector('[data-testid="domain-checked"]')).toBeNull();
      expect(domainsBox().textContent).not.toMatch(/Available|Taken|Estimate/);
      // Retry one: it asks for that domain only, and only that row changes.
      fail = false;
      fireEvent.click(rowFor("ledgerly.ai").querySelector('[data-testid="domain-retry"]')!);
      await act(async () => {});
      expect(domainApi.check.mock.calls.at(-1)![0]).toEqual({ domains: ["ledgerly.ai"] });
      expect(rowFor("ledgerly.ai").dataset.status).toBe("available");
      expect(rowFor("ledgerly.com").dataset.status).toBe("unknown");
      expect(screen.getByTestId("domain-checked").textContent).toMatch(/Checked/);
      // A retry that fails again keeps the row as it was, with its Retry.
      fail = true;
      fireEvent.click(rowFor("ledgerly.io").querySelector('[data-testid="domain-retry"]')!);
      await act(async () => {});
      expect(rowFor("ledgerly.io").dataset.status).toBe("unknown");
      expect(rowFor("ledgerly.io").querySelector('[data-testid="domain-retry"]')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Retry answered after the name changed is dropped", async () => {
    vi.useFakeTimers();
    try {
      let release!: (rows: DomainCheck[]) => void;
      const domainApi = fakeDomainApi(
        { "ledgerly.io": { status: "unknown", reason: "busy" } },
        {
          check: vi.fn((input: { name: string } | { domains: string[] }) => {
            if ("domains" in input) return new Promise<DomainCheck[]>((resolve) => (release = resolve));
            return Promise.resolve(domainCandidates(input.name).map((d) => answer(d, d.endsWith(".io") ? "unknown" : "available", d.endsWith(".io") ? { reason: "busy" } : {})));
          }),
        },
      );
      renderForm(vi.fn(), { domainApi });
      await settle();
      fireEvent.click(rowFor("ledgerly.io").querySelector('[data-testid="domain-retry"]')!);
      fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "Ledgerlyx" } });
      await settle();
      await act(async () => {
        release([answer("ledgerly.io", "taken")]);
      });
      expect(domainsBox().querySelector('[data-domain="ledgerly.io"]')).toBeNull();
      expect(rowFor("ledgerlyx.io").dataset.status).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks nothing for an empty name or one that cannot make a domain, and says so", async () => {
    vi.useFakeTimers();
    try {
      const domainApi = fakeDomainApi();
      renderForm(vi.fn(), { domainApi });
      await settle();
      expect(domainApi.check).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "日本" } });
      await settle();
      expect(domainApi.check).toHaveBeenCalledTimes(1);
      expect(domainsBox().textContent).toMatch(/Add letters or numbers/);
      fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "" } });
      await settle();
      expect(domainsBox().textContent).toMatch(/Type a name to check domains/);
      expect(domainApi.check).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("any status still lets the founder commit", async () => {
    vi.useFakeTimers();
    try {
      const onCommit = vi.fn();
      renderForm(onCommit, { domainApi: fakeDomainApi({ "ledgerly.com": { status: "taken" } }) });
      await settle();
      expect(rowFor("ledgerly.com").dataset.status).toBe("taken");
      fireEvent.click(screen.getByTestId("take-charge"));
      expect(onCommit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("commit screen helpers", () => {
  it("the trail is the studio's unless the founder came from Import", () => {
    expect(commitSteps(false, "job-1")).toBe(STUDIO_STEPS);
    expect(commitSteps(true, null).find((s) => s.id === "import")?.href).toBe("/new/import");
  });

  it("Back from Commit returns to the finished import when its job is known", () => {
    expect(importHref("a.b")).toBe("/new/import?job=a.b");
    expect(importHref(null)).toBe("/new/import");
  });

  it("reads only known archetypes from the address", () => {
    expect(archetypeParam("b2b_saas")).toBe("b2b_saas");
    expect(archetypeParam("crest")).toBeNull();
    expect(archetypeParam(null)).toBeNull();
  });

  it("an agent wears its own department's color, not the color of its place in the list (audit AC-15)", () => {
    const preview = { departments: [{ slug: "product", colourToken: "dept-1" as const }, { slug: "development", colourToken: "dept-2" as const }, { slug: "team", colourToken: "dept-6" as const }] };
    expect(departmentColour(preview, "development")).toBe("dept-2");
    expect(departmentColour(preview, "team")).toBe("dept-6");
    expect(departmentColour(preview, null)).toBe("dept-1");
    expect(departmentColour(preview, "unknown")).toBe("dept-1");
    expect(departmentColour({ departments: [] }, "x")).toBe("dept-1");
  });
});
