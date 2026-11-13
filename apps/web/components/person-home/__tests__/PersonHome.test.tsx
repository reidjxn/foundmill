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

  it("with the people layer closed, the find card says it opens soon, with no link, and reads nothing waiting", async () => {
    ideas.mockResolvedValue(NO_IDEAS);
    renderHome({ liveMode: false });
    expect(screen.getByTestId("home-find-soon").textContent).toBe("Opening soon");
    expect(screen.queryByTestId("home-find-link")).toBeNull();
    expect(screen.getByTestId("home-start-link")).toBeTruthy();
    await waitFor(() => expect(ideas).toHaveBeenCalled());
    expect(summary).not.toHaveBeenCalled();
    expect(screen.queryByTestId("home-waiting")).toBeNull();
  });

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
    expect(screen.getByTestId("home-start-link")).toBeTruthy();
  });
});
