import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DRAFTING_LINE, FoundationsStatus, foundationsNeedsAttention } from "./FoundationsStatus";

describe("FoundationsStatus", () => {
  it("drafting: the line, the basis, the three parts and a Drafting pill (pending reads the same)", () => {
    const { rerender } = render(<FoundationsStatus state="drafting" basis="From your idea and your founder profile." data-testid="fs" />);
    const panel = screen.getByTestId("fs");
    expect(panel.getAttribute("data-foundations-state")).toBe("drafting");
    expect(screen.getByRole("region", { name: "Vision, specification and roadmap" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(DRAFTING_LINE);
    expect(screen.getByText("From your idea and your founder profile.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Being drafted" }).textContent).toBe("VisionSpecificationRoadmap");
    // The ring is decorative next to the status line (aria-hidden), so it is not announced twice.
    expect(panel.querySelector("[aria-hidden] [role=progressbar]")).not.toBeNull();
    expect(panel.querySelector('[data-tone="info"]')?.textContent).toBe("Drafting");
    rerender(<FoundationsStatus state="pending" data-testid="fs" />);
    expect(screen.getByRole("status").textContent).toContain(DRAFTING_LINE);
    expect(screen.queryByText("Try again")).toBeNull();
  });

  it("failed: the reason and Try again, which calls onRetry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<FoundationsStatus state="failed" error="The model service did not answer. Try again in a few minutes." onRetry={onRetry} />);
    expect(screen.getByRole("status").textContent).toContain("The drafting did not finish.");
    expect(screen.getByText("The model service did not answer. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByText("Not drafted")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ready: the summary and the way in; retrying makes the button busy", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { rerender } = render(<FoundationsStatus state="ready" summary="10 sections · 11 roadmap items" onOpen={onOpen} />);
    expect(screen.getByText("Your vision, specification and roadmap are drafted.")).toBeTruthy();
    expect(screen.getByText("10 sections · 11 roadmap items")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open the vision" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(<FoundationsStatus state="failed" onRetry={() => {}} retrying />);
    // Busy, not disabled: it refuses presses but keeps keyboard focus (Button `loading`).
    const retry = screen.getByRole("button", { name: "Try again" });
    expect([retry.getAttribute("aria-busy"), retry.getAttribute("aria-disabled")]).toEqual(["true", "true"]);
  });

  it("ready: a custom line and a second way in (the Inbox, where the sign-off notes wait)", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onInbox = vi.fn();
    render(<FoundationsStatus state="ready" readyLine="Your vision, specification and roadmap are drafted. Two notes in the Inbox ask for your sign-off." onOpen={onOpen} secondaryAction={{ label: "Open the Inbox", onClick: onInbox }} />);
    expect(screen.getByRole("status").textContent).toContain("Two notes in the Inbox ask for your sign-off.");
    await user.click(screen.getByRole("button", { name: "Open the Inbox" }));
    expect(onInbox).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open the vision" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("only pending, drafting and failed need attention", () => {
    expect(["pending", "drafting", "failed"].every((s) => foundationsNeedsAttention(s as never))).toBe(true);
    expect(foundationsNeedsAttention("ready")).toBe(false);
    expect(foundationsNeedsAttention("none")).toBe(false);
    expect(foundationsNeedsAttention(undefined)).toBe(false);
  });
});
