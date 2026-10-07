// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { ImportFlow, type ImportRunner } from "../import/ImportScreen";
import type { ImportJob, ImportStatus, ScoutingReport, SourceConfig } from "../import/import-job";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const GITHUB_STEPS = ["Clone acme/ledgerly into the sandbox (read only)", "Summarise the file tree", "Read the top 200 files by importance", "Run the test suite if one exists", "Turn open issues into roadmap seeds", "Confirm nothing was pushed"];
const STRIPE_STEPS = ["Read customers and subscriptions", "Read invoices and payments", "Build revenue history"];

/** The API's deterministic local job, replayed from a fake clock: `t` steps done out of nine. */
function jobAt(t: number): ImportJob {
  let i = 0;
  const source = (key: "github" | "stripe", value: string, labels: string[]): ImportJob["sources"][number] => {
    const steps = labels.map((label, n) => {
      const idx = i++;
      return { id: `${key}:${n}`, label, status: idx < t ? ("done" as const) : idx === t ? ("running" as const) : ("queued" as const) };
    });
    const done = steps.every((s) => s.status === "done");
    return { key, value, sourceId: null, status: done ? "done" : steps.some((s) => s.status !== "queued") ? "running" : "queued", steps, summary: done ? (key === "github" ? "212 files read, 40 tests passing, 9 open issues, nothing pushed" : "120 customers, 14 months of revenue") : null };
  };
  const sources = [source("github", "acme/ledgerly", GITHUB_STEPS), source("stripe", "", STRIPE_STEPS)];
  const all = sources.every((s) => s.status === "done");
  return { id: "job-1", mode: "local", businessId: null, workflowId: null, status: all ? "done" : "running", sources, startedAt: "2026-10-07T10:00:00.000Z", finishedAt: all ? "2026-10-07T10:00:04.000Z" : null, stepMs: 400 };
}

const report: ScoutingReport = {
  title: "Scouting report: Ledgerly",
  suggestedName: "Ledgerly",
  archetypeHint: "b2b_saas",
  summary: "Ledgerly: 2 sources imported.",
  whatExists: ["GitHub (acme/ledgerly): 212 files read", "Stripe: 120 customers"],
  whatIsMissing: ["No bank connection: runway stays an estimate until one is added."],
  strengths: ["A working codebase with a test suite."],
  weaknesses: ["No deployment pipeline was found; releases look manual."],
  firstDecisions: [
    { id: "spec", label: "Rebuild the Specification from the imported sources", recommended: true, consequence: "The Product lead drafts the spec.", reversible: true },
    { id: "roadmap", label: "Seed the roadmap from open issues", recommended: false, consequence: "Open issues become roadmap items.", reversible: true },
    { id: "finance", label: "Build the management P&L from revenue history", recommended: false, consequence: "Finance reconciles revenue.", reversible: true },
  ],
  roadmapSeeds: [
    { title: "Onboarding drop-off after sign-up", source: "acme/ledgerly issue #12" },
    { title: "Export to CSV", source: "acme/ledgerly issue #40" },
    { title: "Webhook retries on timeout", source: "acme/ledgerly issue #77" },
  ],
  neverPushed: true,
  provenance: "Estimate",
};

/** A runner that advances the job three steps per status poll, like the API's clock-driven local job. */
function fakeRunner(): ImportRunner & { starts: unknown[]; polls: number } {
  let t = 0;
  const status = (): ImportStatus => {
    const job = jobAt(t);
    return { job, report: job.status === "done" ? report : null, workflow: null };
  };
  const r = {
    starts: [] as unknown[],
    polls: 0,
    start: vi.fn(async (input: unknown) => {
      r.starts.push(input);
      t = 0;
      return status();
    }),
    status: vi.fn(async () => {
      r.polls++;
      t = Math.min(9, t + 3);
      return status();
    }),
  };
  return r;
}

function renderFlow(runner: ImportRunner, onContinue = vi.fn()) {
  render(
    <TooltipProvider>
      <ImportFlow viewer={{ email: null }} runner={runner} onContinue={onContinue} pollMs={0} />
    </TooltipProvider>,
  );
  return onContinue;
}

describe("ImportFlow (BUILD §11.1 Door B, AC-11.1.5)", () => {
  it("lists the ten read-only sources and needs one chosen before it starts", () => {
    renderFlow(fakeRunner());
    expect(document.querySelectorAll("[data-source]")).toHaveLength(10);
    expect(screen.getAllByText("Read only")).toHaveLength(10);
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(true);
  });

  it("validates the repository locally, starts the job on the API, polls it to the report and never pushed", async () => {
    const runner = fakeRunner();
    const onContinue = renderFlow(runner);
    fireEvent.click(screen.getByLabelText("Import from GitHub"));
    fireEvent.click(screen.getByTestId("start-import"));
    expect(screen.getAllByRole("alert").some((a) => /owner\/name/.test(a.textContent ?? ""))).toBe(true);
    expect(runner.start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "https://github.com/acme/ledgerly.git" } });
    fireEvent.click(screen.getByLabelText("Import from Stripe"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-import"));
    });
    // Normalised values go to the API; the reduced-motion/zero-poll path asks for the fastest local job.
    expect(runner.starts[0]).toEqual({ sources: [{ key: "github", value: "acme/ledgerly" }, { key: "stripe", value: "" }], stepMs: 1 });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    expect(runner.polls).toBe(3);
    expect(screen.getByTestId("never-pushed").textContent).toMatch(/Nothing was pushed/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scouting report: Ledgerly");
    expect(screen.getByTestId("roadmap-seeds").querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("first-decisions").querySelectorAll("[data-recommended]")).toHaveLength(1);
    expect(document.querySelectorAll('[data-source-progress][data-status="done"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-source-progress="github"] [data-step-status="done"]')).toHaveLength(6);
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("continue-to-commit"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    const [reportArg, configs] = onContinue.mock.calls[0]! as [ScoutingReport, SourceConfig[]];
    expect(reportArg.neverPushed).toBe(true);
    expect(reportArg.suggestedName).toBe("Ledgerly");
    expect(configs).toEqual([{ key: "github", value: "https://github.com/acme/ledgerly.git" }, { key: "stripe", value: "" }]);
  });

  it("shows the running job while polling and lets the founder cancel back to the picker", async () => {
    const runner = fakeRunner();
    runner.status = vi.fn(async () => new Promise<ImportStatus>(() => {})); // a poll that never answers
    renderFlow(runner);
    fireEvent.click(screen.getByLabelText("Import from Stripe"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-import"));
    });
    await waitFor(() => expect(screen.getByTestId("import-progress")).toBeTruthy());
    expect(screen.getByTestId("import-progress").textContent).toMatch(/0 of 9 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("import-sources")).toBeTruthy();
  });

  it("explains a refused start without leaving the picker", async () => {
    const runner = fakeRunner();
    runner.start = vi.fn(async () => {
      throw new Error("Check the sources before importing");
    });
    renderFlow(runner);
    fireEvent.click(screen.getByLabelText("Import from Stripe"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-import"));
    });
    await waitFor(() => expect(screen.getByTestId("import-start-error").textContent).toMatch(/Check the sources/));
    expect(screen.getByTestId("import-sources")).toBeTruthy();
  });
});
