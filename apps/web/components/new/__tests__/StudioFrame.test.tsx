// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_STEPS, STUDIO_STEPS, StudioFrame } from "../StudioFrame";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

describe("StudioFrame (first-run trail)", () => {
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

  it("draws the import trail for Door B", () => {
    render(
      <StudioFrame step="import" steps={IMPORT_STEPS} title="Import">
        <p>body</p>
      </StudioFrame>,
    );
    expect(IMPORT_STEPS.map((s) => s.id)).toEqual(["profile", "new", "import", "commit"]);
    expect(STUDIO_STEPS.map((s) => s.id)).toEqual(["profile", "new", "ideate", "compare", "commit"]);
    expect(screen.getByTestId("studio-frame").querySelector('[data-step-item="import"]')?.getAttribute("data-state")).toBe("active");
  });
});
