import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IncorporateScreen } from "../IncorporateScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, ENTITY, dataResponses, emptyResponses, recommendation, statusEntityOnly } from "./fixtures";

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
    expect(within(cards[0]!).getByText("Date checked 7 Oct 2026")).toBeTruthy();
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
    const session = screen.getByRole("region", { name: "Supervised session" });
    expect(within(session).getAllByText("Waiting for you").length).toBeGreaterThan(0);
    const steps = within(session).getByRole("list", { name: "Session steps" });
    expect(Array.from(steps.querySelectorAll("li")).map((li) => li.getAttribute("data-state"))).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(within(steps).getAllByText("Founder only")).toHaveLength(2);
    expect(within(session).getByText("supervised:abc123")).toBeTruthy();
    const takeOver = within(session).getByRole("button", { name: "Take over · Open Companies House" });
    expect(takeOver.getAttribute("data-founder-only")).toBe("true");
    fireEvent.click(takeOver);
    expect(fake.opened).toEqual(["https://www.gov.uk/limited-company-formation/register-your-company"]);
    expect(fake.mutations).toHaveLength(0); // opening the page submits nothing
    // the route form is locked while an incorporation is in flight
    expect(screen.getByText("An incorporation is in progress")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start supervised session" }).hasAttribute("disabled")).toBe(true);
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
    expect(screen.getByText(/Start a route on the left/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Incorporation route" });
    const start = within(form).getByRole("button", { name: "Start supervised session" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(within(form).getByRole("radio", { name: /Stripe Atlas/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(form).getByLabelText("Jurisdiction"), { target: { value: "United Kingdom" } });
    expect(within(form).getByRole("radio", { name: /Companies House/ }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(form).getByRole("radio", { name: /Document pack/ }));
    expect(within(form).getByRole("radio", { name: /Document pack/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(form).getByLabelText("Entity type"), { target: { value: "Aktiebolag" } });
    fireEvent.change(within(form).getByLabelText("Legal name"), { target: { value: "Northwind AB" } });
    expect(start.hasAttribute("disabled")).toBe(false);
    fireEvent.click(start);
    expect(fake.mutations[0]).toEqual({ path: "legal.incorporate.start", input: { route: "kit", jurisdiction: "United Kingdom", entityType: "Aktiebolag", legalName: "Northwind AB" } });
    await waitFor(() => expect(fake.refetches["legal.incorporate.status"]).toBe(1));
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
