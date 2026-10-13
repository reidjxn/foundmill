// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { DEFAULT_POLL_MS, ImportFlow, commitFromImportHref, importJobHref, type ImportFlowProps, type ImportRunner } from "../import/ImportScreen";
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
  title: "Import report: Ledgerly",
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

function renderFlow(runner: ImportRunner, onContinue = vi.fn(), onReport = vi.fn(), extra: Partial<ImportFlowProps> = {}) {
  render(
    <TooltipProvider>
      <ImportFlow viewer={{ email: null }} runner={runner} onContinue={onContinue} onReport={onReport} pollMs={0} {...extra} />
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Import report: Ledgerly");
    expect(screen.getByTestId("roadmap-seeds").querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("first-decisions").querySelectorAll("[data-recommended]")).toHaveLength(1);
    expect(document.querySelectorAll('[data-source-progress][data-status="done"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-source-progress="github"] [data-step-status="done"]')).toHaveLength(6);
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

  it("keeps the job in the address and finds it again after a reload, Back or the Commit Back link (audit IAE-12)", async () => {
    const runner = fakeRunner();
    const onJob = vi.fn();
    renderFlow(runner, vi.fn(), vi.fn(), { onJob });
    fireEvent.click(screen.getByLabelText("Import from Stripe"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-import"));
    });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    expect(onJob).toHaveBeenCalledWith("job-1");
    fireEvent.click(screen.getByRole("button", { name: "Change sources" }));
    expect(onJob).toHaveBeenLastCalledWith(null);
    expect(importJobHref("job-1")).toBe("/new/import?job=job-1");
    expect(importJobHref(null)).toBe("/new/import");
  });

  it("resumes a finished import from ?job= without starting another, and the picker behind it remembers the sources", async () => {
    const runner = fakeRunner();
    runner.status = vi.fn(async () => ({ job: jobAt(9), report, workflow: null }));
    const onReport = vi.fn();
    renderFlow(runner, vi.fn(), onReport, { resumeJobId: "job-1" });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.status).toHaveBeenCalledWith("job-1");
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Import report: Ledgerly");
    fireEvent.click(screen.getByRole("button", { name: "Change sources" }));
    expect((screen.getByLabelText("Import from GitHub") as HTMLInputElement).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Repository") as HTMLInputElement).value).toBe("acme/ledgerly");
  });

  it("a job that cannot be found shows the picker with a plain message and clears the address", async () => {
    const runner = fakeRunner();
    runner.status = vi.fn(async () => {
      throw new Error("import job not found");
    });
    const onJob = vi.fn();
    renderFlow(runner, vi.fn(), vi.fn(), { resumeJobId: "gone", onJob });
    await waitFor(() => expect(screen.getByTestId("import-start-error").textContent).toMatch(/no longer available/));
    expect(screen.getByTestId("import-start-error").textContent).not.toMatch(/not found/);
    expect(onJob).toHaveBeenCalledWith(null);
  });

  it("a double click on Continue to Commit continues once (audit IAE-07)", async () => {
    const runner = fakeRunner();
    runner.status = vi.fn(async () => ({ job: jobAt(9), report, workflow: null }));
    const onContinue = renderFlow(runner, vi.fn(), vi.fn(), { resumeJobId: "job-1" });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    const button = screen.getByTestId("continue-to-commit");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("Commit opens with the name, the report's archetype and the job to come back to", () => {
    expect(commitFromImportHref("idea-1", report, "job 1/x")).toBe("/new/commit/idea-1?name=Ledgerly&from=import&archetype=b2b_saas&job=job%201%2Fx");
  });

  it("shows the roadmap seeds' sources as written and lets a long one shrink instead of crushing the title (audit IAE-13)", async () => {
    const runner = fakeRunner();
    const seeded = { ...report, roadmapSeeds: [{ title: "Export to CSV", source: "AcmeOrg/web-app issue #89" }, { title: "Rate limit public API", source: "Linear LIN-880" }, { title: "Audit log", source: "Jira ISS-301" }] };
    runner.status = vi.fn(async () => ({ job: jobAt(9), report: seeded, workflow: null }));
    renderFlow(runner, vi.fn(), vi.fn(), { resumeJobId: "job-1" });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    const seeds = screen.getByTestId("roadmap-seeds");
    for (const text of ["AcmeOrg/web-app issue #89", "Linear LIN-880", "Jira ISS-301"]) {
      const label = Array.from(seeds.querySelectorAll("li span")).find((n) => n.textContent === text);
      expect(label, text).toBeTruthy();
      expect(label!.getAttribute("title")).toBe(text);
      expect(label!.className).toMatch(/\btruncate\b/);
      expect(label!.className).not.toMatch(/shrink-0/);
    }
    expect(seeds.textContent).not.toMatch(/Linear lin|Acmeorg/);
  });

  it("step icons keep their size when a label wraps (audit IAE-23)", async () => {
    const runner = fakeRunner();
    runner.status = vi.fn(async () => ({ job: jobAt(9), report, workflow: null }));
    renderFlow(runner, vi.fn(), vi.fn(), { resumeJobId: "job-1" });
    await waitFor(() => expect(screen.getByTestId("scouting-report")).toBeTruthy());
    const icons = document.querySelectorAll('[data-testid="step-icon"]');
    expect(icons.length).toBe(9);
    for (const icon of Array.from(icons)) expect(icon.className).toMatch(/shrink-0/);
  });
});
