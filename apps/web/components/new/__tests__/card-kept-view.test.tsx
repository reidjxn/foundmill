// @vitest-environment happy-dom
/**
 * The kept card's next step (WP-03 T3, WP-04 T1): the three questions work on a phone, so the card links to them with
 * Commit as where they go on to (`?next=`). Commit works on a phone too (WP-04 T2), so it is a link there; the studio
 * is still desktop-only and is not linked.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/new/card/x" }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({ founder: { email: { sendLink: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: async () => ({ sent: false, reason: "off", email: null }), ...opts }) } } } }),
}));

import { CARD_KEPT_WORDS, CardKeptView } from "../card/CardKeptView";

const ID = "11111111-1111-4111-8111-111111111111";
const ONBOARDING_NEXT = `/onboarding?next=/new/commit/${ID}`;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function renderKept(profileComplete: boolean, extra: Partial<React.ComponentProps<typeof CardKeptView>> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CardKeptView ideaId={ID} card={{ name: "Tutorlane" }} viewer={{ email: "maya@example.com" }} profileComplete={profileComplete} {...extra} />
    </QueryClientProvider>,
  );
}

/** Links into pages that are still desktop-only (the studio). */
const walled = (container: HTMLElement) => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "").filter((h) => h === "/new" || h === "/new/ideate");

describe("CardKeptView at 390 px", () => {
  afterEach(() => setWidth(1440));

  it("links to the three questions, which work on a phone, with Commit as where they go on to (WP-04 T1)", () => {
    setWidth(390);
    const { container } = renderKept(false);
    const next = screen.getByTestId("card-kept-next");
    expect(next.getAttribute("href")).toBe(ONBOARDING_NEXT);
    expect(next.textContent).toBe(CARD_KEPT_WORDS.profileNext);
    expect(screen.queryByTestId("next-step-on-computer")).toBeNull();
    expect(walled(container)).toEqual([]);
  });

  it("links to Commit, which works on a phone (WP-04 T2), and into nothing walled", () => {
    setWidth(390);
    const { container } = renderKept(true);
    expect(screen.getByTestId("card-kept-next").getAttribute("href")).toBe(`/new/commit/${ID}`);
    expect(screen.getByTestId("card-kept-next").textContent).toBe(CARD_KEPT_WORDS.build);
    expect(screen.queryByTestId("next-step-on-computer")).toBeNull();
    expect(walled(container)).toEqual([]);
  });
});

describe("CardKeptView on a computer", () => {
  it("links to Commit when the profile exists, and to the three questions with Commit as next when it does not", () => {
    setWidth(1440);
    const { container, unmount } = renderKept(true);
    expect(screen.getByTestId("card-kept-next").getAttribute("href")).toBe(`/new/commit/${ID}`);
    expect(walled(container)).toContain("/new/ideate");
    expect(screen.queryByTestId("next-step-on-computer")).toBeNull();
    unmount();
    renderKept(false);
    expect(screen.getByTestId("card-kept-next").getAttribute("href")).toBe(ONBOARDING_NEXT);
    expect(screen.getByText(CARD_KEPT_WORDS.profileWhy)).toBeTruthy();
  });
});

describe("Founder fit on the kept card (WP-14 T2)", () => {
  const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
  const card = { name: "Tutorlane", pitch: "Tutors for exam years.", attributes: KEYS.map((key) => ({ key, value: key === "founder_fit" ? 15 : 10, evidence: "Unverified." })) };
  const fitRow = (c: HTMLElement) => c.querySelector("[data-idea-rating=founder_fit]")!;

  it("is unmeasured before the profile, a number with its basis after the quick profile, and the number alone once sharpened", () => {
    const before = renderKept(false, { card, fitBasis: "quick" });
    expect(fitRow(before.container).hasAttribute("data-unmeasured")).toBe(true);
    before.unmount();
    const quick = renderKept(true, { card, fitBasis: "quick" });
    expect(fitRow(quick.container).hasAttribute("data-unmeasured")).toBe(false);
    expect(fitRow(quick.container).querySelector("[data-idea-fit-basis]")!.textContent).toBe("Fit: 15 (quick profile)");
    quick.unmount();
    const full = renderKept(true, { card, fitBasis: "full" });
    expect(fitRow(full.container).hasAttribute("data-unmeasured")).toBe(false);
    expect(fitRow(full.container).querySelector("[data-idea-fit-basis]")).toBeNull();
  });
});
