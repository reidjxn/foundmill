// @vitest-environment happy-dom
/**
 * ApiErrorPage (components/shell/ApiErrorPage.tsx): what a server page renders when its first API call fails. The
 * api's `on_waitlist` refusal is "You're on the list" in place (OnWaitlistPage), from 390 px, with Sign out and a link
 * onward; every not-invited answer stays the invite-only page; anything else the unreachable page.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";
import { ON_WAITLIST_WORDS } from "@foundmill/shared/allowlist";

let pathname = "/start";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
// The Server Action that stores the person on the waitlist (waitlist-actions.ts), as the browser sees it.
const joinWaitlist = vi.fn(async (_previous: unknown): Promise<{ status: "joined"; cardKept: boolean; shareUrl?: string | null } | { status: "error" }> => ({ status: "joined", cardKept: false }));
vi.mock("../waitlist-actions", () => ({ joinWaitlist: (previous: unknown) => joinWaitlist(previous) }));

const { ApiErrorPage } = await import("../ApiErrorPage");
const { OnWaitlistPage } = await import("../OnWaitlistPage");
const { NotInvitedPage, WAITLIST_WORDS } = await import("../NotInvitedPage");
const { DesktopOnly } = await import("@/components/providers/DesktopOnly");
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

  it("passes the API's waitlistEmails to both waitlist pages, false when it is absent (WP-03 T2)", () => {
    for (const [appCode, reason] of [["on_waitlist", "ceiling"], ["not_invited", "not_listed"]] as const) {
      expect((ApiErrorPage({ error: refusal(appCode, { reason, waitlistEmails: true }), email: "maya@example.com" }).props as { emails: boolean }).emails).toBe(true);
      expect((ApiErrorPage({ error: refusal(appCode, { reason }), email: "maya@example.com" }).props as { emails: boolean }).emails).toBe(false);
    }
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

  it("the ceiling page stores the person: the waitlist join runs once on arrival", async () => {
    joinWaitlist.mockClear();
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(<OnWaitlistPage email="maya@example.com" />);
    await waitFor(() => expect(screen.getByTestId("waitlist-joined").textContent).toBe(WAITLIST_WORDS.joined));
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
  });
});

describe("NotInvitedPage (WP-03 T1: the gate tells the truth at any width)", () => {
  it("the not-listed page renders at 390 px, on a route that is otherwise desktop only", async () => {
    pathname = "/b/6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60/crm";
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    const page = (
      <DesktopOnly>
        <NotInvitedPage message="x" email="maya@example.com" />
      </DesktopOnly>
    );
    // As a person arrives: the server's page, then hydration before the width is measured.
    const container = document.createElement("div");
    container.innerHTML = renderToString(page);
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, page);
    });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.querySelector('[data-testid="not-invited"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="needs-larger-window"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
    pathname = "/start";
  });

  it("joins once on arrival and says the place is saved, with no email promised", async () => {
    joinWaitlist.mockClear();
    render(<NotInvitedPage message="x" email="maya@example.com" />);
    expect(screen.getByText("A few people at a time")).toBeTruthy();
    expect(screen.getByText("maya@example.com has a place in line")).toBeTruthy();
    expect(screen.getByText("Foundmill lets new people in a few at a time.")).toBeTruthy();
    const pill = await screen.findByTestId("waitlist-joined");
    expect(pill.textContent).toBe("Your place is saved. Come back to check; we cannot email you yet.");
    expect(WAITLIST_WORDS.joined).toBe(pill.textContent);
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
    // Nothing to press when it went through.
    expect(screen.queryByRole("button", { name: WAITLIST_WORDS.join })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" }).className).toContain("min-h-tap");
  });

  it("keeps the card when there is one, and offers Save my place again only when the join failed", async () => {
    joinWaitlist.mockClear();
    joinWaitlist.mockResolvedValueOnce({ status: "joined", cardKept: true });
    const first = render(<NotInvitedPage message="x" email="maya@example.com" />);
    expect((await screen.findByTestId("waitlist-joined")).textContent).toBe("Your place is saved, and your card is kept for 90 days. Come back to check; we cannot email you yet.");
    first.unmount();
    joinWaitlist.mockResolvedValueOnce({ status: "error" });
    render(<NotInvitedPage message="x" email="maya@example.com" />);
    const retry = await screen.findByRole("button", { name: "Save my place" });
    expect(screen.getByRole("alert").textContent).toBe(WAITLIST_WORDS.error);
    expect(joinWaitlist).toHaveBeenCalledTimes(2);
    act(() => retry.click());
    expect(await screen.findByTestId("waitlist-joined")).toBeTruthy();
    expect(joinWaitlist).toHaveBeenCalledTimes(3);
  });

  it("offers the person's own link to share once the place is saved, with no place number or count (WP-03 T10)", async () => {
    joinWaitlist.mockClear();
    joinWaitlist.mockResolvedValueOnce({ status: "joined", cardKept: false, shareUrl: "http://localhost:3000/?via=w.k3m7qa2xpw" });
    render(<NotInvitedPage message="x" email="maya@example.com" />);
    const share = await screen.findByTestId("waitlist-share");
    expect(share.textContent).toContain(WAITLIST_WORDS.shareOffer);
    expect(share.textContent).toContain("http://localhost:3000/?via=w.k3m7qa2xpw");
    expect(screen.getByRole("button", { name: WAITLIST_WORDS.copyLink }).className).toContain("min-h-tap");
    expect(share.textContent).not.toMatch(/\d+(st|nd|rd|th)\b|#\d|\bposition\b|\bpeople ahead\b/i);
  });

  it("shows no share link when there is none", async () => {
    joinWaitlist.mockClear();
    render(<NotInvitedPage message="x" email="maya@example.com" />);
    await screen.findByTestId("waitlist-joined");
    expect(screen.queryByTestId("waitlist-share")).toBeNull();
  });

  it("the unreachable page also renders at 390 px wherever it is shown", () => {
    pathname = "/b/6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60/crm";
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(<UnreachablePage message="The API did not answer." />);
    expect(screen.getByText("Nothing loaded yet")).toBeTruthy();
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
    pathname = "/start";
  });

  it("an address not confirmed yet is asked to confirm it, and nothing is joined", () => {
    joinWaitlist.mockClear();
    render(<NotInvitedPage message="x" email="maya@example.com" unconfirmed />);
    expect(screen.getByText("Confirm maya@example.com first")).toBeTruthy();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });
});

describe("The saved line promises the email only where the waitlist sends it (WP-03 T2)", () => {
  it("with emails, the not-listed page names the address the email goes to", async () => {
    joinWaitlist.mockClear();
    render(<NotInvitedPage message="x" email="maya@example.com" emails />);
    expect((await screen.findByTestId("waitlist-joined")).textContent).toBe("Your place is saved. We email maya@example.com the day it opens.");
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
  });

  it("with emails and a kept card, says both", async () => {
    joinWaitlist.mockResolvedValueOnce({ status: "joined", cardKept: true });
    render(<NotInvitedPage message="x" email="maya@example.com" emails />);
    expect((await screen.findByTestId("waitlist-joined")).textContent).toBe("Your place is saved, and your card is kept for 90 days. We email maya@example.com the day your place opens.");
  });

  it("the ceiling page follows the same switch, either way", async () => {
    const on = render(<OnWaitlistPage email="maya@example.com" emails />);
    expect((await screen.findByTestId("waitlist-joined")).textContent).toBe("Your place is saved. We email maya@example.com the day it opens.");
    on.unmount();
    render(<OnWaitlistPage email="maya@example.com" emails={false} />);
    expect((await screen.findByTestId("waitlist-joined")).textContent).toBe(WAITLIST_WORDS.joined);
  });
});
