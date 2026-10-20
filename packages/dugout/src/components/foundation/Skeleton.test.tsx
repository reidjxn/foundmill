import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton, SkeletonText } from "./Skeleton";

describe("Skeleton label (DESIGN §7: a skeleton names its queue)", () => {
  it("renders a small tertiary line under the bar that is announced politely; the bar stays decorative", () => {
    render(<Skeleton index={1} label="Queued for Teodor" data-testid="bar" />);
    const label = screen.getByText("Queued for Teodor");
    expect(label.className).toContain("text-small");
    expect(label.className).toContain("text-tertiary");
    expect(label.getAttribute("aria-live")).toBe("polite");
    const bar = screen.getByTestId("bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.style.getPropertyValue("--i")).toBe("1");
    expect(bar.parentElement?.hasAttribute("data-skeleton-labeled")).toBe(true);
  });

  it("is the bare aria-hidden bar without a label, as before", () => {
    const { container } = render(<Skeleton data-testid="bar" />);
    const bar = screen.getByTestId("bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.parentElement).toBe(container);
    expect(document.querySelector("[data-skeleton-labeled]")).toBeNull();
  });

  it("names a block of text lines too, and renders on the server", () => {
    const html = renderToStaticMarkup(<SkeletonText lines={2} label="Loading cash from Stripe" />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading cash from Stripe");
    expect(html).not.toMatch(/^<div[^>]*aria-hidden/);
    expect(renderToStaticMarkup(<SkeletonText lines={2} />)).toMatch(/^<div[^>]*aria-hidden="true"/);
  });
});
