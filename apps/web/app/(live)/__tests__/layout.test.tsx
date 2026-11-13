// @vitest-environment happy-dom
/** The LIVE layout (THESIS_REVIEW 2.4): a person with no project gets the person frame, not a redirect to /new. */
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ businesses: [] as { id: string }[], redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));

vi.mock("next/navigation", () => ({ redirect: state.redirect, usePathname: () => "/network" }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof React>()), Suspense: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/trpc-server", () => ({
  serverApi: async () => ({ auth: { email: "robin@example.com", userId: "u1" }, api: { founder: { profile: { get: { query: async () => ({ email: "robin@example.com", profile: { userId: "u1", displayName: "Robin" }, businesses: state.businesses }) } } } } }),
}));
vi.mock("@/lib/auth/server", () => ({ getLastBusinessId: async () => null }));
vi.mock("@/lib/date-format.server", () => ({ getServerDateFormat: async () => ({ prefs: null, owner: null }) }));
vi.mock("@/lib/guidance.server", () => ({ getServerGuidance: async () => ({ prefs: null }) }));
vi.mock("@/lib/shell-data.server", () => ({ startBusinessShell: vi.fn() }));
vi.mock("@/components/providers/DateFormatHost", () => ({ DateFormatHost: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/providers/GuidanceHost", () => ({ GuidanceHost: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/live/PersonLiveFrame", () => ({ PersonLiveFrame: ({ children }: { children: React.ReactNode }) => <div data-testid="person-live-frame">{children}</div> }));
vi.mock("@/components/shell/BusinessShell", () => ({ BusinessShell: ({ children }: { children: React.ReactNode }) => <div data-testid="business-shell">{children}</div> }));
vi.mock("@/components/shell/ShellSkeleton", () => ({ ShellSkeleton: () => null }));
vi.mock("@/components/shell/ApiErrorPage", () => ({ ApiErrorPage: () => null }));
vi.mock("@/components/shell/UnreachablePage", () => ({ UnreachablePage: () => null }));

import LiveLayout from "../layout";

describe("(live) layout", () => {
  it("renders the people pages in the person frame when the person has no project", async () => {
    state.businesses = [];
    // LiveLayout is a sync wrapper around an async server component; call the async part through the wrapper's child.
    const tree = (LiveLayout({ children: <p>network</p> }) as React.ReactElement<{ children: React.ReactElement }>).props.children;
    const out = await (tree.type as (p: unknown) => Promise<React.ReactElement>)(tree.props);
    render(out);
    expect(screen.getByTestId("person-live-frame")).toBeTruthy();
    expect(screen.queryByTestId("business-shell")).toBeNull();
    expect(screen.getByText("network")).toBeTruthy();
    expect(state.redirect).not.toHaveBeenCalled();
  });
});
