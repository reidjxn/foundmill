import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormerProjectCard } from "./FormerProjectCard";

afterEach(cleanup);

describe("FormerProjectCard", () => {
  it("says when the project is deleted and until when it can be stopped, and asks once more before canceling", () => {
    const onCancel = vi.fn();
    render(<FormerProjectCard projectName="Bread by Bike" scheduledFor="Nov 20, 2026" until="Nov 19, 2026 at 3:45 PM" onCancel={onCancel} />);
    expect(screen.getByRole("heading").textContent).toBe("Bread by Bike is set to be deleted");
    expect(screen.getByText(/permanently deleted on Nov 20, 2026/).textContent).toContain("until Nov 19, 2026 at 3:45 PM");
    expect(screen.getByText(/It does not give you your place back/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("former-project-cancel"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("former-project-card").getAttribute("data-state")).toBe("confirming");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByTestId("former-project-card").getAttribute("data-state")).toBe("ready");
    fireEvent.click(screen.getByTestId("former-project-cancel"));
    fireEvent.click(screen.getByTestId("former-project-confirm"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("once done, says so in place of the buttons; a refusal is read out", () => {
    const { rerender } = render(<FormerProjectCard projectName="Bread by Bike" scheduledFor="Nov 20, 2026" until="Nov 19, 2026" onCancel={() => {}} done />);
    expect(screen.getByRole("heading").textContent).toBe("The deletion of Bread by Bike is canceled, and every founder was told.");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<FormerProjectCard projectName="Bread by Bike" scheduledFor="Nov 20, 2026" until="Nov 19, 2026" onCancel={() => {}} error="No longer possible." />);
    expect(screen.getByRole("alert").textContent).toBe("No longer possible.");
  });
});
