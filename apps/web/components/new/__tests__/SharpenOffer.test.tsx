// @vitest-environment happy-dom
/**
 * "Help your team help you" in the Studio (WP-14 T2 step 3): offered once the first ideas show while Founder fit rests
 * on the quick profile, never again after "Not now"; after the long profile is saved, the same slot says fit was
 * re-rated and offers a fresh set.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SHARPEN_HREF, SHARPEN_WORDS, SharpenOffer, sharpenStorageKey } from "../ideate/SharpenOffer";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SharpenOffer", () => {
  it("waits for the first ideas, then offers the long profile in the brief's words", async () => {
    const { rerender } = render(<SharpenOffer basis="quick" sharpened={false} hasIdeas={false} accountId="a1" onRedraft={vi.fn()} />);
    expect(screen.queryByTestId("sharpen-offer")).toBeNull();
    rerender(<SharpenOffer basis="quick" sharpened={false} hasIdeas accountId="a1" onRedraft={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("sharpen-offer")).toBeTruthy());
    expect(screen.getByText("Help your team help you")).toBeTruthy();
    expect(screen.getByText("Fit is based on your quick answers. Two minutes to sharpen it?")).toBeTruthy();
    expect(screen.getByTestId("sharpen-go").getAttribute("href")).toBe(SHARPEN_HREF);
    expect(SHARPEN_HREF).toBe("/onboarding?next=/new/ideate");
  });

  it("is offered once: Not now is remembered for the account", async () => {
    render(<SharpenOffer basis="quick" sharpened={false} hasIdeas accountId="a1" onRedraft={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("sharpen-offer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("sharpen-later"));
    expect(screen.queryByTestId("sharpen-offer")).toBeNull();
    expect(window.localStorage.getItem(sharpenStorageKey("a1"))).toBe("1");
    cleanup();
    render(<SharpenOffer basis="quick" sharpened={false} hasIdeas accountId="a1" onRedraft={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("sharpen-offer")).toBeNull();
  });

  it("is never offered once the long profile is saved", async () => {
    render(<SharpenOffer basis="full" sharpened={false} hasIdeas accountId="a1" onRedraft={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("sharpen-offer")).toBeNull();
    expect(screen.queryByTestId("sharpen-done")).toBeNull();
  });

  it("after sharpening says fit was re-rated and offers a fresh set, once", () => {
    const onRedraft = vi.fn();
    render(<SharpenOffer basis="full" sharpened hasIdeas accountId="a1" onRedraft={onRedraft} />);
    expect(screen.getByText(SHARPEN_WORDS.doneTitle)).toBeTruthy();
    fireEvent.click(screen.getByTestId("sharpen-redraft"));
    expect(onRedraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sharpen-done")).toBeNull();
  });
});
