import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { PAGE_HOLD_MESSAGES, PAGE_SLUG_RULE } from "@foundmill/shared/project-page";
import { PUBLIC_PAGE_WORDS, PublicPageScreen, publishConsequence, type PageViewResponse } from "../PublicPageScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const draft = { pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand.", forWhom: "", stage: "idea" as const, showFounders: false, followForm: true };
const view = (over: Partial<PageViewResponse> = {}): PageViewResponse => ({
  slug: "northwood",
  url: "https://foundmill.example/p/northwood",
  saved: false,
  draft,
  published: null,
  live: false,
  publishedAt: null,
  unpublishedAt: null,
  changed: false,
  canEdit: true,
  canPublish: true,
  isSample: false,
  preview: { name: "Northwood", brandPrimary: "#2f7d6b", brandSecondary: "#ffffff", founderNames: ["Maya"] },
  ...over,
});

const render = (v: PageViewResponse, onMutate?: (path: string, input: Record<string, unknown>) => unknown) => {
  const fake = createFakeSource({ businessId: BID, responses: { "page.get": v }, onMutate });
  renderScreen(fake, <PublicPageScreen businessId={BID} departmentId="d1" />);
  return fake;
};

describe("PublicPageScreen", () => {
  it("shows the fields with counts, the state line, the address and a phone-width preview of the same page", () => {
    render(view());
    expect(screen.getByTestId("page-state").textContent).toContain("Not published yet");
    expect(screen.getByLabelText(/One-line pitch/)).toHaveProperty("value", draft.pitch);
    expect(document.querySelector("[data-count-for$='-pitch']")!.textContent).toBe(`${draft.pitch.length} / 140`);
    expect(document.querySelector("[data-count-for$='-about']")!.textContent).toBe(`${draft.about.length} / 1,500`);
    expect(screen.getByTestId("page-url").textContent).toBe("https://foundmill.example/p/northwood");
    const preview = screen.getByTestId("public-page-preview");
    expect(within(preview).getByRole("heading", { level: 1, name: draft.pitch })).toBeTruthy();
    expect(within(preview).queryByText(/^Built by/)).toBeNull();
    // Copy link and Open only once it is live.
    expect(screen.queryByRole("button", { name: PUBLIC_PAGE_WORDS.copyLink })).toBeNull();
  });

  it("the preview shows the project's own logo, the same as the published page, and the initials without one", () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    render(view({ preview: { name: "Northwood", brandPrimary: "#2f7d6b", brandSecondary: "#ffffff", founderNames: ["Maya"], logo } }));
    expect(screen.getByTestId("public-page-preview").querySelector("img")?.getAttribute("src")).toBe(logo);
  });

  it("the preview follows the typing; an empty about is an inline error and Publish waits for it", () => {
    render(view());
    fireEvent.change(screen.getByLabelText(/One-line pitch/), { target: { value: "Bike repairs at your door" } });
    expect(within(screen.getByTestId("public-page-preview")).getByRole("heading", { level: 1, name: "Bike repairs at your door" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Name the people building it/ }));
    expect(within(screen.getByTestId("public-page-preview")).getByText("Built by Maya")).toBeTruthy();
    const about = screen.getByRole("textbox", { name: /^About/ });
    fireEvent.change(about, { target: { value: "" } });
    fireEvent.blur(about);
    expect(screen.getByText("Say a little about the project.")).toBeTruthy();
    expect((screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.publish }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(PUBLIC_PAGE_WORDS.unsaved)).toBeTruthy();
  });

  it("Publish asks first, saying exactly what becomes public and that it can come down; then publishes what was previewed", async () => {
    const fake = render(view(), (path) => (path === "page.publish" ? { outcome: "published", page: view({ live: true, published: draft, publishedAt: "2026-10-07T12:00:00.000Z" }) } : {}));
    fireEvent.click(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.publish }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: PUBLIC_PAGE_WORDS.confirmTitle })).toBeTruthy();
    expect(within(dialog).getByText(publishConsequence(draft, ["Maya"]))).toBeTruthy();
    expect(publishConsequence(draft, ["Maya"])).toBe("Anyone with the link can read the project's name and logo, its one-line pitch, about, the stage and a form to follow it. You can take it down any time.");
    expect(publishConsequence({ ...draft, followForm: false }, ["Maya"])).toBe("Anyone with the link can read the project's name and logo, its one-line pitch, about and the stage. You can take it down any time.");
    expect(publishConsequence({ ...draft, forWhom: "Renters", showFounders: true }, ["Maya"])).toContain("who it is for, the stage, the names of the people building it and a form to follow it");
    await act(async () => fireEvent.click(within(dialog).getByTestId("page-confirm-publish")));
    expect(fake.mutations).toEqual([{ path: "page.publish", input: { content: draft } }]);
  });

  it("the follow switch: on by default, the preview shows the form disabled, off takes it out; the count only once someone follows", async () => {
    render(view());
    const preview = screen.getByTestId("public-page-preview");
    expect(within(preview).getByRole("heading", { level: 2, name: "Follow Northwood" })).toBeTruthy();
    expect((within(preview).getByRole("button", { name: "Follow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(preview.querySelector("form")).toBeNull();
    expect(screen.queryByTestId("page-followers")).toBeNull();
    const toggle = screen.getByRole("switch", { name: new RegExp(PUBLIC_PAGE_WORDS.followForm) });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(within(preview).queryByRole("heading", { name: "Follow Northwood" })).toBeNull();
  });

  it("where no confirmation can be sent, the switch is off and disabled with one line saying why (WP-02 T7)", () => {
    render(view({ followAvailable: false }));
    const toggle = screen.getByRole("switch", { name: new RegExp(PUBLIC_PAGE_WORDS.followForm) });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("follow-unavailable").textContent).toBe(PUBLIC_PAGE_WORDS.followUnavailable);
    expect(PUBLIC_PAGE_WORDS.followUnavailable).toBe("Following opens when email is switched on for Foundmill. Your page works without it.");
    expect(within(screen.getByTestId("public-page-preview")).queryByRole("heading", { name: "Follow Northwood" })).toBeNull();
  });

  it("says how many people follow, never who", () => {
    render(view({ saved: true, live: true, published: draft, publishedAt: new Date(2026, 9, 7, 12), followers: 3 }));
    expect(screen.getByTestId("page-followers").textContent).toBe("3 people follow this project");
  });

  it("a held page says why, in the founder's words, and stays unpublished", async () => {
    render(view(), (path) => (path === "page.publish" ? { outcome: "held", reason: "personal_data", message: PAGE_HOLD_MESSAGES.personal_data, page: view({ saved: true }) } : {}));
    fireEvent.click(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.publish }));
    await act(async () => fireEvent.click(await screen.findByTestId("page-confirm-publish")));
    await waitFor(() => expect(screen.getByTestId("page-held").textContent).toBe(PAGE_HOLD_MESSAGES.personal_data));
  });

  it("live: the date, Copy link, Open and Take it down; changes show as not yet published", () => {
    render(view({ saved: true, live: true, published: draft, publishedAt: new Date(2026, 9, 7, 12) }));
    expect(screen.getByTestId("page-state").textContent).toContain("Live since Oct 7, 2026");
    expect(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.copyLink })).toBeTruthy();
    expect(screen.getByRole("link", { name: PUBLIC_PAGE_WORDS.open }).getAttribute("href")).toBe("https://foundmill.example/p/northwood");
    expect(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.takeDown })).toBeTruthy();
    expect(screen.queryByRole("button", { name: PUBLIC_PAGE_WORDS.publishChanges })).toBeNull();
    fireEvent.change(screen.getByLabelText(/One-line pitch/), { target: { value: "Candles, now in three sizes" } });
    expect(screen.getByTestId("page-state").textContent).toContain("Live, with changes not yet published");
    expect(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.publishChanges })).toBeTruthy();
  });

  it("Change address states the rule and shows the server's refusal", async () => {
    const fake = render(view(), (path) => {
      if (path === "page.setSlug") throw new Error("That address is taken. Try another one.");
      return {};
    });
    fireEvent.click(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.changeAddress }));
    expect(screen.getByText(PAGE_SLUG_RULE)).toBeTruthy();
    const box = screen.getByLabelText(PUBLIC_PAGE_WORDS.newAddress);
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.saveAddress }));
    expect(screen.getByText("The address needs at least 3 characters.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "taken-one" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: PUBLIC_PAGE_WORDS.saveAddress })));
    await waitFor(() => expect(screen.getByText("That address is taken. Try another one.")).toBeTruthy());
    expect(fake.mutations[0]).toMatchObject({ path: "page.setSlug", input: { slug: "taken-one", draft } });
  });

  it("members who cannot publish read it, with one sentence saying who can", () => {
    render(view({ canPublish: false, canEdit: true }));
    expect(screen.getByTestId("page-read-only").textContent).toBe(PUBLIC_PAGE_WORDS.readOnly);
    expect(screen.getByLabelText(/One-line pitch/)).toHaveProperty("readOnly", true);
    expect(screen.queryByTestId("page-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: PUBLIC_PAGE_WORDS.changeAddress })).toBeNull();
  });

  it("a sample business says it has no public page and offers no publish", () => {
    render(view({ isSample: true }));
    expect(screen.getByText(PUBLIC_PAGE_WORDS.sample)).toBeTruthy();
    expect(screen.queryByRole("button", { name: PUBLIC_PAGE_WORDS.publish })).toBeNull();
  });
});
