// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONCEPT_ATTRIBUTE_KEYS, TooltipProvider } from "@foundmill/dugout";
import { CommitForm } from "../commit/CommitScreen";
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

function renderForm(onCommit = vi.fn(), extra: Partial<React.ComponentProps<typeof CommitForm>> = {}) {
  render(
    <TooltipProvider>
      <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={onCommit} {...extra} />
    </TooltipProvider>,
  );
  return onCommit;
}

describe("CommitForm (BUILD §11.1 Commit screen; AC-11.1.6, AC-11.1.7)", () => {
  it("defaults to Assisted and Personal with the card's archetype and name", () => {
    renderForm();
    expect(screen.getByTestId("commit-form").dataset.businessMode).toBe("assisted");
    expect(document.querySelector('[data-option="assisted"]')?.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-option="personal"]')?.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-option="b2b_saas"]')?.getAttribute("data-selected")).toBe("true");
    expect((screen.getByLabelText(/Business name/) as HTMLInputElement).value).toBe("Ledgerly");
    expect((screen.getByLabelText(/Spend cap per action/) as HTMLInputElement).value).toBe("250");
    expect(screen.getByTestId("trademark-caveat").textContent).toMatch(/Screen, not legal clearance/);
    expect(screen.getByTestId("kit-contrast").dataset.passes).toBe("true");
  });

  it("screens domains and trademarks after the name settles", async () => {
    vi.useFakeTimers();
    try {
      renderForm();
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(document.querySelectorAll("[data-domain]")).toHaveLength(5);
      expect(document.querySelector('[data-domain="ledgerly.com"]')).toBeTruthy();
      expect(document.querySelectorAll("[data-registry]")).toHaveLength(2);
      expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes the default spend cap with the business mode until the founder edits it", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/Automated/));
    expect((screen.getByLabelText(/Spend cap per action/) as HTMLInputElement).value).toBe("1000");
    fireEvent.change(screen.getByLabelText(/Spend cap per action/), { target: { value: "75" } });
    fireEvent.click(screen.getByLabelText(/Augmented/));
    expect((screen.getByLabelText(/Spend cap per action/) as HTMLInputElement).value).toBe("75");
  });

  it("submits the idea.commit input and blocks an empty name", async () => {
    const onCommit = renderForm();
    fireEvent.change(screen.getByLabelText(/Business name/), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("take-charge"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((a) => /Give the business a name/.test(a.textContent ?? ""))).toBe(true);
    const suggestion = document.querySelectorAll<HTMLElement>("[data-suggestion]")[1]!;
    const suggested = suggestion.dataset.suggestion!;
    fireEvent.click(suggestion.querySelector("button")!);
    expect((screen.getByLabelText(/Business name/) as HTMLInputElement).value).toBe(suggested);
    fireEvent.click(document.querySelector<HTMLElement>('[data-option="live"] button[role="radio"]')!);
    fireEvent.change(screen.getByTestId("kit-primary-hex"), { target: { value: "#1b4fd8" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("take-charge-bottom"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toMatchObject({ ideaId: IDEA_ID, name: suggested, gameMode: "live", archetype: "b2b_saas", businessMode: "assisted", currency: "EUR", spendCapMinor: 25_000, kit: { primary: "#1b4fd8" } });
  });

  it("shows the team the archetype seeds", () => {
    renderForm(vi.fn(), {
      preview: {
        departments: [{ slug: "product", name: "Product", icon: "box", colourToken: "dept-1", moduleKeys: ["product"], budgetMinor: 0, budgetLabel: "Estimate" }],
        agents: [{ templateKey: "chief_of_staff", name: "Chief of Staff", role: "Chief of Staff", layer: "utility", modelKey: "opus", wageCapMinor: 0, wageLabel: "Estimate" }],
        defaultChannels: ["seo"],
        specOutline: [],
      } as unknown as React.ComponentProps<typeof CommitForm>["preview"],
    });
    const squad = screen.getByTestId("squad-preview");
    expect(squad.textContent).toMatch(/Chief of Staff/);
    expect(squad.textContent).toMatch(/1 agents · 1 departments · 1 channels on/);
  });
});
