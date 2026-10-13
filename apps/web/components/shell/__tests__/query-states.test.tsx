// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push }) }));

import { NotFoundPanel, RefreshFailedNotice, isMissing, loadFailed, refreshFailed } from "../QueryStates";

const error = (code: string, message = "boom") => new TRPCClientError(message, { result: { error: { code: -32004, message, data: { code, httpStatus: 404 } } } } as never);

describe("query states (audit RES-04, IAE-16)", () => {
  it("a failed first load shows the error panel; a failed refetch keeps the data on screen", () => {
    expect(loadFailed({ error: error("INTERNAL_SERVER_ERROR"), data: undefined })).toBe(true);
    expect(refreshFailed({ error: error("INTERNAL_SERVER_ERROR"), data: undefined })).toBe(false);
    // TanStack keeps `data` when a refetch fails and sets `error`: the loaded list stays.
    expect(loadFailed({ error: error("INTERNAL_SERVER_ERROR"), data: { items: [1, 2, 3] } })).toBe(false);
    expect(refreshFailed({ error: error("INTERNAL_SERVER_ERROR"), data: { items: [1, 2, 3] } })).toBe(true);
    expect(loadFailed({ error: null, data: undefined })).toBe(false);
    expect(refreshFailed({ error: null, data: [] })).toBe(false);
    // An empty list is data too.
    expect(loadFailed({ error: error("INTERNAL_SERVER_ERROR"), data: [] })).toBe(false);
  });

  it("tells a record that is not there from a failure", () => {
    expect(isMissing(error("NOT_FOUND"))).toBe(true);
    expect(isMissing(error("INTERNAL_SERVER_ERROR"))).toBe(false);
    expect(isMissing(new Error("x"))).toBe(false);
  });

  it("the refresh notice is a quiet status line with a Retry that refetches", () => {
    const refetch = vi.fn();
    render(<RefreshFailedNotice query={{ error: error("INTERNAL_SERVER_ERROR"), data: [1], refetch }} />);
    expect(screen.getByRole("status").textContent).toContain("Couldn't refresh");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a missing record says so with the way back and no Try again", () => {
    render(
      <NotFoundPanel title="Agent profile" heading="No such agent" back={{ label: "Back to Agents", href: "/b/x/d/team/squad" }}>
        No agent has this address.
      </NotFoundPanel>,
    );
    expect(screen.getByText("No such agent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to Agents" }));
    expect(push).toHaveBeenCalledWith("/b/x/d/team/squad");
  });
});
