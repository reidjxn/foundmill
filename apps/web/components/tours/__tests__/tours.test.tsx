/**
 * The three tours mounted on a stand-in of their screens: each starts on its own once per account while guidance is on,
 * stamps the targets outside the shell, skips a step whose target is missing, marks itself done on Skip, and never
 * starts when the account has done it, when guidance is off, or while a dialog is open. The stamping helper is tested
 * on its own (it adds `data-coachmark` to the first match, leaves native anchors alone, and takes its marks off again).
 * The gate in front of them (LazyTour) mounts nothing for an account that will not see the tour, unmounts the tour once
 * it is done, mounts it again on "Replay the tour", and the tours report how they ended (guidance.tour_*).
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { GuidanceProvider } from "@foundmill/dugout";
import { GuidanceSignalProvider, type GuidanceSignalFn } from "@/components/providers/GuidanceHost";
import { DepartmentTour } from "@/components/screen/DepartmentTour";
import { HomeTour } from "@/components/home/HomeTour";
import { InboxTour } from "@/components/inbox/InboxTour";
import { HOME_TOUR } from "../definitions";
import { tourWanted } from "../LazyTour";
import { applyCoachmarkStamps, removeCoachmarkStamps } from "../stamps";

/** Home as the tour sees it: the shell's anchors, a status strip and a department card widget (by `data-widget`). */
function HomeStandIn({ children, card = true }: { children?: React.ReactNode; card?: boolean }) {
  return (
    <>
      <nav aria-label="Primary" data-coachmark="sidebar">
        Sidebar
      </nav>
      <button type="button" data-coachmark="continue">
        Continue
      </button>
      <div role="status" data-coachmark="processing-strip" />
      <section data-widget="status_strip">Status</section>
      {card ? <section data-widget="department_card">Product</section> : null}
      {children}
    </>
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("HomeTour", () => {
  it("starts on the first visit, stamps the widgets, walks the five steps and marks the tour done", async () => {
    const markTourDone = vi.fn();
    render(
      <GuidanceProvider actions={{ markTourDone }}>
        <HomeStandIn>
          <HomeTour />
        </HomeStandIn>
      </GuidanceProvider>,
    );
    const card = await screen.findByRole("dialog", { name: "Your areas" });
    expect(card.getAttribute("data-tour")).toBe("home");
    expect(screen.getByText("1 of 5")).toBeTruthy();
    expect(document.querySelector("[data-coachmark='sidebar'][data-coachmark-active]")).toBeTruthy();
    // The widgets carry the stamped ids now.
    expect(document.querySelector("[data-widget='status_strip']")?.getAttribute("data-coachmark")).toBe("status-strip");
    expect(document.querySelector("[data-widget='department_card']")?.getAttribute("data-coachmark")).toBe("department-card");
    for (const [i, title] of ["Continue", "The working light", "The status strip", "A department card"].entries()) {
      click("Next");
      await screen.findByRole("dialog", { name: title });
      expect(screen.getByText(`${i + 2} of 5`)).toBeTruthy();
      expect(document.querySelector(`[data-coachmark='${HOME_TOUR.steps[i + 1]!.targetId}'][data-coachmark-active]`)).toBeTruthy();
    }
    click("Done");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
  });

  it("skips a step whose target is not on the page (no department card on this dashboard) and still counts 5", async () => {
    render(
      <GuidanceProvider>
        <HomeStandIn card={false}>
          <HomeTour />
        </HomeStandIn>
      </GuidanceProvider>,
    );
    await screen.findByRole("dialog", { name: "Your areas" });
    click("Next");
    await screen.findByRole("dialog", { name: "Continue" });
    click("Next");
    await screen.findByRole("dialog", { name: "The working light" });
    click("Next");
    await screen.findByRole("dialog", { name: "The status strip" });
    expect(screen.getByText("4 of 5")).toBeTruthy();
    // The fifth step has no target: this is the last card, so it offers Done.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("never starts once the account has done it, when guidance is off, or while a dialog is open; Skip marks it done", async () => {
    const done = render(
      <GuidanceProvider value={{ toursDone: { home: true } }}>
        <HomeStandIn>
          <HomeTour />
        </HomeStandIn>
      </GuidanceProvider>,
    );
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-coachmark='status-strip']")).toBeNull();
    done.unmount();

    const off = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <HomeStandIn>
          <HomeTour />
        </HomeStandIn>
      </GuidanceProvider>,
    );
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-coachmark-ring]")).toBeNull();
    // Nothing of the tour runs for someone who will not see it: not even the stamping.
    expect(document.querySelector("[data-coachmark='status-strip']")).toBeNull();
    off.unmount();

    const markTourDone = vi.fn();
    function WithDialog() {
      const [open, setOpen] = useState(true);
      return (
        <GuidanceProvider actions={{ markTourDone }}>
          <HomeStandIn>
            {open ? (
              <div role="dialog" aria-label="Rename dashboard">
                A dialog
              </div>
            ) : null}
            <button type="button" onClick={() => setOpen(false)}>
              Close the dialog
            </button>
            <HomeTour />
          </HomeStandIn>
        </GuidanceProvider>
      );
    }
    render(<WithDialog />);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Your areas" })).toBeNull();
    click("Close the dialog");
    await screen.findByRole("dialog", { name: "Your areas" });
    click("Skip tour");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
  });
});

describe("InboxTour", () => {
  it("points at the two panes, then at the decision bar and its ask button once a decision is open", async () => {
    // The tour is mounted once and never re-rendered by the page: the decision bar appearing has to reach it through
    // the DOM alone (as in the app, where the reading pane and the tour are siblings).
    const tour = <InboxTour />;
    function Inbox() {
      const [open, setOpen] = useState(false);
      return (
        <GuidanceProvider>
          <aside data-testid="inbox-pane">List</aside>
          <section data-testid="reading-pane">
            {open ? (
              <div role="group" aria-label="Decision" data-coachmark="decision-bar">
                <button type="button" data-coachmark="decision-ask">
                  Ask Juno
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setOpen(true)}>
                Open a decision
              </button>
            )}
          </section>
          {tour}
        </GuidanceProvider>
      );
    }
    render(<Inbox />);
    await screen.findByRole("dialog", { name: "Notes from the team" });
    expect(screen.getByText("1 of 4")).toBeTruthy();
    expect(document.querySelector("[data-testid='inbox-pane']")?.getAttribute("data-coachmark")).toBe("inbox-pane");
    click("Next");
    await screen.findByRole("dialog", { name: "The note" });
    // No decision open yet: this is the last step with a target.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    // The founder opens a decision mid-tour: the bar and the ask button come into the tour.
    click("Open a decision");
    await screen.findByRole("button", { name: "Next" });
    click("Next");
    await screen.findByRole("dialog", { name: "Your decision" });
    expect(screen.getByText("3 of 4")).toBeTruthy();
    click("Next");
    await screen.findByRole("dialog", { name: "Ask the agent" });
    expect(document.querySelector("[data-coachmark='decision-ask'][data-coachmark-active]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});

describe("DepartmentTour", () => {
  it("rings the tabs, the explainer and the table's view selector, stamping the last two", async () => {
    render(
      <GuidanceProvider>
        <div role="tablist" aria-label="Screen tabs" data-coachmark="tabs">
          <button type="button" role="tab">
            Vision
          </button>
        </div>
        <button type="button" data-explainer="product/vision">
          Explain this page
        </button>
        <button type="button" aria-label="View: Simple">
          Simple
        </button>
        <DepartmentTour />
      </GuidanceProvider>,
    );
    await screen.findByRole("dialog", { name: "This area's screens" });
    expect(document.querySelector("[data-coachmark='tabs'][data-coachmark-active]")).toBeTruthy();
    click("Next");
    await screen.findByRole("dialog", { name: "What a screen is for" });
    expect(document.querySelector("[data-explainer][data-coachmark-active]")).toBeTruthy();
    click("Next");
    await screen.findByRole("dialog", { name: "Simple view and row actions" });
    expect(screen.getByRole("button", { name: "View: Simple" }).getAttribute("data-coachmark")).toBe("table-views");
    expect(screen.getByText("3 of 3")).toBeTruthy();
  });
});

describe("LazyTour", () => {
  it("wants a tour only once the preferences answered, with guidance on and the tour not done", () => {
    expect(tourWanted({ loaded: true, guidance: "on", toursDone: {} }, "home")).toBe(true);
    expect(tourWanted({ loaded: false, guidance: "on", toursDone: {} }, "home")).toBe(false);
    expect(tourWanted({ loaded: true, guidance: "off", toursDone: {} }, "home")).toBe(false);
    expect(tourWanted({ loaded: true, guidance: "on", toursDone: { home: true } }, "home")).toBe(false);
    expect(tourWanted({ loaded: true, guidance: "on", toursDone: { inbox: true } }, "home")).toBe(true);
  });

  it("mounts nothing before the preferences answer; once done it unmounts (stamps off), sends its signal, and Replay brings it back", async () => {
    const signal = vi.fn<GuidanceSignalFn>();
    function Account({ loaded }: { loaded: boolean }) {
      const [toursDone, setToursDone] = useState<Record<string, true>>({});
      const value = useMemo(() => ({ loaded, toursDone }), [loaded, toursDone]);
      const actions = useMemo(
        () => ({ markTourDone: (id: string) => setToursDone((d) => ({ ...d, [id]: true as const })), resetGuidance: () => setToursDone({}) }),
        [],
      );
      return (
        <GuidanceProvider value={value} actions={actions}>
          <GuidanceSignalProvider value={signal}>
            <HomeStandIn>
              <button type="button" onClick={actions.resetGuidance}>
                Replay the tour
              </button>
              <HomeTour />
            </HomeStandIn>
          </GuidanceSignalProvider>
        </GuidanceProvider>
      );
    }
    const view = render(<Account loaded={false} />);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-coachmark='status-strip']")).toBeNull();
    view.rerender(<Account loaded />);
    await screen.findByRole("dialog", { name: "Your areas" });
    expect(document.querySelector("[data-widget='status_strip']")?.getAttribute("data-coachmark")).toBe("status-strip");
    click("Skip tour");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Done: the tour is gone whole, its stamps with it, and it said how it ended.
    await waitFor(() => expect(document.querySelector("[data-coachmark='status-strip']")).toBeNull());
    expect(signal).toHaveBeenCalledWith("guidance.tour_skipped", { tourId: "home", atStep: 1, steps: 5 });
    click("Replay the tour");
    await screen.findByRole("dialog", { name: "Your areas" });
    expect(screen.getByText("1 of 5")).toBeTruthy();
  });
});

describe("applyCoachmarkStamps", () => {
  it("stamps the first match, leaves a native anchor and a foreign id alone, and takes its own marks off again", () => {
    document.body.innerHTML = `
      <section data-widget="status_strip" id="first"></section>
      <section data-widget="status_strip" id="second"></section>
      <section data-widget="department_card" data-coachmark="elsewhere"></section>
      <div data-coachmark="tabs"></div>
      <div role="tablist" id="list"></div>`;
    const stamped = new Map<string, HTMLElement>();
    applyCoachmarkStamps(
      [
        { targetId: "status-strip", selector: "[data-widget='status_strip']" },
        { targetId: "department-card", selector: "[data-widget='department_card']" },
        { targetId: "tabs", selector: "[role='tablist']" },
        { targetId: "nowhere", selector: "[data-no-such]" },
      ],
      stamped,
    );
    expect(document.getElementById("first")?.getAttribute("data-coachmark")).toBe("status-strip");
    expect(document.getElementById("second")?.hasAttribute("data-coachmark")).toBe(false);
    // Carries another id: untouched. The tabs anchor exists natively: the tablist is not stamped.
    expect(document.querySelector("[data-widget='department_card']")?.getAttribute("data-coachmark")).toBe("elsewhere");
    expect(document.getElementById("list")?.hasAttribute("data-coachmark")).toBe(false);
    expect([...stamped.keys()]).toEqual(["status-strip"]);
    // A second pass changes nothing; once the element is gone the stamp is forgotten and the next match is taken.
    applyCoachmarkStamps([{ targetId: "status-strip", selector: "[data-widget='status_strip']" }], stamped);
    expect(document.getElementById("second")?.hasAttribute("data-coachmark")).toBe(false);
    document.getElementById("first")!.remove();
    applyCoachmarkStamps([{ targetId: "status-strip", selector: "[data-widget='status_strip']" }], stamped);
    expect(document.getElementById("second")?.getAttribute("data-coachmark")).toBe("status-strip");
    removeCoachmarkStamps(stamped);
    expect(document.getElementById("second")?.hasAttribute("data-coachmark")).toBe(false);
    expect(document.querySelector("[data-widget='department_card']")?.getAttribute("data-coachmark")).toBe("elsewhere");
    expect(stamped.size).toBe(0);
    document.body.innerHTML = "";
  });
});
