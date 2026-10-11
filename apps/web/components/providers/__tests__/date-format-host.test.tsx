// @vitest-environment happy-dom
/**
 * DateFormatHost: starts from the server's choice (so hydration matches), checks it once against the account, keeps the
 * cookie in step with what it read, and saves a change optimistically (rolled back if the save fails).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFormatters, type DateFormatPrefs } from "@foundmill/dugout";
import { DATE_FORMAT_COOKIE, readDateFormatCookie } from "@/lib/date-format";

let stored: DateFormatPrefs = { date: "us", time: "12h" };
const get = vi.fn(async () => stored);
const update = vi.fn(async (change: Partial<DateFormatPrefs>) => {
  stored = { ...stored, ...change };
  return stored;
});

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      preferences: {
        get: {
          queryKey: () => [["founder", "preferences", "get"], { type: "query" }],
          queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "preferences", "get"], { type: "query" }], queryFn: () => get(), ...opts }),
        },
        update: {
          mutationKey: () => [["founder", "preferences", "update"]],
          mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "preferences", "update"]], mutationFn: (change: Partial<DateFormatPrefs>) => update(change), ...opts }),
        },
      },
    },
  }),
}));

import { DateFormatHost, useDatePreferences, type DatePreferencesApi } from "../DateFormatHost";

const at = new Date(2026, 9, 7, 15, 45);
let api: DatePreferencesApi | null = null;

function Probe() {
  const f = useFormatters();
  api = useDatePreferences();
  return <p data-testid="probe">{f.formatDateTime(at)}</p>;
}

const mount = (initial: DateFormatPrefs, owner = "dev") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <DateFormatHost initial={initial} owner={owner}>
        <Probe />
      </DateFormatHost>
    </QueryClientProvider>,
  );

const cookie = () => readDateFormatCookie(document.cookie);

beforeEach(() => {
  document.cookie = `${DATE_FORMAT_COOKIE}=; path=/; max-age=0`;
  stored = { date: "us", time: "12h" };
  api = null;
});
afterEach(() => {
  get.mockClear();
  update.mockClear();
});

describe("DateFormatHost", () => {
  it("renders the server's choice first, then follows the account and writes the cookie", async () => {
    stored = { date: "iso", time: "24h" };
    mount({ date: "day_first", time: "24h" });
    // The first render is the server's choice (what the HTML holds).
    expect(screen.getByTestId("probe").textContent).toBe("7 Oct 2026, 15:45");
    // Then the account's own answer wins and the cookie follows it.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("2026-10-07 15:45"));
    expect(get).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(cookie()).toBe("iso.24h.dev"));
  });

  it("saves a change at once everywhere and keeps the cookie in step", async () => {
    mount({ date: "us", time: "12h" });
    await waitFor(() => expect(cookie()).toBe("us.12h.dev"));
    await act(async () => {
      await api!.save({ date: "day_first" });
    });
    expect(update).toHaveBeenCalledWith({ date: "day_first" });
    // The query cache notifies on its next tick.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("7 Oct 2026, 3:45 PM"));
    await waitFor(() => expect(cookie()).toBe("day_first.12h.dev"));
    await act(async () => {
      await api!.save({ time: "24h" });
    });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("7 Oct 2026, 15:45"));
    await waitFor(() => expect(cookie()).toBe("day_first.24h.dev"));
  });

  it("ends on what was stored when two quick changes answer out of order", async () => {
    mount({ date: "us", time: "12h" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    // The first request answers last, with a row that predates the second change.
    let releaseFirst: () => void = () => undefined;
    update.mockImplementationOnce(async (change) => {
      await new Promise<void>((r) => (releaseFirst = r));
      return { date: "day_first", time: "12h", ...change } as DateFormatPrefs;
    });
    let first: Promise<DateFormatPrefs> = Promise.resolve(stored);
    await act(async () => {
      first = api!.save({ date: "day_first" });
      await Promise.resolve();
    });
    await act(async () => {
      await api!.save({ time: "24h" });
    });
    stored = { date: "day_first", time: "24h" };
    await act(async () => {
      releaseFirst();
      await first;
    });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("7 Oct 2026, 15:45"));
    await waitFor(() => expect(cookie()).toBe("day_first.24h.dev"));
  });

  it("rolls a failed save back", async () => {
    mount({ date: "us", time: "12h" });
    await waitFor(() => expect(get).toHaveBeenCalled());
    update.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(api!.save({ date: "iso" })).rejects.toThrow("offline");
    });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("Oct 7, 2026, 3:45 PM"));
    expect(cookie()).toBe("us.12h.dev");
  });

  it("reads and writes nothing for a signed-out page", async () => {
    mount({ date: "us", time: "12h" }, "");
    expect(screen.getByTestId("probe").textContent).toBe("Oct 7, 2026, 3:45 PM");
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
    expect(cookie()).toBeNull();
  });
});
