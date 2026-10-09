// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { ConnectionsPanel, RequestsPanel, SentRequestsPanel, type ConnectionRow } from "../ConnectionPanels";
import type { People } from "../shared";
import { ids } from "./fake-trpc";

const NOW = new Date();
const row = (id: string, from: string, to: string, status: ConnectionRow["status"], message: string | null = null): ConnectionRow => ({ id, fromUser: from, toUser: to, status, message, respondedAt: status === "requested" ? null : NOW, createdAt: NOW });
const NAMES: Record<string, string | null> = { [ids.ana]: "Ana Ruiz", [ids.ben]: "Ben Okoye", [ids.cal]: null };
const people: People = { person: (id) => ({ userId: id, displayName: NAMES[id] ?? null }), business: () => undefined, name: (id) => NAMES[id] ?? "A founder", loading: false };
const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

afterEach(cleanup);

describe("RequestsPanel", () => {
  it("lists each request with the sender's note and Accept and Block that act on that row", () => {
    const onAccept = vi.fn();
    const onBlock = vi.fn();
    const rows = [row("r1", ids.ana, ids.me, "requested", "Saw your post on first touch."), row("r2", ids.cal, ids.me, "requested")];
    wrap(<RequestsPanel rows={rows} viewerId={ids.me} people={people} onAccept={onAccept} onBlock={onBlock} />);
    const items = screen.getAllByTestId("request-row");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Ana Ruiz");
    expect(items[0]!.textContent).toContain("Saw your post on first touch.");
    expect(items[1]!.textContent).toContain("A founder");
    expect(screen.getByText("2 waiting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept Ana Ruiz" }));
    expect(onAccept).toHaveBeenCalledWith(rows[0]);
    fireEvent.click(screen.getByRole("button", { name: "Block A founder" }));
    expect(onBlock).toHaveBeenCalledWith(rows[1]);
  });

  it("waits on the row a mutation is working on", () => {
    const rows = [row("r1", ids.ana, ids.me, "requested")];
    wrap(<RequestsPanel rows={rows} viewerId={ids.me} people={people} busyId="r1" />);
    expect((screen.getByRole("button", { name: "Accept Ana Ruiz" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Block Ana Ruiz" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says what will appear when nobody is waiting, and shows a failure with a retry", () => {
    const { rerender } = wrap(<RequestsPanel rows={[]} viewerId={ids.me} people={people} />);
    expect(screen.getByText(/No requests waiting/)).toBeTruthy();
    const onRetry = vi.fn();
    rerender(
      <TooltipProvider>
        <RequestsPanel rows={[]} viewerId={ids.me} people={people} error="The API did not answer." onRetry={onRetry} />
      </TooltipProvider>,
    );
    expect(screen.getByText("The API did not answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("SentRequestsPanel", () => {
  it("shows who the founder asked and lets them withdraw it", () => {
    const onRemove = vi.fn();
    const rows = [row("s1", ids.me, ids.ben, "requested")];
    wrap(<SentRequestsPanel rows={rows} viewerId={ids.me} people={people} onRemove={onRemove} />);
    expect(screen.getByTestId("sent-request-row").textContent).toContain("Ben Okoye");
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request to Ben Okoye" }));
    expect(onRemove).toHaveBeenCalledWith(rows[0]);
  });
  it("has an empty state", () => {
    wrap(<SentRequestsPanel rows={[]} viewerId={ids.me} people={people} />);
    expect(screen.getByText(/Requests you send wait here/)).toBeTruthy();
  });
});

describe("ConnectionsPanel", () => {
  const rows = [row("c1", ids.ana, ids.me, "accepted", "Met at the meetup."), row("c2", ids.me, ids.ben, "accepted"), row("c3", ids.cal, ids.me, "blocked")];

  it("opens on the Connected view: accepted people only, with the note they came with", () => {
    wrap(<ConnectionsPanel rows={rows} viewerId={ids.me} people={people} />);
    const grid = screen.getByRole("grid", { name: "Connections" });
    const body = within(grid).getAllByRole("row").slice(1);
    expect(body).toHaveLength(2);
    expect(body.map((r) => r.textContent).join(" ")).toContain("Ana Ruiz");
    expect(body.map((r) => r.textContent).join(" ")).toContain("Met at the meetup.");
    expect(body.map((r) => r.textContent).join(" ")).not.toContain("A founder");
    expect(screen.getByText("2 connections")).toBeTruthy();
  });

  it("offers Message, Block and Remove on a right-click, and Unblock for a blocked person", () => {
    const onMessage = vi.fn();
    const onBlock = vi.fn();
    const onRemove = vi.fn();
    wrap(<ConnectionsPanel rows={rows} viewerId={ids.me} people={people} onMessage={onMessage} onBlock={onBlock} onRemove={onRemove} />);
    const first = within(screen.getByRole("grid", { name: "Connections" })).getAllByRole("row")[1]!;
    fireEvent.contextMenu(first);
    expect(screen.getByRole("menuitem", { name: /Message/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Block/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove connection/ }));
    expect(onRemove).toHaveBeenCalledWith(rows[0]);
  });

  it("Enter on a connection opens a message to them", () => {
    const onMessage = vi.fn();
    wrap(<ConnectionsPanel rows={rows} viewerId={ids.me} people={people} onMessage={onMessage} />);
    const grid = screen.getByRole("grid", { name: "Connections" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onMessage).toHaveBeenCalledWith(rows[0]);
  });

  it("explains what will appear when there are no connections", () => {
    wrap(<ConnectionsPanel rows={[]} viewerId={ids.me} people={people} />);
    expect(screen.getByText(/No connections yet/)).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
  });
});
