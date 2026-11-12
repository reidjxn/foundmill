import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ChannelProfileCard } from "./ChannelProfileCard";
import { FormationBoard } from "./FormationBoard";
import { mockChannels } from "./mock";

/**
 * A channel the founder posts themselves (tap-to-post, docs/DESIGN.md §9e): on the board, and never shown as running.
 * The hub does not count it, its line to the hub is still, and its name and its profile say "you post it" in words.
 */
const channels = mockChannels();
const withSocialByTap = channels.map((c) => (c.key === "social" ? { ...c, founderPosts: true } : c));

describe("FormationBoard: a channel the founder posts", () => {
  it("is on the board as a token, is not counted in the hub, and its line is still", () => {
    render(<FormationBoard channels={withSocialByTap} onToggle={() => {}} animateEntrance={false} hoverCards={false} />);
    const pitch = screen.getByRole("group", { name: /Board: active channels/ });
    // Four tokens on the board as before; three of them are running.
    expect(within(pitch).getAllByRole("button")).toHaveLength(4);
    expect(pitch.querySelector("[data-hub]")!.textContent).toContain("3running");
    const social = within(pitch).getByRole("button", { name: /^Social media, .*on the board, you post it$/ });
    expect(social.getAttribute("aria-pressed")).toBe("true");
    const line = pitch.querySelector('[data-signal="social"]')!;
    expect(line.getAttribute("data-founder-posts")).toBe("true");
    expect(line.getAttribute("data-paused")).toBe("true");
    // Only a running channel's line moves: no pulse path on this one, one on a running channel.
    expect(line.querySelectorAll("path")).toHaveLength(1);
    expect(pitch.querySelector('[data-signal="paid_ads"]')!.querySelectorAll("path").length).toBeGreaterThan(1);
    // The key says what a dashed line means, in words.
    expect(screen.getByText(/a dashed one is paused, or one you post yourself\./)).toBeTruthy();
  });

  it("without the flag nothing changes: every channel on the board is counted as running", () => {
    render(<FormationBoard channels={channels} onToggle={() => {}} animateEntrance={false} hoverCards={false} />);
    const pitch = screen.getByRole("group", { name: /Board: active channels/ });
    expect(pitch.querySelector("[data-hub]")!.textContent).toContain("4running");
    expect(within(pitch).queryByRole("button", { name: /you post it/ })).toBeNull();
    expect(pitch.querySelector("[data-founder-posts]")).toBeNull();
  });

  it("off the board it is a token like any other: nothing says it is posted by anyone", () => {
    const off = withSocialByTap.map((c) => (c.key === "social" ? { ...c, enabled: false } : c));
    render(<FormationBoard channels={off} onToggle={() => {}} animateEntrance={false} hoverCards={false} />);
    const bench = screen.getByRole("group", { name: /^Off the board/ });
    expect(within(bench).getByRole("button", { name: /^Social media, .*off the board$/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /Board: active channels/ }).querySelector("[data-hub]")!.textContent).toContain("3running");
  });

  it("the profile card says it in a word beside its other chips", () => {
    const social = withSocialByTap.find((c) => c.key === "social")!;
    const { rerender } = render(<ChannelProfileCard channel={social} />);
    expect(screen.getByText("You post it")).toBeTruthy();
    expect(screen.getByText("On the board")).toBeTruthy();
    rerender(<ChannelProfileCard channel={{ ...social, founderPosts: false }} />);
    expect(screen.queryByText("You post it")).toBeNull();
  });
});
