import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK_RELOAD_KEY } from "@/lib/chunk-error";
import { FALLBACK_ERROR_LINE, isPlainMessage } from "../ErrorPanel";
import { RouteError, UPDATED_RELOAD_LINE, UPDATED_RELOADING_LINE } from "../RouteError";

const CHUNK_MESSAGE = "Failed to load chunk /_next/static/chunks/2dldrprwzv1ji.js from module 47731";

function chunkError(): Error {
  return Object.assign(new Error(CHUNK_MESSAGE), { name: "ChunkLoadError" });
}

describe("RouteError (audit RES-06)", () => {
  const reload = vi.fn();
  const originalLocation = window.location;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    reload.mockReset();
    vi.restoreAllMocks();
  });

  it("never shows the raw chunk message as the founder's line", () => {
    expect(isPlainMessage(CHUNK_MESSAGE)).toBe(false);
  });

  it("reloads the page once for a chunk that failed to load, in product words", () => {
    render(<RouteError error={chunkError()} retry={vi.fn()} scope="business" />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    expect(screen.getByText(UPDATED_RELOADING_LINE)).toBeTruthy();
    // The technical text stays behind Details; the founder's line is the product sentence.
    expect(screen.getByRole("alert").querySelector("p")?.textContent).toBe(UPDATED_RELOADING_LINE);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("offers a manual Reload (not a re-render) when the reload just ran and the chunk is still missing", () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    const retry = vi.fn();
    render(<RouteError error={chunkError()} retry={retry} scope="business" />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(UPDATED_RELOAD_LINE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("Try again re-fetches the segment (retry) for any other error", () => {
    const retry = vi.fn();
    render(<RouteError error={new TypeError("Cannot read properties of undefined (reading 'x')")} retry={retry} scope="business" />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(FALLBACK_ERROR_LINE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
