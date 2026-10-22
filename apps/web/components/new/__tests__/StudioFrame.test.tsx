// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@foundmill/config";
import { MONOGRAM_HEIGHT, MONOGRAM_WIDTH } from "@foundmill/dugout/brand";
import { IMPORT_STEPS, STUDIO_STEPS, StudioFrame } from "../StudioFrame";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

describe("StudioFrame (first-run trail)", () => {
  it("draws no step trail on an account page (Your businesses)", () => {
    render(
      <StudioFrame title="Your businesses">
        <p>body</p>
      </StudioFrame>,
    );
    expect(screen.queryByRole("navigation", { name: "First-run steps" })).toBeNull();
    expect(screen.getByTestId("studio-frame").hasAttribute("data-step")).toBe(false);
  });

  it("marks earlier steps done, the current one active and later ones upcoming", () => {
    render(
      <StudioFrame step="ideate" title="Ideation Studio" viewer={{ email: "founder@example.com" }}>
        <p>body</p>
      </StudioFrame>,
    );
    const frame = screen.getByTestId("studio-frame");
    expect(frame.dataset.step).toBe("ideate");
    expect(frame.querySelector('[data-step-item="profile"]')?.getAttribute("data-state")).toBe("done");
    expect(frame.querySelector('[data-step-item="new"]')?.getAttribute("data-state")).toBe("done");
    expect(frame.querySelector('[data-step-item="ideate"]')?.getAttribute("data-state")).toBe("active");
    expect(frame.querySelector('[data-step-item="ideate"]')?.getAttribute("aria-current")).toBe("step");
    expect(frame.querySelector('[data-step-item="compare"]')?.getAttribute("data-state")).toBe("upcoming");
    expect(frame.querySelector('[data-step-item="commit"]')?.getAttribute("data-state")).toBe("upcoming");
    // Done steps link back; upcoming ones do not.
    expect(frame.querySelector('[data-step-item="profile"] a')?.getAttribute("href")).toBe("/onboarding");
    expect(frame.querySelector('[data-step-item="compare"] a')).toBeNull();
    expect(screen.getByText("founder@example.com")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ideation Studio");
  });

  it("carries the Foundmill wordmark alone in its top bar, never the FM monogram", () => {
    const { container } = render(
      <StudioFrame step="new" title="New business">
        <p>body</p>
      </StudioFrame>,
    );
    const home = screen.getByRole("link", { name: `${APP_NAME} home` });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector(`svg[viewBox="0 0 ${MONOGRAM_WIDTH} ${MONOGRAM_HEIGHT}"]`)).toBeNull();
    expect(container.querySelector("svg[data-variant]")).toBeNull();
  });

  it("draws the import trail for Door B", () => {
    render(
      <StudioFrame step="import" steps={IMPORT_STEPS} title="Import">
        <p>body</p>
      </StudioFrame>,
    );
    expect(IMPORT_STEPS.map((s) => s.id)).toEqual(["profile", "new", "import", "commit"]);
    expect(STUDIO_STEPS.map((s) => s.id)).toEqual(["profile", "new", "ideate", "compare", "commit"]);
    // The words say what each step is for (A9); the ids stay.
    expect(STUDIO_STEPS.map((s) => s.label)).toEqual(["Your profile", "Start", "Ideas", "Compare (optional)", "Launch"]);
    expect(IMPORT_STEPS.map((s) => s.label)).toEqual(["Your profile", "Start", "Import", "Launch"]);
    expect(screen.getByTestId("studio-frame").querySelector('[data-step-item="import"]')?.getAttribute("data-state")).toBe("active");
  });

  it("asks for a larger window below 1280 px instead of drawing an overflowing top bar (audit PAS-5)", () => {
    const before = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { value: 1279, configurable: true, writable: true });
      render(
        <StudioFrame step="new" title="New business">
          <p>body</p>
        </StudioFrame>,
      );
      expect(screen.getByTestId("needs-larger-window")).toBeTruthy();
      expect(screen.queryByText("body")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { value: before, configurable: true, writable: true });
    }
  });
});
