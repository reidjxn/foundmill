// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { ImportFlow } from "../import/ImportScreen";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ImportFlow (BUILD §11.1 Door B, AC-11.1.5)", () => {
  it("lists the ten read-only sources and needs one chosen before it starts", () => {
    render(
      <TooltipProvider>
        <ImportFlow viewer={{ email: null }} onContinue={vi.fn()} stepMs={0} />
      </TooltipProvider>,
    );
    expect(document.querySelectorAll("[data-source]")).toHaveLength(10);
    expect(screen.getAllByText("Read only")).toHaveLength(10);
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(true);
  });

  it("validates the repository, runs the job and shows a Scouting report that never pushed", async () => {
    const onContinue = vi.fn();
    render(
      <TooltipProvider>
        <ImportFlow viewer={{ email: null }} onContinue={onContinue} stepMs={0} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText("Import from GitHub"));
    fireEvent.click(screen.getByTestId("start-import"));
    expect(screen.getAllByRole("alert").some((a) => /owner\/name/.test(a.textContent ?? ""))).toBe(true);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "https://github.com/acme/ledgerly.git" } });
    fireEvent.click(screen.getByLabelText("Import from Stripe"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-import"));
    });
    const report = screen.getByTestId("scouting-report");
    expect(report).toBeTruthy();
    expect(screen.getByTestId("never-pushed").textContent).toMatch(/Nothing was pushed/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scouting report: Ledgerly");
    expect(screen.getByTestId("roadmap-seeds").querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("first-decisions").querySelectorAll("[data-recommended]")).toHaveLength(1);
    expect(document.querySelectorAll('[data-source-progress][data-status="done"]')).toHaveLength(2);
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("continue-to-commit"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    const [reportArg, configs] = onContinue.mock.calls[0]!;
    expect(reportArg.neverPushed).toBe(true);
    expect(reportArg.suggestedName).toBe("Ledgerly");
    expect(configs).toEqual([{ key: "github", value: "https://github.com/acme/ledgerly.git" }, { key: "stripe", value: "" }]);
  });
});
