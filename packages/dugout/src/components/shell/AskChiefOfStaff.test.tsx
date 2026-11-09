import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChiefQuestion } from "@foundmill/shared";
import { Avatar } from "../foundation/Avatar";
import { EntityLinkProvider } from "../data/EntityLink";
import { AppShell, type AppShellProps } from "./AppShell";
import { AskChiefOfStaff, ASK_CHIEF_ERROR, type AskChiefAnswer, type AskChiefOfStaffProps } from "./AskChiefOfStaff";
import { FIXTURE_TODAY, NORTHWIND_KIT, NORTHWIND_SEGMENTS, NORTHWIND_SIDEBAR } from "./fixtures";

const AGENT = "11111111-1111-4111-8111-111111111111";

const avatar = (size: number) => <Avatar size={size} name="Ines Park" agent={{ seed: "ines", dept: "dept-1" }} />;

function Harness({ answer, ...rest }: Partial<AskChiefOfStaffProps> & { answer?: AskChiefAnswer | null }) {
  const [q, setQ] = useState<ChiefQuestion | null>(null);
  return (
    <EntityLinkProvider value={{}}>
      <AskChiefOfStaff name="Ines" renderAvatar={avatar} answer={q ? (answer ?? { status: "loading" }) : null} onQuestionChange={setQ} onContinue={vi.fn()} onAskElse={vi.fn()} {...rest} />
    </EntityLinkProvider>
  );
}

describe("AskChiefOfStaff", () => {
  it("is one focusable button named for the Chief of Staff, with their avatar", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Ask Ines" });
    expect(trigger.getAttribute("data-testid")).toBe("ask-chief-trigger");
    expect(trigger.querySelector("svg, [data-avatar], img, span")).toBeTruthy();
    await userEvent.tab();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a menu of the three questions and Ask something else, the first one focused", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["What's happening?", "What's blocking us?", "Why am I seeing this?", "Ask something else…"]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it("moves between the rows with the arrow keys, Home and End", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(items[3]);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[3]);
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(items[0]);
  });

  it("asks with Enter and shows a skeleton while the answer loads, focus on the answer", async () => {
    const onQuestionChange = vi.fn();
    render(<Harness onQuestionChange={onQuestionChange} answer={{ status: "loading" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    await screen.findAllByRole("menuitem");
    await userEvent.keyboard("{Enter}");
    expect(onQuestionChange).toHaveBeenCalledWith("happening");
    expect(await screen.findByTestId("ask-chief-loading")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("ask-chief-answer")));
  });

  it("renders the answer through EntityText: a mention becomes a link, not markup", async () => {
    render(<Harness answer={{ status: "ready", text: `[[ent:${AGENT}|Juno Reyes]] is working on “Set up card payments”.` }} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "What's happening?" }));
    const text = await screen.findByTestId("ask-chief-text");
    expect(text.textContent).toContain("Juno Reyes is working on “Set up card payments”.");
    expect(text.textContent).not.toContain("[[ent:");
    expect(text.querySelector("[data-entity], a, button")).toBeTruthy();
    expect(screen.getByTestId("ask-chief-answer").getAttribute("aria-label")).toBe("Ines: What's happening?");
  });

  it("shows an error with Try again", async () => {
    const onRetry = vi.fn();
    render(<Harness answer={{ status: "error" }} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "What's blocking us?" }));
    expect((await screen.findByTestId("ask-chief-error")).textContent).toContain(ASK_CHIEF_ERROR);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("Continue in chat closes and hands over the question; Back returns to the menu", async () => {
    const onContinue = vi.fn();
    render(<Harness answer={{ status: "ready", text: "Nothing is blocking the team." }} onContinue={onContinue} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Why am I seeing this?" }));
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await userEvent.click(items[1]!);
    await userEvent.click(await screen.findByRole("button", { name: "Continue in chat" }));
    expect(onContinue).toHaveBeenCalledWith("blocking");
    await waitFor(() => expect(screen.queryByTestId("ask-chief-panel")).toBeNull());
  });

  it("Ask something else closes and opens the desk with nothing typed", async () => {
    const onAskElse = vi.fn();
    render(<Harness onAskElse={onAskElse} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Ines" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ask something else…" }));
    expect(onAskElse).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByTestId("ask-chief-panel")).toBeNull());
  });

  it("Escape closes it and the focus returns to the button; the next open starts at the menu", async () => {
    render(<Harness answer={{ status: "ready", text: "Nothing is blocking the team." }} />);
    const trigger = screen.getByRole("button", { name: "Ask Ines" });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("menuitem", { name: "What's blocking us?" }));
    await screen.findByTestId("ask-chief-answer");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("ask-chief-panel")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    expect(await screen.findByTestId("ask-chief-menu")).toBeTruthy();
  });

  it("calls onIntent when the pointer or focus reaches the button", async () => {
    const onIntent = vi.fn();
    render(<Harness onIntent={onIntent} />);
    await userEvent.hover(screen.getByRole("button", { name: "Ask Ines" }));
    expect(onIntent).toHaveBeenCalled();
  });
});

describe("AppShell pageActions", () => {
  const shell = (over: Partial<AppShellProps> = {}): AppShellProps => ({
    mode: "live",
    businessMode: "assisted",
    kit: NORTHWIND_KIT,
    businessName: "Northwind Skincare",
    screenTitle: "Today",
    sidebar: { items: NORTHWIND_SIDEBAR, activeId: "home", collapsed: false, onCollapsedChange: vi.fn() },
    continueButton: { state: { kind: "idle" }, onContinue: vi.fn() },
    stopAll: { onConfirm: vi.fn() },
    processing: { segments: NORTHWIND_SEGMENTS, active: false },
    date: FIXTURE_TODAY,
    runwayMonths: 11,
    viewportWidth: 1440,
    pageActions: <button type="button">Ask Ines</button>,
    children: <p>Content</p>,
    ...over,
  });
  const askButtons = () => screen.getAllByRole("button", { name: "Ask Ines" });

  it("draws it once at the end of the tab row", () => {
    render(<AppShell {...shell({ tabs: { tabs: [{ id: "today", label: "Today" }], activeId: "today" } })} />);
    expect(askButtons()).toHaveLength(1);
    expect(screen.queryByTestId("page-actions-row")).toBeNull();
    expect(askButtons()[0]!.closest("[role=tablist], nav, div")).toBeTruthy();
  });

  it("draws it once in the breadcrumb row on a page with breadcrumbs and no tabs", () => {
    render(<AppShell {...shell({ breadcrumbs: [{ label: "Team", href: "/team" }, { label: "Juno" }] })} />);
    expect(askButtons()).toHaveLength(1);
    expect(screen.queryByTestId("page-actions-row")).toBeNull();
  });

  it("draws it once in a thin row of its own on a page with neither", () => {
    render(<AppShell {...shell()} />);
    expect(askButtons()).toHaveLength(1);
    expect(screen.getByTestId("page-actions-row").contains(askButtons()[0]!)).toBe(true);
  });

  it("draws nothing extra without it", () => {
    render(<AppShell {...shell({ pageActions: undefined })} />);
    expect(screen.queryByRole("button", { name: "Ask Ines" })).toBeNull();
    expect(screen.queryByTestId("page-actions-row")).toBeNull();
  });
});
