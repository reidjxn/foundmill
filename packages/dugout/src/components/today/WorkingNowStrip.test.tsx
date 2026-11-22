import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkingNowStrip } from "./WorkingNowStrip";

afterEach(cleanup);

const lines = [
  { id: "a1", agent: "Rhea Stone", doing: "Set up card payments" },
  { id: "a2", agent: "Page Designer", doing: "Draft the pricing page" },
];

describe("WorkingNowStrip", () => {
  it("shows one line for each working agent with what it is doing, and a link to the work", () => {
    render(<WorkingNowStrip lines={lines} href="/b/b1/d/development/training-ground" />);
    const strip = screen.getByTestId("working-now");
    expect(screen.getByRole("heading", { name: "Working now" })).toBeTruthy();
    expect([...strip.querySelectorAll("[data-working-now-line]")].map((li) => li.textContent)).toEqual(["Rhea Stone: Set up card payments", "Page Designer: Draft the pricing page"]);
    expect(screen.getByRole("link", { name: "See the work" }).getAttribute("href")).toBe("/b/b1/d/development/training-ground");
    // Quiet: no progress, no cost, no figures.
    expect(strip.textContent).not.toMatch(/\$|%|Estimate/);
  });

  it("is absent, not empty, when nobody is working", () => {
    const { container } = render(<WorkingNowStrip lines={[]} href="/x" />);
    expect(container.firstChild).toBeNull();
  });
});
