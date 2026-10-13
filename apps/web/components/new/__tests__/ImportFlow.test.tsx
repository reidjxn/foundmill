// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { DEFAULT_POLL_MS, ImportFlow, type ImportRunner } from "../import/ImportScreen";
import type { ImportJob, ImportStatus, ScoutingReport, SourceConfig } from "../import/import-job";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/** The API's sign-up job: one check per source, then the read planned for after commit (nothing is read here). */
const SOURCES = [
  { key: "github" as const, value: "acme/ledgerly", check: "Check the repository name acme/ledgerly", read: "Read the file tree of acme/ledgerly through the GitHub App (read only; nothing is pushed)", summary: "Not read yet: read after you take charge (read only)." },
  { key: "stripe" as const, value: "", check: "Note the Stripe connection it needs", read: "Read the Stripe account (read only)", summary: "Not read yet: read after you take charge, if Stripe is connected in Settings › Integrations." },
];

/** The API's deterministic local job, replayed from a fake clock: `t` checks done out of two. */
function jobAt(t: number): ImportJob {
  const sources: ImportJob["sources"] = SOURCES.map((src, i) => {
    const check = i < t ? ("done" as const) : i === t ? ("running" as const) : ("queued" as const);
    return {
      key: src.key,
      value: src.value,
      sourceId: null,
      status: check === "done" ? "planned" : check,
      steps: [
        { id: `${src.key}:0`, label: src.check, status: check },
        { id: `${src.key}:1`, label: src.read, status: "planned" as const },
      ],
      summary: check === "done" ? src.summary : null,
    };
  });
  const all = sources.every((s) => s.status === "planned");
  return { id: "job-1", mode: "local", businessId: null, workflowId: null, status: all ? "done" : "running", sources, startedAt: "2026-10-07T10:00:00.000Z", finishedAt: all ? "2026-10-07T10:00:00.240Z" : null, stepMs: 120 };
}

const report: ScoutingReport = {
  title: "Import report: Ledgerly",
  suggestedName: "Ledgerly",
  archetypeHint: "b2b_saas",
  summary: "Ledgerly: 2 sources to read after you take charge; nothing has been read yet.",
  whatExists: ["GitHub (acme/ledgerly): Not read yet: read after you take charge (read only).", "Stripe: Not read yet: read after you take charge, if Stripe is connected in Settings › Integrations."],
  whatIsMissing: ["No bank connection: runway stays an estimate until one is added."],
  strengths: ["Once GitHub is read after you take charge, agents start from your real code, not a blank repository."],
  weaknesses: ["Nothing has been read yet, so no weakness is measured: the team reports what it finds once the import has read your sources."],
  firstDecisions: [
    { id: "spec", label: "Rebuild the Specification from the imported sources", recommended: true, consequence: "The Product lead drafts the spec.", reversible: true },
    { id: "roadmap", label: "Seed the roadmap from open issues", recommended: false, consequence: "Open issues the import reads become roadmap items.", reversible: true },
    { id: "finance", label: "Build the management P&L from revenue history", recommended: false, consequence: "Finance reconciles revenue once it is read.", reversible: true },
  ],
  roadmapSeeds: [],
  sources: [
    { key: "github", label: "GitHub", value: "acme/ledgerly", state: "planned", note: SOURCES[0]!.summary },
    { key: "stripe", label: "Stripe", value: "", state: "planned", note: SOURCES[1]!.summary },
  ],
  neverPushed: true,
  provenance: "Estimate",
};

/** A runner that advances the job one check per status poll, like the API's clock-driven local job. */
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
      t = Math.min(2, t + 1);
      return status();
    }),
  };
  return r;
}

function renderFlow(runner: ImportRunner, onContinue = vi.fn(), onReport = vi.fn()) {
  render(
    <TooltipProvider>
      <ImportFlow viewer={{ email: null }} runner={runner} onContinue={onContinue} onReport={onReport} pollMs={0} />
    </TooltipProvider>,
  );
  return onContinue;
}

describe("ImportFlow (BUILD §11.1 Door B, AC-11.1.5)", () => {
  it("lists the ten read-only sources, says which the import cannot read yet, and needs one chosen before it starts", () => {
    renderFlow(fakeRunner());
    expect(document.querySelectorAll("[data-source]")).toHaveLength(10);
    expect(screen.getAllByText("Read only")).toHaveLength(10);
    expect([...document.querySelectorAll("[data-source]")].filter((el) => el.querySelector("[data-testid='no-import-reader']")).map((el) => el.getAttribute("data-source")).sort()).toEqual(["jira", "linear", "website"]);
    expect((screen.getByTestId("start-import") as HTMLButtonElement).disabled).toBe(true);
  });

  it("validates the repository locally, starts the job on the API, polls it to a report that claims nothing as read", async () => {
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
    expect(runner.polls).toBe(2);
    expect(screen.getByTestId("never-pushed").textContent).toMatch(/Nothing was pushed/);
    expect(screen.getByTestId("report-read-state").textContent).toMatch(/Nothing read yet/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Import report: Ledgerly");
    expect(screen.getByTestId("roadmap-seeds").querySelectorAll("li")).toHaveLength(0);
    expect(screen.getByTestId("roadmap-seeds").textContent).toMatch(/No open issues have been read/);
    expect(screen.getByTestId("first-decisions").querySelectorAll("[data-recommended]")).toHaveLength(1);
    // Checked now, read after commit: no source and no read step shows as done.
    expect(document.querySelectorAll('[data-source-progress][data-status="planned"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-source-progress="github"] [data-step-status="done"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-source-progress="github"] [data-step-status="planned"]')).toHaveLength(1);
    expect(screen.getAllByText("After you take charge").length).toBe(2);
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("continue-to-commit"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    const [reportArg, configs, job] = onContinue.mock.calls[0]! as [ScoutingReport, SourceConfig[], { id: string; status: string }];
    expect(reportArg.neverPushed).toBe(true);
    expect(reportArg.suggestedName).toBe("Ledgerly");
    expect(configs).toEqual([{ key: "github", value: "https://github.com/acme/ledgerly.git" }, { key: "stripe", value: "" }]);
    // The finished job travels on, so commit can link the business to this import.
    expect(job.status).toBe("done");
    expect(job.id).toBeTruthy();
  });

  it("asks for the concept card once, the moment the report is on screen (audit P7: Continue does not wait on the model)", async () => {
    const runner = fakeRunner();
    const onReport = vi.fn();
    const onContinue = renderFlow(runner, vi.fn(), onReport);
    fireEvent.click(screen.getByLabelText("Import from Stripe"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-import"));
    });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    expect(onReport).toHaveBeenCalledTimes(1);
    const [job, reportArg] = onReport.mock.calls[0]! as [{ id: string; status: string }, ScoutingReport];
    expect(job).toMatchObject({ id: "job-1", status: "done" });
    expect(reportArg.suggestedName).toBe("Ledgerly");
    // Before Continue: the card is only being drafted, nothing is continued yet.
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("polls about once per API step by default", () => {
    expect(DEFAULT_POLL_MS).toBeLessThanOrEqual(200);
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
    expect(screen.getByTestId("import-progress").textContent).toMatch(/0 of 2 steps/); // the two checks; the reads come after commit
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
