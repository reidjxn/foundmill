import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ChannelProfileCard } from "./ChannelProfileCard";
import { FormGuide } from "./ChannelToken";
import { FormationBoard } from "./FormationBoard";
import { benchChannels, entranceOrder, fitShare, pitchLines, toggleChannel } from "./formation";
import { mockChannels } from "./mock";

const channels = mockChannels();

describe("formation logic", () => {
  it("groups starters by line in pitch order and benches the rest by fit", () => {
    const lines = pitchLines(channels);
    expect(lines.map((l) => l.line)).toEqual(["attack", "midfield", "defence", "wings"]);
    expect(lines[0]!.channels.map((c) => c.key)).toEqual(["paid_ads"]);
    expect(lines[1]!.channels.map((c) => c.key)).toEqual(["social", "influencer", "email_automation"]);
    expect(lines[2]!.channels).toHaveLength(0);
    const bench = benchChannels(channels);
    expect(bench).toHaveLength(11);
    expect(bench[0]!.key).toBe("content");
    expect(bench.every((c) => !c.enabled)).toBe(true);
  });

  it("toggleChannel is immutable and a no-op when nothing changes", () => {
    const next = toggleChannel(channels, "seo", true);
    expect(next.find((c) => c.key === "seo")!.enabled).toBe(true);
    expect(channels.find((c) => c.key === "seo")!.enabled).toBe(false);
    expect(toggleChannel(channels, "seo", false)).toEqual(channels);
  });

  it("entrance order puts recommended, best-fit channels first", () => {
    expect(entranceOrder(channels)).toEqual(["paid_ads", "social", "influencer", "email_automation"]);
  });

  it("fitShare splits the budget by fit among starters", () => {
    const shares = ["paid_ads", "social", "influencer", "email_automation"].map((k) => fitShare(channels, k as never));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(fitShare(channels, "seo")).toBe(0);
  });
});

describe("FormGuide", () => {
  it("renders five cells with words in the accessible name", () => {
    render(<FormGuide form={["good", "bad"]} name="SEO form" />);
    const list = screen.getByRole("list", { name: /SEO form, last five weeks: no data, no data, no data, under cap, over cap/ });
    expect(list.querySelectorAll("li")).toHaveLength(5);
  });
});

describe("FormationBoard", () => {
  it("renders four labelled lines, starters on the pitch and the bench sentence", () => {
    const onToggle = vi.fn();
    render(<FormationBoard channels={channels} onToggle={onToggle} animateEntrance={false} hoverCards={false} />);
    const pitch = screen.getByRole("group", { name: /Pitch/ });
    expect(within(pitch).getByRole("group", { name: /Attack line/ })).toBeTruthy();
    expect(within(pitch).getByRole("group", { name: /Wings line/ })).toBeTruthy();
    expect(within(pitch).getAllByRole("button")).toHaveLength(4);
    const bench = screen.getByRole("group", { name: /Bench: All 15 channels are available/ });
    expect(within(bench).getAllByRole("button")).toHaveLength(11);
    const paid = within(pitch).getByRole("button", { name: /Paid advertising, fit 17 of 20 \(Excellent\), recommended, on the pitch/ });
    expect(paid.getAttribute("aria-pressed")).toBe("true");
  });

  it("Enter toggles a token between pitch and bench, O opens the channel", () => {
    const onToggle = vi.fn();
    const onOpenChannel = vi.fn();
    render(<FormationBoard channels={channels} onToggle={onToggle} onOpenChannel={onOpenChannel} animateEntrance={false} hoverCards={false} />);
    const seo = screen.getByRole("button", { name: /^SEO,/ });
    fireEvent.keyDown(seo, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("seo", true);
    expect(screen.getByText(/SEO moved to the pitch/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Social media,/ }), { key: " " });
    expect(onToggle).toHaveBeenCalledWith("social", false);
    expect(screen.getByText(/Social media moved to the bench/)).toBeTruthy();
    fireEvent.keyDown(seo, { key: "o" });
    expect(onOpenChannel).toHaveBeenCalledWith("seo");
  });

  it("drags a bench token onto the pitch and treats a still pointer as a click", () => {
    const onToggle = vi.fn();
    const onOpenChannel = vi.fn();
    const { container } = render(<FormationBoard channels={channels} onToggle={onToggle} onOpenChannel={onOpenChannel} animateEntrance={false} hoverCards={false} />);
    const pitch = container.querySelector('[data-drop-zone="pitch"]') as HTMLElement;
    const bench = container.querySelector('[data-drop-zone="bench"]') as HTMLElement;
    const spy = vi.spyOn(document, "elementFromPoint").mockImplementation((x) => (x > 500 ? pitch : bench));
    const content = screen.getByRole("button", { name: /^Content marketing,/ });
    fireEvent.pointerDown(content, { button: 0, clientX: 10, clientY: 600 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    expect(content.getAttribute("data-dragging")).toBe("true");
    fireEvent.pointerUp(window, { clientX: 600, clientY: 200 });
    expect(onToggle).toHaveBeenCalledWith("content", true);
    expect(onOpenChannel).not.toHaveBeenCalled();
    // A press without movement opens the channel.
    const pr = screen.getByRole("button", { name: /^PR,/ });
    fireEvent.pointerDown(pr, { button: 0, clientX: 10, clientY: 610 });
    fireEvent.pointerUp(window, { clientX: 11, clientY: 611 });
    expect(onOpenChannel).toHaveBeenCalledWith("pr");
    expect(onToggle).toHaveBeenCalledTimes(1);
    // Dropping back where it came from changes nothing.
    fireEvent.pointerDown(pr, { button: 0, clientX: 10, clientY: 610 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 640 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 640 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  describe("entrance", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("recommended tokens start on the bench and walk onto the pitch one by one", () => {
      const { container } = render(<FormationBoard channels={channels} onToggle={vi.fn()} hoverCards={false} />);
      const pitch = () => container.querySelector('[data-drop-zone="pitch"]') as HTMLElement;
      expect(within(pitch()).queryAllByRole("button")).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(400 + 10);
      });
      expect(within(pitch()).getAllByRole("button")).toHaveLength(1);
      expect(within(pitch()).getByRole("button", { name: /^Paid advertising/ })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(160 * 4 + 100);
      });
      expect(within(pitch()).getAllByRole("button")).toHaveLength(4);
      expect((container.querySelector("[data-formation-board]") as HTMLElement).dataset.walkedOn).toBe("true");
    });
  });
});

describe("ChannelProfileCard", () => {
  it("shows the facts and actions", () => {
    const onToggle = vi.fn();
    const onOpenChannel = vi.fn();
    const paid = channels.find((c) => c.key === "paid_ads")!;
    render(<ChannelProfileCard channel={paid} onToggle={onToggle} onOpenChannel={onOpenChannel} />);
    expect(screen.getByText("Paid advertising")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByText(/Estimate/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move to bench" }));
    expect(onToggle).toHaveBeenCalledWith("paid_ads", false);
    fireEvent.click(screen.getByRole("button", { name: "Open channel" }));
    expect(onOpenChannel).toHaveBeenCalledWith("paid_ads");
  });
});
