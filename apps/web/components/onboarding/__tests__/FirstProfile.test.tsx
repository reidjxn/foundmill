// @vitest-environment happy-dom
/**
 * The three questions a new account answers after keeping a card (WP-04 T1): what to call you (prefilled from the
 * email), what you are good at (optional tags), what you are here for ("Building on my own" by default), then the one
 * "I am 18 or older" box. Two inputs are required: the name and the box. The save creates the profile through
 * `founder.profile.update`; the two optional answers go through `founder.publicProfile.update` only when the person gave
 * one, and a failure there never holds them up. Then on to `next` (the kept card's Commit), else /new.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_PROFILE_WORDS, ToastProvider, TooltipProvider } from "@foundmill/dugout";
import { LOOKING_FOR_OPTIONS } from "@foundmill/shared/person-profile";

const update = vi.fn();
const publicUpdate = vi.fn();
const publicGet = vi.fn();
const forgetVia = vi.fn();
const push = vi.fn();
const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      profile: { update: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationKey: [["founder", "profile", "update"]], mutationFn: (vars: unknown) => update(vars), ...opts }) } },
      publicProfile: {
        update: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationKey: [["founder", "publicProfile", "update"]], mutationFn: (vars: unknown) => publicUpdate(vars), ...opts }) },
        get: { queryOptions: (_input?: unknown, opts: Record<string, unknown> = {}) => ({ queryKey: [["founder", "publicProfile", "get"]], queryFn: () => publicGet(), ...opts }) },
      },
    },
  }),
}));
vi.mock("@/app/onboarding/actions", () => ({ forgetVia: () => forgetVia() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (to: string) => push(to), refresh: vi.fn() }), usePathname: () => "/onboarding" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FIRST_PROFILE_STRENGTHS, FIRST_PROFILE_TITLE, FirstProfile, type FirstProfileProps } from "../FirstProfile";

const COMMIT = "/new/commit/11111111-1111-4111-8111-111111111111";

function renderFirst(props: Partial<FirstProfileProps> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TooltipProvider>
          <FirstProfile email="reid.jackson@example.com" adultConfirmed={false} {...props} />
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const nameField = () => screen.getByLabelText(new RegExp(FIRST_PROFILE_WORDS.name)) as HTMLInputElement;
const box = () => screen.getByRole("checkbox", { name: "I am 18 or older" });
async function pressContinue() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("first-profile-submit"));
  });
}

beforeEach(() => {
  update.mockReset().mockResolvedValue({ guidanceTurnedOff: false });
  publicUpdate.mockReset().mockResolvedValue({ outcome: "saved" });
  publicGet.mockReset();
  forgetVia.mockReset().mockResolvedValue(undefined);
  push.mockReset();
  warn.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

const NEUTRAL = { engineering: 10, sales: 10, design: 10, finance: 10, domain: 10 };

describe("FirstProfile", () => {
  it("asks three things, with the name prefilled from the email and Building on my own chosen", () => {
    renderFirst();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(FIRST_PROFILE_TITLE);
    expect(nameField().value).toBe("Reid Jackson");
    expect(screen.getByLabelText(FIRST_PROFILE_WORDS.strengths)).toBeTruthy();
    for (const s of FIRST_PROFILE_STRENGTHS) expect(screen.getByRole("button", { name: s })).toBeTruthy();
    // Every answer is offered; working on your own is the default, people are one choice among the others.
    for (const o of LOOKING_FOR_OPTIONS) expect(screen.getByRole("radio", { name: o.label })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Building on my own" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(screen.getByTestId("first-profile-submit").textContent).toContain("Continue");
  });

  it("requires two inputs, the name and the 18-or-older box, and nothing else", async () => {
    renderFirst();
    fireEvent.change(nameField(), { target: { value: "  " } });
    fireEvent.click(box());
    await pressContinue();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText(FIRST_PROFILE_WORDS.nameNeeded)).toBeTruthy();

    fireEvent.change(nameField(), { target: { value: "Reid" } });
    fireEvent.click(box());
    await pressContinue();
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText(FIRST_PROFILE_WORDS.adultNeeded)).toBeTruthy();

    fireEvent.click(box());
    await pressContinue();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/new"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toEqual({ displayName: "Reid", skills: NEUTRAL, confirmAdult: true });
    // Nothing optional was answered: no second save.
    expect(publicUpdate).not.toHaveBeenCalled();
  });

  it("saves what they are good at and what they are here for through the public profile, then goes on to next", async () => {
    renderFirst({ via: "p.maple-bakes", next: COMMIT });
    fireEvent.click(screen.getByRole("button", { name: "Product and brand" }));
    const tags = screen.getByLabelText(FIRST_PROFILE_WORDS.strengths);
    fireEvent.change(tags, { target: { value: "Baking" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    fireEvent.click(screen.getByRole("radio", { name: "Looking for a cofounder" }));
    fireEvent.click(box());
    await pressContinue();
    await waitFor(() => expect(push).toHaveBeenCalledWith(COMMIT));
    expect(update.mock.calls[0]![0]).toEqual({ displayName: "Reid Jackson", skills: { engineering: 7, sales: 7, design: 14, finance: 7, domain: 7 }, confirmAdult: true, via: "p.maple-bakes" });
    expect(forgetVia).toHaveBeenCalledTimes(1);
    expect(publicUpdate).toHaveBeenCalledTimes(1);
    expect(publicUpdate.mock.calls[0]![0]).toEqual({
      content: { headline: "", about: "", strengths: ["Product and brand", "Baking"], wantsToLearn: [], lookingFor: "looking_for_cofounder", place: "" },
    });
  });

  it("a failed second save never holds the person up", async () => {
    publicUpdate.mockRejectedValueOnce(new Error("The server took too long to answer."));
    renderFirst({ next: COMMIT });
    fireEvent.click(screen.getByRole("button", { name: "Money and pricing" }));
    fireEvent.click(box());
    await pressContinue();
    await waitFor(() => expect(push).toHaveBeenCalledWith(COMMIT));
    expect(publicUpdate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("a failed first save keeps them here and says why", async () => {
    update.mockRejectedValueOnce(new Error("The server took too long to answer."));
    renderFirst({ next: COMMIT });
    fireEvent.click(box());
    await pressContinue();
    await waitFor(() => expect(screen.getAllByText(/took too long/).length).toBeGreaterThan(0));
    expect(push).not.toHaveBeenCalled();
    expect(publicUpdate).not.toHaveBeenCalled();
  });

  it("a person already confirmed is not shown the box, and the save carries nothing about it", async () => {
    renderFirst({ adultConfirmed: true });
    expect(screen.queryByRole("checkbox", { name: "I am 18 or older" })).toBeNull();
    await pressContinue();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toEqual({ displayName: "Reid Jackson", skills: NEUTRAL });
  });

  it("a save the api refuses with adult_unconfirmed shows the box", async () => {
    update.mockRejectedValueOnce(Object.assign(new Error("Foundmill is for people 18 or older."), { data: { code: "FORBIDDEN", appCode: "adult_unconfirmed" } }));
    renderFirst({ adultConfirmed: true });
    await pressContinue();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "I am 18 or older" })).toBeTruthy());
    fireEvent.click(box());
    await pressContinue();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![0]).toMatchObject({ confirmAdult: true });
  });

  it("editing on a phone: prefilled from the profile, and the rest of the public profile is kept as it was", async () => {
    publicGet.mockResolvedValue({ content: { headline: "Baker", about: "I bake.", strengths: ["Writing"], wantsToLearn: ["Selling"], lookingFor: "open_to_people", place: "Leeds" } });
    renderFirst({ profile: { displayName: "Reid J" }, adultConfirmed: true, via: "p.maple-bakes" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Open to building with people" }).getAttribute("aria-checked")).toBe("true"));
    expect(nameField().value).toBe("Reid J");
    expect(screen.getByRole("list", { name: `${FIRST_PROFILE_WORDS.strengths} chosen` }).textContent).toContain("Writing");
    fireEvent.click(screen.getByRole("radio", { name: "Building on my own" }));
    await pressContinue();
    // Back to the signed-in index, which works on a phone.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    // An edit never carries the reference or the box.
    expect(update.mock.calls[0]![0]).toEqual({ displayName: "Reid J" });
    expect(forgetVia).not.toHaveBeenCalled();
    expect(publicUpdate.mock.calls[0]![0]).toEqual({
      content: { headline: "Baker", about: "I bake.", strengths: ["Writing"], wantsToLearn: ["Selling"], lookingFor: "on_my_own", place: "Leeds" },
    });
  });
  it("asks time and where you live, saves both with the currency of the place, and neither is required (WP-14 T2)", async () => {
    renderFirst({ adultConfirmed: true });
    expect(screen.getByText(FIRST_PROFILE_TITLE)).toBeTruthy();
    expect(FIRST_PROFILE_TITLE).toBe("Tell your team about you");
    fireEvent.click(screen.getByRole("radio", { name: /Evenings and weekends/ }));
    fireEvent.change(screen.getByLabelText(FIRST_PROFILE_WORDS.place), { target: { value: "United" } });
    await pressContinue();
    // A country picked only part of the way is not saved.
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText(/Finish picking the country/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(FIRST_PROFILE_WORDS.place), { target: { value: "United Kingdom" } });
    await pressContinue();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toEqual({ displayName: "Reid Jackson", skills: NEUTRAL, timeCommitment: "evenings_weekends", residence: "United Kingdom", currency: "GBP" });
  });

  it("an edit keeps the ratings a person set in the long profile, and an untouched quick profile's too", async () => {
    publicGet.mockResolvedValue({ content: { headline: "", about: "", strengths: ["Building software"], wantsToLearn: [], lookingFor: "on_my_own", place: "" } });
    renderFirst({ adultConfirmed: true, profile: { displayName: "Reid J", experience: "first_time", timeCommitment: "full_time", residence: "Canada" } });
    await waitFor(() => expect(screen.getByRole("list", { name: `${FIRST_PROFILE_WORDS.strengths} chosen` })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Money and pricing" }));
    await pressContinue();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // Sharpened already: the tags never rewrite the ratings; time and place go back as they were.
    expect(update.mock.calls[0]![0]).toEqual({ displayName: "Reid J", timeCommitment: "full_time", residence: "Canada" });
  });
});
