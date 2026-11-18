import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekOutcomes } from "./WeekOutcomes";

afterEach(cleanup);

describe("WeekOutcomes", () => {
  it("leads with the count and says what the outcomes were", () => {
    render(<WeekOutcomes headline="This week: 23 real outcomes" detail="1 payment, 2 replies, 20 emails sent" toward="Working toward: never shown beside a count" />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("This week: 23 real outcomes");
    expect(screen.getByTestId("week-outcomes-detail").textContent).toBe("1 payment, 2 replies, 20 emails sent");
    expect(screen.getByTestId("week-outcomes").getAttribute("data-state")).toBe("count");
    expect(screen.queryByTestId("week-outcomes-toward")).toBeNull();
  });

  it("a week with none has no count line and no zero, only what the team is working toward", () => {
    render(<WeekOutcomes headline={null} toward="Working toward: Get the first 10 paying customers by Dec 19" />);
    const section = screen.getByTestId("week-outcomes");
    expect(section.getAttribute("data-state")).toBe("toward");
    expect(screen.queryByTestId("week-outcomes-headline")).toBeNull();
    expect(section.textContent).toBe("Working toward: Get the first 10 paying customers by Dec 19");
    expect(section.textContent).not.toMatch(/\b0\b/);
  });

  it("renders nothing when there is neither", () => {
    const { container } = render(<WeekOutcomes headline={null} toward={null} />);
    expect(container.firstChild).toBeNull();
  });
});
