// @vitest-environment happy-dom
/**
 * Settings › Preferences: two sets of radio cards; a choice saves at once with a toast in the new format, and every
 * date on screen follows without a reload. The Guidance section: the switch, the text size and the two resets save
 * through the GuidanceHost the same way, and the guided layer elsewhere on the page follows at once.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider, useBuilderView, useFormatters, useGuidance, type DateFormatPrefs } from "@foundmill/dugout";
import { AGENT_STYLE_META, type AgentStyle } from "@foundmill/shared/personas";
import type * as SharedModule from "../shared";

type Guidance = { guidance: "on" | "off"; textSize: "standard" | "comfortable"; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissedAt: string | null; anthropomorphicAgents: boolean; agentStyle?: AgentStyle; builderView?: boolean };
type Change = Partial<DateFormatPrefs> & Partial<{ guidance: Guidance["guidance"]; textSize: Guidance["textSize"]; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissed: boolean; anthropomorphicAgents: boolean; agentStyle: AgentStyle; builderView: boolean; reset: true; email: { decision_waiting: boolean } }>;

const BUSINESS = "b1e5e5e5-0000-4000-8000-000000000001";
const PREFS_KEY = [["founder", "preferences", "get"], { type: "query" }];
const GUIDANCE_KEY = [["founder", "preferences", "guidance"], { type: "query" }];
const guidanceDefaults = (): Guidance => ({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false });

let stored: DateFormatPrefs = { date: "us", time: "12h" };
let guidanceStored: Guidance = guidanceDefaults();
let emailStored = { decision_waiting: true };
const NOTIFICATIONS_KEY = [["founder", "preferences", "notifications"], { type: "query" }];
const notificationsView = () => ({ notifications: { decision: true }, hideAmountsOnLockScreen: false, email: { ...emailStored } });
async function serverUpdate(change: Change) {
  const { date, time, guidance, textSize, explainersSeen, toursDone, checklistDismissed, anthropomorphicAgents, agentStyle, builderView, reset, email } = change;
  if (email) emailStored = { ...emailStored, ...email };
  stored = { ...stored, ...(date ? { date } : {}), ...(time ? { time } : {}) };
  const next: Guidance = { ...guidanceStored, explainersSeen: { ...guidanceStored.explainersSeen }, toursDone: { ...guidanceStored.toursDone } };
  if (guidance) next.guidance = guidance;
  if (textSize) next.textSize = textSize;
  if (anthropomorphicAgents !== undefined) next.anthropomorphicAgents = anthropomorphicAgents;
  if (agentStyle) next.agentStyle = agentStyle;
  if (builderView !== undefined) next.builderView = builderView;
  if (reset) Object.assign(next, { explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });
  for (const id of Object.keys(explainersSeen ?? {})) next.explainersSeen[id] = true;
  for (const id of Object.keys(toursDone ?? {})) next.toursDone[id] = true;
  if (checklistDismissed !== undefined) next.checklistDismissedAt = checklistDismissed ? "2026-10-20T15:45:00.000Z" : null;
  guidanceStored = next;
  return { ...stored, ...guidanceStored, ...notificationsView() };
}
const update = vi.fn(serverUpdate);
/** Holds the next request open until the returned function is called, so the optimistic state can be observed. */
function holdNextUpdate(): () => void {
  let release: () => void = () => undefined;
  update.mockImplementationOnce(async (change) => {
    await new Promise<void>((r) => (release = r));
    return serverUpdate(change);
  });
  return () => release();
}
const saved = vi.fn();
const failed = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => `/b/${BUSINESS}/settings/preferences`, useParams: () => ({ bid: BUSINESS }) }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      // The account ID section reads the signed-in person's id (WEB-12).
      profile: {
        get: {
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "profile", "get"], { type: "query" }], queryFn: async () => ({ userId: "5a1e0000-0000-4000-8000-00000000fe01", profile: null, complete: true, email: "reid@northwind.example", memberships: [] }), ...opts }),
        },
      },
      // Your public profile (package 2.3): the section says whether it is public and links to where it is edited.
      publicProfile: {
        get: {
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "publicProfile", "get"], { type: "query" }], queryFn: async () => ({ handle: "reid", url: "http://localhost:3000/u/reid", saved: true, displayName: "Reid", public: true, publishedAt: new Date(2026, 9, 7, 12), projects: [], content: { headline: "", about: "", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "" } }), ...opts }),
        },
      },
      preferences: {
        get: {
          queryKey: () => PREFS_KEY,
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: PREFS_KEY, queryFn: async () => stored, ...opts }),
        },
        guidance: {
          queryKey: () => GUIDANCE_KEY,
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: GUIDANCE_KEY, queryFn: async () => guidanceStored, ...opts }),
        },
        notifications: {
          queryKey: () => NOTIFICATIONS_KEY,
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: NOTIFICATIONS_KEY, queryFn: async () => notificationsView(), ...opts }),
        },
        update: {
          mutationKey: () => [["founder", "preferences", "update"]],
          mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "preferences", "update"]], mutationFn: (change: Change) => update(change), ...opts }),
        },
      },
    },
    business: { get: { queryKey: (input: { businessId: string }) => [["business", "get"], { input, type: "query" }] } },
  }),
}));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved, failed, info: vi.fn() }) }));

import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { GuidanceHost } from "@/components/providers/GuidanceHost";
import { ANTHROPOMORPHIC_EXPLAINER, BUILDER_VIEW_HINT, builderViewSavedLine, PreferencesTab, anthropomorphicSavedLine, guidanceSavedLine, preferenceChange, resettable, savedLine } from "../PreferencesTab";

/** Somewhere else on the page (the top bar, the Inbox): it must follow the choice without a reload. */
function Elsewhere() {
  const { formatDate, formatTime } = useFormatters();
  const { guidance, textSize } = useGuidance();
  const builder = useBuilderView();
  return (
    <>
      <p data-testid="elsewhere-builder">{builder ? "on" : "off"}</p>
      <p data-testid="elsewhere">{`${formatDate(new Date(2026, 9, 7, 15, 45))} ${formatTime(new Date(2026, 9, 7, 15, 45))}`}</p>
      <p data-testid="elsewhere-guidance">{`${guidance} ${textSize}`}</p>
    </>
  );
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <TooltipProvider>
        <ToastProvider>
          <GuidanceHost>
            <DateFormatHost initial={{ date: "us", time: "12h" }} owner="dev">
              <PreferencesTab />
              <Elsewhere />
            </DateFormatHost>
          </GuidanceHost>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  stored = { date: "us", time: "12h" };
  guidanceStored = guidanceDefaults();
  emailStored = { decision_waiting: true };
  update.mockClear();
  saved.mockClear();
  failed.mockClear();
  document.documentElement.removeAttribute("data-text");
});

describe("Anthropomorphic agents switch", () => {
  it("is off by default, explains itself in plain words, and says the agents are still AI agents", async () => {
    mount();
    const sw = await screen.findByTestId("anthropomorphic-switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("Anthropomorphic agents")).toBe(sw);
    expect(screen.getByTestId("anthropomorphic-panel").textContent).toContain(ANTHROPOMORPHIC_EXPLAINER);
    expect(ANTHROPOMORPHIC_EXPLAINER).toMatch(/still AI agents/);
    expect(ANTHROPOMORPHIC_EXPLAINER).toMatch(/AI-generated picture/);
    expect(ANTHROPOMORPHIC_EXPLAINER).toMatch(/fantasy characters/);
    // Off: no style to choose.
    expect(screen.queryByTestId("agent-style-picker")).toBeNull();
  });

  it("saves at once through founder.preferences.update, says so, and can be switched back", async () => {
    mount();
    const sw = await screen.findByTestId("anthropomorphic-switch");
    fireEvent.click(sw);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ anthropomorphicAgents: true }));
    await waitFor(() => expect(screen.getByTestId("anthropomorphic-switch").getAttribute("aria-checked")).toBe("true"));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]?.[0]).toBe("Anthropomorphic agents on: Humans");
    fireEvent.click(screen.getByTestId("anthropomorphic-switch"));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ anthropomorphicAgents: false }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    expect(saved.mock.calls[1]?.[0]).toBe("Anthropomorphic agents off");
    expect(guidanceStored.anthropomorphicAgents).toBe(false);
  });

  it("with the switch on, offers the four styles, starting at Humans when the account has none", async () => {
    guidanceStored = { ...guidanceDefaults(), anthropomorphicAgents: true };
    mount();
    const picker = await screen.findByRole("radiogroup", { name: "Style" });
    expect(picker).toBeTruthy();
    for (const style of ["humans", "cartoon_3d", "cartoon_2d", "fantasy"] as const) {
      const card = screen.getByRole("radio", { name: AGENT_STYLE_META[style].label });
      expect(card.textContent).toContain(AGENT_STYLE_META[style].description);
      expect(card.getAttribute("aria-checked")).toBe(style === "humans" ? "true" : "false");
    }
  });

  it("saves a style at once, names it in the toast, and choosing the same one saves nothing", async () => {
    guidanceStored = { ...guidanceDefaults(), anthropomorphicAgents: true };
    mount();
    fireEvent.click(await screen.findByRole("radio", { name: "Humans" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ agentStyle: "fantasy" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]?.[0]).toBe("Anthropomorphic agents on: Fantasy");
    expect(screen.getByRole("radio", { name: "Fantasy" }).getAttribute("aria-checked")).toBe("true");
    expect(guidanceStored.agentStyle).toBe("fantasy");
  });

  it("shows the saved style, and keeps it when the switch goes off and on", async () => {
    guidanceStored = { ...guidanceDefaults(), anthropomorphicAgents: true, agentStyle: "cartoon_2d" };
    mount();
    expect((await screen.findByRole("radio", { name: AGENT_STYLE_META.cartoon_2d.label })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("anthropomorphic-switch"));
    await waitFor(() => expect(screen.queryByTestId("agent-style-picker")).toBeNull());
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]?.[0]).toBe("Anthropomorphic agents off");
    fireEvent.click(screen.getByTestId("anthropomorphic-switch"));
    expect((await screen.findByRole("radio", { name: AGENT_STYLE_META.cartoon_2d.label })).getAttribute("aria-checked")).toBe("true");
  });

  it("rolls back a style and reports when its save fails", async () => {
    guidanceStored = { ...guidanceDefaults(), anthropomorphicAgents: true };
    mount();
    update.mockRejectedValueOnce(new Error("nope"));
    fireEvent.click(await screen.findByRole("radio", { name: "Fantasy" }));
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Humans" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("rolls back and reports when the save fails", async () => {
    mount();
    update.mockRejectedValueOnce(new Error("nope"));
    fireEvent.click(await screen.findByTestId("anthropomorphic-switch"));
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("anthropomorphic-switch").getAttribute("aria-checked")).toBe("false"));
  });

  it("words the toast for each state", () => {
    expect(anthropomorphicSavedLine(true, "cartoon_3d").title).toBe("Anthropomorphic agents on: 3D cartoon humans");
    expect(anthropomorphicSavedLine(true, "fantasy").description).toContain("AI-generated picture");
    expect(anthropomorphicSavedLine(true).title).toBe("Anthropomorphic agents on: Humans");
    expect(anthropomorphicSavedLine(false, "fantasy").title).toBe("Anthropomorphic agents off");
    expect(anthropomorphicSavedLine(false).description).toContain("by role");
  });
});

describe("Builder view switch", () => {
  it("is off by default and says what it shows, in plain words", async () => {
    mount();
    const sw = await screen.findByTestId("builder-view-switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("Builder view", { selector: "button" })).toBe(sw);
    expect(screen.getByTestId("builder-view-panel").textContent).toContain(BUILDER_VIEW_HINT);
    expect(BUILDER_VIEW_HINT).toBe(
      "Shows how the platform runs the team: round numbers, AI usage in tokens, agents' live screens, test counts, finished code changes and previews, and the team's ratings, health and reporting lines. For operators and anyone building software with the team.",
    );
    expect(screen.getByTestId("elsewhere-builder").textContent).toBe("off");
  });

  it("saves at once, says so in every business, and the design system elsewhere follows", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("builder-view-switch"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ builderView: true }));
    await waitFor(() => expect(screen.getByTestId("elsewhere-builder").textContent).toBe("on"));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]).toEqual(["Builder view on", "How the platform runs the team now shows, in every business."]);
    fireEvent.click(screen.getByTestId("builder-view-switch"));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ builderView: false }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    expect(saved.mock.calls[1]?.[0]).toBe("Builder view off");
    expect(screen.getByTestId("elsewhere-builder").textContent).toBe("off");
  });

  it("words the toasts", () => {
    expect(builderViewSavedLine(true)).toEqual({ title: "Builder view on", description: "How the platform runs the team now shows, in every business." });
    expect(builderViewSavedLine(false)).toEqual({ title: "Builder view off", description: "The technical details are hidden again, in every business." });
  });
});

describe("Email switch", () => {
  it("is on by default, says what it sends in plain words, and saves at once with a toast", async () => {
    mount();
    const sw = await screen.findByTestId("email-decision-waiting-switch");
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByLabelText("Email me when something has waited a day for my answer", { selector: "button" })).toBe(sw);
    expect(screen.getByTestId("email-notifications-panel").textContent).toContain("at most one email a day for each project, and three a day in all");
    fireEvent.click(sw);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ email: { decision_waiting: false } }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]).toEqual(["Email off", "No more emails about answers that wait. Turn it on again any time from here."]);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ email: { decision_waiting: true } }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    expect(saved.mock.calls[1]?.[0]).toBe("Email on");
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("goes back to what is stored when the save fails", async () => {
    update.mockImplementationOnce(async () => {
      throw new Error("Network down");
    });
    mount();
    const sw = await screen.findByTestId("email-decision-waiting-switch");
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(sw);
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Your public profile", () => {
  it("says whether it is public and links to where it is edited, asking nothing about people", async () => {
    mount();
    const panel = await screen.findByTestId("public-profile-panel");
    expect(panel.textContent).toContain("A page about you at its own address, with no project needed.");
    await waitFor(() => expect(screen.getByTestId("public-profile-panel-state").textContent).toBe("Public since Oct 7, 2026"));
    expect(screen.getByTestId("public-profile-edit").getAttribute("href")).toBe("/public-profile");
    for (const word of ["cofounder", "alone", "people"]) expect(panel.textContent?.toLowerCase(), word).not.toContain(word);
  });
});

describe("PreferencesTab", () => {
  it("saves each choice at once, says so in the new format, and every date follows", async () => {
    mount();
    expect(screen.getByTestId("preferences-scope").textContent).toContain("Just for you");
    expect(screen.getByTestId("preferences-panel").textContent).toContain("in every business");
    expect(screen.getByTestId("preferences-panel").textContent).toContain("3 min ago");
    expect(screen.getByRole("radio", { name: "US" }).getAttribute("aria-checked")).toBe("true");
    // The signed-in person's account ID, for a co-founder to add them (WEB-12).
    await waitFor(() => expect(screen.getByTestId("account-id").textContent).toContain("5a1e0000-0000-4000-8000-00000000fe01"));

    fireEvent.click(screen.getByRole("radio", { name: "Day first" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ date: "day_first" }));
    expect(screen.getByTestId("elsewhere").textContent).toBe("7 Oct 2026 3:45 PM");
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]?.[0]).toBe("Day first dates, 12-hour times");

    fireEvent.click(screen.getByRole("radio", { name: "24-hour" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ time: "24h" }));
    await waitFor(() => expect(screen.getByTestId("elsewhere").textContent).toBe("7 Oct 2026 15:45"));
    expect(screen.getByRole("radio", { name: "24-hour" }).getAttribute("aria-checked")).toBe("true");
    expect(failed).not.toHaveBeenCalled();
  });

  it("says what failed and keeps the old choice when the save fails", async () => {
    update.mockRejectedValueOnce(new Error("offline"));
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "ISO 8601" }));
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(failed.mock.calls[0]?.[1]).toBe("Preference not saved");
    expect(screen.getByTestId("elsewhere").textContent).toBe("Oct 7, 2026 3:45 PM");
    expect(screen.getByRole("radio", { name: "US" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("PreferencesTab › Guidance", () => {
  it("the switch and the text size save at once, with a toast, and the guided layer elsewhere follows", async () => {
    mount();
    const panel = screen.getByTestId("guidance-panel");
    expect(panel.textContent).toContain("Guidance");
    expect(panel.textContent).toContain("always show");
    const sw = screen.getByRole("switch", { name: "Explain things as I go" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Standard" }).getAttribute("aria-pressed")).toBe("true");
    // Nothing to reset yet: both buttons are off, and say so to the keyboard too.
    expect(screen.getByTestId("show-checklist-again").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("replay-tour").getAttribute("aria-disabled")).toBe("true");
    // The tip beside the switch says what guidance changes; the reassurance under it is tutoring and shows while it is on.
    expect(screen.getByRole("button", { name: "About what guidance changes" })).toBeTruthy();
    expect(screen.getByTestId("guidance-reassurance").textContent).toContain("You can switch this any time.");

    // Optimistic: the switch and the rest of the page change while the request is still on its way.
    const release = holdNextUpdate();
    fireEvent.click(sw);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ guidance: "off" }));
    // The query cache notifies on its next tick; the request is still held open, so no toast yet.
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByTestId("elsewhere-guidance").textContent).toBe("off standard");
    expect(saved).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(saved).toHaveBeenCalledWith("Guidance off", expect.stringContaining("still show")));
    expect(sw.getAttribute("aria-checked")).toBe("false");
    // Off: the reassurance line goes; the tip stays, since it says what the switch does (information, not tutoring).
    expect(screen.queryByTestId("guidance-reassurance")).toBeNull();
    expect(screen.getByRole("button", { name: "About what guidance changes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Comfortable" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ textSize: "comfortable" }));
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith("Comfortable text", expect.stringContaining("in every business")));
    expect(screen.getByTestId("elsewhere-guidance").textContent).toBe("off comfortable");
    expect(screen.getByRole("button", { name: "Comfortable" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBe("comfortable"));

    fireEvent.click(sw);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ guidance: "on" }));
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith("Guidance on", expect.stringContaining("show as you go")));
    await waitFor(() => expect(screen.getByTestId("guidance-reassurance")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith("Standard text", expect.any(String)));
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBeNull());
    // The date format never travels with a guidance change.
    for (const call of update.mock.calls) expect(Object.keys(call[0])).not.toContain("date");
    expect(failed).not.toHaveBeenCalled();
  });

  it("the resets wake once something was seen, put it back to the first day, and go quiet again", async () => {
    guidanceStored = { ...guidanceDefaults(), explainersSeen: { home: true }, checklistDismissedAt: "2026-10-19T09:00:00.000Z" };
    mount();
    const checklist = screen.getByTestId("show-checklist-again");
    const tour = screen.getByTestId("replay-tour");
    await waitFor(() => expect(checklist.getAttribute("aria-disabled")).toBeNull());
    expect(tour.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(checklist);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ reset: true }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("Starting over", expect.stringContaining("show again")));
    await waitFor(() => expect(checklist.getAttribute("aria-disabled")).toBe("true"));
    expect(tour.getAttribute("aria-disabled")).toBe("true");
    expect(update).toHaveBeenCalledTimes(1);
    // Off buttons do nothing.
    fireEvent.click(tour);
    await new Promise((r) => setTimeout(r, 10));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("says what failed and keeps the old choice when a guidance save fails", async () => {
    mount();
    const sw = screen.getByRole("switch", { name: "Explain things as I go" });
    update.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(sw);
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(failed.mock.calls[0]?.[1]).toBe("Preference not saved");
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByTestId("elsewhere-guidance").textContent).toBe("on standard");
  });
});

describe("helpers", () => {
  it("sends only the field that changed", () => {
    expect(preferenceChange({ date: "us", time: "12h" }, { date: "iso", time: "12h" })).toEqual({ date: "iso" });
    expect(preferenceChange({ date: "us", time: "12h" }, { date: "us", time: "24h" })).toEqual({ time: "24h" });
    expect(preferenceChange({ date: "us", time: "12h" }, { date: "us", time: "12h" })).toBeNull();
  });
  it("words the toast in the new format", () => {
    expect(savedLine({ date: "iso", time: "24h" }, new Date(2026, 9, 7, 15, 45))).toEqual({ title: "ISO 8601 dates, 24-hour times", description: "Dates read 2026-10-07 and times 15:45, in every business." });
  });
  it("knows which resets have something to undo", () => {
    expect(resettable(guidanceDefaults())).toEqual({ checklist: false, tour: false });
    expect(resettable({ ...guidanceDefaults(), checklistDismissedAt: "2026-10-19T09:00:00.000Z" })).toEqual({ checklist: true, tour: false });
    expect(resettable({ ...guidanceDefaults(), explainersSeen: { home: true } })).toEqual({ checklist: false, tour: true });
    expect(resettable({ ...guidanceDefaults(), toursDone: { inbox: true } })).toEqual({ checklist: false, tour: true });
  });
  it("words the guidance toasts in sentence case, naming the choice", () => {
    expect(guidanceSavedLine({ guidance: "on", textSize: "standard" }, "guidance").title).toBe("Guidance on");
    expect(guidanceSavedLine({ guidance: "off", textSize: "standard" }, "guidance")).toEqual({ title: "Guidance off", description: "Consequences, provenance and Estimate labels still show. Turn it on again any time from here." });
    expect(guidanceSavedLine({ guidance: "on", textSize: "comfortable" }, "textSize").title).toBe("Comfortable text");
    expect(guidanceSavedLine({ guidance: "on", textSize: "standard" }, "textSize").title).toBe("Standard text");
    expect(guidanceSavedLine({ guidance: "on", textSize: "standard" }, "reset")).toEqual({ title: "Starting over", description: "The unread dots on Explain this page, the first-week checklist and the tours show again." });
    for (const line of [guidanceSavedLine({ guidance: "on", textSize: "standard" }, "guidance"), guidanceSavedLine({ guidance: "on", textSize: "standard" }, "reset")]) {
      expect(line.title).not.toMatch(/!/);
      expect(line.description).not.toMatch(/!/);
    }
  });
});
