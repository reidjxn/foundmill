// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONCEPT_ATTRIBUTE_KEYS, TooltipProvider } from "@foundmill/dugout";
import { CommitForm, type CommitLogoApi } from "../commit/CommitScreen";
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

function renderForm(onCommit = vi.fn(), extra: Partial<React.ComponentProps<typeof CommitForm>> = {}) {
  render(
    <TooltipProvider>
      <CommitForm idea={idea} viewer={{ email: null }} currency="EUR" onCommit={onCommit} logoApi={fakeLogoApi()} {...extra} />
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
    expect((screen.getByLabelText(/Spend cap per action/) as HTMLInputElement).value).toBe("1,000");
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
    // Name suggestions are local rules, not a model call: no sparkle (it is reserved for generation).
    expect(suggestion.querySelector("svg")).toBeNull();
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
    expect(screen.getByTestId("committing-status").textContent).toBe("Setting up your business: departments, team and the first cycle. This takes a few seconds.");
    // The header says it too, beside the top button, which reads as the work in progress rather than the action.
    expect(screen.getAllByText(/^Setting up your business/)).toHaveLength(2);
    expect(screen.getByTestId("take-charge").textContent).toMatch(/Setting up…/);
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
    expect(squad.textContent).toMatch(/1 agent · 1 department · 1 channel on/);
  });
});
