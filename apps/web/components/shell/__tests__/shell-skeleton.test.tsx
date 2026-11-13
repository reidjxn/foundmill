import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname: string | null = "/b/b1e5e5e5-0000-4000-8000-000000000001/crm";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { ShellSkeleton } from "../ShellSkeleton";

const NORTHWIND = "b1e5e5e5-0000-4000-8000-000000000001";

describe("ShellSkeleton (package 2.1)", () => {
  it("keeps the 1280 px floor and the rail on a console route", () => {
    pathname = `/b/${NORTHWIND}/crm`;
    render(<ShellSkeleton />);
    const root = screen.getByTestId("shell-skeleton");
    expect(root.className).toContain("min-w-(--min-viewport)");
    expect(root.firstElementChild!.className).not.toContain("hidden");
  });

  it.each([`/b/${NORTHWIND}/today`, `/b/${NORTHWIND}/inbox`, `/b/${NORTHWIND}/inbox/9f1c2a64-0000-4000-8000-000000000009`])("drops the floor and hides the rail below it on %s", (path) => {
    pathname = path;
    render(<ShellSkeleton />);
    const root = screen.getByTestId("shell-skeleton");
    expect(root.className).not.toContain("min-w-(--min-viewport)");
    expect(root.className).toContain("@container");
    expect(root.firstElementChild!.className).toContain("@max-[1279px]:hidden");
  });
});
