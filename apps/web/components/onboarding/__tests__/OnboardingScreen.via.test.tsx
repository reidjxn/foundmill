// @vitest-environment happy-dom
/**
 * Attribution at onboarding (docs/NETWORK.md §5; lib/via.ts): the page hands the screen the reference from the httpOnly
 * `fm_via` cookie. The save that creates the profile carries it as `via`, and once that save has succeeded the cookie
 * is cleared on the server before the founder moves on. An edit never carries it, and without one nothing is called.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

const update = vi.fn();
const forgetVia = vi.fn();
const push = vi.fn();
const order: string[] = [];

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      profile: { update: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationKey: [["founder", "profile", "update"]], mutationFn: (vars: unknown) => update(vars), ...opts }) } },
      publicProfile: {
        update: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: async () => ({ outcome: "saved" }), ...opts }) },
        get: { queryOptions: (_i?: unknown, opts: Record<string, unknown> = {}) => ({ queryKey: [["founder", "publicProfile", "get"]], queryFn: async () => null, ...opts }) },
      },
    },
  }),
}));
vi.mock("@/app/onboarding/actions", () => ({ forgetVia: () => forgetVia() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (to: string) => push(to), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OnboardingScreen } from "../OnboardingScreen";
import type { ProfileLike } from "../profile-form";

const EXISTING: ProfileLike = { displayName: "Reid Jackson", experience: "first_time", skills: {}, timeCommitment: "full_time", budgetMinor: null, currency: "GBP", citizenship: null, residence: "United Kingdom", targetMarkets: ["UK"], constraints: [], riskAppetite: "medium" };

function renderScreen(props: Partial<React.ComponentProps<typeof OnboardingScreen>>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TooltipProvider>
          <OnboardingScreen profile={null} email="reid.jackson@example.com" adultConfirmed {...props} />
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The create path is the three questions (WP-04 T1): the name is prefilled, so Continue is the only press. */
async function answerAndSubmit() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("first-profile-submit"));
  });
}

/** The long form (editing) is for a computer: below 1280 px an edit renders the three questions. */
function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  setWidth(1440);
  order.length = 0;
  update.mockReset().mockImplementation(async () => {
    order.push("saved");
    return { guidanceTurnedOff: false };
  });
  forgetVia.mockReset().mockImplementation(async () => {
    order.push("forgotten");
  });
  push.mockReset().mockImplementation(() => {
    order.push("moved on");
  });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("OnboardingScreen and the `via` reference", () => {
  it("the save that creates the profile carries it, and the cookie is cleared before the founder moves on", async () => {
    renderScreen({ via: "p.maple-bakes" });
    await answerAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/new"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toMatchObject({ displayName: "Reid Jackson", via: "p.maple-bakes" });
    expect(forgetVia).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["saved", "forgotten", "moved on"]);
  });

  it("without a reference nothing is sent and nothing is cleared", async () => {
    renderScreen({ via: null });
    await answerAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/new"));
    expect(update.mock.calls[0]![0]).not.toHaveProperty("via");
    expect(forgetVia).not.toHaveBeenCalled();
  });

  it("an edit of an existing profile never carries it", async () => {
    renderScreen({ profile: EXISTING, via: "p.maple-bakes" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("profile-submit-bottom"));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/new"));
    expect(update.mock.calls[0]![0]).not.toHaveProperty("via");
    expect(forgetVia).not.toHaveBeenCalled();
  });

  it("a save that fails keeps the cookie, and a cookie that cannot be cleared does not hold the founder up", async () => {
    update.mockRejectedValueOnce(new Error("The server took too long to answer."));
    renderScreen({ via: "u.maya" });
    await answerAndSubmit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(forgetVia).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    // The next try saves; clearing the cookie fails, and the founder still moves on.
    forgetVia.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("first-profile-submit"));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/new"));
    expect(update.mock.calls[1]![0]).toMatchObject({ via: "u.maya" });
  });
});
