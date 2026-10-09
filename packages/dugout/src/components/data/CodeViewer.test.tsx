import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatBytes } from "../../lib/format";
import { CodeViewer } from "./CodeViewer";

describe("CodeViewer", () => {
  it("shows the path, size, line count, numbered lines and the text", () => {
    const { container } = render(<CodeViewer path="src/a.ts" text={"const a = 1;\nconst b = 2;\n"} size={26} />);
    expect(screen.getByRole("region", { name: "File src/a.ts" })).toBeTruthy();
    expect(screen.getByText("2 lines")).toBeTruthy();
    expect(screen.getByText("26 B")).toBeTruthy();
    const [gutter, code] = Array.from(container.querySelectorAll("[data-code-body] pre"));
    expect(gutter?.textContent).toBe("1\n2");
    expect(gutter?.getAttribute("aria-hidden")).toBe("true");
    expect(code?.textContent).toBe("const a = 1;\nconst b = 2;\n");
  });

  it("says when a file is binary or only partly shown", () => {
    const { rerender } = render(<CodeViewer path="logo.png" text={null} binary size={2048} />);
    expect(screen.getByText(/binary file/)).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
    rerender(<CodeViewer path="big.json" text={"{"} truncated size={3 * 1024 * 1024} />);
    expect(screen.getByText("Showing the first 1 MB of this file.")).toBeTruthy();
    expect(screen.getByText("3 MB")).toBeTruthy();
  });

  it("formats sizes", () => {
    expect([formatBytes(0), formatBytes(1023), formatBytes(1536), formatBytes(34 * 1024 + 100), formatBytes(5 * 1024 * 1024), formatBytes(-1)]).toEqual(["0 B", "1023 B", "1.5 KB", "34 KB", "5 MB", "—"]);
  });
});
