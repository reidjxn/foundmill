// @vitest-environment happy-dom
/**
 * The kept card's next step (WP-03 T3, WP-04 T1): the three questions work on a phone, so the card links to them with
 * Commit as where they go on to (`?next=`). Commit and the studio are still desktop-only, so on a phone Commit is
 * offered by email and the studio is not linked.
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
import { CONTINUE_LATER_WORDS } from "@/components/providers/ContinueLater";

const ID = "11111111-1111-4111-8111-111111111111";
const ONBOARDING_NEXT = `/onboarding?next=/new/commit/${ID}`;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function renderKept(profileComplete: boolean) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CardKeptView ideaId={ID} card={{ name: "Tutorlane" }} viewer={{ email: "maya@example.com" }} profileComplete={profileComplete} />
    </QueryClientProvider>,
  );
}

/** Links into pages that are still desktop-only (Commit, the studio). */
const walled = (container: HTMLElement) => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "").filter((h) => h === "/new" || h.startsWith("/new/commit/") || h === "/new/ideate");

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

  it("offers Commit by email while Commit is desktop-only, and links into nothing walled", () => {
    setWidth(390);
    const { container } = renderKept(true);
    expect(walled(container)).toEqual([]);
    expect(screen.getByText(CONTINUE_LATER_WORDS.nextStep)).toBeTruthy();
    expect(screen.getByTestId("next-step-on-computer").dataset.path).toBe(`/new/commit/${ID}`);
    expect(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.email })).toBeTruthy();
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
