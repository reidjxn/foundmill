import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_ORBIT_DEPARTMENTS, TeamOrbit } from "./TeamOrbit";

describe("TeamOrbit", () => {
  it("is one decorative image with a name that describes the team", () => {
    render(<TeamOrbit />);
    const img = screen.getByRole("img", { name: /Your team: you at the center, a Chief of Staff, and 6 departments with 6 leads and 10 agents/ });
    expect(img.querySelectorAll("[aria-hidden] [role='img']").length).toBeGreaterThan(0);
  });

  it("places a lead and a label for every department, every worker on the outer orbit and the Chief of Staff", () => {
    const { container } = render(<TeamOrbit />);
    const leads = container.querySelector('[data-orbit="leads"]')!;
    for (const d of DEFAULT_ORBIT_DEPARTMENTS) expect(leads.textContent).toContain(d.name);
    expect(container.querySelector('[data-orbit="workers"]')!.children).toHaveLength(10);
    expect(container.querySelector('[data-orbit="chief"]')!.textContent).toContain("Chief of Staff");
  });

  it("turns the rings in opposite directions and takes custom labels", () => {
    const { container } = render(<TeamOrbit centreLabel="Sara" centreCaption="Founder" periodSeconds={30} />);
    const leads = container.querySelector<HTMLElement>('[data-orbit="leads"]')!;
    const workers = container.querySelector<HTMLElement>('[data-orbit="workers"]')!;
    expect(leads.style.animationDuration).toBe("30s");
    expect(workers.style.animationDirection).toBe("reverse");
    expect(container.textContent).toContain("Sara");
  });
});
