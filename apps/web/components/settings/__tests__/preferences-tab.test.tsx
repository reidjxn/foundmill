// @vitest-environment happy-dom
/**
 * Settings › Preferences: two sets of radio cards; a choice saves at once with a toast in the new format, and every
 * date on screen follows without a reload.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider, useFormatters, type DateFormatPrefs } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

let stored: DateFormatPrefs = { date: "us", time: "12h" };
const update = vi.fn(async (change: Partial<DateFormatPrefs>) => {
  stored = { ...stored, ...change };
  return stored;
});
const saved = vi.fn();
const failed = vi.fn();

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      // The account ID section reads the signed-in person's id (WEB-12).
      profile: {
        get: {
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "profile", "get"], { type: "query" }], queryFn: async () => ({ userId: "5a1e0000-0000-4000-8000-00000000fe01", profile: null, complete: true, email: "reid@northwind.example", memberships: [] }), ...opts }),
        },
      },
      preferences: {
        get: {
          queryKey: () => [["founder", "preferences", "get"], { type: "query" }],
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "preferences", "get"], { type: "query" }], queryFn: async () => stored, ...opts }),
        },
        update: {
          mutationKey: () => [["founder", "preferences", "update"]],
          mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "preferences", "update"]], mutationFn: (change: Partial<DateFormatPrefs>) => update(change), ...opts }),
        },
      },
    },
  }),
}));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => ({ saved, failed, info: vi.fn() }) }));

import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { PreferencesTab, preferenceChange, savedLine } from "../PreferencesTab";

/** Somewhere else on the page (the top bar, the Inbox): it must follow the choice without a reload. */
function Elsewhere() {
  const { formatDate, formatTime } = useFormatters();
  return <p data-testid="elsewhere">{`${formatDate(new Date(2026, 9, 7, 15, 45))} ${formatTime(new Date(2026, 9, 7, 15, 45))}`}</p>;
}

afterEach(() => {
  stored = { date: "us", time: "12h" };
  update.mockClear();
  saved.mockClear();
  failed.mockClear();
});

describe("PreferencesTab", () => {
  it("saves each choice at once, says so in the new format, and every date follows", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <TooltipProvider>
          <ToastProvider>
            <DateFormatHost initial={{ date: "us", time: "12h" }} owner="dev">
              <PreferencesTab />
              <Elsewhere />
            </DateFormatHost>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
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
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <TooltipProvider>
          <ToastProvider>
            <DateFormatHost initial={{ date: "us", time: "12h" }} owner="dev">
              <PreferencesTab />
              <Elsewhere />
            </DateFormatHost>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "ISO 8601" }));
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(failed.mock.calls[0]?.[1]).toBe("Preference not saved");
    expect(screen.getByTestId("elsewhere").textContent).toBe("Oct 7, 2026 3:45 PM");
    expect(screen.getByRole("radio", { name: "US" }).getAttribute("aria-checked")).toBe("true");
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
});
