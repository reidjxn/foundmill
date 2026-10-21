import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GuidanceProvider, type GuidanceState } from "../guidance/GuidanceProvider";
import { Callout, COACHMARK_PAUSE_POLL_MS, COACHMARK_PAUSE_SELECTOR, Coachmark, findCoachmarkTarget, focusAfterTour, isCoachmarkPaused, type CoachmarkStep } from "./Coachmark";

const steps: CoachmarkStep[] = [
  { targetId: "journey", title: "Your story on one line", body: "Revenue, customers and milestones on one time axis." },
  { targetId: "missing-panel", title: "Never shown", body: "This target is not on the page." },
  { targetId: "continue", title: "This is how you move forward", body: "Press it when you have answered what needs you." },
];

function Page({ value, actions, onDone, children }: { value?: Partial<GuidanceState>; actions?: { markTourDone?: (id: string) => void }; onDone?: (o: "done" | "skipped") => void; children?: React.ReactNode }) {
  return (
    <GuidanceProvider value={value} actions={actions}>
      <section id="journey">Journey</section>
      <button type="button" data-coachmark="continue">
        Continue
      </button>
      {children ?? <Coachmark tourId="home" steps={steps} onDone={onDone} />}
    </GuidanceProvider>
  );
}

const card = () => screen.getByRole("dialog", { name: /./ });

describe("Coachmark", () => {
  it("starts on the first step with a target, rings it, counts, skips a missing target, and marks the tour done at the end", async () => {
    const user = userEvent.setup();
    const markTourDone = vi.fn();
    const onDone = vi.fn();
    render(<Page actions={{ markTourDone }} onDone={onDone} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(document.getElementById("journey")?.hasAttribute("data-coachmark-active")).toBe(true);
    expect(document.querySelector("[data-coachmark-ring]")).toBeTruthy();
    // Nothing modal: no backdrop, the page is not inert.
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeTruthy();
    expect(document.querySelector("[aria-hidden='true'][data-aria-hidden]")).toBeNull();
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next" }));
    // The second step's target is missing, so the third shows next; the count still says where it is in the tour.
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(document.getElementById("journey")?.hasAttribute("data-coachmark-active")).toBe(false);
    expect(document.querySelector("[data-coachmark='continue']")?.hasAttribute("data-coachmark-active")).toBe(true);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
    expect(onDone).toHaveBeenCalledWith("done");
    expect(document.querySelector("[data-coachmark-active]")).toBeNull();
  });

  it("waits for the account's preferences: a tour already done never opens on load, and the focus stays put", async () => {
    const { rerender } = render(<Page value={{ loaded: false }} />);
    // Until the preferences answer `toursDone` is the empty default: nothing opens.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Page value={{ loaded: true, toursDone: { home: true } }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    // Once they answer and the tour is not done, it starts.
    rerender(<Page value={{ loaded: true }} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("moves with the arrow keys and skips with Esc, marking the tour done", async () => {
    const user = userEvent.setup();
    const markTourDone = vi.fn();
    const onDone = vi.fn();
    render(<Page actions={{ markTourDone }} onDone={onDone} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    expect(document.activeElement).toBe(card());
    await user.keyboard("{ArrowRight}");
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    await user.keyboard("{ArrowLeft}");
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
    expect(onDone).toHaveBeenCalledWith("skipped");
  });

  it("Skip tour ends it without finishing", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<Page onDone={onDone} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDone).toHaveBeenCalledWith("skipped");
  });

  it("never starts when the tour is done, when guidance is off, or with autoStart off until open", async () => {
    const { unmount } = render(<Page value={{ toursDone: { home: true } }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    const off = render(<Page value={{ guidance: "off" }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    off.unmount();
    function Manual() {
      const [open, setOpen] = useState(false);
      return (
        <Page>
          <button type="button" onClick={() => setOpen(true)}>
            Replay the tour
          </button>
          <Coachmark tourId="home" steps={steps} autoStart={false} open={open} />
        </Page>
      );
    }
    render(<Manual />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Replay the tour" }));
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("waits while something on the page asks tours to pause, and starts once it clears", async () => {
    function Paused() {
      const [busy, setBusy] = useState(true);
      return (
        <Page>
          {busy ? <div data-coachmark-pause="">Continue is processing</div> : null}
          <button type="button" onClick={() => setBusy(false)}>
            Finish processing
          </button>
          <Coachmark tourId="home" steps={steps} />
        </Page>
      );
    }
    render(<Paused />);
    expect(isCoachmarkPaused()).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Finish processing" }));
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("waits while any dialog is open, and starts once it closes", async () => {
    function WithDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Page>
          {open ? (
            <div role="dialog" aria-label="Rename dashboard">
              A dialog
            </div>
          ) : null}
          <button type="button" onClick={() => setOpen(false)}>
            Close the dialog
          </button>
          <Coachmark tourId="home" steps={steps} />
        </Page>
      );
    }
    render(<WithDialog />);
    expect(isCoachmarkPaused()).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog", { name: "Your story on one line" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close the dialog" }));
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("while paused, polls every 500 ms instead of waking on every change of a busy page", async () => {
    function Busy() {
      const [busy, setBusy] = useState(true);
      return (
        <Page>
          {busy ? <div data-coachmark-pause="">Continue is processing</div> : null}
          <button type="button" onClick={() => setBusy(false)}>
            Finish processing
          </button>
          <Coachmark tourId="home" steps={steps} />
        </Page>
      );
    }
    render(<Busy />);
    const spy = vi.spyOn(document, "querySelector");
    const pauseChecks = () => spy.mock.calls.filter(([s]) => s === COACHMARK_PAUSE_SELECTOR).length;
    try {
      // A long cycle: mounts, unmounts and `data-state` flips, across several frames, well inside one poll.
      const host = document.createElement("div");
      document.body.appendChild(host);
      for (let i = 0; i < 6; i += 1) {
        host.appendChild(document.createElement("span"));
        host.setAttribute("data-state", i % 2 ? "open" : "closed");
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      }
      expect(pauseChecks()).toBe(0);
      host.remove();
      expect(screen.queryByRole("dialog")).toBeNull();
      // The pause clears: the next poll starts the tour.
      await userEvent.click(screen.getByRole("button", { name: "Finish processing" }));
      await screen.findByRole("dialog", { name: "Your story on one line" }, { timeout: 1500 });
      expect(COACHMARK_PAUSE_POLL_MS).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });

  it("waiting for its targets, wakes on mounts and attributes it cares about but not on a `data-state` flip", async () => {
    const lonely: CoachmarkStep[] = [{ targetId: "later-target", title: "Here now", body: "It appeared." }];
    render(
      <GuidanceProvider>
        <div data-testid="flipper" data-state="closed" />
        <Coachmark tourId="later" steps={lonely} />
      </GuidanceProvider>,
    );
    const spy = vi.spyOn(document, "getElementById");
    const lookups = () => spy.mock.calls.filter(([id]) => id === "later-target").length;
    try {
      const flipper = screen.getByTestId("flipper");
      for (let i = 0; i < 4; i += 1) {
        flipper.setAttribute("data-state", i % 2 ? "closed" : "open");
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      }
      expect(lookups()).toBe(0);
      const target = document.createElement("div");
      target.setAttribute("data-coachmark", "later-target");
      document.body.appendChild(target);
      await screen.findByRole("dialog", { name: "Here now" });
      expect(lookups()).toBeGreaterThan(0);
      target.remove();
    } finally {
      spy.mockRestore();
    }
  });

  it("while a step shows, measures its target once per frame however many changes the frame holds", async () => {
    render(<Page />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    const journey = document.getElementById("journey")!;
    const rect = { top: 10, left: 10, width: 100, height: 20 };
    const measure = vi.fn(() => ({ ...rect, right: 110, bottom: 30, x: 10, y: 10, toJSON: () => rect }) as DOMRect);
    journey.getBoundingClientRect = measure;
    const host = document.createElement("div");
    document.body.appendChild(host);
    // Twenty separate observer deliveries inside one frame (each mutation in its own microtask).
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        host.appendChild(document.createElement("span"));
        await Promise.resolve();
      }
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(measure.mock.calls.length).toBeGreaterThan(0);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(3);
    host.remove();
  });

  it("never starts when none of its targets is on the page, and nothing breaks", async () => {
    render(
      <GuidanceProvider>
        <Coachmark tourId="nowhere" steps={[{ targetId: "no-such-target", title: "Never", body: "Never shown." }]} />
      </GuidanceProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-coachmark-ring]")).toBeNull();
  });

  it("moves on when the current target leaves the page", async () => {
    function Vanishing() {
      const [shown, setShown] = useState(true);
      return (
        <GuidanceProvider>
          {shown ? <section id="journey">Journey</section> : null}
          <button type="button" data-coachmark="continue" onClick={() => setShown(false)}>
            Continue
          </button>
          <Coachmark tourId="home" steps={steps} />
        </GuidanceProvider>
      );
    }
    render(<Vanishing />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("dialog", { name: "This is how you move forward" });
  });

  it("finds a target by id or by data-coachmark", () => {
    render(
      <div>
        <p id="by-id">a</p>
        <p data-coachmark="by-attr">b</p>
      </div>,
    );
    expect(findCoachmarkTarget("by-id")?.textContent).toBe("a");
    expect(findCoachmarkTarget("by-attr")?.textContent).toBe("b");
    expect(findCoachmarkTarget("nowhere")).toBeNull();
  });

  it("keeps the ring on its target through a scroll and a resize", async () => {
    render(<Page />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    const journey = document.getElementById("journey")!;
    const ring = () => document.querySelector<HTMLElement>("[data-coachmark-ring]")!;
    // The target moves (the page scrolled, the window resized): the ring is measured again and follows it.
    let rect = { top: 0, left: 0, width: 100, height: 20 };
    journey.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect;
    rect = { top: 120, left: 40, width: 300, height: 48 };
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    // 4 px of room between the target and its ring on every side.
    expect(ring().style.top).toBe("116px");
    expect(ring().style.left).toBe("36px");
    expect(ring().style.width).toBe("308px");
    expect(ring().style.height).toBe("56px");
    rect = { top: 200, left: 60, width: 320, height: 48 };
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(ring().style.top).toBe("196px");
    expect(ring().style.left).toBe("56px");
    expect(ring().style.width).toBe("328px");
  });

  it("gives focus back to the element that started the tour, and after a tour that started by itself to the last target when it is a control", async () => {
    const user = userEvent.setup();
    function Replay() {
      const [open, setOpen] = useState(false);
      return (
        <Page>
          <button type="button" onClick={() => setOpen(true)} data-testid="replay">
            Replay the tour
          </button>
          <Coachmark tourId="home" steps={steps} autoStart={false} open={open} />
        </Page>
      );
    }
    const replay = render(<Replay />);
    await user.click(screen.getByTestId("replay"));
    await screen.findByRole("dialog", { name: "Your story on one line" });
    expect(document.activeElement).toBe(card());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("replay"));
    replay.unmount();

    // Started on page load (nothing had focus): Done on the Continue step leaves focus on Continue, the next thing to press.
    render(<Page />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Continue" }));
  });

  it("never moves focus onto a target when the card closes on its own (dropped by the page, or marked done elsewhere)", async () => {
    // A callout that started on page load and is then dropped by the page (the shell's frame no longer wants it).
    function Shell({ show }: { show: boolean }) {
      return <Page>{show ? <Callout tourId="first-continue" targetId="continue" title="This is how you move forward" body="Press it." /> : <span />}</Page>;
    }
    const dropped = render(<Shell show />);
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    dropped.rerender(<Shell show={false} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Continue" }));
    dropped.unmount();

    // The same callout marked done elsewhere (Settings › Preferences, another tab) while it shows.
    const elsewhere = render(<Page value={{ loaded: true }}>{<Callout tourId="first-continue" targetId="continue" title="This is how you move forward" body="Press it." />}</Page>);
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    elsewhere.rerender(<Page value={{ loaded: true, toursDone: { "first-continue": true } }}>{<Callout tourId="first-continue" targetId="continue" title="This is how you move forward" body="Press it." />}</Page>);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Continue" }));
  });

  it("focusAfterTour: the opener first, then a focusable last target, else nothing", () => {
    render(
      <div>
        <button type="button" id="opener">
          Replay
        </button>
        <button type="button" id="target">
          Continue
        </button>
        <section id="panel">Not a control</section>
      </div>,
    );
    const opener = document.getElementById("opener") as HTMLElement;
    const target = document.getElementById("target") as HTMLElement;
    const panel = document.getElementById("panel") as HTMLElement;
    expect(focusAfterTour(opener, target)).toBe(opener);
    expect(focusAfterTour(null, target)).toBe(target);
    expect(focusAfterTour(null, panel)).toBeNull();
    expect(focusAfterTour(document.body, panel)).toBeNull();
    const gone = document.createElement("button");
    expect(focusAfterTour(gone, null)).toBeNull();
    panel.tabIndex = -1;
    expect(focusAfterTour(null, panel)).toBeNull();
    panel.tabIndex = 0;
    expect(focusAfterTour(null, panel)).toBe(panel);
  });
});

describe("Callout", () => {
  it("is one step with a Got it and no count, marking its tour done", async () => {
    const markTourDone = vi.fn();
    render(
      <GuidanceProvider actions={{ markTourDone }}>
        <button type="button" id="continue-button">
          Continue
        </button>
        <Callout tourId="first-continue" targetId="continue-button" title="This is how you move forward" body="Press it when you have answered what needs you." />
      </GuidanceProvider>,
    );
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    expect(screen.queryByText(/of 1/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("first-continue");
  });
});
