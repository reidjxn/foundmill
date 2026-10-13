// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let business: { isAdmin: boolean; data: { role: string } } = { isAdmin: false, data: { role: "member" } };
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => business }));

import { AdminOnly } from "../shared";

describe("AdminOnly (audit RUI-05)", () => {
  it("disables the controls of a settings screen for a member, for the keyboard as well as the pointer, and says why", () => {
    business = { isAdmin: false, data: { role: "member" } };
    render(
      <AdminOnly>
        <button type="button">Go on vacation</button>
      </AdminOnly>,
    );
    const button = screen.getByRole("button", { name: "Go on vacation" });
    const group = button.closest("fieldset");
    expect(group?.disabled).toBe(true);
    expect(group?.getAttribute("data-testid")).toBe("read-only-settings");
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.getByText(/an owner or admin changes them/)).toBeTruthy();
  });

  it("leaves an owner's or admin's controls alone", () => {
    business = { isAdmin: true, data: { role: "owner" } };
    render(
      <AdminOnly>
        <button type="button">Go on vacation</button>
      </AdminOnly>,
    );
    expect(screen.getByRole("button", { name: "Go on vacation" }).closest("fieldset")).toBeNull();
    expect(screen.queryByText("Read only")).toBeNull();
  });
});
