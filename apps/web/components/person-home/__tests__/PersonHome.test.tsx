// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/home",
}));

const ideas = vi.fn();
const summary = vi.fn();
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    idea: {
      list: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["idea", "list"], input],
          queryFn: () => ideas(input),
          ...opts,
        }),
      },
    },
    founder: { email: { sendLink: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: async () => ({ sent: false, reason: "off", email: null }), ...opts }) } } },
    live: {
      summary: {
        queryOptions: (_input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["live", "summary"]],
          queryFn: () => summary(),
          ...opts,
        }),
      },
    },
  }),
}));

import { HOME_CONCEPTS_SHOWN, PersonHome, homeTitle, waitingLines } from "../PersonHome";

const NO_IDEAS = { items: [], nextCursor: null };
const NOTHING_WAITING = {
  unreadMessages: 0,
  requestsWaiting: 0,
  invitations: 0,
  moderation: 0,
  total: 0,
  adultConfirmed: true,
};

function renderHome(props: { liveMode: boolean; displayName?: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PersonHome
        viewer={{ email: "maya@example.com" }}
        displayName={props.displayName ?? "Maya"}
        liveMode={props.liveMode}
      />
    </QueryClientProvider>,
  );
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

afterEach(() => {
  ideas.mockReset();
  summary.mockReset();
  setWidth(1440);
});

describe("homeTitle", () => {
  it("greets the person by the name they gave, and never asks for one", () => {
    expect(homeTitle("Maya")).toBe("Welcome, Maya");
    expect(homeTitle("  ")).toBe("Welcome");
    expect(homeTitle(null)).toBe("Welcome");
  });
});

describe("waitingLines", () => {
  it("lists only what is waiting, requests first, with plain counts", () => {
    expect(waitingLines(undefined)).toEqual([]);
    expect(waitingLines(NOTHING_WAITING)).toEqual([]);
    expect(waitingLines({ unreadMessages: 2, requestsWaiting: 1, invitations: 0 })).toEqual([
      { key: "requests", label: "1 request to connect", href: "/network" },
      { key: "messages", label: "2 unread messages", href: "/network" },
    ]);
    expect(waitingLines({ unreadMessages: 0, requestsWaiting: 0, invitations: 3 })).toEqual([
      { key: "invitations", label: "3 community invitations", href: "/communities" },
    ]);
  });
});

describe("PersonHome (package 2.4)", () => {
  it("leads with Start something, offers finding people beside it, and suggests no one", async () => {
    ideas.mockResolvedValue(NO_IDEAS);
    summary.mockResolvedValue(NOTHING_WAITING);
    renderHome({ liveMode: true });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome, Maya");
    expect(screen.getByTestId("home-start-link").getAttribute("href")).toBe("/new");
    expect(screen.getByTestId("home-find-link").getAttribute("href")).toBe("/network");
    // Solo is complete: the offer says so, and nothing reads as a missing person.
    expect(screen.getByTestId("home-find").textContent).toMatch(
      /Only if you want to: you can do all of it on your own/,
    );
    await waitFor(() => expect(summary).toHaveBeenCalled());
    expect(screen.queryByTestId("home-waiting")).toBeNull();
    expect(screen.queryByTestId("home-concepts")).toBeNull();
    // No people suggestions: the screen never lists anyone.
    expect(screen.queryByText(/suggest|people you may know|recommended people/i)).toBeNull();
  });

  it("with the people layer closed, leaves the find card out (no Opening soon) and reads nothing waiting (WP-04 T15)", async () => {
    ideas.mockResolvedValue(NO_IDEAS);
    renderHome({ liveMode: false });
    expect(screen.queryByTestId("home-find")).toBeNull();
    expect(screen.queryByText("Opening soon")).toBeNull();
    expect(screen.queryByTestId("home-find-link")).toBeNull();
    expect(screen.getByTestId("home-start-link")).toBeTruthy();
    await waitFor(() => expect(ideas).toHaveBeenCalled());
    expect(summary).not.toHaveBeenCalled();
    expect(screen.queryByTestId("home-waiting")).toBeNull();
  });

  it("with the people layer open, the find card is there with its link and no Opening soon (WP-04 T15)", async () => {
    ideas.mockResolvedValue(NO_IDEAS);
    summary.mockResolvedValue(NOTHING_WAITING);
    renderHome({ liveMode: true });
    expect(screen.getByTestId("home-find-link").getAttribute("href")).toBe("/network");
    expect(screen.queryByText("Opening soon")).toBeNull();
  });

  for (const liveMode of [true, false]) {
    it(`Start something goes to /new on a wide screen and to /new/write on a narrow one (liveMode ${liveMode}; WP-04 T15)`, () => {
      ideas.mockResolvedValue(NO_IDEAS);
      summary.mockResolvedValue(NOTHING_WAITING);
      const wide = renderHome({ liveMode });
      expect(screen.getByTestId("home-start-link").getAttribute("href")).toBe("/new");
      wide.unmount();
      setWidth(390);
      renderHome({ liveMode });
      expect(screen.getByTestId("home-start-link").getAttribute("href")).toBe("/new/write");
    });
  }

  it("shows requests and messages only when something is waiting", async () => {
    ideas.mockResolvedValue(NO_IDEAS);
    summary.mockResolvedValue({
      ...NOTHING_WAITING,
      unreadMessages: 1,
      requestsWaiting: 2,
      total: 3,
    });
    renderHome({ liveMode: true });
    const panel = await screen.findByTestId("home-waiting");
    expect(panel.textContent).toMatch(/2 requests to connect/);
    expect(panel.textContent).toMatch(/1 unread message/);
  });

  it("lists the concepts left mid-studio, with Continue to each", async () => {
    ideas.mockResolvedValue({
      items: [
        {
          id: "i1",
          title: "Plant subscription",
          pitch: "Houseplants delivered monthly.",
          current: null,
        },
      ],
      nextCursor: "c2",
    });
    renderHome({ liveMode: false });
    const panel = await screen.findByTestId("home-concepts");
    expect(ideas).toHaveBeenCalledWith({ limit: HOME_CONCEPTS_SHOWN });
    expect(panel.textContent).toMatch(/Plant subscription/);
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toMatch(/i1/);
    expect(
      screen.getByRole("link", { name: "See every concept in the studio" }).getAttribute("href"),
    ).toBe("/new/ideate");
  });

  it("renders at 390 px instead of asking for a larger window", () => {
    ideas.mockResolvedValue(NO_IDEAS);
    setWidth(390);
    renderHome({ liveMode: false });
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
    expect(screen.getByTestId("studio-frame").dataset.smallScreen).toBe("true");
    // WP-04 T15: Start something links to the phone start, never the desktop-only doors.
    expect(screen.queryByTestId("next-step-on-computer")).toBeNull();
    expect(screen.getByTestId("home-start-link").getAttribute("href")).toBe("/new/write");
  });

  it("at 390 px links nowhere desktop-only but the phone start: not the doors, not the studio's list (WP-03 T3, WP-04 T15)", async () => {
    ideas.mockResolvedValue({ items: [{ id: "i1", title: "Plant subscription", pitch: "Plants", current: null }], nextCursor: "c" });
    setWidth(390);
    const { container } = renderHome({ liveMode: false });
    await waitFor(() => expect(screen.getByTestId("home-concepts")).toBeTruthy());
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h === "/new" || h.startsWith("/new/"))).toEqual(["/new/write"]);
    // Each concept's Continue still offers the link by email on a phone.
    expect(screen.getAllByRole("button", { name: "Email me a link" }).length).toBe(1);
  });
});
