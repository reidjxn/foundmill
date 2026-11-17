// @vitest-environment happy-dom
/**
 * "On Foundmill" (audits GLS2F-09, LS2-06): finding founders and businesses by name, opening their profile page, asking a
 * founder to connect from it, and the typeahead group in the CRM search.
 */
import { TRPCClientError } from "@trpc/client";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeApi } from "./fake-trpc";

const api = vi.hoisted(() => ({ handlers: {}, calls: [] }) as FakeApi);
const ctx = vi.hoisted(() => ({ gameMode: "live" as "live" | "personal", noBusiness: false, push: vi.fn() }));
vi.mock("@/lib/trpc-react", async () => {
  const { fakeTrpc } = await import("./fake-trpc");
  return { useTRPC: () => fakeTrpc(api) };
});
vi.mock("@/components/shell/business-context", () => {
  const value = () => ({ businessId: "b1", data: { business: { name: "Ledgerly", gameMode: ctx.gameMode } } });
  return { useBusiness: value, useOptionalBusiness: () => (ctx.noBusiness ? null : value()) };
});
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ctx.push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));

import { OnNetworkResults } from "../public-search";
import { PeopleSearchPanel } from "../PeopleSearchPanel";
import { ProfileScreen } from "../ProfileScreen";
import { LiveViewerProvider } from "../viewer";
import { callsTo, ids, renderWithProviders } from "./fake-trpc";

const AT = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const hit = (over: Record<string, unknown>) => ({ kind: "founder", businessId: ids.business, userId: ids.ana, name: "Ana Ruiz", slug: null, archetype: null, kitPrimary: null, kitSecondary: null, region: null, since: null, ...over });
const BUSINESS_HIT = hit({ kind: "business", userId: null, name: "Northlight Payments", slug: "northlight", archetype: "b2b_saas", kitPrimary: "#1F6FEB", kitSecondary: "#F5B841", region: "eu", since: AT(5000) });
const FOUNDER_HIT = hit({});
const mount = (ui: ReactElement) => renderWithProviders(<LiveViewerProvider value={{ userId: ids.me, displayName: "Jamie Reyes" }}>{ui}</LiveViewerProvider>);

beforeEach(() => {
  api.handlers = {};
  api.calls = [];
  ctx.noBusiness = false;
  ctx.gameMode = "live";
  ctx.push.mockClear();
});
afterEach(cleanup);

describe("find on Foundmill", () => {
  it("searches public profiles by name, labels every hit 'On Foundmill' and opens the profile page", async () => {
    api.handlers["live.people.search"] = (v) => ({ hits: (v as { q: string }).q.toLowerCase().startsWith("n") ? [BUSINESS_HIT, FOUNDER_HIT] : [] });
    mount(<PeopleSearchPanel />);
    const panel = screen.getByTestId("people-search");
    expect(within(panel).getByText(/Type at least 2 letters/)).toBeTruthy();
    const field = screen.getByLabelText("Search Foundmill by name");
    fireEvent.change(field, { target: { value: "n" } });
    expect(callsTo(api, "live.people.search")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "Nor" } });
    const results = await screen.findByTestId("people-search-results");
    expect(callsTo(api, "live.people.search")).toEqual([{ q: "Nor", limit: 8 }]);
    const rows = within(results).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["Northlight PaymentsBusiness · b2b saasOn Foundmill", "Ana RuizFounderOn Foundmill"]);
    fireEvent.click(rows[0]!);
    expect(ctx.push).toHaveBeenCalledWith(`/profiles/business/${ids.business}`);
    fireEvent.click(rows[1]!);
    expect(ctx.push).toHaveBeenLastCalledWith(`/profiles/founder/${ids.ana}`);

    fireEvent.change(field, { target: { value: "Zed" } });
    expect(await screen.findByTestId("people-search-empty")).toBeTruthy();
  });

  it("the CRM typeahead shows the same hits under an 'On Foundmill' heading instead of a promise", async () => {
    api.handlers["live.people.search"] = () => ({ hits: [FOUNDER_HIT] });
    mount(<OnNetworkResults text="Ana" />);
    const group = await screen.findByTestId("crm-on-network");
    expect(group.getAttribute("aria-label")).toBe("On Foundmill");
    expect(await within(group).findByText("Ana Ruiz")).toBeTruthy();
    expect(group.textContent).not.toMatch(/appear here/);
    cleanup();
    mount(<OnNetworkResults text="A" />);
    expect(screen.queryByTestId("crm-on-network")).toBeNull();
  });
});

describe("/profiles/[kind]/[id]", () => {
  const founderProfile = (connection: unknown = null, isSelf = false) => ({
    profile: FOUNDER_HIT,
    businesses: [BUSINESS_HIT],
    founders: [FOUNDER_HIT],
    isSelf,
    connection,
  });

  it("a founder: the businesses they run, and Connect asks as the current business", async () => {
    api.handlers["live.people.profile"] = () => founderProfile();
    api.handlers["live.connections.request"] = () => ({ id: "c-new", status: "requested" });
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    const header = await screen.findByTestId("profile-screen");
    expect(header.getAttribute("data-kind")).toBe("founder");
    expect(callsTo(api, "live.people.profile")[0]).toEqual({ kind: "founder", id: ids.ana });
    const businesses = screen.getByTestId("profile-businesses");
    expect(within(businesses).getByText("Northlight Payments")).toBeTruthy();
    expect(screen.getAllByText("On Foundmill").length).toBeGreaterThan(0);
    fireEvent.click(within(businesses).getByText("Northlight Payments"));
    expect(ctx.push).toHaveBeenCalledWith(`/profiles/business/${ids.business}`);

    fireEvent.click(screen.getByTestId("profile-connect"));
    await waitFor(() => expect(callsTo(api, "live.connections.request")).toEqual([{ businessId: "b1", toUserId: ids.ana }]));
  });

  it("shows a request in flight, an accepted connection and one's own profile without a Connect button", async () => {
    api.handlers["live.people.profile"] = () => founderProfile({ id: "c1", status: "requested", direction: "outgoing" });
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    expect((await screen.findByTestId("profile-requested")).textContent).toBe("Request sent");
    expect(screen.queryByTestId("profile-connect")).toBeNull();
    cleanup();

    api.handlers["live.people.profile"] = () => founderProfile({ id: "c1", status: "accepted", direction: "incoming" });
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    await screen.findByTestId("profile-message");
    cleanup();

    api.handlers["live.people.profile"] = () => founderProfile(null, true);
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    await screen.findByTestId("profile-screen");
    expect(screen.queryByTestId("profile-connect")).toBeNull();
  });

  it("Report (and block in the same step) on another founder's profile; never on one's own (NETWORK F21)", async () => {
    api.handlers["live.people.profile"] = () => founderProfile();
    api.handlers["report.create"] = () => ({ reported: true, blocked: true });
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    fireEvent.click(await screen.findByTestId("profile-report-open"));
    const dialog = await screen.findByTestId("report-person-dialog");
    fireEvent.click(within(dialog).getByTestId("report-person-block"));
    fireEvent.click(within(dialog).getByTestId("report-person-send"));
    await waitFor(() => expect(callsTo(api, "report.create")).toEqual([{ target: { kind: "person", userId: FOUNDER_HIT.userId }, reason: "spam", note: undefined, block: true }]));
    cleanup();

    api.handlers["live.people.profile"] = () => founderProfile(null, true);
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    await screen.findByTestId("profile-screen");
    expect(screen.queryByTestId("profile-report-open")).toBeNull();
  });

  it("a Personal business explains why Connect is off", async () => {
    ctx.gameMode = "personal";
    api.handlers["live.people.profile"] = () => founderProfile();
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    const connect = await screen.findByTestId("profile-connect");
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("profile-connect-note").textContent).toMatch(/live business/);
  });

  it("with no project the Connect button and its note are not drawn, and no notice names a business", async () => {
    ctx.noBusiness = true;
    api.handlers["live.people.profile"] = () => founderProfile();
    mount(<ProfileScreen kind="founder" id={ids.ana} />);
    await screen.findByTestId("profile-screen");
    expect(screen.queryByTestId("profile-connect")).toBeNull();
    expect(screen.queryByTestId("profile-connect-note")).toBeNull();
    expect(screen.queryByTestId("personal-notice")).toBeNull();
  });

  it("a business: its public founders, and a missing or private profile says so", async () => {
    api.handlers["live.people.profile"] = () => ({ profile: BUSINESS_HIT, businesses: [BUSINESS_HIT], founders: [FOUNDER_HIT], isSelf: false, connection: null });
    mount(<ProfileScreen kind="business" id={ids.business} />);
    const founders = await screen.findByTestId("profile-founders");
    expect(within(founders).getByText("Ana Ruiz")).toBeTruthy();
    expect(screen.queryByTestId("profile-connect")).toBeNull();
    cleanup();

    api.handlers["live.people.profile"] = () => {
      throw new TRPCClientError("Not found", { result: { error: { message: "Not found", code: -32004, data: { code: "NOT_FOUND" } } } as never });
    };
    mount(<ProfileScreen kind="business" id={ids.business} />);
    const missing = await screen.findByTestId("profile-missing");
    expect(missing.textContent).toMatch(/No such profile/);
    fireEvent.click(within(missing).getByRole("button", { name: "Back to Network" }));
    expect(ctx.push).toHaveBeenCalledWith("/network");
  });
});
