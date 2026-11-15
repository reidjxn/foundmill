import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityLink, EntityLinkProvider } from "../data/EntityLink";
import { AreaLine } from "./AreaLine";

const COS = "11111111-1111-4111-8111-111111111111";

describe("AreaLine", () => {
  it("shows the sentence with its Estimate chip, in a labeled region", () => {
    render(<AreaLine area="Money" sentence="You have £25K and spend about £18K a month, so you have about 1.4 months of cash." provenance="estimate" />);
    const region = screen.getByRole("region", { name: "Money at a glance" });
    expect(region.querySelector("[data-area-sentence]")?.textContent).toBe("You have £25K and spend about £18K a month, so you have about 1.4 months of cash.Estimate");
    expect(region.querySelector("[data-provenance='estimate']")).toBeTruthy();
  });

  it("shows a Forecast chip, and none without a label", () => {
    const { rerender, container } = render(<AreaLine area="Plan" sentence="Your goal: 10 paying customers by Dec 19. 4 of 10 so far: on pace." provenance="forecast" />);
    expect(container.querySelector("[data-provenance='forecast']")).toBeTruthy();
    rerender(<AreaLine area="Customers" sentence="Selling has not started yet." />);
    expect(container.querySelector("[data-provenance]")).toBeNull();
  });

  it("renders entity markup in a string as an EntityLink", () => {
    render(
      <EntityLinkProvider value={{ resolve: (id) => (id === COS ? { id, kind: "agent", name: "Ines Park" } : undefined) }}>
        <AreaLine area="Team" sentence={`[[ent:${COS}|Ines Park]], your Chief of Staff, runs 6 leads and 23 specialists.`} />
      </EntityLinkProvider>,
    );
    const link = screen.getByRole("link", { name: "Ines Park" });
    expect(link.getAttribute("data-entity-kind")).toBe("agent");
    expect(screen.getByTestId("area-line").textContent).toBe("Ines Park, your Chief of Staff, runs 6 leads and 23 specialists.");
  });

  it("takes a node for a sentence the caller renders itself", () => {
    render(<AreaLine area="Team" sentence={<>Your <EntityLink entity={{ id: COS, kind: "agent", name: "Chief of Staff", href: "/a" }} /> runs 2 leads.</>} />);
    expect(screen.getByRole("link", { name: "Chief of Staff" })).toBeTruthy();
  });

  it("shows section lines and the kind line under the sentence", () => {
    render(
      <AreaLine
        area="Money"
        sentence="You have £25K and earn more than you spend, so cash is not running out."
        provenance="estimate"
        sections={[{ id: "company", label: "Company", sentence: "Northwind Ltd: 2 filings are due in the next 30 days, the first on Dec 1." }, { id: "empty", label: "Empty", sentence: null }]}
        kind="Legal is part of Money, in its Company section."
      />,
    );
    const line = screen.getByTestId("area-line");
    expect(line.querySelector("[data-area-section='company']")?.textContent).toBe("Company: Northwind Ltd: 2 filings are due in the next 30 days, the first on Dec 1.");
    expect(line.querySelector("[data-area-section='empty']")).toBeNull();
    expect(line.querySelector("[data-area-kind]")?.textContent).toBe("Legal is part of Money, in its Company section.");
  });

  it("holds the place with a skeleton while loading, and renders nothing with nothing to say", () => {
    const { container, rerender } = render(<AreaLine area="Product" loading />);
    expect(screen.getByTestId("area-line").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("[data-skeleton]")).toBeTruthy();
    rerender(<AreaLine area="Product" sentence={null} />);
    expect(container.querySelector("[data-area-line]")).toBeNull();
    rerender(<AreaLine area="Product" kind="Formulation Lab is part of Product." />);
    expect(container.querySelector("[data-area-kind]")?.textContent).toBe("Formulation Lab is part of Product.");
  });
});
