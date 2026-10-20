// @vitest-environment happy-dom
/**
 * GuidanceHost: reads the account's guidance preferences on a signed-in page only, provides them (and the definitions,
 * renamed by the business glossary) to the design system's `useGuidance`, stamps comfortable text on the document, and
 * saves a change optimistically (rolled back if the save fails).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGuidance, useTerm } from "@foundmill/dugout";

type Prefs = { guidance: "on" | "off"; textSize: "standard" | "comfortable"; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissedAt: string | null };
type Patch = Partial<{ guidance: Prefs["guidance"]; textSize: Prefs["textSize"]; explainersSeen: Record<string, true>; toursDone: Record<string, true>; checklistDismissed: boolean; reset: true }>;

const BUSINESS = "b1e5e5e5-0000-4000-8000-000000000001";
const GUIDANCE_KEY = [["founder", "preferences", "guidance"], { type: "query" }];
const businessKey = (businessId: string) => [["business", "get"], { input: { businessId }, type: "query" }];
const defaults = (): Prefs => ({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });

let stored: Prefs = defaults();
let pathname: string | null = `/b/${BUSINESS}/home`;
let params: Record<string, string> | null = { bid: BUSINESS };
const read = vi.fn(async () => stored);
/** The API's own rules, in miniature (packages/db repos/preferences.ts): marks merge, a reset clears, the answer carries the formats too. */
async function serverUpdate(change: Patch) {
  const next: Prefs = { ...stored, explainersSeen: { ...stored.explainersSeen }, toursDone: { ...stored.toursDone } };
  if (change.guidance) next.guidance = change.guidance;
  if (change.textSize) next.textSize = change.textSize;
  if (change.reset) Object.assign(next, { explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });
  for (const id of Object.keys(change.explainersSeen ?? {})) next.explainersSeen[id] = true;
  for (const id of Object.keys(change.toursDone ?? {})) next.toursDone[id] = true;
  if (change.checklistDismissed !== undefined) next.checklistDismissedAt = change.checklistDismissed ? "2026-10-20T15:45:00.000Z" : null;
  stored = next;
  return { date: "us", time: "12h", ...stored };
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
      },
    },
    business: { get: { queryKey: (input: { businessId: string }) => businessKey(input.businessId) } },
  }),
}));

import { GuidanceHost, applyGuidancePatch, isSignedInPath, resolveLearn, termsFor, useGuidancePreferences, type GuidancePreferencesApi } from "../GuidanceHost";
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
const mount = (queryClient = client(), initial?: Prefs, host: { textSizeOwner?: string; initialTextSize?: "standard" | "comfortable" | null } = {}) =>
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

  it("renames the definitions with the glossary of the business on screen, read from the query cache", async () => {
    const queryClient = client();
    mount(queryClient);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(probe()).toContain("Cost to win a customer");
    act(() => {
      queryClient.setQueryData(businessKey(BUSINESS), { business: { glossary: { customer: "client" } } });
    });
    await waitFor(() => expect(probe()).toContain("Cost to win a client"));
    // Another business's glossary is not this one's.
    act(() => {
      queryClient.setQueryData(businessKey("b1e5e5e5-0000-4000-8000-000000000002"), { business: { glossary: { customer: "patient" } } });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(probe()).toContain("Cost to win a client");
  });
});

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

  it("keeps the size the server rendered with (the cookie) until the account answers, so nothing flashes", async () => {
    stored = { ...defaults(), textSize: "comfortable" };
    let release: () => void = () => undefined;
    read.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return stored;
    });
    mount(client(), undefined, { textSizeOwner: "dev", initialTextSize: "comfortable" });
    expect(probe()).toBe("on comfortable - - Cost to win a customer");
    await waitFor(() => expect(document.documentElement.getAttribute("data-text")).toBe("comfortable"));
    await act(async () => release());
    await waitFor(() => expect(probe()).toBe("on comfortable - - Cost to win a customer"));
    expect(document.documentElement.getAttribute("data-text")).toBe("comfortable");
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

describe("helpers", () => {
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

  it("applyGuidancePatch: the optimistic answer follows the API's rules without touching the previous state", () => {
    const prev: Prefs = { guidance: "on", textSize: "standard", explainersSeen: { home: true }, toursDone: {}, checklistDismissedAt: null };
    const now = "2026-10-20T15:45:00.000Z";
    expect(applyGuidancePatch(prev, { guidance: "off", textSize: "comfortable" }, now)).toEqual({ ...prev, guidance: "off", textSize: "comfortable" });
    expect(applyGuidancePatch(prev, { explainersSeen: { inbox: true }, toursDone: { home: true } }, now)).toEqual({ ...prev, explainersSeen: { home: true, inbox: true }, toursDone: { home: true } });
    expect(applyGuidancePatch(prev, { checklistDismissed: true }, now).checklistDismissedAt).toBe(now);
    expect(applyGuidancePatch({ ...prev, checklistDismissedAt: now }, { checklistDismissed: false }, now).checklistDismissedAt).toBeNull();
    expect(applyGuidancePatch({ ...prev, toursDone: { home: true }, checklistDismissedAt: now }, { reset: true, guidance: "off" }, now)).toEqual({ guidance: "off", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });
    expect(prev).toEqual({ guidance: "on", textSize: "standard", explainersSeen: { home: true }, toursDone: {}, checklistDismissedAt: null });
  });
});
