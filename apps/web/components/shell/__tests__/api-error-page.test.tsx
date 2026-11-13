// @vitest-environment happy-dom
/**
 * ApiErrorPage (components/shell/ApiErrorPage.tsx): what a server page renders when its first API call fails. The
 * api's `on_waitlist` refusal is "You're on the list" in place (OnWaitlistPage), from 390 px, with Sign out and a link
 * onward; every not-invited answer stays the invite-only page; anything else the unreachable page.
 */
import { render, screen } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";
import { ON_WAITLIST_WORDS } from "@foundmill/shared/allowlist";

vi.mock("next/navigation", () => ({ usePathname: () => "/start", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { ApiErrorPage } = await import("../ApiErrorPage");
const { OnWaitlistPage } = await import("../OnWaitlistPage");
const { NotInvitedPage } = await import("../NotInvitedPage");
const { UnreachablePage } = await import("../UnreachablePage");

const refusal = (appCode: string, details: Record<string, unknown>) => new TRPCClientError("x", { result: { error: { code: -32003, message: "x", data: { code: "FORBIDDEN", httpStatus: 403, appCode, details } } } } as never);

describe("ApiErrorPage", () => {
  it("shows the on_waitlist panel for that refusal, with the address that signed in", () => {
    const page = ApiErrorPage({ error: refusal("on_waitlist", { reason: "ceiling" }), email: "maya@example.com" });
    expect(page.type).toBe(OnWaitlistPage);
    expect((page.props as { email: string }).email).toBe("maya@example.com");
  });

  it("keeps the invite-only page for an address that is not listed or not confirmed, and the unreachable page otherwise", () => {
    for (const reason of ["not_listed", "email_unconfirmed"]) {
      const page = ApiErrorPage({ error: refusal("not_invited", { reason }), email: "maya@example.com" });
      expect(page.type).toBe(NotInvitedPage);
      expect((page.props as { unconfirmed: boolean }).unconfirmed).toBe(reason === "email_unconfirmed");
    }
    expect(ApiErrorPage({ error: new Error("down") }).type).toBe(UnreachablePage);
  });
});

describe("OnWaitlistPage", () => {
  it("says the two lines, names the address, and offers Sign out and a link onward; nothing to join", () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(<OnWaitlistPage email="maya@example.com" onwardHref="/examples/ledgerly" />);
    expect(screen.getByRole("heading", { level: 1, name: ON_WAITLIST_WORDS.title })).toBeTruthy();
    expect(screen.getByText(ON_WAITLIST_WORDS.body)).toBeTruthy();
    expect(screen.getByText("maya@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Look around an example" }).getAttribute("href")).toBe("/examples/ledgerly");
    // From 390 px: the brand frame does not ask for a larger window.
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
  });
});
