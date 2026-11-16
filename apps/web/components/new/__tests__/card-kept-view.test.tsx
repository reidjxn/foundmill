// @vitest-environment happy-dom
/**
 * The kept card's next step on a small screen (WP-03 T3; a stopgap WP-04 removes): no link into onboarding, Commit or
 * the studio, which are desktop-only; the step says it needs a computer and offers the link by email.
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

import { CardKeptView } from "../card/CardKeptView";
import { CONTINUE_LATER_WORDS } from "@/components/providers/ContinueLater";

const ID = "11111111-1111-4111-8111-111111111111";

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

const walled = (container: HTMLElement) => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "").filter((h) => h === "/onboarding" || h === "/new" || h.startsWith("/new/commit/") || h === "/new/ideate");

describe("CardKeptView at 390 px", () => {
  afterEach(() => setWidth(1440));

  it("offers the next step by email, for onboarding or Commit, and links into neither", () => {
    setWidth(390);
    for (const [complete, path] of [
      [false, "/onboarding"],
      [true, `/new/commit/${ID}`],
    ] as const) {
      const { container, unmount } = renderKept(complete);
      expect(walled(container)).toEqual([]);
      expect(screen.getByText(CONTINUE_LATER_WORDS.nextStep)).toBeTruthy();
      expect(screen.getByTestId("next-step-on-computer").dataset.path).toBe(path);
      expect(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.email })).toBeTruthy();
      unmount();
    }
  });

  it("links to the next step on a computer", () => {
    setWidth(1440);
    const { container } = renderKept(true);
    expect(screen.getByTestId("card-kept-next").getAttribute("href")).toBe(`/new/commit/${ID}`);
    expect(walled(container)).toContain("/new/ideate");
    expect(screen.queryByTestId("next-step-on-computer")).toBeNull();
  });
});
