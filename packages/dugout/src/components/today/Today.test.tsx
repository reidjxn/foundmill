import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProgressBar } from "../foundation/ProgressBar";
import { ShellLinkProvider } from "../shell/ShellLink";
import { GOAL_PANEL_WORDS, GoalPanel, proposedByLine, type GoalPanelGoal, type GoalPanelProposal } from "./GoalPanel";
import { NEEDS_YOU_WORDS, NeedsYouList, needsYouMeta, type NeedsYouRow } from "./NeedsYouList";
import { WEEK_PLAN_WORDS, WeekPlan } from "./WeekPlan";
import { PUBLIC_PAGE_NOTE_WORDS, PublicPageNote } from "./PublicPageNote";

const proposal: GoalPanelProposal = { id: "g2", sentence: "Get the first 10 paying customers by Dec 19", proposedBy: "Ines Park", because: "Recommended because the first customers tell us what to build next." };
const active: GoalPanelGoal = { id: "g1", sentence: "Get the first 10 paying customers by Dec 19", state: "on_pace", progress: { current: 4, target: 10, valueText: "4 of 10 paying customers", pace: "4 of 10 so far, 38 days left: on pace (Forecast)." } };

describe("ProgressBar", () => {
  it("is a progressbar with its value, max and words, clamped to the whole", () => {
    render(<ProgressBar value={4} max={10} label="Goal progress" valueText="4 of 10" />);
    const bar = screen.getByRole("progressbar", { name: "Goal progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(bar.getAttribute("aria-valuemax")).toBe("10");
    expect(bar.getAttribute("aria-valuetext")).toBe("4 of 10");
    expect(bar.getAttribute("style")).toContain("--progress: 0.4");
  });

  it("never reads past the whole or below zero, and survives a zero max", () => {
    const { rerender } = render(<ProgressBar value={14} max={10} label="P" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("10");
    rerender(<ProgressBar value={-3} max={10} label="P" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    rerender(<ProgressBar value={3} max={0} label="P" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("100%");
  });
});

describe("GoalPanel", () => {
  it("waits with the Chief of Staff's line when there is no goal", () => {
    render(<GoalPanel active={null} proposed={null} canDecide />);
    expect(screen.getByRole("heading", { name: GOAL_PANEL_WORDS.title })).toBeTruthy();
    expect(screen.getByText("Your Chief of Staff proposes a goal after the first round of work.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: GOAL_PANEL_WORDS.approve })).toBeNull();
  });

  it("shows a proposal with who proposed it, approves in one tap", async () => {
    const onApprove = vi.fn();
    render(<GoalPanel active={null} proposed={proposal} canDecide onApprove={onApprove} onRequestChange={async () => {}} />);
    expect(screen.getByText(proposedByLine("Ines Park"))).toBeTruthy();
    expect(screen.getByText("Proposed by Ines Park, your Chief of Staff")).toBeTruthy();
    expect(screen.getByText(proposal.because!)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: GOAL_PANEL_WORDS.approve }));
    expect(onApprove).toHaveBeenCalledWith("g2");
  });

  it("Change it asks what should change, sends the founder's words and shows a refusal in the dialog", async () => {
    const onRequestChange = vi.fn().mockRejectedValueOnce(new Error("Say a number or a date, for example ‘20 customers by Jan 31’.")).mockResolvedValueOnce(undefined);
    render(<GoalPanel active={null} proposed={proposal} canDecide onApprove={() => {}} onRequestChange={onRequestChange} />);
    await userEvent.click(screen.getByRole("button", { name: GOAL_PANEL_WORDS.change }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "What should change?" })).toBeTruthy();
    const box = within(dialog).getByPlaceholderText("For example: 20 customers by the end of January");
    const send = within(dialog).getByRole("button", { name: GOAL_PANEL_WORDS.send });
    expect(send.hasAttribute("disabled")).toBe(true);
    await userEvent.type(box, "more please");
    await userEvent.click(send);
    expect(onRequestChange).toHaveBeenLastCalledWith("g2", "more please");
    expect(await within(dialog).findByText(/Say a number or a date/)).toBeTruthy();
    await userEvent.clear(box);
    await userEvent.type(box, "20 customers by Jan 31");
    await userEvent.click(send);
    expect(onRequestChange).toHaveBeenLastCalledWith("g2", "20 customers by Jan 31");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("is read-only for a reader who cannot answer the Inbox", () => {
    render(<GoalPanel active={null} proposed={proposal} canDecide={false} />);
    expect(screen.queryByRole("button", { name: GOAL_PANEL_WORDS.approve })).toBeNull();
    expect(screen.getByText(GOAL_PANEL_WORDS.readOnly)).toBeTruthy();
  });

  it("shows an active goal's progress bar, its pace in words and a pill that is never color alone", () => {
    render(<GoalPanel active={active} proposed={null} canDecide />);
    const bar = screen.getByRole("progressbar", { name: "Goal progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(bar.getAttribute("aria-valuetext")).toBe("4 of 10 paying customers");
    expect(screen.getByText("4 of 10 so far, 38 days left: on pace (Forecast).")).toBeTruthy();
    expect(screen.getByText("On pace")).toBeTruthy();
  });

  it("names each state: behind, date passed, reached; a goal without a number has no bar", () => {
    const { rerender } = render(<GoalPanel active={{ ...active, state: "behind" }} proposed={null} canDecide />);
    expect(screen.getByText("Behind")).toBeTruthy();
    rerender(<GoalPanel active={{ ...active, state: "overdue" }} proposed={null} canDecide />);
    expect(screen.getByText("Date passed")).toBeTruthy();
    rerender(<GoalPanel active={{ ...active, state: "reached" }} proposed={null} canDecide />);
    expect(screen.getByText("Reached")).toBeTruthy();
    rerender(<GoalPanel active={{ ...active, progress: null, state: "untracked" }} proposed={null} canDecide />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(GOAL_PANEL_WORDS.untracked)).toBeTruthy();
  });

  it("puts a new proposal under the active goal", () => {
    render(<GoalPanel active={active} proposed={{ ...proposal, sentence: "Get 20 paying customers by Jan 31" }} canDecide onApprove={() => {}} />);
    expect(screen.getByText(GOAL_PANEL_WORDS.newProposal)).toBeTruthy();
    expect(screen.getByText("Get 20 paying customers by Jan 31")).toBeTruthy();
    expect(document.querySelector("[data-goal-panel], [data-testid='goal-panel']")?.getAttribute("data-goal")).toBe("active");
  });
});

const rows: NeedsYouRow[] = [
  { id: "a", subject: "Sign off the product specification", from: "Ines Park", kindLabel: "Sign-off", href: "/inbox/a", quickOption: { id: "approve", label: "Approve the specification" } },
  { id: "b", subject: "Which channel first?", from: "Priya", kindLabel: "Your decision", href: "/inbox/b" },
  { id: "c", subject: "Credits used up", kindLabel: "Your decision", href: "/inbox/c", holdsContinue: true },
];

describe("NeedsYouList", () => {
  it("says nothing needs you, and still links the Inbox", () => {
    render(<NeedsYouList items={[]} total={0} seeAllHref="/inbox?tab=respond" />);
    expect(screen.getByText(NEEDS_YOU_WORDS.empty)).toBeTruthy();
    expect(screen.getByRole("link", { name: NEEDS_YOU_WORDS.seeAll }).getAttribute("href")).toBe("/inbox?tab=respond");
  });

  it("lays a row out from its container (stacked under page-wide) and keeps every control a finger's size", () => {
    render(<NeedsYouList items={rows} total={7} seeAllHref="/inbox?tab=respond" onQuickAnswer={() => {}} />);
    const first = screen.getAllByRole("listitem")[0]!;
    expect(first.className).toContain("flex-col");
    expect(first.className).toContain("@page-wide:flex-row");
    for (const el of [...within(first).getAllByRole("button"), ...within(first).getAllByRole("link"), screen.getByRole("link", { name: NEEDS_YOU_WORDS.seeAll })]) {
      expect(el.className).toContain("min-h-tap");
      expect(el.className).toContain("@page-wide:min-h-0");
    }
  });

  it("offers one tap only where the row has a quick option, and Open on every row", async () => {
    const onQuickAnswer = vi.fn();
    render(<NeedsYouList items={rows} total={7} seeAllHref="/inbox?tab=respond" onQuickAnswer={onQuickAnswer} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole("button", { name: "Approve the specification" })).toBeTruthy();
    expect(within(items[1]!).queryByRole("button")).toBeNull();
    expect(within(items[1]!).getByRole("link", { name: "Open: Which channel first?" }).getAttribute("href")).toBe("/inbox/b");
    expect(within(items[2]!).getByText("Holds Continue")).toBeTruthy();
    expect(screen.getByText("3 of 7 waiting")).toBeTruthy();
    await userEvent.click(within(items[0]!).getByRole("button", { name: "Approve the specification" }));
    expect(onQuickAnswer).toHaveBeenCalledWith(rows[0]);
  });

  it("shows one row, at most three, and renders mentions as names", () => {
    const { rerender } = render(<NeedsYouList items={[rows[1]!]} total={1} seeAllHref="/i" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("1 waiting")).toBeTruthy();
    rerender(<NeedsYouList items={[...rows, { id: "d", subject: "Fourth", href: "/d" }]} total={4} seeAllHref="/i" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    rerender(<NeedsYouList items={[{ id: "e", subject: "Call [[ent:00000000-0000-4000-8000-000000000001|Acme Ltd]] back", href: "/e" }]} total={1} seeAllHref="/i" />);
    expect(screen.getByRole("link", { name: "Open: Call Acme Ltd back" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("[[ent:");
  });

  it("links through the shell's router link", () => {
    const renderLink = vi.fn(({ href, children, className, "aria-label": label }) => (
      <a href={href} className={className} aria-label={label} data-router-link="">
        {children}
      </a>
    ));
    render(
      <ShellLinkProvider render={renderLink}>
        <NeedsYouList items={rows} total={3} seeAllHref="/inbox?tab=respond" />
      </ShellLinkProvider>,
    );
    expect(screen.getByRole("link", { name: NEEDS_YOU_WORDS.seeAll }).getAttribute("data-router-link")).toBe("");
  });

  it("meta counts what is shown against what waits", () => {
    expect(needsYouMeta(0, 0)).toBeNull();
    expect(needsYouMeta(3, 3)).toBe("3 waiting");
    expect(needsYouMeta(3, 9)).toBe("3 of 9 waiting");
  });
});

describe("WeekPlan", () => {
  it("shows this week and next as sentences", () => {
    render(<WeekPlan done={["This week the team finished 6 pieces of work, 4 of them for “Online booking”."]} next={["Next: Set up card payments, starting this round.", "Press Continue and the team keeps going until nothing is left."]} />);
    expect(screen.getByRole("heading", { name: WEEK_PLAN_WORDS.title })).toBeTruthy();
    expect(screen.getByText(WEEK_PLAN_WORDS.done)).toBeTruthy();
    expect(screen.getByText(WEEK_PLAN_WORDS.next)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says why there is nothing", () => {
    render(<WeekPlan done={[]} next={[]} empty="Members who can read Development see the week here." />);
    expect(screen.getByText("Members who can read Development see the week here.")).toBeTruthy();
  });
});

describe("PublicPageNote", () => {
  it("is one quiet link to the Public page tab, through the shell's link renderer", () => {
    render(<PublicPageNote href="/b/b1/d/product/public-page" />);
    const link = screen.getByRole("link", { name: /Your project's public page is ready to check/ });
    expect(link.getAttribute("href")).toBe("/b/b1/d/product/public-page");
    expect(link.textContent).toBe(`${PUBLIC_PAGE_NOTE_WORDS.line}${PUBLIC_PAGE_NOTE_WORDS.open}`);
  });
});
