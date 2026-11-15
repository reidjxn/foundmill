/**
 * <BusinessTitle> (audit WEB-5, WEB-9): the browser title inside a business comes from what the shell holds, with no
 * request of its own, and React hoists it into the document head. A CRM record's name is read from the record query
 * its screen runs; the title never asks for it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, type AppRouter } from "@/lib/trpc";
import { TRPCProvider } from "@/lib/trpc-react";
import { BusinessProvider, makeBusinessContext, type BusinessGet, type DepartmentList } from "../business-context";
import { shellQueryInputs } from "@/lib/shell-queries";
import { BusinessTitle } from "../BusinessTitle";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const BID = "b1e5e5e5-0000-4000-8000-000000000001";
const ENTITY = "e1e5e5e5-0000-4000-8000-000000000001";
const business = (name: string) => ({ business: { id: BID, name, currency: "USD", glossary: {} }, role: "owner", membership: null }) as unknown as BusinessGet;
const DEPARTMENTS = [{ id: "d1", slug: "finance", name: "Finance", tabs: [{ slug: "overview", title: "Overview" }], squad: [{ id: "a1", name: "Mara" }] }] as unknown as DepartmentList;

const fetchSpy = vi.fn<typeof fetch>();

function setup(queryClient = new QueryClient()) {
  const client = createApiClient({ getToken: () => null, url: "http://api.test/trpc", fetch: fetchSpy });
  const view = (name: string) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>
        <BusinessProvider value={makeBusinessContext(BID, business(name), DEPARTMENTS)}>
          <BusinessTitle />
        </BusinessProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
  return { queryClient, client, view };
}

afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
});

describe("BusinessTitle", () => {
  it("names the screen, the business and the product, and follows navigations and renames", () => {
    const { view } = setup();
    pathname = `/b/${BID}/inbox`;
    const { rerender } = render(view("Northwind Skincare"));
    expect(document.title).toBe("Inbox · Northwind Skincare · Foundmill");
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
    pathname = `/b/${BID}/d/finance/overview`;
    rerender(view("Northwind Skincare"));
    expect(document.title).toBe("Overview · Finance · Northwind Skincare · Foundmill");
    pathname = `/b/${BID}/agents/a1/training`;
    rerender(view("Northwind"));
    expect(document.title).toBe("Training · Mara · Northwind · Foundmill");
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removes the server's streamed copy that React did not take over, so the document holds one title", () => {
    // What the server leaves: an icon's SVG title first, then the streamed page title at the end of the body.
    document.body.insertAdjacentHTML("afterbegin", '<svg><title>Chart</title></svg>');
    document.body.insertAdjacentHTML("beforeend", "<title>Inbox · Northwind Skincare · Foundmill</title>");
    const { view } = setup();
    pathname = `/b/${BID}/inbox`;
    render(view("Northwind Skincare"));
    const htmlTitles = [...document.querySelectorAll("title")].filter((t) => !t.closest("svg"));
    expect(htmlTitles).toHaveLength(1);
    expect(htmlTitles[0]!.parentElement).toBe(document.head);
    expect(document.title).toBe("Inbox · Northwind Skincare · Foundmill");
    expect(document.querySelector("svg title")?.textContent).toBe("Chart");
    document.querySelector("svg")?.remove();
  });

  it("names a CRM record once its screen has loaded it, and never asks for it itself", async () => {
    const { queryClient, client, view } = setup();
    pathname = `/b/${BID}/crm/${ENTITY}/activity`;
    render(view("Northwind Skincare"));
    expect(document.title).toBe("Activity · Contacts · Northwind Skincare · Foundmill");
    const trpc = createTRPCOptionsProxy<AppRouter>({ client, queryClient });
    await act(async () => {
      queryClient.setQueryData(trpc.crm.entity.get.queryKey({ businessId: BID, entityId: ENTITY }), { entity: { displayName: "Acme Ltd" } } as never);
    });
    await waitFor(() => expect(document.title).toBe("Activity · Acme Ltd · Northwind Skincare · Foundmill"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("puts how many things need the founder in front, from the shell's Inbox read", async () => {
    const { queryClient, client, view } = setup();
    pathname = `/b/${BID}/today`;
    render(view("Northwind Skincare"));
    const trpc = createTRPCOptionsProxy<AppRouter>({ client, queryClient });
    await act(async () => {
      queryClient.setQueryData(trpc.inbox.list.queryKey(shellQueryInputs(BID).inbox), { items: [], counts: { respond: 2 } } as never);
    });
    await waitFor(() => expect(document.title).toBe("(2) Today · Northwind Skincare · Foundmill"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
