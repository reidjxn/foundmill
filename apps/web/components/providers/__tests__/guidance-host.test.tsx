// @vitest-environment happy-dom
/**
 * GuidanceHost: reads the account's guidance preferences on a signed-in page only (or takes the layout's server read),
 * provides them and the definitions to the design system's `useGuidance`, stamps comfortable text on the document once
 * the account has answered, and saves a change optimistically (rolled back if the save fails).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuidanceTermsProvider, useBuilderView, useGuidance, useTerm } from "@foundmill/dugout";
import type { AgentStyle } from "@foundmill/shared/personas";

type Prefs = { guidance: "on" | "off"; textSize: "standard" | "comfortable"; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissedAt: string | null; anthropomorphicAgents: boolean; agentStyle: AgentStyle; builderView: boolean; keyboardShortcuts: boolean };
type Patch = Partial<{ guidance: Prefs["guidance"]; textSize: Prefs["textSize"]; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissed: boolean; anthropomorphicAgents: boolean; agentStyle: AgentStyle; builderView: boolean; keyboardShortcuts: boolean; reset: true }>;

const BUSINESS = "b1e5e5e5-0000-4000-8000-000000000001";
const GUIDANCE_KEY = [["founder", "preferences", "guidance"], { type: "query" }];
const businessKey = (businessId: string) => [["business", "get"], { input: { businessId }, type: "query" }];
const defaults = (): Prefs => ({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: "humans", builderView: false, keyboardShortcuts: false });

let stored: Prefs = defaults();
let pathname: string | null = `/b/${BUSINESS}/home`;
let params: Record<string, string> | null = { bid: BUSINESS };
const read = vi.fn(async () => stored);
/** The API's own rules, in miniature (packages/db repos/preferences.ts): marks merge, a reset clears, the answer carries the formats too. */
async function serverUpdate(change: Patch) {
  const next: Prefs = { ...stored, explainersSeen: { ...stored.explainersSeen }, toursDone: { ...stored.toursDone } };
  if (change.guidance) next.guidance = change.guidance;
  if (change.textSize) next.textSize = change.textSize;
  if (change.anthropomorphicAgents !== undefined) next.anthropomorphicAgents = change.anthropomorphicAgents;
  if (change.agentStyle) next.agentStyle = change.agentStyle;
  if (change.builderView !== undefined) next.builderView = change.builderView;
  if (change.keyboardShortcuts !== undefined) next.keyboardShortcuts = change.keyboardShortcuts;
  if (change.reset) Object.assign(next, { explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });
  for (const id of Object.keys(change.explainersSeen ?? {})) next.explainersSeen[id] = true;
  for (const id of Object.keys(change.toursDone ?? {})) next.toursDone[id] = true;
  if (change.checklistDismissed !== undefined) next.checklistDismissedAt = change.checklistDismissed ? "2026-10-20T15:45:00.000Z" : null;
  stored = next;
  return { date: "us", time: "12h", ...stored };
}
const update = vi.fn(serverUpdate);
const sendSignal = vi.fn(async (_input: unknown) => ({ written: true }));
/** Holds the next request open until the returned function is called, so the optimistic state can be observed. */
function holdNextUpdate(): () => void {
  let release: () => void = () => undefined;
  update.mockImplementationOnce(async (change) => {
    await new Promise<void>((r) => (release = r));
    return serverUpdate(change);
  });
  return () => release();
}

vi.mock("next/navigation", () => ({ usePathname: () => pathname, useParams: () => params }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      preferences: {
        guidance: {
          queryKey: () => GUIDANCE_KEY,
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: GUIDANCE_KEY, queryFn: () => read(), ...opts }),
        },
        update: {
          mutationKey: () => [["founder", "preferences", "update"]],
          mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "preferences", "update"]], mutationFn: (change: Patch) => update(change), ...opts }),
        },
        // The fake client for the product signals: records each request.
        signal: { mutationOptions: () => ({ mutationKey: [["founder", "preferences", "signal"]], mutationFn: (input: unknown) => sendSignal(input) }) },
      },
    },
    business: { get: { queryKey: (input: { businessId: string }) => businessKey(input.businessId) } },
  }),
}));

import { useBuilderViewPreference } from "../guidance-context";
import { GuidanceHost, agentStyleOf, applyGuidancePatch, guidancePrefsOf, guidanceSignalInput, isSignedInPath, resolveLearn, sameGuidancePrefs, screenIdFromPath, termsFor, useGuidancePreferences, useGuidanceSignal, type GuidancePreferencesApi } from "../GuidanceHost";
import { TEXT_SIZE_COOKIE, readTextSizeCookie } from "../text-size-cookie";

let api: GuidancePreferencesApi | null = null;
let guided: ReturnType<typeof useGuidance> | null = null;

function Probe() {
  guided = useGuidance();
  api = useGuidancePreferences();
  const term = useTerm("acquisition_cost");
  return (
    <p data-testid="probe">
      {guided.guidance} {guided.textSize} {Object.keys(guided.explainersSeen).join(",") || "-"} {guided.checklistDismissedAt ?? "-"} {term?.word ?? "?"}
    </p>
  );
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const mount = (queryClient = client(), initial?: Prefs, host: { textSizeOwner?: string } = {}) =>
  render(
    <QueryClientProvider client={queryClient}>
      <GuidanceHost initial={initial} {...host}>
        <Probe />
      </GuidanceHost>
    </QueryClientProvider>,
  );
const probe = () => screen.getByTestId("probe").textContent;
const clearTextSizeCookie = () => {
  document.cookie = `${TEXT_SIZE_COOKIE}=; path=/; max-age=0`;
};

beforeEach(() => {
  stored = defaults();
  pathname = `/b/${BUSINESS}/home`;
  params = { bid: BUSINESS };
  api = null;
  guided = null;
  document.documentElement.removeAttribute("data-text");
  clearTextSizeCookie();
});
afterEach(() => {
  read.mockClear();
  update.mockClear();
  sendSignal.mockReset();
  sendSignal.mockImplementation(async () => ({ written: true }));
});

describe("GuidanceHost", () => {
  it("renders the defaults first, then the account's answer, and stamps comfortable text on the document", async () => {
    stored = { ...defaults(), guidance: "off", textSize: "comfortable", explainersSeen: { home: true } };
    mount();
    expect(probe()).toBe("on standard - - Cost to win a customer");
    expect(document.documentElement.getAttribute("data-text")).toBeNull();
    await waitFor(() => expect(probe()).toBe("off comfortable home - Cost to win a customer"));
    expect(read).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBe("comfortable"));
    expect(guided?.terms.runway?.short).toBe("How many months your cash lasts at today's spending.");
  });

  it("starts from the layout's answer without a read, and takes the attribute off again for standard text", async () => {
    mount(client(), { ...defaults(), textSize: "comfortable" });
    expect(probe()).toBe("on comfortable - - Cost to win a customer");
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBe("comfortable"));
    await new Promise((r) => setTimeout(r, 20));
    expect(read).not.toHaveBeenCalled();
    await act(async () => {
      await api!.save({ textSize: "standard" });
    });
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBeNull());
  });

  it("reads nothing on a signed-out page, where everything is the default and nothing can be saved", async () => {
    stored = { ...defaults(), guidance: "off" };
    for (const path of ["/", "/login", "/examples/northwind", null]) {
      pathname = path;
      params = null;
      const r = mount();
      expect(probe()).toBe("on standard - - Cost to win a customer");
      await new Promise((res) => setTimeout(res, 20));
      expect(read).not.toHaveBeenCalled();
      expect(api?.signedIn).toBe(false);
      await expect(api!.save({ guidance: "on" })).rejects.toThrow(/Sign in/);
      r.unmount();
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("the provider's actions show at once and travel as one change each", async () => {
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    // Optimistic: the screen shows "home" while the request is still on its way.
    const release = holdNextUpdate();
    await act(async () => {
      guided!.markExplainerSeen("home");
    });
    expect(update).toHaveBeenCalledWith({ explainersSeen: { home: true } });
    // The query cache notifies on its next tick; the request is still held open.
    await waitFor(() => expect(probe()).toBe("on standard home - Cost to win a customer"));
    expect(stored.explainersSeen).toEqual({});
    await act(async () => release());
    await waitFor(() => expect(stored.explainersSeen).toEqual({ home: true }));
    expect(probe()).toBe("on standard home - Cost to win a customer");
    await act(async () => {
      guided!.dismissChecklist();
    });
    expect(update).toHaveBeenLastCalledWith({ checklistDismissed: true });
    await waitFor(() => expect(probe()).toBe("on standard home 2026-10-20T15:45:00.000Z Cost to win a customer"));
    await act(async () => {
      guided!.setGuidance("off");
    });
    expect(update).toHaveBeenLastCalledWith({ guidance: "off" });
    await waitFor(() => expect(probe()).toBe("off standard home 2026-10-20T15:45:00.000Z Cost to win a customer"));
    await act(async () => {
      guided!.resetGuidance();
    });
    expect(update).toHaveBeenLastCalledWith({ reset: true });
    await waitFor(() => expect(probe()).toBe("off standard - - Cost to win a customer"));
    expect(stored).toEqual({ ...defaults(), guidance: "off" });
    act(() => guided!.markTourDone("inbox"));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ toursDone: { inbox: true } }));
    await waitFor(() => expect(guided?.toursDone).toEqual({ inbox: true }));
  });

  it("rolls a failed save back and rejects, so Settings can say so", async () => {
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    update.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(api!.save({ guidance: "off" })).rejects.toThrow("offline");
    });
    await waitFor(() => expect(probe()).toBe("on standard - - Cost to win a customer"));
    expect(stored.guidance).toBe("on");
  });

  it("hands the map as written and never watches the business; the shell's GuidanceTermsProvider renames it below (perf item 3)", async () => {
    const queryClient = client();
    mount(queryClient, defaults());
    expect(probe()).toContain("Cost to win a customer");
    act(() => {
      queryClient.setQueryData(businessKey(BUSINESS), { business: { glossary: { customer: "client" } } });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(probe()).toContain("Cost to win a customer");
    // The business shell's provider: the same host, the glossary's words below it.
    render(
      <QueryClientProvider client={queryClient}>
        <GuidanceHost initial={defaults()}>
          <GuidanceTermsProvider terms={termsFor(BUSINESS, { customer: "client" })}>
            <ShellProbe />
          </GuidanceTermsProvider>
        </GuidanceHost>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("shell-probe").textContent).toBe("on Cost to win a client");
  });

  it("writes no second answer when the API's equals the optimistic one, so readers render once per change (perf item 8)", async () => {
    const queryClient = client();
    mount(queryClient, defaults());
    const writes = vi.spyOn(queryClient, "setQueryData");
    await act(async () => {
      await api!.save({ toursDone: { home: true } });
    });
    // The optimistic write only: the answer said the same.
    expect(writes.mock.calls.filter(([key]) => JSON.stringify(key) === JSON.stringify(GUIDANCE_KEY))).toHaveLength(1);
    writes.mockClear();
    // A dismissal carries the server's own time, which differs from the optimistic one: written again.
    await act(async () => {
      await api!.save({ checklistDismissed: true });
    });
    expect(writes.mock.calls.filter(([key]) => JSON.stringify(key) === JSON.stringify(GUIDANCE_KEY))).toHaveLength(2);
    // React Query tells its readers on a later macrotask (notifyManager's setTimeout), which `act` does not always flush
    // on a loaded runner: wait for the render instead of reading it at once.
    await waitFor(() => expect(probe()).toContain("2026-10-20T15:45:00.000Z"));
  });

  it("is loaded at once with the layout's answer, and waits (loaded false) while its own read is on the way (F28)", async () => {
    const r = mount(client(), { ...defaults(), toursDone: { home: true } });
    expect(guided?.loaded).toBe(true);
    expect(guided?.toursDone).toEqual({ home: true });
    r.unmount();
    let release: () => void = () => undefined;
    read.mockImplementationOnce(async () => {
      await new Promise<void>((res) => (release = res));
      return stored;
    });
    mount(client(), undefined);
    expect(guided?.loaded).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(guided?.loaded).toBe(true));
  });
});

function ShellProbe() {
  const g = useGuidance();
  const term = useTerm("acquisition_cost");
  return <p data-testid="shell-probe">{`${g.guidance} ${term?.word ?? "?"}`}</p>;
}

describe("GuidanceHost text size", () => {
  it("mirrors the account's text size into the owner's cookie once the account has answered, and follows a save", async () => {
    stored = { ...defaults(), textSize: "comfortable" };
    mount(client(), undefined, { textSizeOwner: "dev" });
    // Before the answer: the default, and no cookie written over a real choice.
    expect(readTextSizeCookie(document.cookie)).toBeNull();
    await waitFor(() => expect(probe()).toContain("comfortable"));
    await waitFor(() => expect(readTextSizeCookie(document.cookie)).toBe("comfortable.dev"));
    await act(async () => {
      await api!.save({ textSize: "standard" });
    });
    await waitFor(() => expect(readTextSizeCookie(document.cookie)).toBe("standard.dev"));
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBeNull());
  });

  it("leaves the head script's attribute alone until the account answers, then follows the account (no flash)", async () => {
    // app/layout.tsx's head script stamped comfortable text from the cookie before the first paint.
    document.documentElement.setAttribute("data-text", "comfortable");
    stored = { ...defaults(), textSize: "standard" };
    let release: () => void = () => undefined;
    read.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return stored;
    });
    mount(client(), undefined, { textSizeOwner: "dev" });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.getAttribute("data-text")).toBe("comfortable");
    // The account says standard (the cookie was stale): the attribute goes once it has answered.
    await act(async () => release());
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBeNull());
    await waitFor(() => expect(readTextSizeCookie(document.cookie)).toBe("standard.dev"));
  });

  it("writes no cookie without an owner or on a signed-out page", async () => {
    stored = { ...defaults(), textSize: "comfortable" };
    const r = mount();
    await waitFor(() => expect(probe()).toContain("comfortable"));
    expect(readTextSizeCookie(document.cookie)).toBeNull();
    r.unmount();
    pathname = "/login";
    params = null;
    mount(client(), undefined, { textSizeOwner: "dev" });
    await new Promise((res) => setTimeout(res, 20));
    expect(readTextSizeCookie(document.cookie)).toBeNull();
  });
});

describe("GuidanceHost definitions and Learn more", () => {
  it("resolves Learn more inside the business on screen and leaves slugs unlinked elsewhere", () => {
    expect(resolveLearn("finance/runway", BUSINESS)).toBe(`/b/${BUSINESS}/d/finance/runway`);
    expect(resolveLearn("team/agents", BUSINESS)).toBe(`/b/${BUSINESS}/d/team/squad`);
    expect(resolveLearn("settings/mode", BUSINESS)).toBe(`/b/${BUSINESS}/settings/mode`);
    expect(resolveLearn("https://example.com/help", null)).toBe("https://example.com/help");
    expect(resolveLearn("finance/runway", null)).toBeUndefined();
  });

  it("hands the map as written outside a business, and the glossary's words inside one", () => {
    expect(termsFor(null, { customer: "client" }).acquisition_cost?.word).toBe("Cost to win a customer");
    expect(termsFor(BUSINESS, { customer: "client" }).acquisition_cost?.word).toBe("Cost to win a client");
    expect(termsFor(BUSINESS, null).acquisition_cost?.word).toBe("Cost to win a customer");
  });
});

/** The provider's actions as the Term sees them (GuidanceHost passes `onTermOpen` with the others). */
type Actions = ReturnType<typeof useGuidance> & { onTermOpen?: (termId: string) => void };
const signalsSent = () => sendSignal.mock.calls.map(([input]) => input as { businessId: string; signal: Record<string, unknown> });

describe("GuidanceHost product signals", () => {
  it("signal() sends one request for the business on screen and returns at once", async () => {
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => api!.signal("guidance.tour_completed", { tourId: "home", steps: 5 }));
    await waitFor(() => expect(sendSignal).toHaveBeenCalledTimes(1));
    expect(signalsSent()[0]).toEqual({ businessId: BUSINESS, signal: { type: "guidance.tour_completed", tourId: "home", steps: 5 } });
  });

  it("sends nothing outside a business route, and a failed signal changes nothing on screen", async () => {
    pathname = "/new";
    params = null;
    const r = mount(client(), undefined, {});
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => api!.signal("guidance.explainer_dismissed", { screenId: "home" }));
    await new Promise((res) => setTimeout(res, 20));
    expect(sendSignal).not.toHaveBeenCalled();
    r.unmount();

    pathname = `/b/${BUSINESS}/home`;
    params = { bid: BUSINESS };
    sendSignal.mockRejectedValue(new Error("offline"));
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(() => act(() => api!.signal("guidance.tour_skipped", { tourId: "home", atStep: 2, steps: 5 }))).not.toThrow();
    await waitFor(() => expect(sendSignal).toHaveBeenCalledTimes(1));
    await new Promise((res) => setTimeout(res, 20));
    expect(probe()).toBe("on standard - - Cost to win a customer");
  });

  it("an explainer's first opening is its read signal; one already seen sends nothing", async () => {
    stored = { ...defaults(), explainersSeen: { inbox: true } };
    mount();
    await waitFor(() => expect(guided?.explainersSeen).toEqual({ inbox: true }));
    await act(async () => guided!.markExplainerSeen("finance/runway"));
    await act(async () => guided!.markExplainerSeen("inbox"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(signalsSent().map((i) => i.signal)).toEqual([{ type: "guidance.explainer_dismissed", screenId: "finance/runway" }]);
  });

  it("a definition opened sends term_opened once per term per session, with the screen it was opened on", async () => {
    pathname = `/b/${BUSINESS}/finance/runway`;
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const actions = guided as Actions;
    expect(typeof actions.onTermOpen).toBe("function");
    act(() => {
      actions.onTermOpen!("runway");
      actions.onTermOpen!("runway");
      actions.onTermOpen!("burn");
      // An inline definition's id the API would refuse is dropped, not sent.
      actions.onTermOpen!("Not An Id");
    });
    await waitFor(() => expect(sendSignal).toHaveBeenCalledTimes(2));
    expect(signalsSent().map((i) => i.signal)).toEqual([
      { type: "guidance.term_opened", termId: "runway", screenId: "finance/runway" },
      { type: "guidance.term_opened", termId: "burn", screenId: "finance/runway" },
    ]);
  });

  it("a saved switch from on to off sends turned_off (from Settings by default); off to off and on do not", async () => {
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await act(async () => {
      await api!.save({ textSize: "comfortable" });
      await api!.save({ guidance: "off" });
    });
    await waitFor(() => expect(sendSignal).toHaveBeenCalledTimes(1));
    expect(signalsSent()[0]!.signal).toEqual({ type: "guidance.turned_off", from: "settings" });
    await act(async () => {
      await api!.save({ guidance: "off" });
      await api!.save({ guidance: "on" });
      await api!.save({ guidance: "off" }, { from: "checklist" });
    });
    await waitFor(() => expect(sendSignal).toHaveBeenCalledTimes(2));
    expect(signalsSent()[1]!.signal).toEqual({ type: "guidance.turned_off", from: "checklist" });
  });

  it("a failed save sends no turned_off", async () => {
    mount();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    update.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(api!.save({ guidance: "off" })).rejects.toThrow("offline");
    });
    await new Promise((res) => setTimeout(res, 20));
    expect(sendSignal).not.toHaveBeenCalled();
  });

  it("useGuidanceSignal is the host's signal inside it and a no-op outside it", async () => {
    let inside: ReturnType<typeof useGuidanceSignal> | null = null;
    let outside: ReturnType<typeof useGuidanceSignal> | null = null;
    function Inside() {
      inside = useGuidanceSignal();
      return null;
    }
    function Outside() {
      outside = useGuidanceSignal();
      return null;
    }
    render(
      <QueryClientProvider client={client()}>
        <Outside />
        <GuidanceHost>
          <Inside />
        </GuidanceHost>
      </QueryClientProvider>,
    );
    expect(() => outside!("guidance.tour_completed", { tourId: "home", steps: 1 })).not.toThrow();
    act(() => inside!("guidance.tour_completed", { tourId: "inbox", steps: 4 }));
    await waitFor(() => expect(sendSignal).toHaveBeenCalledTimes(1));
    expect(signalsSent()[0]!.signal).toEqual({ type: "guidance.tour_completed", tourId: "inbox", steps: 4 });
  });
});

describe("helpers", () => {
  it("guidanceSignalInput: the business on screen and ids the API accepts, else nothing", () => {
    expect(guidanceSignalInput("guidance.turned_off", { from: "tour" }, BUSINESS)).toEqual({ businessId: BUSINESS, signal: { type: "guidance.turned_off", from: "tour" } });
    expect(guidanceSignalInput("guidance.turned_off", { from: "tour" }, null)).toBeNull();
    expect(guidanceSignalInput("guidance.term_opened", { termId: "mrr" }, BUSINESS)?.signal).toEqual({ type: "guidance.term_opened", termId: "mrr" });
    expect(guidanceSignalInput("guidance.term_opened", { termId: "MRR" }, BUSINESS)).toBeNull();
    expect(guidanceSignalInput("guidance.explainer_dismissed", { screenId: " " }, BUSINESS)).toBeNull();
    expect(guidanceSignalInput("guidance.explainer_dismissed", { screenId: "x".repeat(121) }, BUSINESS)).toBeNull();
  });

  it("screenIdFromPath: the part of a business route after its id, Home for the root, null elsewhere", () => {
    expect(screenIdFromPath(`/b/${BUSINESS}/finance/runway`)).toBe("finance/runway");
    expect(screenIdFromPath(`/b/${BUSINESS}/inbox/`)).toBe("inbox");
    expect(screenIdFromPath(`/b/${BUSINESS}`)).toBe("home");
    expect(screenIdFromPath(`/b/${BUSINESS}/home?x=1`)).toBe("home");
    expect(screenIdFromPath("/new")).toBeNull();
    expect(screenIdFromPath(null)).toBeNull();
  });


  it("isSignedInPath: the founder's pages, never the landing page or the sign-in pages", () => {
    expect(isSignedInPath(`/b/${BUSINESS}/home`)).toBe(true);
    expect(isSignedInPath("/new/ideate")).toBe(true);
    expect(isSignedInPath("/onboarding")).toBe(true);
    expect(isSignedInPath("/businesses")).toBe(true);
    expect(isSignedInPath("/network")).toBe(true);
    expect(isSignedInPath("/")).toBe(false);
    expect(isSignedInPath("/login")).toBe(false);
    expect(isSignedInPath("/auth/callback")).toBe(false);
    expect(isSignedInPath("/examples/northwind")).toBe(false);
    expect(isSignedInPath(null)).toBe(false);
    expect(isSignedInPath(undefined)).toBe(false);
  });

  it("sameGuidancePrefs: the same choice and marks, whatever their order", () => {
    const a = { ...defaults(), explainersSeen: { home: true as const, inbox: true as const } };
    expect(sameGuidancePrefs(a, { ...defaults(), explainersSeen: { inbox: true, home: true } })).toBe(true);
    expect(sameGuidancePrefs(a, { ...a, guidance: "off" })).toBe(false);
    expect(sameGuidancePrefs(a, { ...a, toursDone: { home: true } })).toBe(false);
    expect(sameGuidancePrefs(a, { ...a, explainersSeen: { home: true } })).toBe(false);
    expect(sameGuidancePrefs(a, { ...a, checklistDismissedAt: "2026-10-20T15:45:00.000Z" })).toBe(false);
    expect(sameGuidancePrefs(undefined, a)).toBe(false);
    expect(sameGuidancePrefs(undefined, undefined)).toBe(true);
  });

  it("Builder view: the design system reads the account's switch (off by default), and the preference hook saves it at once", async () => {
    let pref: ReturnType<typeof useBuilderViewPreference> | null = null;
    function BuilderProbe() {
      pref = useBuilderViewPreference();
      return <p data-testid="builder">{useBuilderView() ? "on" : "off"}</p>;
    }
    render(
      <QueryClientProvider client={client()}>
        <GuidanceHost initial={defaults()}>
          <BuilderProbe />
        </GuidanceHost>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("builder").textContent).toBe("off");
    expect(pref!.on).toBe(false);
    expect(pref!.loaded).toBe(true);
    await act(async () => {
      await pref!.setOn(true);
    });
    expect(update).toHaveBeenLastCalledWith({ builderView: true });
    await waitFor(() => expect(screen.getByTestId("builder").textContent).toBe("on"));
    expect(pref!.on).toBe(true);
    expect(stored.builderView).toBe(true);
    // The layout's answer saying on is on from the first render (no flash of the founder view for a builder).
    stored = { ...defaults(), builderView: true };
    render(
      <QueryClientProvider client={client()}>
        <GuidanceHost initial={{ ...defaults(), builderView: true }}>
          <BuilderProbe />
        </GuidanceHost>
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId("builder").map((n) => n.textContent)).toEqual(["on", "on"]);
  });

  it("useBuilderViewPreference outside a host: off, loaded, and saving rejects", async () => {
    let pref: ReturnType<typeof useBuilderViewPreference> | null = null;
    function Outside() {
      pref = useBuilderViewPreference();
      return null;
    }
    render(<Outside />);
    expect(pref!.on).toBe(false);
    expect(pref!.loaded).toBe(true);
    await expect(pref!.setOn(true)).rejects.toThrow(/Sign in/);
  });

  it("applyGuidancePatch: the optimistic answer follows the API's rules without touching the previous state", () => {
    const prev: Prefs = { guidance: "on", textSize: "standard", explainersSeen: { home: true }, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: "humans", builderView: false, keyboardShortcuts: false };
    const now = "2026-10-20T15:45:00.000Z";
    expect(applyGuidancePatch(prev, { guidance: "off", textSize: "comfortable" }, now)).toEqual({ ...prev, guidance: "off", textSize: "comfortable" });
    expect(applyGuidancePatch(prev, { explainersSeen: { inbox: true }, toursDone: { home: true } }, now)).toEqual({ ...prev, explainersSeen: { home: true, inbox: true }, toursDone: { home: true } });
    expect(applyGuidancePatch(prev, { checklistDismissed: true }, now).checklistDismissedAt).toBe(now);
    expect(applyGuidancePatch({ ...prev, checklistDismissedAt: now }, { checklistDismissed: false }, now).checklistDismissedAt).toBeNull();
    // The Give agents names and faces switch travels with the guided layer's preferences.
    expect(applyGuidancePatch(prev, { anthropomorphicAgents: true }, now).anthropomorphicAgents).toBe(true);
    expect(applyGuidancePatch({ ...prev, anthropomorphicAgents: true }, { guidance: "off" }, now).anthropomorphicAgents).toBe(true);
    expect(applyGuidancePatch({ ...prev, anthropomorphicAgents: true }, { reset: true }, now).anthropomorphicAgents).toBe(true);
    expect(sameGuidancePrefs(prev, { ...prev, anthropomorphicAgents: true })).toBe(false);
    expect(applyGuidancePatch({ ...prev, toursDone: { home: true }, checklistDismissedAt: now }, { reset: true, guidance: "off" }, now)).toEqual({ guidance: "off", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: "humans", builderView: false, keyboardShortcuts: false });
    expect(prev).toEqual({ guidance: "on", textSize: "standard", explainersSeen: { home: true }, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: "humans", builderView: false, keyboardShortcuts: false });
    // The agent style travels the same way, is kept by a reset, and counts as a change.
    expect(applyGuidancePatch(prev, { agentStyle: "fantasy" }, now).agentStyle).toBe("fantasy");
    expect(applyGuidancePatch({ ...prev, agentStyle: "fantasy" }, { reset: true }, now).agentStyle).toBe("fantasy");
    expect(sameGuidancePrefs(prev, { ...prev, agentStyle: "cartoon_3d" })).toBe(false);
    // Builder view too: it travels with the rest, a reset keeps it, and it counts as a change.
    expect(applyGuidancePatch(prev, { builderView: true }, now).builderView).toBe(true);
    expect(applyGuidancePatch({ ...prev, builderView: true }, { reset: true }, now).builderView).toBe(true);
    expect(sameGuidancePrefs(prev, { ...prev, builderView: true })).toBe(false);
    // And the single-key shortcuts (WP-04 T13): they travel, a reset keeps them, they count as a change.
    expect(applyGuidancePatch(prev, { keyboardShortcuts: true }, now).keyboardShortcuts).toBe(true);
    expect(applyGuidancePatch({ ...prev, keyboardShortcuts: true }, { reset: true }, now).keyboardShortcuts).toBe(true);
    expect(sameGuidancePrefs(prev, { ...prev, keyboardShortcuts: true })).toBe(false);
    expect(guidancePrefsOf({ ...prev, keyboardShortcuts: true }).keyboardShortcuts).toBe(true);
    expect(agentStyleOf(prev)).toBe("humans");
    expect(agentStyleOf({ agentStyle: "cartoon_2d" })).toBe("cartoon_2d");
    expect(agentStyleOf({})).toBe("humans");
    expect(agentStyleOf({ agentStyle: "dragon" })).toBe("humans");
  });
});
