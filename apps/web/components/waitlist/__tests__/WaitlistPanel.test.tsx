import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/waitlist" }));
const { WaitlistPanel } = await import("../WaitlistPanel");

afterEach(cleanup);

/** WP-14 T15: the page shows a real batch or none, and never a number it was not given. */
describe("WaitlistPanel", () => {
  it("shows the batch the API answered, in the founder's sentence", () => {
    render(<WaitlistPanel read={{ status: "batch", batch: { number: 2, opensOn: "2026-12-01", placesLeft: 40, open: false } }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Foundmill opens in batches");
    expect(screen.getByTestId("waitlist-batch").textContent).toBe("Batch 2 opens Dec 1, 2026. 40 places.");
    expect(screen.getByRole("link", { name: "Join the waitlist" }).getAttribute("href")).toBe("/login");
  });
  it("with no batch set says so and shows no number", () => {
    render(<WaitlistPanel read={{ status: "none" }} />);
    expect(screen.getByTestId("waitlist-no-batch").textContent).toBe("The next batch has no date yet. Join the waitlist and your place is held for it.");
    expect(screen.getByTestId("waitlist-page").textContent).not.toMatch(/\d/);
    expect(screen.queryByTestId("waitlist-batch")).toBeNull();
  });
  it("when the API does not answer it says that, never that there is no batch", () => {
    render(<WaitlistPanel read={{ status: "unavailable" }} />);
    expect(screen.getByTestId("waitlist-batch-unavailable").textContent).toMatch(/could not be loaded/);
    expect(screen.queryByTestId("waitlist-no-batch")).toBeNull();
  });
});
