import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IncorporateScreen } from "../IncorporateScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, ENTITY, dataResponses, emptyResponses, incorporationAwaiting, recommendation, statusActive, statusEntityOnly } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

describe("IncorporateScreen", () => {
  it("runs the recommender and shows the two-jurisdiction headline, up to 6 cards with date-checked stamps and the caption (AC-11.11.1)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (path) => (path === "legal.recommend" ? recommendation : {}) });
    renderScreen(fake, <IncorporateScreen {...props} />);
    expect(screen.getAllByText("Information, not legal or tax advice").length).toBeGreaterThan(0);
    const form = screen.getByRole("form", { name: "Recommender inputs" });
    fireEvent.change(within(form).getByLabelText("Co-founders"), { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Recommend" }));
    expect(fake.mutations[0]).toEqual({ path: "legal.recommend", input: { fundraising: "none", coFounders: 2 } });
    const section = await screen.findByRole("region", { name: "Recommendation" });
    expect(within(section).getByRole("heading", { level: 2 }).textContent).toBe("For your business, we recommend Delaware or the United Kingdom");
    const cards = within(section).getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Date checked Oct 7, 2026")).toBeTruthy();
    expect(within(cards[0]!).getAllByText("Estimate").length).toBe(2);
    expect(within(cards[0]!).getByText(/permanent-establishment risk/)).toBeTruthy();
    expect(within(cards[0]!).getByText("Stripe Atlas")).toBeTruthy();
    expect(within(cards[2]!).getByText("Document pack")).toBeTruthy();
    expect(screen.getAllByText("Information, not legal or tax advice").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Partner professionals are available for a review/)).toBeTruthy();
  });

  it("shows the supervised session with status steps, a founder takeover that only opens the external page, and records 'I submitted' (AC-11.11.4)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <IncorporateScreen {...props} />);
    const session = screen.getByRole("region", { name: "Progress" });
    expect(within(session).getAllByText("Waiting for you").length).toBeGreaterThan(0);
    const steps = within(session).getByRole("list", { name: "Session steps" });
    expect(Array.from(steps.querySelectorAll("li")).map((li) => li.getAttribute("data-state"))).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(within(steps).getAllByText("Founder only")).toHaveLength(2);
    expect(within(session).getByText("supervised:abc123")).toBeTruthy();
    const takeOver = within(session).getByRole("button", { name: "Take over · Open Companies House" });
    expect(takeOver.getAttribute("data-founder-only")).toBe("true");
    fireEvent.click(takeOver);
    expect(fake.opened).toEqual(["https://www.gov.uk/limited-company-formation/register-your-company"]);
    expect(fake.mutations).toHaveLength(0); // opening the page submits nothing
    // the route form is locked while an incorporation is in flight
    expect(screen.getByText("An incorporation is in progress")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prepare the paperwork" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(session).getByRole("button", { name: "I submitted and paid" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    expect(fake.mutations[0]).toEqual({ path: "legal.incorporate.founderSubmitted", input: { incorporationId: ENTITY.inc } });
    await screen.findByText(/Submitted by you/);
    expect(fake.refetches["legal.incorporate.status"]).toBe(1);
  });

  it("starts a route from the chooser when nothing is in flight, and picks the route from the jurisdiction", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "legal.incorporate.status": statusEntityOnly }, onMutate: () => ({ entity: {}, incorporation: {}, workflow: { queued: true }, founderSubmits: true }) });
    renderScreen(fake, <IncorporateScreen {...props} />);
    expect(screen.getByText(/Choose a route on the left/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Incorporation route" });
    const start = within(form).getByRole("button", { name: "Prepare the paperwork" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(within(form).getByRole("radio", { name: /Stripe Atlas/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(form).getByLabelText("Jurisdiction"), { target: { value: "United Kingdom" } });
    expect(within(form).getByRole("radio", { name: /Companies House/ }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(form).getByRole("radio", { name: /Document pack/ }));
    expect(within(form).getByRole("radio", { name: /Document pack/ }).getAttribute("aria-checked")).toBe("true");
    // the pack has no default: the founder names the jurisdiction and the entity type
    expect((within(form).getByLabelText("Jurisdiction") as HTMLInputElement).value).toBe("");
    fireEvent.change(within(form).getByLabelText("Jurisdiction"), { target: { value: "Sweden" } });
    fireEvent.change(within(form).getByLabelText("Entity type"), { target: { value: "Aktiebolag" } });
    fireEvent.change(within(form).getByLabelText("Legal name"), { target: { value: "Northwind AB" } });
    expect(start.hasAttribute("disabled")).toBe(false);
    fireEvent.click(start);
    expect(fake.mutations[0]).toEqual({ path: "legal.incorporate.start", input: { route: "kit", jurisdiction: "Sweden", entityType: "Aktiebolag", legalName: "Northwind AB" } });
    await waitFor(() => expect(fake.refetches["legal.incorporate.status"]).toBe(1));
  });

  it("fills in the jurisdiction and entity type each route forms when its radio is picked (#167)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "legal.incorporate.status": statusEntityOnly } });
    renderScreen(fake, <IncorporateScreen {...props} />);
    const form = screen.getByRole("form", { name: "Incorporation route" });
    const jurisdiction = () => (within(form).getByLabelText("Jurisdiction") as HTMLInputElement).value;
    const entityType = () => (within(form).getByLabelText("Entity type") as HTMLInputElement).value;
    expect([jurisdiction(), entityType()]).toEqual(["Delaware", "C-corp"]);
    await user.click(within(form).getByRole("radio", { name: /Companies House/ }));
    expect([jurisdiction(), entityType()]).toEqual(["United Kingdom", "Ltd"]);
    await user.click(within(form).getByRole("radio", { name: /Stripe Atlas/ }));
    expect([jurisdiction(), entityType()]).toEqual(["Delaware", "C-corp"]);
  });

  it("marks the founder's review as the current step while the pack waits for them (#167)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <IncorporateScreen {...props} />);
    const steps = within(screen.getByRole("list", { name: "Session steps" }));
    const review = steps.getByText("Your review").closest("li")!;
    expect(review.getAttribute("data-state")).toBe("current");
    expect(within(review).queryByText(/^Done/)).toBeNull();
    expect(within(review).getByText("In progress")).toBeTruthy();
  });

  it("cancels an incorporation that has not been filed, after a confirmation (#167)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ incorporation: { status: "abandoned" }, workflow: { queued: true } }) });
    renderScreen(fake, <IncorporateScreen {...props} />);
    const session = screen.getByRole("region", { name: "Progress" });
    await user.click(within(session).getByRole("button", { name: "Cancel incorporation" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nothing has been filed/)).toBeTruthy();
    expect(fake.mutations).toHaveLength(0); // opening the dialog cancels nothing
    await user.click(within(dialog).getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    expect(fake.mutations[0]).toEqual({ path: "legal.incorporate.cancel", input: { incorporationId: ENTITY.inc } });
    await waitFor(() => expect(fake.refetches["legal.incorporate.status"]).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no cancel once the filing is submitted, and shows a cancel failure in the dialog", async () => {
    const user = userEvent.setup();
    const submitted = createFakeSource({ businessId: BID, responses: { ...dataResponses, "legal.incorporate.status": { ...statusActive, incorporation: { ...incorporationAwaiting, status: "submitted" } } } });
    const { unmount } = renderScreen(submitted, <IncorporateScreen {...props} />);
    expect(screen.queryByRole("button", { name: "Cancel incorporation" })).toBeNull();
    unmount();
    const failing = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => { throw new Error("The filing is already with the registry"); } });
    renderScreen(failing, <IncorporateScreen {...props} />);
    await user.click(screen.getByRole("button", { name: "Cancel incorporation" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, cancel it" }));
    expect((await within(screen.getByRole("dialog")).findByRole("alert")).textContent).toBe("The filing is already with the registry");
  });

  it("sends the registration number with 'I submitted and paid' when the founder has it (#166)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <IncorporateScreen {...props} />);
    await user.type(screen.getByLabelText("Registration number"), " 15432198 ");
    await user.click(screen.getByRole("button", { name: "I submitted and paid" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    expect(fake.mutations[0]).toEqual({ path: "legal.incorporate.founderSubmitted", input: { incorporationId: ENTITY.inc, reference: "15432198" } });
  });

  it("surfaces recommender and status errors inline", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => { throw new Error("model unavailable"); } });
    renderScreen(fake, <IncorporateScreen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect((await screen.findByRole("alert")).textContent).toBe("model unavailable");
    act(() => fake.setResponse("legal.incorporate.status", new Error("status down")));
    expect(screen.getAllByText("status down").length).toBeGreaterThan(0);
  });
});
