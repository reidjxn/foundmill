import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoogleSignInButton } from "./GoogleSignInButton";

describe("GoogleSignInButton", () => {
  it("is Google's light-theme button: the standard G beside the call to action, 48 px tall", () => {
    render(<GoogleSignInButton />);
    const button = screen.getByRole("button", { name: "Continue with Google" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("btn-google");
    expect(button.getAttribute("data-size")).toBe("xl");
    const mark = button.querySelector("[data-google-mark]");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    // Google's four colors, unchanged.
    expect([...mark!.querySelectorAll("path")].map((p) => p.getAttribute("fill"))).toEqual(["#EA4335", "#4285F4", "#FBBC05", "#34A853"]);
  });

  it("swaps the mark for the spinner while loading and refuses a second click", () => {
    render(<GoogleSignInButton loading />);
    const button = screen.getByRole("button", { name: "Continue with Google" });
    expect(button.querySelector("[data-google-mark]")).toBeNull();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });
});
