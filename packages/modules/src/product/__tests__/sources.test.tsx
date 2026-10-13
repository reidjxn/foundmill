import "./setup";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IMPORT_POLL_MS, SourcesScreen } from "../SourcesScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { readState, summaryLine } from "../sources/kinds";
import type { SourceRow } from "../types";
import { BID, BLOCK, dataResponses, emptyResponses, sources } from "./fixtures";

const departments = [{ id: "d1", name: "Product", slug: "product", colourToken: "dept-1", position: 0, moduleKeys: ["product"], lead: null, squad: [], tabs: [{ id: "t1", slug: "specification", title: "Specification", position: 1 }] }];
const responses = { ...dataResponses, "department.list": departments };

describe("SourcesScreen", () => {
  it("renders every source with its kind chip, summary, linked blocks and kind counts", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const table = screen.getByRole("grid", { name: "Sources" });
    expect(within(table).getByText(/Customer interview 7/)).toBeTruthy();
    expect(within(table).getByText("Invoicely")).toBeTruthy();
    expect(within(table).getByText(/Reminder sent twice/)).toBeTruthy();
    expect(within(table).getByText("EU e-invoicing directive note")).toBeTruthy();
    expect(within(table).getAllByText("Interview").length).toBeGreaterThan(0);
    expect(within(table).getByText(/Wants annual billing/)).toBeTruthy();
    const filters = screen.getByRole("group", { name: "Filter by kind" });
    expect(within(filters).getByRole("button", { name: /Competitor 1/ })).toBeTruthy();
    expect(screen.getByText(/4 sources ·/)).toBeTruthy();
  });

  it("says where the Source Watcher is with a source that has no summary yet", () => {
    const rows = [
      ...sources,
      { id: "00000000-0000-4000-8000-0000000000a1", kind: "competitor" as const, uri: "https://blocked.example/pricing", title: "Blocked page", contentRef: null, relevance: { watch: { status: "unreachable", reason: "The site's robots.txt does not allow reading this page." } }, fetchedAt: null, createdAt: "2026-10-06T10:00:00Z" },
    ];
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "product.sources.list": { items: rows, nextCursor: null } } });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const table = screen.getByRole("grid", { name: "Sources" });
    expect(within(table).getByText("Could not read it: The site's robots.txt does not allow reading this page.")).toBeTruthy();
    // The issue has linked blocks but no summary and was never read: it waits for the watcher.
    expect(within(table).getByText("Waiting for the Source Watcher to read it")).toBeTruthy();
    expect(readState(rows.at(-1)!)).toEqual({ state: "unreachable", reason: "The site's robots.txt does not allow reading this page." });
    expect(readState({ relevance: { watch: { status: "scored" } }, fetchedAt: null }).state).toBe("read");
    expect(summaryLine({ relevance: { watch: { status: "failed" } }, fetchedAt: null })).toMatch(/tries again on the next sweep/);
  });

  it("says whether each imported source was read, and labels a summary nobody read Estimate (Door B)", () => {
    const at = "2026-10-05T10:00:00Z";
    const imported: SourceRow[] = [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", kind: "doc", uri: "https://github.com/acme/ledgerly", title: "GitHub import: acme/ledgerly", contentRef: null, relevance: { import: { key: "github", status: "read" }, imported: true, connector: "github", tool: "read_tree" }, fetchedAt: at, createdAt: at },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", kind: "finance", uri: "https://dashboard.stripe.com/", title: "Stripe import", contentRef: null, relevance: { import: { key: "stripe", status: "pending" } }, fetchedAt: null, createdAt: at },
      { id: "aaaaaaaa-0000-4000-8000-000000000003", kind: "issue", uri: "https://linear.app/", title: "Linear import", contentRef: null, relevance: { import: { key: "linear", status: "failed" }, imported: false, reason: "no import reader for this source yet" }, fetchedAt: null, createdAt: at },
      // Stored by the sign-up simulation before the fix: "done", an invented summary, never fetched.
      { id: "aaaaaaaa-0000-4000-8000-000000000004", kind: "finance", uri: "https://admin.shopify.com/", title: "Shopify import", contentRef: null, relevance: { import: { key: "shopify", status: "done", provenance: "Estimate" }, summary: "164 orders, 12 products" }, fetchedAt: null, createdAt: at },
    ];
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "product.sources.list": { items: imported, nextCursor: null } } });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const table = screen.getByRole("grid", { name: "Sources" });
    const stateOf = (title: string) => within(table).getByText(title).closest("[role='row']")!.querySelector("[data-import-state]")!.getAttribute("data-import-state");
    expect(stateOf("GitHub import: acme/ledgerly")).toBe("read");
    expect(stateOf("Stripe import")).toBe("pending");
    expect(stateOf("Linear import")).toBe("not_read");
    expect(stateOf("Shopify import")).toBe("not_read");
    expect(within(table).getByText("Read through github (read_tree), read only.")).toBeTruthy();
    expect(within(table).getByText("Not read: no import reader for this source yet.")).toBeTruthy();
    const shopify = within(table).getByText("Shopify import").closest("[role='row']") as HTMLElement;
    expect(within(shopify).getByText("Estimate")).toBeTruthy();
    expect(within(table).getAllByText("Estimate")).toHaveLength(1);
  });

  it("reads again the imported sources that were not read: Read now on the panel and in a row's menu (Door B)", async () => {
    const user = userEvent.setup();
    const at = "2026-10-05T10:00:00Z";
    const LINEAR = "aaaaaaaa-0000-4000-8000-000000000003";
    const STRIPE = "aaaaaaaa-0000-4000-8000-000000000002";
    const imported: SourceRow[] = [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", kind: "doc", uri: "https://github.com/acme/ledgerly", title: "GitHub import: acme/ledgerly", contentRef: null, relevance: { import: { key: "github", status: "read" }, imported: true, connector: "github", tool: "read_tree" }, fetchedAt: at, createdAt: at },
      { id: STRIPE, kind: "finance", uri: "https://dashboard.stripe.com/", title: "Stripe import", contentRef: null, relevance: { import: { key: "stripe", status: "failed" }, imported: false, reason: "Stripe is not connected for this business; connect it in Settings › Integrations" }, fetchedAt: null, createdAt: at },
      { id: LINEAR, kind: "issue", uri: "https://linear.app/", title: "Linear import", contentRef: null, relevance: { import: { key: "linear", status: "failed" }, imported: false, reason: "the import has no reader for this source yet" }, fetchedAt: null, createdAt: at },
    ];
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "product.sources.list": { items: imported, nextCursor: null } }, onMutate: () => ({ sourceIds: [], workflow: { queued: true, workflowId: "import:x" } }) });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const button = screen.getByTestId("read-imports-now");
    expect(button.textContent).toBe("Read now · 2");
    await user.click(button);
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "import.readAgain", input: { sourceIds: [STRIPE, LINEAR] } }));
    await waitFor(() => expect(fake.refetches["product.sources.list"]).toBeGreaterThan(0));

    const table = screen.getByRole("grid", { name: "Sources" });
    fireEvent.contextMenu(within(table).getByText("GitHub import: acme/ledgerly"));
    expect(within(await screen.findByRole("menu")).queryByRole("menuitem", { name: "Read now" })).toBeNull();
    await user.keyboard("{Escape}");
    fireEvent.contextMenu(within(table).getByText("Linear import"));
    await user.click(await screen.findByRole("menuitem", { name: "Read now" }));
    await waitFor(() => expect(fake.mutations[1]).toEqual({ path: "import.readAgain", input: { sourceIds: [LINEAR] } }));
  });

  it("shows no Read now when every imported source was read, and polls only while an import is still reading", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(screen.queryByTestId("read-imports-now")).toBeNull();
    expect(fake.intervals["product.sources.list"]).toBeUndefined();
    const at = "2026-10-05T10:00:00Z";
    act(() => fake.setResponse("product.sources.list", { items: [{ id: "aaaaaaaa-0000-4000-8000-000000000009", kind: "doc", uri: "https://github.com/acme/ledgerly", title: "GitHub import: acme/ledgerly", contentRef: null, relevance: { import: { key: "github", status: "pending" } }, fetchedAt: null, createdAt: at }], nextCursor: null }));
    expect(fake.intervals["product.sources.list"]).toBe(IMPORT_POLL_MS);
  });

  it("filters by kind through the query input and navigates to a linked spec block", () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by kind" })).getByRole("button", { name: /Issue/ }));
    expect(fake.queried.get("product.sources.list")).toEqual({ kind: "issue", limit: 200 });
    fireEvent.click(within(screen.getByRole("grid", { name: "Sources" })).getByRole("button", { name: /Automatic reminders/ }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/product/specification?block=${BLOCK.features}`);
  });

  it("adds a source through product.sources.add and refetches", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a source" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    });
    expect(within(dialog).getAllByRole("alert").some((a) => /title or a link/.test(a.textContent ?? ""))).toBe(true);
    expect(fake.mutations).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Pricing page" } });
    fireEvent.change(within(dialog).getByLabelText(/Link/), { target: { value: "https://rival.example/pricing" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "Annual plan 20% off" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add source" }));
    });
    expect(fake.mutations[0]).toEqual({ path: "product.sources.add", input: { kind: "doc", uri: "https://rival.example/pricing", title: "Pricing page", relevance: { notes: "Annual plan 20% off" } } });
    expect(fake.refetches["product.sources.list"]).toBe(1);
  });

  it("removes a source from the right-click menu after a confirmation, and counts in the singular (TPD-30)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: { ...responses, "product.sources.list": { items: [sources[1]!], nextCursor: null } } });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText(/^1 source ·/)).toBeTruthy();
    fireEvent.contextMenu(within(screen.getByRole("grid", { name: "Sources" })).getByText("Invoicely"));
    await user.click(await screen.findByRole("menuitem", { name: "Remove source" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this source?" });
    expect(within(dialog).getByText(/Invoicely/)).toBeTruthy();
    expect(fake.mutations).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Remove source" }));
    await waitFor(() => expect(fake.mutations).toEqual([{ path: "product.sources.remove", input: { sourceId: sources[1]!.id } }]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove this source?" })).toBeNull());
    expect(fake.refetches["product.sources.list"]).toBe(1);
  });

  it("offers no Add or Remove to people who may only read Product", async () => {
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />, { canWrite: () => false });
    expect(screen.queryByRole("button", { name: "Add source" })).toBeNull();
    fireEvent.contextMenu(within(screen.getByRole("grid", { name: "Sources" })).getByText("Invoicely"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Remove source" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Open link" })).toBeTruthy();
  });

  it("opens the link in a new tab when a row is opened", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const fake = createFakeSource({ businessId: BID, responses });
    renderScreen(fake, <SourcesScreen businessId={BID} departmentId="d1" />);
    const row = within(screen.getByRole("grid", { name: "Sources" })).getByText("Invoicely").closest("[role='row']")!;
    fireEvent.doubleClick(row);
    expect(open).toHaveBeenCalledWith("https://invoicely.example.com/pricing", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("shows the empty, loading and error states", () => {
    const empty = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "department.list": [] } });
    renderScreen(empty, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("No sources yet")).toBeTruthy();
    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "product.sources.list": new Error("sources down") } });
    renderScreen(failing, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("sources down")).toBeTruthy();
    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <SourcesScreen businessId={BID} departmentId="d1" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
