// @vitest-environment happy-dom
/**
 * 18 or older, once, at sign-up (0100): a new founder with no confirmation on record ticks "I am 18 or older" on the
 * form, and the save that creates the profile carries `confirmAdult: true`; Continue does nothing without it. A
 * founder already confirmed is never shown the box. A founder with a profile and no confirmation (here before sign-up
 * asked) sees the one step instead of the form, and goes on once it is recorded.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

const update = vi.fn();
const confirm = vi.fn();
const replace = vi.fn();

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      profile: { update: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationKey: [["founder", "profile", "update"]], mutationFn: (vars: unknown) => update(vars), ...opts }) } },
      publicProfile: {
        update: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: async () => ({ outcome: "saved" }), ...opts }) },
        get: { queryOptions: (_i?: unknown, opts: Record<string, unknown> = {}) => ({ queryKey: [["founder", "publicProfile", "get"]], queryFn: async () => null, ...opts }) },
      },
      adult: { confirm: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "adult", "confirm"]], mutationFn: (vars: unknown) => confirm(vars), ...opts }) } },
    },
  }),
}));
vi.mock("@/app/onboarding/actions", () => ({ forgetVia: async () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: (to: string) => replace(to), refresh: vi.fn() }), usePathname: () => "/onboarding" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ADULT_FORM_NEEDED, OnboardingScreen } from "../OnboardingScreen";
import { ADULT_STEP_WORDS } from "../AdultStep";
import type { ProfileLike } from "../profile-form";

const EXISTING: ProfileLike = { displayName: "Reid Jackson", experience: "first_time", skills: {}, timeCommitment: "full_time", budgetMinor: null, currency: "USD", citizenship: null, residence: "United States", targetMarkets: ["US"], constraints: [], riskAppetite: "medium" };

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
  update.mockReset().mockResolvedValue({ guidanceTurnedOff: false });
  confirm.mockReset().mockResolvedValue({ confirmed: true, confirmedAt: "2026-11-14T10:00:00.000Z" });
  replace.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("OnboardingScreen and 18 or older", () => {
  it("a new founder without it on record ticks the box, and the save that creates the profile carries it", async () => {
    renderScreen({ adultConfirmed: false });
    await answerAndSubmit();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId("first-profile-adult").textContent).toContain(ADULT_FORM_NEEDED);
    fireEvent.click(screen.getByRole("checkbox", { name: "I am 18 or older" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("first-profile-submit"));
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toMatchObject({ confirmAdult: true });
  });

  it("a founder already confirmed is never shown the box, and the save carries nothing about it", async () => {
    renderScreen({ adultConfirmed: true });
    expect(screen.queryByTestId("first-profile-adult")).toBeNull();
    await answerAndSubmit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).not.toHaveProperty("confirmAdult");
  });

  it("a save the api refuses with adult_unconfirmed shows the box, even when the page believed it was on record", async () => {
    update.mockReset().mockRejectedValueOnce(Object.assign(new Error("Foundmill is for people 18 or older."), { data: { code: "FORBIDDEN", appCode: "adult_unconfirmed" } })).mockResolvedValue({ guidanceTurnedOff: false });
    renderScreen({ adultConfirmed: true });
    expect(screen.queryByTestId("first-profile-adult")).toBeNull();
    await answerAndSubmit();
    await waitFor(() => expect(screen.getByTestId("first-profile-adult")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "I am 18 or older" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("first-profile-submit"));
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![0]).toMatchObject({ confirmAdult: true });
  });

  it("a founder with a profile and no confirmation sees the one step, confirms once and goes on", async () => {
    renderScreen({ profile: EXISTING, adultConfirmed: false });
    expect(screen.queryByTestId("onboarding-form")).toBeNull();
    const step = screen.getByTestId("adult-step");
    expect(step.textContent).toContain(ADULT_STEP_WORDS.body);
    await act(async () => {
      fireEvent.click(screen.getByTestId("adult-step-continue"));
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(step.textContent).toContain(ADULT_STEP_WORDS.needed);
    fireEvent.click(screen.getByRole("checkbox", { name: "I am 18 or older" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("adult-step-continue"));
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ confirm: true }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("a founder with a profile who confirmed edits the profile as before", () => {
    renderScreen({ profile: EXISTING, adultConfirmed: true });
    expect(screen.getByTestId("onboarding-form")).toBeTruthy();
    expect(screen.queryByTestId("profile-adult")).toBeNull();
    expect(screen.queryByTestId("adult-step")).toBeNull();
  });
});
