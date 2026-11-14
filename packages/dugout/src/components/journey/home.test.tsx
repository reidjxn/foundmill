import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentPersonaProvider } from "../foundation/AgentPersona";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { DayDigest } from "./DayDigest";
import { DepartmentCard, teamStripWords } from "./DepartmentCard";
import { departmentCardFixtures, generateJourneyFixture, RIBBON_DEPARTMENTS, squadPulseFixture, trophyFixtures } from "./fixtures";
import { indexDailyRows, summariseDay } from "./ribbon/geometry";
import { buildPulseGrid, SquadPulse } from "./SquadPulse";
import { TrophyCabinet } from "./TrophyCabinet";

const cards = departmentCardFixtures();

describe("DepartmentCard", () => {
  it("renders each health state with a worded pill, the team strip and the metric", () => {
    const { container } = render(
      <>
        {cards.map((d) => (
          <DepartmentCard key={d.id} department={d} />
        ))}
      </>,
    );
    expect(container.querySelector("[data-department='d-distribution']")?.getAttribute("data-health")).toBe("good");
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("Failing")).toBeTruthy();
    expect(container.querySelectorAll("[data-department='d-development'] [data-squad-member]").length).toBe(5);
    // The figure is set in parts (dimmed raised currency, dimmed decimals); its text is the whole value.
    const figure = document.querySelector("[data-department-metric] [data-figure]");
    expect(figure?.textContent).toBe("€41.20");
    expect(figure?.querySelector(".t-currency")?.textContent).toBe("€");
    expect(figure?.querySelector(".t-decimals")?.textContent).toBe(".20");
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    expect(screen.getByText("Quiet", { selector: "[data-now-quiet]" })).toBeTruthy();
    expect(screen.queryByText(/next cycle starts with Continue/)).toBeNull();
    // Plain labels (UX plan E6): "Working on now" and "Next", never the bare "Now" or "Next up".
    expect(screen.getAllByText("Working on now").length).toBe(cards.length);
    expect(screen.getAllByText("Next").length).toBe(cards.length);
    expect(screen.queryByText("Next up")).toBeNull();
  });

  it("counts the agents on a task in the team strip, and says what the team is when nobody is (UX plan B19)", () => {
    const { container } = render(
      <>
        {cards.map((d) => (
          <DepartmentCard key={d.id} department={d} />
        ))}
      </>,
    );
    // Distribution: Scout, Lifecycle and Beacon carry a task (Beacon degraded, still on one); Quill is idle.
    expect(container.querySelector("[data-department='d-distribution'] [data-team-strip-words]")?.textContent).toBe("3 of 4 working");
    expect(container.querySelector("[data-department='d-distribution'] [data-team-strip]")?.getAttribute("aria-label")).toBe("Team: 3 of 4 working");
    // Product: two idle agents, nobody on a task: not "0 of 2 working".
    expect(container.querySelector("[data-department='d-product'] [data-team-strip-words]")?.textContent).toBe("2 agents, all healthy");
    expect(container.textContent).not.toContain("0 of 2 working");
  });

  it("teamStripWords: a task counts as working, health alone does not; an idle team names what needs you", () => {
    const m = (status: "healthy" | "idle" | "paused" | "degraded" | "injured" | "failing", task: string | null = null) => ({ status, task });
    expect(teamStripWords([m("healthy", "Invoice lines"), m("healthy"), m("idle"), m("degraded", "Retry the sync")])).toBe("2 of 4 working");
    expect(teamStripWords([m("healthy"), m("healthy"), m("idle"), m("paused")])).toBe("4 agents, all healthy");
    expect(teamStripWords([m("idle"), m("degraded")])).toBe("2 agents, 1 degraded");
    expect(teamStripWords([m("failing"), m("injured"), m("injured"), m("degraded")])).toBe("4 agents, 1 failing, 2 down, 1 degraded");
    expect(teamStripWords([m("idle")])).toBe("1 agent, healthy");
    expect(teamStripWords([m("injured")])).toBe("1 agent, 1 down");
    expect(teamStripWords([])).toBe("No agents yet");
  });
  it("links entities in Now lines, exposes member status in the name and opens agents", async () => {
    const user = userEvent.setup();
    const onOpenEntity = vi.fn();
    const onOpenAgent = vi.fn();
    const onOpen = vi.fn();
    render(<DepartmentCard department={cards[0]!} onOpenEntity={onOpenEntity} onOpenAgent={onOpenAgent} onOpen={onOpen} entityKinds={{ "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c": "organisation" }} />);
    await user.click(screen.getByRole("link", { name: "Nordic Beauty AB" }));
    expect(onOpenEntity).toHaveBeenCalledWith("0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c");
    await user.click(screen.getByRole("button", { name: /Beacon, Paid ads, Degraded: Waiting: budget above threshold/ }));
    expect(onOpenAgent).toHaveBeenCalledWith("dept-3-2");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("d-distribution");
  });
  it("finds the lead by id, not by name, and names it as the team strip does with anthropomorphic agents on", async () => {
    const user = userEvent.setup();
    const onOpenAgent = vi.fn();
    const base = cards[0]!;
    const twin = { ...base.squad[0]!, id: "twin", name: "Twin", role: "Paid ads", personaKey: "mei" };
    const leadMember = { ...base.squad[1]!, id: "the-lead", name: "Twin", role: "Distribution lead", personaKey: "malik" };
    const helper = { ...base.squad[2]!, id: "helper", name: "Classifier", role: "Classification utility", personaKey: "amara", layer: "utility" };
    const department = { ...base, lead: { id: "the-lead", name: "Twin", seed: "lead", status: "healthy" as const }, squad: [twin, leadMember, helper] };
    render(
      <AgentPersonaProvider anthropomorphic>
        <DepartmentCard department={department} onOpenAgent={onOpenAgent} />
      </AgentPersonaProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Malik (Distribution lead), department lead" }));
    expect(onOpenAgent).toHaveBeenCalledWith("the-lead");
    expect(screen.getByRole("button", { name: /^Mei, Paid ads/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Malik, Distribution lead/ })).toBeTruthy();
    // A background helper is not in the team strip at all (Leads first).
    expect(screen.queryByRole("button", { name: /Classifier/ })).toBeNull();
  });

  it("leaves background helpers out of the team strip and its count, by layer or by tier", () => {
    const base = cards[0]!;
    const helper = (id: string, extra: Record<string, unknown>) => ({ ...base.squad[0]!, id, name: "Entity linker", role: "Linking utility", task: null, status: "injured" as const, ...extra });
    const department = { ...base, squad: [...base.squad, helper("h1", { layer: "utility" }), helper("h2", { tier: "background" as const })] };
    const { container } = render(<DepartmentCard department={department} />);
    expect(container.querySelectorAll("[data-squad-member]").length).toBe(base.squad.length);
    // A down helper never reads as "down" on the founder's card.
    expect(container.querySelector("[data-team-strip-words]")?.textContent).toBe("3 of 4 working");
    expect(screen.queryByText(/Entity linker/)).toBeNull();
  });
});

describe("DepartmentCard · quiet", () => {
  const quiet = cards.find((d) => d.now.length === 0)!;

  it("fills Now with the line it is given, which opens the note", async () => {
    const user = userEvent.setup();
    const onOpenQuiet = vi.fn();
    const { container } = render(<DepartmentCard department={{ ...quiet, quiet: { kind: "respond", label: "Needs your answer", text: "Approve the Q4 retail terms", detail: "2 more in the Inbox" } }} onOpenQuiet={onOpenQuiet} />);
    expect(screen.getByText("Quiet", { selector: "[data-now-quiet]" })).toBeTruthy();
    expect(container.querySelector("[data-now-lines]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Needs your answer: Approve the Q4 retail terms. 2 more in the Inbox" }));
    expect(onOpenQuiet).toHaveBeenCalledTimes(1);
  });

  it("puts the headline metric in plain words under its figure while guidance is on, and leaves the figure alone when it is off", () => {
    const terms = { runway: { id: "runway", word: "Runway", short: "How many months your cash lasts at today's spending." } };
    const { container, unmount } = render(
      <GuidanceProvider value={{ terms }}>
        <DepartmentCard department={quiet} metricId="runway" />
      </GuidanceProvider>,
    );
    expect(container.querySelector("[data-department-metric] [data-plain-line]")?.textContent).toBe("How many months your cash lasts at today's spending.");
    unmount();
    const { container: plain, unmount: unmountPlain } = render(<DepartmentCard department={quiet} metricPlain="Tasks the team finished in the last 7 days." />);
    expect(plain.querySelector("[data-department-metric] [data-plain-line]")?.textContent).toBe("Tasks the team finished in the last 7 days.");
    unmountPlain();
    const { container: off } = render(
      <GuidanceProvider value={{ guidance: "off", terms }}>
        <DepartmentCard department={quiet} metricId="runway" metricPlain="Never shown" />
      </GuidanceProvider>,
    );
    expect(off.querySelector("[data-plain-line]")).toBeNull();
    expect(off.querySelector("[data-department-metric] [data-figure]")).toBeTruthy();
  });

  it("states a finished task as plain text, and says only what it knows without a line", () => {
    const { container, unmount } = render(<DepartmentCard department={{ ...quiet, quiet: { kind: "finished", label: "Last finished", text: "Customer interview synthesis", detail: "Aug 31" } }} onOpenQuiet={() => {}} />);
    expect(screen.getByText("Last finished")).toBeTruthy();
    expect(screen.getByText("Aug 31")).toBeTruthy();
    // A task is not something to open from Home: no button.
    expect(screen.queryByRole("button", { name: /Last finished/ })).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")?.getAttribute("data-now-quiet-line")).toBe("finished");
    unmount();
    render(<DepartmentCard department={{ ...quiet, quiet: null }} />);
    expect(screen.getByText("Nothing in progress right now.")).toBeTruthy();
  });

  it("shows placeholders while the work is loading instead of calling the department quiet", () => {
    const { container } = render(<DepartmentCard department={{ ...quiet, nowLoading: true }} />);
    expect(container.querySelector("[data-now-quiet]")).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")).toBeNull();
    expect(screen.getByLabelText("Loading what the team is doing").getAttribute("aria-busy")).toBe("true");
  });
});

describe("SquadPulse", () => {
  const { cells, days } = squadPulseFixture();
  it("folds cells into a 7 × 24 grid led by the busiest department", () => {
    const { grid, max } = buildPulseGrid(RIBBON_DEPARTMENTS, cells);
    expect(grid.length).toBe(7);
    expect(grid.every((r) => r.length === 24)).toBe(true);
    expect(max).toBeGreaterThan(0);
    const busy = grid.flat().find((c) => c.total > 0)!;
    expect(busy.lead?.id).toBe(busy.breakdown[0]?.department.id);
    expect(busy.breakdown[0]!.agentHours).toBeGreaterThanOrEqual(busy.breakdown[busy.breakdown.length - 1]!.agentHours);
  });
  it("renders 168 grid cells with roving focus and selection", async () => {
    const onSelect = vi.fn();
    const { container } = render(<SquadPulse departments={RIBBON_DEPARTMENTS} days={days} cells={cells} onSelect={onSelect} />);
    expect(container.querySelectorAll("[data-pulse-cell]").length).toBe(168);
    // "Hours of team work", never "agent-hours", in anything read out (UX plan B16).
    expect(screen.getByRole("grid").getAttribute("aria-label")).toContain("hours of team work over the last 7 days");
    expect(screen.getByRole("grid").getAttribute("aria-label")).not.toMatch(/agent.hours/);
    const start = container.querySelector("[data-pulse-cell='6:9']") as HTMLElement;
    expect(start.tabIndex).toBe(0);
    start.focus();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight" });
    expect((document.activeElement as HTMLElement).getAttribute("data-pulse-cell")).toBe("6:10");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowUp" });
    expect((document.activeElement as HTMLElement).getAttribute("data-pulse-cell")).toBe("5:10");
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(days[5], 10, expect.any(Array));
  });
  it("gives each visible hour label a box three columns wide and keeps a screen-reader header for every hour", () => {
    // A label box one column wide (about 24 px at 1280) cannot hold "12 AM" (about 35 px): no-clip.spec flagged all 8.
    render(<SquadPulse departments={RIBBON_DEPARTMENTS} days={days} cells={cells} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.getAttribute("aria-label"))).toEqual(Array.from({ length: 24 }, (_, h) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`)));
    const visible = headers.filter((h) => !h.classList.contains("sr-only"));
    expect(visible.map((h) => h.textContent)).toEqual(["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]);
    for (const h of visible) {
      expect(h.className).toContain("flex-[3]");
      expect(h.className).not.toMatch(/\b(flex-1|invisible)\b/);
    }
  });
});

describe("TrophyCabinet", () => {
  it("gives reached milestones the gold treatment, keeps locked ones ghosted and shares", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onShare = vi.fn();
    const { container } = render(<TrophyCabinet trophies={trophyFixtures()} onOpen={onOpen} onShare={onShare} />);
    expect(screen.getByText("Milestones")).toBeTruthy();
    expect(screen.getByText("6 of 8 reached")).toBeTruthy();
    expect(container.querySelectorAll("[data-trophy][data-achieved]").length).toBe(6);
    expect(screen.getAllByText("Not yet").length).toBe(2);
    await user.click(screen.getByRole("button", { name: /First enterprise contract, reached Oct 1, 2026/ }));
    expect(onOpen).toHaveBeenCalledWith("first_enterprise_contract");
    await user.click(screen.getByRole("button", { name: "Share First customer" }));
    expect(onShare).toHaveBeenCalledWith("customer_1");
    expect(screen.queryByRole("button", { name: /1,000th customer/ })).toBeNull();
  });

  it("lays each card and its Share button out as one column of the row (the button never overflows under the next card)", () => {
    const { container } = render(<TrophyCabinet trophies={trophyFixtures()} onOpen={() => {}} onShare={() => {}} />);
    const share = screen.getByRole("button", { name: "Share First customer" });
    const cell = share.closest("[data-trophy]")!;
    // The cell is a flex column: the card takes the row's spare height (flex-1, not h-full of the row) and the button
    // sits under it inside the cell, so the grid row is sized to hold both.
    expect(cell.className).toMatch(/\bflex\b/);
    expect(cell.className).toMatch(/\bflex-col\b/);
    const card = cell.firstElementChild!;
    expect(card.className).toMatch(/\bflex-1\b/);
    expect(card.className).not.toMatch(/\bh-full\b/);
    expect(cell.lastElementChild).toBe(share);
    for (const c of container.querySelectorAll("[data-trophy]")) expect(c.firstElementChild!.className).not.toMatch(/\bh-full\b/);
  });

  it("the public page: one press shows a reached milestone; a shown one says so quietly, with Hide and Copy card link", async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    const onHide = vi.fn();
    const onCopy = vi.fn();
    const early = [
      { key: "page_live", label: "Page live", description: "Your project's public page went live.", achievedAt: "2026-11-12T09:00:00.000Z", page: "shown" as const },
      { key: "first_follower", label: "First follower", description: "The first person confirmed that they follow your project.", achievedAt: "2026-11-14T08:00:00.000Z", page: "hidden" as const },
      { key: "customer_1", label: "First customer", description: "The first paying customer.", achievedAt: "2026-11-19T10:00:00.000Z", page: "waiting" as const },
      { key: "customer_10", label: "10th customer", description: "10 paying customers.", achievedAt: null, page: "hidden" as const },
      { key: "mrr_1k", label: "First $1K MRR", description: "Monthly recurring revenue.", achievedAt: "2026-11-20T10:00:00.000Z" },
    ];
    const { container, rerender } = render(<TrophyCabinet trophies={early} onShowOnPage={onShow} onHideFromPage={onHide} onCopyCardLink={onCopy} />);
    const cell = (key: string) => container.querySelector(`[data-trophy='${key}']`) as HTMLElement;

    // Reached and not shown: one button.
    await user.click(within(cell("first_follower")).getByRole("button", { name: "Show on your page: First follower" }));
    expect(onShow).toHaveBeenCalledWith("first_follower");
    expect(within(cell("first_follower")).getByRole("button").textContent).toBe("Show on your page");
    expect(cell("first_follower").querySelector("[data-trophy-on-page]")).toBeNull();

    // Shown: the quiet state (an icon and the words), Hide and Copy card link.
    const shown = cell("page_live").querySelector("[data-trophy-on-page='shown']") as HTMLElement;
    expect(shown.textContent).toContain("On your page");
    expect(shown.querySelector("svg")).not.toBeNull();
    await user.click(within(shown).getByRole("button", { name: "Hide: Page live" }));
    expect(onHide).toHaveBeenCalledWith("page_live");
    await user.click(within(shown).getByRole("button", { name: "Copy card link: Page live" }));
    expect(onCopy).toHaveBeenCalledWith("page_live");
    expect(within(cell("page_live")).queryByRole("button", { name: /Show on your page/ })).toBeNull();

    // Shown before, page not live now: it says so, can be hidden, and has no link to copy.
    const waiting = cell("customer_1").querySelector("[data-trophy-on-page='waiting']") as HTMLElement;
    expect(waiting.textContent).toContain("Shown when your page is live");
    expect(within(waiting).getByRole("button", { name: "Hide: First customer" })).toBeTruthy();
    expect(within(waiting).queryByRole("button", { name: /Copy card link/ })).toBeNull();

    // Not reached, or not one that can be shown: nothing.
    expect(within(cell("customer_10")).queryByRole("button")).toBeNull();
    expect(within(cell("mrr_1k")).queryByRole("button")).toBeNull();
    // Nothing here counts what is shown.
    expect(container.textContent).not.toMatch(/\d+\s+(shown|on your page)/i);

    // While a change is on its way that milestone's controls wait; the others do not.
    rerender(<TrophyCabinet trophies={early} onShowOnPage={onShow} onHideFromPage={onHide} onCopyCardLink={onCopy} pendingKey="first_follower" />);
    expect((within(cell("first_follower")).getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect((within(cell("page_live")).getByRole("button", { name: "Hide: Page live" }) as HTMLButtonElement).disabled).toBe(false);

    // A reader who cannot publish sees the state and no control.
    rerender(<TrophyCabinet trophies={early} />);
    expect(cell("page_live").querySelector("[data-trophy-on-page='shown']")!.textContent).toBe("On your page");
    expect(container.querySelectorAll("[data-trophy-show], [data-trophy-hide], [data-trophy-copy-link]")).toHaveLength(0);
  });

  it("labels a reached milestone whose figure is an estimate (an MRR milestone of a business without subscriptions)", () => {
    const { container } = render(<TrophyCabinet trophies={trophyFixtures().map((t) => (t.key === "customer_1" ? { ...t, estimate: true } : t))} />);
    const estimated = container.querySelectorAll("[data-trophy] [data-provenance='estimate']");
    expect(estimated.length).toBe(1);
    expect(container.querySelector("[data-trophy='customer_1'] [data-provenance='estimate']")).toBeTruthy();
  });
});

describe("DayDigest", () => {
  it("shows the day's numbers, wins and team hours", async () => {
    const user = userEvent.setup();
    const data = generateJourneyFixture({ days: 40, seed: "digest" });
    const index = indexDailyRows(data.rows, RIBBON_DEPARTMENTS);
    const dayWithPayment = data.conversions.find((c) => c.kind === "payment")!.occurredAt.slice(0, 10);
    const summary = summariseDay(dayWithPayment, { index, departments: RIBBON_DEPARTMENTS, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
    const onOpenJourney = vi.fn();
    render(<DayDigest summary={summary} currency="EUR" highlights={["Scout closed [[ent:0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c|Nordic Beauty AB]]"]} onOpenJourney={onOpenJourney} onOpenEntity={() => {}} />);
    expect(screen.getByRole("region", { name: /Day digest/ })).toBeTruthy();
    expect(screen.getByText("Hours of team work")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Hours of team work by department" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nordic Beauty AB" })).toBeTruthy();
    const replay = screen.getAllByRole("button", { name: /Open the Customer Update/ })[0]!;
    await user.click(replay);
    expect(onOpenJourney).toHaveBeenCalledWith(summary.conversions[0]!.id);
    expect(screen.getByText(/won today/)).toBeTruthy();
  });

  it("moves the wins the volume rule rolled up out of the Wins list and into the day's results table (audit #342)", async () => {
    const user = userEvent.setup();
    const data = generateJourneyFixture({ days: 40, seed: "digest" });
    const index = indexDailyRows(data.rows, RIBBON_DEPARTMENTS);
    const day = data.conversions.find((c) => c.kind === "payment")!.occurredAt.slice(0, 10);
    const summary = summariseDay(day, { index, departments: RIBBON_DEPARTMENTS, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
    const rolled = summary.conversions[0]!;
    const onOpenJourney = vi.fn();
    const row = { conversionId: rolled.id, kind: rolled.kind, level: "friendly" as const, customerName: rolled.entityName ?? null, entityId: rolled.entityId, channelKey: null, amountMinor: rolled.amountMinor, currency: rolled.currency, occurredAt: rolled.occurredAt };
    const { container } = render(<DayDigest summary={summary} currency="EUR" roundup={[row]} onOpenJourney={onOpenJourney} />);
    expect(container.querySelector("[data-roundup]")).toBeTruthy();
    expect(container.querySelector(`[data-roundup-row='${rolled.id}']`)).toBeTruthy();
    // The rolled-up win has its row in the table, not a second entry in the Wins list.
    expect(screen.queryAllByRole("button", { name: /Open the Customer Update/ }).length).toBe(Math.min(8, summary.conversions.length - 1));
    await user.click(container.querySelector(`[data-roundup-row='${rolled.id}'] button`) as HTMLElement);
    expect(onOpenJourney).toHaveBeenCalledWith(rolled.id);
  });
});
