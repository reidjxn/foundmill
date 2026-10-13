import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ChannelProfileCard } from "./ChannelProfileCard";
import { FormGuide } from "./ChannelToken";
import { FormationBoard } from "./FormationBoard";
import { BOARD_H, BOARD_W, CAPTION_CORRIDOR, FAMILY_QUADRANT, HUB, RX, RY, TOKEN_DOWN, TOKEN_UP, WEDGE_HALF, benchChannels, hitsHub, boardLayout, channelLine, entranceOrder, fitShare, fitToT, halfWidth, pitchLines, signalPath, toggleChannel } from "./formation";
import { mockChannels } from "./mock";

const channels = mockChannels();

describe("board logic", () => {
  it("groups running channels by family in board order and lists the rest by fit", () => {
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

describe("boardLayout (the quadrant map)", () => {
  const allOn = channels.map((c) => ({ ...c, enabled: true }));
  const sameFit = channels.map((c) => ({ ...c, enabled: true, fit: 18 }));

  function assertClear(slots: ReturnType<typeof boardLayout>) {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]!;
        const b = slots[j]!;
        const dx = Math.abs(a.x - b.x) / (halfWidth(a.key) + halfWidth(b.key) + 14);
        const dy = Math.abs(a.y - b.y) / 142;
        expect(Math.hypot(dx, dy), `${a.key} vs ${b.key}`).toBeGreaterThan(0.97);
      }
    }
  }

  it("places every channel, running or not, inside the board and its own family's wedge", () => {
    const slots = boardLayout(channels);
    expect(slots).toHaveLength(15);
    for (const s of slots) {
      expect(s.line).toBe(channelLine(s.key));
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(BOARD_W);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(BOARD_H);
      const angle = (Math.atan2((s.y - HUB.y) / RY, (s.x - HUB.x) / RX) * 180) / Math.PI;
      let d = angle - FAMILY_QUADRANT[s.line].angle;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      expect(Math.abs(d)).toBeLessThanOrEqual(WEDGE_HALF + 0.5);
    }
  });

  it("keeps every token and its full name clear of every other, even with all 15 running or all at the same fit", () => {
    assertClear(boardLayout(channels));
    assertClear(boardLayout(allOn));
    assertClear(boardLayout(sameFit));
  });

  it("never lets a token or its name touch the hub or cross the board's edge, whatever the fits", () => {
    const strong = channels.map((c) => ({ ...c, enabled: true, fit: 20 }));
    const mixed = channels.map((c, i) => ({ ...c, enabled: true, fit: [20, 19, 18, 3, 12][i % 5]! }));
    for (const set of [channels, allOn, sameFit, strong, mixed]) {
      for (const s of boardLayout(set)) {
        expect(hitsHub(s, halfWidth(s.key)), `${s.key} on the hub`).toBe(false);
        expect(s.x - halfWidth(s.key)).toBeGreaterThanOrEqual(0);
        expect(s.x + halfWidth(s.key)).toBeLessThanOrEqual(BOARD_W);
        expect(s.y - TOKEN_UP).toBeGreaterThanOrEqual(0);
        expect(s.y + TOKEN_DOWN).toBeLessThanOrEqual(BOARD_H);
      }
    }
  });

  it("keeps the caption corridor above the hub clear", () => {
    for (const s of boardLayout(allOn)) if (s.y < HUB.y) expect(Math.abs(s.x - HUB.x)).toBeGreaterThanOrEqual(CAPTION_CORRIDOR - 0.5);
  });

  it("gives each channel a fixed home: toggling channels never moves the others", () => {
    const a = boardLayout(channels);
    const b = boardLayout(allOn);
    expect(b.map((s) => [s.key, s.x.toFixed(3), s.y.toFixed(3)])).toEqual(a.map((s) => [s.key, s.x.toFixed(3), s.y.toFixed(3)]));
    expect(boardLayout(channels)).toEqual(a);
  });

  it("puts a stronger fit closer to the hub within a family", () => {
    const slots = new Map(boardLayout(channels).map((s) => [s.key, s]));
    const dist = (k: string) => {
      const s = slots.get(k as never)!;
      return Math.hypot((s.x - HUB.x) / RX, (s.y - HUB.y) / RY);
    };
    expect(dist("paid_ads")).toBeLessThan(dist("lead_generation")); // 17 vs 4
    expect(dist("content")).toBeLessThan(dist("geo")); // 12 vs 8
    expect(fitToT(20)).toBeLessThan(fitToT(1));
  });

  it("draws each signal as a curve from the hub to the channel", () => {
    const s = boardLayout(allOn)[0]!;
    const d = signalPath(s);
    expect(d.startsWith(`M ${HUB.x} ${HUB.y} Q `)).toBe(true);
    expect(d.endsWith(`${s.x.toFixed(1)} ${s.y.toFixed(1)}`)).toBe(true);
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
  it("renders the four family groups, running channels on the map, ghosts for the rest and the tray sentence", () => {
    const onToggle = vi.fn();
    render(<FormationBoard channels={channels} onToggle={onToggle} animateEntrance={false} hoverCards={false} />);
    const pitch = screen.getByRole("group", { name: /Board: active channels/ });
    expect(within(pitch).getByRole("group", { name: /Acquisition channels/ })).toBeTruthy();
    expect(within(pitch).getByRole("group", { name: /Offline channels/ })).toBeTruthy();
    expect(within(pitch).getAllByRole("button")).toHaveLength(4);
    expect(pitch.querySelectorAll("[data-ghost]")).toHaveLength(11);
    expect(pitch.querySelectorAll("[data-signal]")).toHaveLength(4);
    expect(pitch.querySelector("[data-hub]")!.textContent).toContain("4running");
    const bench = screen.getByRole("group", { name: /Off the board: All 15 channels are available/ });
    expect(within(bench).getAllByRole("button")).toHaveLength(11);
    const paid = within(pitch).getByRole("button", { name: /Paid advertising, fit 17 of 20 \(Excellent\), recommended, on the board/ });
    expect(paid.getAttribute("aria-pressed")).toBe("true");
  });

  it("Enter toggles a token between board and bench, O opens the channel", () => {
    const onToggle = vi.fn();
    const onOpenChannel = vi.fn();
    render(<FormationBoard channels={channels} onToggle={onToggle} onOpenChannel={onOpenChannel} animateEntrance={false} hoverCards={false} />);
    const seo = screen.getByRole("button", { name: /^SEO,/ });
    fireEvent.keyDown(seo, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("seo", true);
    expect(screen.getByText(/SEO moved onto the board/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Social media,/ }), { key: " " });
    expect(onToggle).toHaveBeenCalledWith("social", false);
    expect(screen.getByText(/Social media moved off the board/)).toBeTruthy();
    fireEvent.keyDown(seo, { key: "o" });
    expect(onOpenChannel).toHaveBeenCalledWith("seo");
  });

  it("drags a token from the tray onto the board, lights its ghost as the target, and treats a still pointer as a click", () => {
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
    expect(pitch.querySelector('[data-ghost="content"]')!.getAttribute("data-target")).toBe("true");
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

    it("recommended channels start off the board and join it one by one", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Take off the board" }));
    expect(onToggle).toHaveBeenCalledWith("paid_ads", false);
    fireEvent.click(screen.getByRole("button", { name: "Open channel" }));
    expect(onOpenChannel).toHaveBeenCalledWith("paid_ads");
  });

  it("shows Offline tracking from the channel's own setting, falling back to its default", () => {
    const paid = channels.find((c) => c.key === "paid_ads")!;
    // Outdoor is connected by default; set to offline tracking, its card says so (as the Channels table does).
    const { unmount } = render(<ChannelProfileCard channel={{ ...paid, key: "outdoor", kitMode: true }} />);
    expect(screen.getByText("Offline tracking")).toBeTruthy();
    unmount();
    // Print is offline by default; turned off, the card no longer claims it.
    const off = render(<ChannelProfileCard channel={{ ...paid, key: "print", kitMode: false }} />);
    expect(screen.queryByText("Offline tracking")).toBeNull();
    off.unmount();
    render(<ChannelProfileCard channel={{ ...paid, key: "print" }} />);
    expect(screen.getByText("Offline tracking")).toBeTruthy();
  });
});
